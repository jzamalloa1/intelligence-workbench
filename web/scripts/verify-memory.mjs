/**
 * Verifies the Memory tab WITHOUT calling the agent (zero API cost). Puts test
 * text in the local agent memory file (restored byte-for-byte afterwards) and
 * answers the run request with a synthetic stream in which the agent edits
 * /memories/agent/AGENTS.md.
 *
 *   node scripts/verify-memory.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
const MEMORY_FILE = path.resolve("../agent/.mda/__contexthub__/memories/agent/AGENTS.md");
fs.mkdirSync(OUT, { recursive: true });

function stream(threadId, runId) {
  const ev = [
    { type: "RUN_STARTED", threadId, runId },
    { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Noted — I'll remember that." },
    { type: "TEXT_MESSAGE_END", messageId: "m1" },
    { type: "TOOL_CALL_START", toolCallId: "mem-1", toolCallName: "edit_file", parentMessageId: "m1" },
    {
      type: "TOOL_CALL_ARGS",
      toolCallId: "mem-1",
      delta: JSON.stringify({
        file_path: "/memories/agent/AGENTS.md",
        old_string: "- Reports: long form",
        new_string: "- Reports: one page, table first",
      }),
    },
    { type: "TOOL_CALL_END", toolCallId: "mem-1" },
    { type: "TOOL_CALL_RESULT", toolCallId: "mem-1", messageId: "r1", role: "tool", content: "ok" },
    { type: "RUN_FINISHED", threadId, runId },
  ];
  return ev.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${msg}`);
  if (!ok) failures.push(msg);
};

const original = fs.existsSync(MEMORY_FILE) ? fs.readFileSync(MEMORY_FILE) : null;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/copilotkit/agent/workbench/run", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: stream(body.threadId, body.runId) });
  });
  await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });

  // Empty memory first.
  fs.writeFileSync(MEMORY_FILE, "");
  await page.goto(BASE, { waitUntil: "networkidle" });
  const workspace = page.locator("section", { has: page.getByRole("heading", { name: "Workspace" }) });
  await workspace.getByRole("tab", { name: /Memory/ }).click();
  check(await workspace.getByText("Shared by everyone who uses this agent.").isVisible(), "shared-memory notice is shown");
  await workspace.getByText("Empty — the agent hasn’t saved anything yet.").waitFor();
  check(true, "empty memory explains itself");

  // Stored content.
  fs.writeFileSync(MEMORY_FILE, "# Working preferences\n\n- Domain: fintech research\n- Reports: long form\n");
  await page.getByRole("tab", { name: /Files/ }).click();
  await workspace.getByRole("tab", { name: /Memory/ }).click();
  await workspace.getByText("Domain: fintech research").waitFor();
  check(true, "stored memory renders");

  // The agent edits memory in this conversation.
  await page.locator("textarea").first().fill("Remember: one-page reports, table first.");
  await page.locator("textarea").first().press("Enter");
  await page.getByText("Noted — I'll remember that.").waitFor();
  await page.waitForTimeout(600);
  check(await workspace.getByRole("tab", { name: "Memory · 1 new" }).isVisible(), "the tab counts the change");
  check(await workspace.getByText("Changed in this conversation").isVisible(), "…and lists it");
  check(await workspace.getByText("- Reports: one page, table first").isVisible(), "the new text is shown");
  check(await workspace.getByText("- Reports: long form").first().isVisible(), "the replaced text is shown");
  await page.screenshot({ path: `${OUT}/memory.png` });

  await workspace.getByRole("tab", { name: /Files/ }).click();
  check(!(await workspace.getByText("/memories/agent/AGENTS.md").isVisible()), "memory writes are not listed as Workspace files");

  const signedOut = await (await fetch(`${BASE}/api/memory`)).status;
  check(signedOut === 401, `memory API needs a signed-in user (got ${signedOut})`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  if (original === null) fs.rmSync(MEMORY_FILE, { force: true });
  else fs.writeFileSync(MEMORY_FILE, original);
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshot in ${OUT}`);
process.exit(failures.length ? 1 : 0);
