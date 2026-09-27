/**
 * Verifies the provider toggle WITHOUT calling the agent (zero API cost): the
 * run request is answered with a synthetic stream, and a seeded OpenAI
 * conversation checks the history side. Server-side enforcement (a stored
 * conversation keeps its provider) needs a real run — see README § Provider
 * toggle.
 *
 *   node scripts/verify-provider.mjs
 */
import { chromium } from "playwright-core";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
const DB = process.env.WORKBENCH_HISTORY_DB ?? path.resolve(".data/workbench.sqlite");
fs.mkdirSync(OUT, { recursive: true });
const SEEDED = "verify-provider-openai";

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
  const req = route.request();
  const body = JSON.parse(req.postData() || "{}");
  runs.push({ threadId: body.threadId, provider: req.headers()["x-llm-provider"] });
  const ev = [
    { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
    { type: "TEXT_MESSAGE_START", messageId: `m${runs.length}`, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: `m${runs.length}`, delta: `reply ${runs.length}` },
    { type: "TEXT_MESSAGE_END", messageId: `m${runs.length}` },
    { type: "RUN_FINISHED", threadId: body.threadId, runId: body.runId },
  ];
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: ev.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") });
});

await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });
await page.request.get(`${BASE}/api/threads`); // ensures the schema (and provider column) exist
const db = new DatabaseSync(DB);
const now = Date.now();
db.prepare(
  "INSERT OR REPLACE INTO threads (id, user_id, title, created_at, updated_at, messages, state, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
).run(SEEDED, "alex", "Seeded OpenAI conversation", now, now, JSON.stringify([{ id: "u", role: "user", content: "seeded" }]), "{}", "openai");

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  const toggle = page.getByRole("radiogroup", { name: "Model provider" });
  check((await toggle.getByRole("radio", { checked: true }).innerText()) === "Anthropic", "new conversations default to Anthropic");

  await page.locator("textarea").first().fill("on anthropic");
  await page.locator("textarea").first().press("Enter");
  await page.getByText("reply 1").waitFor();
  check(runs[0]?.provider === "anthropic", `run sends x-llm-provider: anthropic (got ${runs[0]?.provider})`);

  const firstThread = new URL(page.url()).searchParams.get("t");
  await toggle.getByRole("radio", { name: "OpenAI" }).click();
  await page.waitForTimeout(500);
  const secondThread = new URL(page.url()).searchParams.get("t");
  check(secondThread !== firstThread, "switching provider starts a new conversation");
  check(new URL(page.url()).searchParams.get("p") === "openai", "URL records the provider (?p=openai)");
  check(!(await page.getByText("reply 1").isVisible()), "…with an empty chat");

  await page.locator("textarea").first().fill("on openai");
  await page.locator("textarea").first().press("Enter");
  await page.getByText("reply 2").waitFor();
  check(runs[1]?.provider === "openai", `run sends x-llm-provider: openai (got ${runs[1]?.provider})`);

  const history = page.getByRole("navigation", { name: "Conversation history" });
  const seededRow = history.locator("li", { hasText: "Seeded OpenAI conversation" }).getByRole("button").first();
  check(await seededRow.getByText("OpenAI").isVisible(), "OpenAI conversations carry a badge in history");

  await toggle.getByRole("radio", { name: "Anthropic" }).click();
  await page.waitForTimeout(300);
  await seededRow.click();
  await page.waitForTimeout(800);
  check((await toggle.getByRole("radio", { checked: true }).innerText()) === "OpenAI", "reopening an OpenAI conversation switches the toggle to OpenAI");
  await page.screenshot({ path: `${OUT}/provider.png` });
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  db.prepare("DELETE FROM threads WHERE id = ?").run(SEEDED);
  db.close();
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshot in ${OUT}`);
process.exit(failures.length ? 1 : 0);
