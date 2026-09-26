/**
 * Verifies that subagent work survives the run WITHOUT calling the agent (zero
 * API cost). A synthetic run delegates to a researcher, which searches and
 * writes a /research/ file; then — like the real adapter — a lead-only
 * MESSAGES_SNAPSHOT arrives, which used to erase all of it. The stream goes
 * through the real SubagentTracker, as it does on the server.
 *
 *   node scripts/verify-subagents.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { SubagentTracker } from "../src/lib/subagent-tracker.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
fs.mkdirSync(OUT, { recursive: true });

const LEAD_NS = { metadata: { langgraph_checkpoint_ns: "tools:lead-step" } };
const SUB_NS = { metadata: { langgraph_checkpoint_ns: "tools:task-1|tools:inner" } };
const note = "# Are ETF inflows driving it?\n\n## Findings\n- Inflows rose\n\n## Sources\n- [Example](https://example.com)\n";

function stream(threadId, runId) {
  const ev = [];
  const push = (e) => ev.push(e);
  const call = (id, name, args, result, rawEvent, parentMessageId = null) => {
    push({ type: "TOOL_CALL_START", toolCallId: id, toolCallName: name, parentMessageId, rawEvent });
    push({ type: "TOOL_CALL_ARGS", toolCallId: id, delta: JSON.stringify(args) });
    push({ type: "TOOL_CALL_END", toolCallId: id });
    push({ type: "TOOL_CALL_RESULT", toolCallId: id, messageId: `res-${id}`, role: "tool", content: result });
  };
  push({ type: "RUN_STARTED", threadId, runId });
  push({ type: "TEXT_MESSAGE_START", messageId: "lead-1", role: "assistant" });
  push({ type: "TEXT_MESSAGE_CONTENT", messageId: "lead-1", delta: "Delegating the ETF question." });
  push({ type: "TEXT_MESSAGE_END", messageId: "lead-1" });
  // The lead's task call streams from its model, so it carries its message id.
  push({ type: "TOOL_CALL_START", toolCallId: "task-1", toolCallName: "task", parentMessageId: "lead-1", rawEvent: LEAD_NS });
  push({ type: "TOOL_CALL_ARGS", toolCallId: "task-1", delta: JSON.stringify({ description: "ETF inflows", subagent_type: "researcher" }) });
  push({ type: "TOOL_CALL_END", toolCallId: "task-1" });
  // The researcher's own calls: one level deeper in the graph.
  call("sub-search-1", "research", { query: "bitcoin ETF inflows September" }, "sources…", SUB_NS);
  call("sub-search-2", "research", { query: "ETF net flows 30 days" }, "sources…", SUB_NS);
  call("sub-write-1", "write_file", { file_path: "/research/etf-inflows.md", content: note }, "ok", SUB_NS);
  push({ type: "TOOL_CALL_RESULT", toolCallId: "task-1", messageId: "task-1-result", role: "tool", content: "ETF inflows were the main driver." });
  push({ type: "TEXT_MESSAGE_START", messageId: "lead-2", role: "assistant" });
  push({ type: "TEXT_MESSAGE_CONTENT", messageId: "lead-2", delta: "ETF inflows were the main driver." });
  push({ type: "TEXT_MESSAGE_END", messageId: "lead-2" });
  // What the adapter sends at the end: the lead's thread only.
  push({
    type: "MESSAGES_SNAPSHOT",
    messages: [
      { id: "user-1", role: "user", content: "subagent check" },
      {
        id: "lead-1",
        role: "assistant",
        content: "Delegating the ETF question.",
        toolCalls: [{ id: "task-1", type: "function", function: { name: "task", arguments: JSON.stringify({ description: "ETF inflows", subagent_type: "researcher" }) } }],
      },
      { id: "task-1-result", role: "tool", toolCallId: "task-1", content: "ETF inflows were the main driver." },
      { id: "lead-2", role: "assistant", content: "ETF inflows were the main driver." },
    ],
  });
  push({ type: "RUN_FINISHED", threadId, runId });
  const tracker = new SubagentTracker();
  return ev.map((e) => `data: ${JSON.stringify(tracker.process(e))}\n\n`).join("");
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
await page.route("**/api/copilotkit/agent/workbench/run", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: stream(body.threadId, body.runId) });
});

await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator("textarea").first().fill("subagent check");
await page.locator("textarea").first().press("Enter");
await page.getByText("ETF inflows were the main driver.").first().waitFor();
await page.waitForTimeout(1200);

const workspace = page.locator("section", { has: page.getByRole("heading", { name: "Workspace" }) });
check(await workspace.getByText("/research/etf-inflows.md").isVisible(), "the researcher's /research/ file survives the final snapshot");
check(await workspace.getByText("by a researcher").isVisible(), "…and is labelled as the researcher's");

const activity = page.locator("section", { has: page.getByRole("heading", { name: "Activity" }) });
check(await activity.getByText("bitcoin ETF inflows September").isVisible(), "researcher searches stay in Activity");
check((await activity.getByText("subagent", { exact: true }).count()) === 2, "…each search tagged as subagent work (2; file writes go to the Workspace)");

const chat = page.locator("section", { has: page.getByRole("heading", { name: "Conversation" }) });
check(!(await chat.getByText("bitcoin ETF inflows September").isVisible()), "researcher searches are not in the chat");
check(await chat.getByText("ETF inflows", { exact: false }).first().isVisible(), "the lead's task call is still in the chat");

await workspace.getByText("/research/etf-inflows.md").click();
check(await page.getByRole("dialog", { name: "/research/etf-inflows.md" }).getByText("Findings").isVisible(), "the research file opens and renders");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check(!(await page.getByRole("dialog").isVisible()), "Escape closes the file viewer");
await page.screenshot({ path: `${OUT}/subagents.png` });

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshot in ${OUT}`);
process.exit(failures.length ? 1 : 0);
