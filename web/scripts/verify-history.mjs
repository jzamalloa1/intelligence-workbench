/**
 * Verifies demo sign-in and per-user history WITHOUT calling the agent (zero
 * API cost): seeds two conversations for one user straight into the history
 * store, then drives the real app — sign-in, the sidebar, reopening a
 * conversation (restored from its snapshot, since the agent server doesn't
 * hold these threads), isolation between users, rename and delete. Everything
 * it seeds is removed at the end.
 *
 *   node scripts/verify-history.mjs
 */
import { chromium } from "playwright-core";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
const DB = process.env.WORKBENCH_HISTORY_DB ?? path.resolve(".data/workbench.sqlite");
fs.mkdirSync(OUT, { recursive: true });

const OWNER = "alex";
const OTHER = "sam";
const T1 = "verify-history-thread-1";
const T2 = "verify-history-thread-2";

const chart = {
  title: "Judge cost per eval",
  chart_type: "bar",
  categories: ["Jev", "Luna"],
  series: [{ name: "Cost", values: [0.02, 0.03], unit: "cents" }],
};
const messages = [
  { id: "u1", role: "user", content: "How is Jev being adopted?" },
  {
    id: "a1",
    role: "assistant",
    content: "Here is what I found.",
    toolCalls: [
      { id: "c1", type: "function", function: { name: "render_chart", arguments: JSON.stringify(chart) } },
      {
        id: "f1",
        type: "function",
        function: {
          name: "write_file",
          arguments: JSON.stringify({ file_path: "/reports/jev.md", content: "# Jev\n\n```chart\njudge-cost-per-eval\n```\n" }),
        },
      },
    ],
  },
  { id: "t1", role: "tool", content: '{"rendered": true}', toolCallId: "c1" },
  { id: "t2", role: "tool", content: "ok", toolCallId: "f1" },
  { id: "a2", role: "assistant", content: "Jev is the cheapest judge measured — see the report." },
];
const state = { todos: [{ content: "Research adoption", status: "completed" }] };

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${msg}`);
  if (!ok) failures.push(msg);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// --- sign-in screen, and the store gets created by the first history read
await page.goto(BASE, { waitUntil: "networkidle" });
check(await page.getByText("Choose who you are to continue.").isVisible(), "signed-out visitors get the sign-in screen");
const blocked = await page.request.post(`${BASE}/api/copilotkit/agent/workbench/run`, {
  data: { threadId: "x", runId: "y", messages: [] },
});
check(blocked.status() === 401, `agent calls need a signed-in user (got ${blocked.status()})`);

await page.getByRole("button", { name: /Alex Rivera/ }).click();
await page.getByRole("button", { name: "New conversation" }).waitFor();
await page.request.get(`${BASE}/api/threads`); // ensures the schema exists

// --- seed two conversations for Alex
const db = new DatabaseSync(DB);
const now = Date.now();
const insert = db.prepare(
  "INSERT OR REPLACE INTO threads (id, user_id, title, created_at, updated_at, messages, state) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
insert.run(T1, OWNER, "How is Jev being adopted?", now - 60_000, now - 60_000, JSON.stringify(messages), JSON.stringify(state));
insert.run(T2, OWNER, "An older question", now - 3 * 86_400_000, now - 3 * 86_400_000, JSON.stringify(messages.slice(0, 1)), "{}");

try {
  await page.reload({ waitUntil: "networkidle" });
  const history = page.getByRole("navigation", { name: "Conversation history" });
  await history.getByText("How is Jev being adopted?").waitFor();
  check(await history.getByText("Today").isVisible(), "grouped by date (Today)");
  check(await history.getByText("Previous 7 days").isVisible(), "grouped by date (Previous 7 days)");

  // --- reopen: restored from the snapshot
  await history.getByRole("button", { name: "How is Jev being adopted?", exact: true }).click();
  await page.getByText("Jev is the cheapest judge measured").waitFor({ timeout: 15000 });
  check(true, "reopened conversation shows its messages");
  check(new URL(page.url()).searchParams.get("t") === T1, "URL carries the open conversation (?t=)");
  check(await page.getByText("Research adoption").isVisible(), "plan restored from saved state");
  check(await page.getByRole("button", { name: "/reports/jev.md write_file" }).isVisible(), "workspace file restored");
  await page.getByRole("tab", { name: "Charts" }).click();
  check(await page.getByText("Judge cost per eval").first().isVisible(), "chart restored");
  await page.screenshot({ path: `${OUT}/history-reopened.png` });

  // --- reload keeps the same conversation
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Jev is the cheapest judge measured").waitFor({ timeout: 15000 });
  check(true, "reload returns to the same conversation");

  // --- rename
  const row = history.locator("li", { hasText: "How is Jev being adopted?" });
  await row.hover();
  await row.getByRole("button", { name: /^Rename/ }).click();
  await history.getByRole("textbox", { name: "Conversation title" }).fill("Jev adoption study");
  await page.keyboard.press("Enter");
  await history.getByText("Jev adoption study").waitFor();
  check(true, "rename persists");

  // --- another user sees none of it, and can't open it by URL
  await page.getByRole("button", { name: /Alex Rivera/ }).click();
  await page.getByRole("menuitem", { name: "Switch user" }).click();
  await page.getByRole("button", { name: /Sam Patel/ }).click();
  await page.getByRole("button", { name: "New conversation" }).waitFor();
  await page.waitForTimeout(800);
  check(!(await page.getByText("Jev adoption study").isVisible()), `${OTHER} does not see ${OWNER}'s history`);
  const list = await (await page.request.get(`${BASE}/api/threads`)).json();
  check(list.threads.every((t) => !t.id.startsWith("verify-history")), `${OTHER}'s /api/threads excludes ${OWNER}'s threads`);
  const connect = await page.request.post(`${BASE}/api/copilotkit/agent/workbench/connect`, {
    headers: { "x-runner": "local", "x-workbench-user": OWNER }, // spoofed header must not help
    data: { threadId: T1, runId: "probe", messages: [], state: {}, tools: [], context: [], forwardedProps: {} },
  });
  check(connect.status() === 404, `${OTHER} cannot open ${OWNER}'s thread, even spoofing the header (got ${connect.status()})`);
  const del = await page.request.delete(`${BASE}/api/threads/${T1}`);
  check(del.status() === 404, `${OTHER} cannot delete ${OWNER}'s thread (got ${del.status()})`);
  await page.screenshot({ path: `${OUT}/history-other-user.png` });

  // --- back to Alex: delete
  await page.getByRole("button", { name: /Sam Patel/ }).click();
  await page.getByRole("menuitem", { name: "Switch user" }).click();
  await page.getByRole("button", { name: /Alex Rivera/ }).click();
  const history2 = page.getByRole("navigation", { name: "Conversation history" });
  await history2.getByText("An older question").waitFor();
  const oldRow = history2.locator("li", { hasText: "An older question" });
  await oldRow.hover();
  await oldRow.getByRole("button", { name: /^Delete/ }).click();
  await history2.locator("li", { hasText: "Delete this conversation?" }).getByRole("button", { name: "Delete" }).click();
  await page.waitForTimeout(800);
  check(!(await history2.getByText("An older question").isVisible()), "delete removes the conversation");

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  db.prepare("DELETE FROM threads WHERE id LIKE 'verify-history-%'").run();
  db.close();
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshots in ${OUT}`);
process.exit(failures.length ? 1 : 0);
