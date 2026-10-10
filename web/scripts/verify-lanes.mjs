/**
 * Verifies the research lanes WITHOUT calling the agent (zero API cost).
 *
 * Synthetic runs go through the real SubagentTracker, as on the server:
 *   1. two parallel researchers, one still working when the stream ends →
 *      the banner names it and its lane shows live progress;
 *   2. the same delegation finished → a "Parallel research" group with two
 *      lanes, each with its own searches and notes (matched to its `task` by
 *      the lead's on_tool_start, as the real adapter emits it), collapsible;
 *   3. a follow-up turn whose final snapshot holds the lead's thread only →
 *      the first turn's lanes keep their work (carried over by the tracker).
 *
 *   node scripts/verify-lanes.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { SubagentTracker } from "../src/lib/subagent-tracker.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
fs.mkdirSync(OUT, { recursive: true });

const MODEL_NS = { metadata: { langgraph_checkpoint_ns: "model:lead" } };
const TASKS = [
  { id: "task-a", ns: "tools:ns-a", description: "Research Alpha Corp pricing", subagent_type: "researcher" },
  { id: "task-b", ns: "tools:ns-b", description: "Research Beta Inc market share", subagent_type: "researcher" },
];

// The user message keeps the id the browser gave it, as in a real snapshot.
let firstUserId = "user-1";
function leadMessages(withResults) {
  return [
    { id: firstUserId, role: "user", content: "lanes check" },
    {
      id: "lead-1",
      role: "assistant",
      content: "Splitting this across two researchers.",
      toolCalls: TASKS.map((t) => ({
        id: t.id,
        type: "function",
        function: { name: "task", arguments: JSON.stringify({ description: t.description, subagent_type: t.subagent_type }) },
      })),
    },
    ...(withResults
      ? [
          { id: "res-a", role: "tool", toolCallId: "task-a", content: "Alpha charges $20 per seat." },
          { id: "res-b", role: "tool", toolCallId: "task-b", content: "Beta holds 31% of the market." },
          { id: "lead-2", role: "assistant", content: "Alpha is cheaper; Beta is bigger." },
        ]
      : []),
  ];
}

function firstTurn(threadId, runId, finished) {
  const ev = [];
  const push = (e) => ev.push(e);
  const sub = (t, id, name, args, result) => {
    const raw = { metadata: { langgraph_checkpoint_ns: `${t.ns}|tools:${id}` } };
    push({ type: "TOOL_CALL_START", toolCallId: id, toolCallName: name, parentMessageId: null, rawEvent: raw });
    push({ type: "TOOL_CALL_ARGS", toolCallId: id, delta: JSON.stringify(args) });
    push({ type: "TOOL_CALL_END", toolCallId: id });
    if (result !== undefined) push({ type: "TOOL_CALL_RESULT", toolCallId: id, messageId: `r-${id}`, role: "tool", content: result });
  };
  push({ type: "RUN_STARTED", threadId, runId });
  push({ type: "TEXT_MESSAGE_START", messageId: "lead-1", role: "assistant" });
  push({ type: "TEXT_MESSAGE_CONTENT", messageId: "lead-1", delta: "Splitting this across two researchers." });
  push({ type: "TEXT_MESSAGE_END", messageId: "lead-1" });
  for (const t of TASKS) {
    push({ type: "TOOL_CALL_START", toolCallId: t.id, toolCallName: "task", parentMessageId: "lead-1", rawEvent: MODEL_NS });
    push({ type: "TOOL_CALL_ARGS", toolCallId: t.id, delta: JSON.stringify({ description: t.description, subagent_type: t.subagent_type }) });
    push({ type: "TOOL_CALL_END", toolCallId: t.id });
  }
  // The lead's tools node starts each task in its own namespace — the RAW
  // event the tracker matches on. Note: in reverse order, so matching is by
  // arguments, not position.
  for (const t of [...TASKS].reverse()) {
    push({
      type: "RAW",
      event: { event: "on_tool_start", name: "task", metadata: { langgraph_checkpoint_ns: t.ns }, data: { input: { description: t.description, subagent_type: t.subagent_type } } },
    });
  }
  const [a, b] = TASKS;
  sub(a, "a-s1", "research", { query: "Alpha Corp seat price" }, "sources…");
  sub(b, "b-s1", "research", { query: "Beta Inc share 2026" }, "sources…");
  sub(a, "a-s2", "research", { query: "Alpha Corp enterprise tier" }, "sources…");
  sub(a, "a-w1", "write_file", { file_path: "/research/alpha-pricing.md", content: "# Alpha" }, "ok");
  if (finished) {
    sub(b, "b-w1", "write_file", { file_path: "/research/beta-share.md", content: "# Beta" }, "ok");
    push({ type: "TOOL_CALL_RESULT", toolCallId: "task-a", messageId: "res-a", role: "tool", content: "Alpha charges $20 per seat." });
    push({ type: "TOOL_CALL_RESULT", toolCallId: "task-b", messageId: "res-b", role: "tool", content: "Beta holds 31% of the market." });
    push({ type: "TEXT_MESSAGE_START", messageId: "lead-2", role: "assistant" });
    push({ type: "TEXT_MESSAGE_CONTENT", messageId: "lead-2", delta: "Alpha is cheaper; Beta is bigger." });
    push({ type: "TEXT_MESSAGE_END", messageId: "lead-2" });
  } else {
    // Beta's researcher is mid-search when the stream ends.
    sub(b, "b-s2", "research", { query: "Beta Inc competitors" }, undefined);
    push({ type: "TOOL_CALL_RESULT", toolCallId: "task-a", messageId: "res-a", role: "tool", content: "Alpha charges $20 per seat." });
  }
  const snapshot = leadMessages(finished);
  if (!finished) snapshot.push({ id: "res-a", role: "tool", toolCallId: "task-a", content: "Alpha charges $20 per seat." });
  push({ type: "MESSAGES_SNAPSHOT", messages: snapshot });
  push({ type: "RUN_FINISHED", threadId, runId });
  const tracker = new SubagentTracker();
  return ev.map((e) => `data: ${JSON.stringify(tracker.process(e))}\n\n`).join("");
}

function followUp(threadId, runId, inputMessages) {
  const tracker = new SubagentTracker(inputMessages);
  const ev = [
    { type: "RUN_STARTED", threadId, runId },
    { type: "TEXT_MESSAGE_START", messageId: "lead-3", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "lead-3", delta: "Follow-up answered." },
    { type: "TEXT_MESSAGE_END", messageId: "lead-3" },
    {
      type: "MESSAGES_SNAPSHOT",
      messages: [
        ...leadMessages(true),
        { id: inputMessages.filter((m) => m.role === "user").at(-1)?.id ?? "user-2", role: "user", content: "and in Europe?" },
        { id: "lead-3", role: "assistant", content: "Follow-up answered." },
      ],
    },
    { type: "RUN_FINISHED", threadId, runId },
  ];
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
let mode = "partial";
let followUpInput = null;
await page.route("**/api/copilotkit/agent/workbench/run", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  let sse;
  if (mode === "followup") {
    followUpInput = body.messages;
    sse = followUp(body.threadId, body.runId, body.messages);
  } else {
    firstUserId = body.messages?.find((m) => m.role === "user")?.id ?? firstUserId;
    sse = firstTurn(body.threadId, body.runId, mode === "full");
  }
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sse });
});

const send = async (text) => {
  await page.locator("textarea").first().fill(text);
  await page.locator("textarea").first().press("Enter");
};
const chat = page.locator("section", { has: page.getByRole("heading", { name: "Conversation" }) });
const lane = (description) => chat.locator("[data-lane-status]", { hasText: description });

try {
  await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });

  // --- 1. one researcher still working
  await page.goto(BASE, { waitUntil: "networkidle" });
  await send("lanes check");
  await page.getByText("Splitting this across two researchers.").first().waitFor();
  await page.waitForTimeout(1000);
  const banner = chat.getByRole("status");
  check(await banner.getByText("1 researcher working").isVisible(), "banner names the researcher still working");
  check(await banner.getByText("Research Beta Inc market share").isVisible(), "…by its task");
  check((await lane("Research Beta Inc market share").getAttribute("data-lane-status")) === "working", "Beta's lane is live (Researching)");
  check(await lane("Research Beta Inc market share").getByText("Beta Inc competitors").isVisible(), "…showing its latest step");
  check((await lane("Research Alpha Corp pricing").getAttribute("data-lane-status")) === "done", "Alpha's lane is done");
  await page.screenshot({ path: `${OUT}/lanes-working.png` });

  // --- 2. finished, in a new conversation
  mode = "full";
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.waitForTimeout(500);
  await send("lanes check");
  await page.getByText("Alpha is cheaper; Beta is bigger.").first().waitFor();
  await page.waitForTimeout(1000);
  check(!(await chat.getByRole("status").isVisible()), "no banner once every researcher is done");
  const group = chat.getByTestId("delegation-group");
  check(await group.getByText("2 researchers · 2 of 2 done").isVisible(), "parallel delegation is framed with its progress");
  const alpha = lane("Research Alpha Corp pricing");
  const beta = lane("Research Beta Inc market share");
  check(await alpha.getByText("2 searches · 1 note").isVisible(), "Alpha's lane counts its own work (2 searches, 1 note)");
  check(await beta.getByText("1 search · 1 note").isVisible(), "Beta's lane counts its own work (1 search, 1 note)");
  check(await alpha.getByText("Alpha charges $20 per seat.").isVisible(), "a finished lane shows the researcher's answer");
  check(!(await chat.getByText("Alpha Corp seat price").isVisible()), "subagent searches are not chat rows");
  await alpha.getByRole("button", { name: "Show 3 steps" }).click();
  check(await alpha.getByText("Alpha Corp seat price").isVisible(), "expanding a lane lists its steps");
  await page.screenshot({ path: `${OUT}/lanes-done.png` });
  await group.getByRole("button", { name: "Collapse" }).click();
  check(!(await alpha.isVisible()), "collapsing the group hides the lanes…");
  check(await group.getByText("Research Alpha Corp pricing").isVisible(), "…and leaves a chip per researcher");
  await group.getByRole("button", { name: "Expand" }).click();

  const activity = page.locator("section", { has: page.getByRole("heading", { name: "Activity" }) });
  check(await activity.getByText("Alpha Corp seat price").isVisible(), "the Activity panel still lists subagent searches");

  // --- 3. a follow-up turn keeps the first turn's lanes
  mode = "followup";
  await send("and in Europe?");
  await page.getByText("Follow-up answered.").first().waitFor();
  await page.waitForTimeout(1000);
  check(Array.isArray(followUpInput) && followUpInput.some((m) => m.subagentRunId === "task-a"), "subagent calls are tagged with their task's id");
  check(await alpha.getByText("2 searches · 1 note").isVisible(), "after a follow-up, the first turn's lane keeps its work");
  check(await activity.getByText("Alpha Corp seat price").isVisible(), "…and so does the Activity panel");

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshots in ${OUT}`);
process.exit(failures.length ? 1 : 0);
