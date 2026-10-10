/**
 * Verifies the chat's welcome screen, suggestions, regenerate and edit WITHOUT
 * calling the agent (zero API cost) — every run request is answered with a
 * synthetic stream, and the requests the page sends are checked.
 *
 *   node scripts/verify-chat.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
fs.mkdirSync(OUT, { recursive: true });

const chart = { title: "Rate history", chart_type: "line", categories: ["2024", "2025", "2026"], series: [{ name: "Rate", values: [5.3, 4.3, 3.8], unit: "%" }] };

function answer(body, n) {
  const user = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  const ev = [
    { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
    { type: "TEXT_MESSAGE_START", messageId: `a${n}`, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: `a${n}`, delta: `Answer ${n}.` },
    { type: "TEXT_MESSAGE_END", messageId: `a${n}` },
    { type: "TOOL_CALL_START", toolCallId: `c${n}`, toolCallName: "render_chart", parentMessageId: `a${n}` },
    { type: "TOOL_CALL_ARGS", toolCallId: `c${n}`, delta: JSON.stringify(chart) },
    { type: "TOOL_CALL_END", toolCallId: `c${n}` },
    { type: "TOOL_CALL_RESULT", toolCallId: `c${n}`, messageId: `r${n}`, role: "tool", content: '{"rendered": true}' },
    {
      type: "MESSAGES_SNAPSHOT",
      messages: [
        ...(body.messages ?? []).filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool"),
        {
          id: `a${n}`,
          role: "assistant",
          content: `Answer ${n}.`,
          toolCalls: [{ id: `c${n}`, type: "function", function: { name: "render_chart", arguments: JSON.stringify(chart) } }],
        },
        { id: `r${n}`, role: "tool", toolCallId: `c${n}`, content: '{"rendered": true}' },
      ].filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i),
    },
    { type: "RUN_FINISHED", threadId: body.threadId, runId: body.runId },
  ];
  void user;
  return ev.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
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
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: answer(body, runs.length) });
});
const chat = page.locator("section", { has: page.getByRole("heading", { name: "Conversation" }) });
const lastUser = (run) => [...(run?.messages ?? [])].reverse().find((m) => m.role === "user");

try {
  await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });
  await page.goto(BASE, { waitUntil: "networkidle" });

  // --- welcome + starters
  check(await chat.getByRole("heading", { name: "What should we research?" }).isVisible(), "welcome screen shows the hero");
  for (const t of ["Size a market", "Compare competitors", "Explain a trend", "Quick fact check"]) {
    check(await chat.getByRole("button", { name: new RegExp(`^${t}`) }).isVisible(), `starter card: ${t}`);
  }
  await page.screenshot({ path: `${OUT}/chat-welcome.png` });
  await chat.getByRole("button", { name: /^Quick fact check/ }).click();
  await chat.getByText("Answer 1.").first().waitFor();
  check(lastUser(runs[0])?.content?.startsWith("What is the current US federal funds rate"), "a starter sends its prompt");

  // --- follow-ups from what the run produced
  await page.waitForTimeout(800);
  check(await chat.getByRole("button", { name: "Turn this into a report" }).isVisible(), "follow-up offered after a chart: turn into a report");
  check(await chat.getByRole("button", { name: "What's least certain?" }).isVisible(), "follow-up offered: least certain");
  check(!(await chat.getByRole("heading", { name: "What should we research?" }).isVisible()), "the welcome screen is gone after the first message");
  await page.screenshot({ path: `${OUT}/chat-followups.png` });

  // --- regenerate
  const userMsg = lastUser(runs[0]);
  await chat.getByText("Answer 1.").first().hover();
  await chat.getByRole("button", { name: "Regenerate" }).last().click();
  await chat.getByText("Answer 2.").first().waitFor();
  check(
    runs[1]?.forwardedProps?.workbenchRewind?.messageId === userMsg.id &&
      runs[1].forwardedProps.workbenchRewind.content === userMsg.content,
    "regenerate asks the server to rewind to the question",
  );
  check(runs[1]?.messages?.at(-1)?.id === userMsg.id, "…with the conversation trimmed to end at it");
  check(!(await chat.getByText("Answer 1.").first().isVisible()), "the old answer is replaced");

  // --- edit
  await chat.getByText(userMsg.content).first().hover();
  await chat.getByRole("button", { name: "Edit" }).first().click();
  const bar = page.getByRole("form", { name: "Edit your message" });
  check(await bar.isVisible(), "edit opens the edit bar with the message");
  await bar.getByRole("textbox").fill("What is the ECB deposit rate?");
  await page.screenshot({ path: `${OUT}/chat-edit.png` });
  await bar.getByRole("button", { name: "Re-run from here" }).click();
  await chat.getByText("Answer 3.").first().waitFor();
  check(
    runs[2]?.forwardedProps?.workbenchRewind?.content === "What is the ECB deposit rate?" &&
      lastUser(runs[2])?.content === "What is the ECB deposit rate?" &&
      lastUser(runs[2])?.id === userMsg.id,
    "edit re-runs from the same message with the new text",
  );
  check(await chat.getByText("What is the ECB deposit rate?").first().isVisible(), "the edited question shows in the chat");

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshots in ${OUT}`);
process.exit(failures.length ? 1 : 0);
