/**
 * Verifies the reasoning cards WITHOUT calling the agent (zero API cost). The
 * synthetic run streams a thinking summary the way @ag-ui/langgraph emits it
 * for Opus 5 with `display: "summarized"` (REASONING_* events, then the
 * answer), ending in a snapshot that — like the real adapter's — holds no
 * reasoning. It goes through the real SubagentTracker, as on the server.
 *
 *   node scripts/verify-reasoning.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { SubagentTracker, withoutReasoningMessages } from "../src/lib/subagent-tracker.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
fs.mkdirSync(OUT, { recursive: true });

const THOUGHT = "Counting combinations of coins: build up from pennies, then add nickels, dimes, quarters and half-dollars.";
let lastSnapshot = null;

function stream(body, n) {
  const user = body.messages.filter((m) => m.role === "user").at(-1);
  const ev = [
    { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
    { type: "REASONING_START", messageId: `think-${n}` },
    { type: "REASONING_MESSAGE_START", messageId: `think-${n}`, role: "reasoning" },
    { type: "REASONING_MESSAGE_CONTENT", messageId: `think-${n}`, delta: THOUGHT.slice(0, 40) },
    { type: "REASONING_MESSAGE_CONTENT", messageId: `think-${n}`, delta: THOUGHT.slice(40) },
    { type: "REASONING_MESSAGE_END", messageId: `think-${n}` },
    { type: "REASONING_END", messageId: `think-${n}` },
    { type: "TEXT_MESSAGE_START", messageId: `ans-${n}`, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: `ans-${n}`, delta: `There are 292 ways (${n}).` },
    { type: "TEXT_MESSAGE_END", messageId: `ans-${n}` },
    {
      type: "MESSAGES_SNAPSHOT",
      messages: [
        ...body.messages.filter((m) => m.role === "user" || m.role === "assistant"),
        { id: `ans-${n}`, role: "assistant", content: `There are 292 ways (${n}).` },
      ].filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i),
    },
    { type: "RUN_FINISHED", threadId: body.threadId, runId: body.runId },
  ];
  void user;
  const tracker = new SubagentTracker(body.messages);
  const out = ev.map((e) => tracker.process(e));
  lastSnapshot = out.find((e) => e.type === "MESSAGES_SNAPSHOT");
  return out.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
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
const runs = [];
await page.route("**/api/copilotkit/agent/workbench/run", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  runs.push(body);
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: stream(body, runs.length) });
});
const chat = page.locator("section", { has: page.getByRole("heading", { name: "Conversation" }) });

try {
  await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator("textarea").first().fill("How many ways to make change for a dollar?");
  await page.locator("textarea").first().press("Enter");
  await chat.getByText("There are 292 ways (1).").first().waitFor();
  await page.waitForTimeout(800);

  const ids = lastSnapshot.messages.map((m) => m.id);
  check(ids.indexOf("think-1") >= 0 && ids.indexOf("think-1") === ids.indexOf("ans-1") - 1, "the snapshot keeps the reasoning, right before its answer");
  const card = chat.getByTestId("reasoning-card");
  check(await card.getByText("Reasoning").isVisible(), "a reasoning card shows once the answer is in");
  check(await card.getByText(/\d+ words/).isVisible(), "…with its length");
  check(!(await card.getByText(THOUGHT).isVisible()), "…folded by default");
  await card.getByRole("button").click();
  check(await card.getByText(THOUGHT).isVisible(), "unfolding shows the model's reasoning summary");
  await page.screenshot({ path: `${OUT}/reasoning.png` });

  // Next turn: reasoning is display-only and never goes back as input.
  await page.locator("textarea").first().fill("And for two dollars?");
  await page.locator("textarea").first().press("Enter");
  await chat.getByText("There are 292 ways (2).").first().waitFor();
  check(runs[1].messages.some((m) => m.role === "reasoning"), "the browser holds the first turn's reasoning");
  check(!withoutReasoningMessages(runs[1]).messages.some((m) => m.role === "reasoning"), "…which is stripped before it reaches the agent");
  check((await chat.getByTestId("reasoning-card").count()) === 2, "both turns keep their reasoning card");

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshot in ${OUT}`);
process.exit(failures.length ? 1 : 0);
