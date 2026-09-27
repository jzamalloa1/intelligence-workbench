/**
 * Verifies the Context and Cost meters WITHOUT calling the agent (zero API
 * cost): two synthetic turns whose model-call usage reports go through the real
 * UsageTracker. Checks the meters, the breakdown, the math, and that usage
 * carries into the next turn through the run input's state.
 *
 *   node scripts/verify-usage.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { UsageTracker, takeUsageFromInput } from "../src/lib/usage-tracker.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
fs.mkdirSync(OUT, { recursive: true });

const modelEnd = (model, ns, usage) => ({
  type: "RAW",
  event: {
    event: "on_chat_model_end",
    metadata: { ls_model_name: model, ls_provider: "anthropic", langgraph_checkpoint_ns: ns },
    data: { output: { usage_metadata: usage } },
  },
});
// Lead: 10,000 in (9,000 cache-written), 500 out → 1,000×$5 + 9,000×$6.25 + 500×$25 = $0.07375
const LEAD = modelEnd("claude-opus-5", "model:x", { input_tokens: 10_000, output_tokens: 500, input_token_details: { cache_creation: 9_000, cache_read: 0 } });
// Researcher: 5,000 in (4,000 read from cache), 200 out → 1,000×$2 + 4,000×$0.20 + 200×$10 = $0.0048
const SUB = modelEnd("claude-sonnet-5", "tools:a|tools:b", { input_tokens: 5_000, output_tokens: 200, input_token_details: { cache_read: 4_000, cache_creation: 0, ephemeral_5m_input_tokens: 0 } });

function stream(body, turn) {
  const { previous } = takeUsageFromInput(body);
  const usage = new UsageTracker(previous);
  const { threadId, runId } = body;
  const ev = [
    { type: "RUN_STARTED", threadId, runId },
    LEAD,
    SUB,
    { type: "TEXT_MESSAGE_START", messageId: `m${turn}`, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: `m${turn}`, delta: `Turn ${turn} done.` },
    { type: "TEXT_MESSAGE_END", messageId: `m${turn}` },
    { type: "STATE_SNAPSHOT", snapshot: { todos: [] } },
    { type: "RUN_FINISHED", threadId, runId },
  ];
  return ev.flatMap((e) => usage.process(e)).map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${msg}`);
  if (!ok) failures.push(msg);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const bodies = [];
await page.route("**/api/copilotkit/agent/workbench/run", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  bodies.push(body);
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: stream(body, bodies.length) });
});

await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });
await page.goto(BASE, { waitUntil: "networkidle" });
const send = async (text) => {
  await page.locator("textarea").first().fill(text);
  await page.locator("textarea").first().press("Enter");
};

await send("first");
await page.getByText("Turn 1 done.").waitFor();
const meter = page.getByRole("button", { name: /Context.*Cost/ });
await meter.waitFor();
// Per turn: $0.07375 + $0.0048 = $0.07855.
check((await meter.innerText()).includes("$0.08"), `cost after turn 1 is $0.08 (got "${(await meter.innerText()).replace(/\s+/g, " ")}")`);

await send("second");
await page.getByText("Turn 2 done.").waitFor();
const carried = bodies[1]?.state?.workbenchUsage;
check(Array.isArray(carried) && carried.length === 2, `turn 2's input carries turn 1's usage (${carried?.length ?? 0} records)`);
check((await meter.innerText()).includes("$0.16"), `cost accumulates across turns → $0.16 (got "${(await meter.innerText()).replace(/\s+/g, " ")}")`);

await meter.click();
const pop = page.getByRole("dialog", { name: "Usage for this conversation" });
await pop.waitFor();
check(await pop.getByText("4 model calls").isVisible(), "breakdown counts 4 calls");
check(await pop.getByRole("cell", { name: /Claude Opus 5\s*lead/ }).isVisible(), "lead row");
check(await pop.getByRole("cell", { name: /Claude Sonnet 5\s*subagents/ }).isVisible(), "subagent row");
check(await pop.getByText("% of 1M").isVisible(), "context shown against the model's 1M window");
await page.screenshot({ path: `${OUT}/usage.png` });

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshot in ${OUT}`);
process.exit(failures.length ? 1 : 0);
