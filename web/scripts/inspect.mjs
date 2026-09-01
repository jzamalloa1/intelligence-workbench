/**
 * Drives the workbench in a real browser to capture screenshots and console
 * errors. Uses the locally installed Chrome via playwright-core, so there is no
 * browser download.
 *
 *   node scripts/inspect.mjs "your prompt here"
 *
 * Writes screenshots and a console log to scripts/.out/ (gitignored).
 */
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";

const PROMPT =
  process.argv[2] ??
  "Compare Redis and Memcached for session caching. Research it, then write a short report.";
const OUT = new URL("./.out/", import.meta.url).pathname;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const WAIT_MS = Number(process.env.WAIT_MS ?? 90_000);

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}01-initial.png`, fullPage: false });

// Find the chat composer and send the prompt.
const box = page
  .locator('textarea, [contenteditable="true"], input[type="text"]')
  .first();
await box.waitFor({ state: "visible", timeout: 15_000 });
await box.click();
await box.fill?.(PROMPT).catch(() => box.type(PROMPT));
if (!(await box.inputValue().catch(() => ""))) await page.keyboard.type(PROMPT);
await page.screenshot({ path: `${OUT}02-typed.png` });
await page.keyboard.press("Enter");

// Let the agent work, screenshotting periodically so we see intermediate states.
const step = 15_000;
for (let t = step, i = 3; t <= WAIT_MS; t += step, i++) {
  await page.waitForTimeout(step);
  await page.screenshot({ path: `${OUT}${String(i).padStart(2, "0")}-t${t / 1000}s.png` });
}
await page.screenshot({ path: `${OUT}99-final-full.png`, fullPage: true });

// Count the noisy repeated affordance the user reported.
const inspectorCount = await page
  .getByText(/View in Inspector/i)
  .count()
  .catch(() => -1);

const summary = [
  `prompt: ${PROMPT}`,
  `"View in Inspector" occurrences: ${inspectorCount}`,
  "",
  "--- console ---",
  ...logs,
].join("\n");
await writeFile(`${OUT}console.log`, summary);

console.log(summary.slice(0, 4000));
await browser.close();
