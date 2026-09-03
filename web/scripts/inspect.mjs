/**
 * Drives the workbench in a real browser to capture screenshots, console errors,
 * and failed network requests. Uses the locally installed Chrome via
 * playwright-core, so there is no browser download.
 *
 *   node scripts/inspect.mjs "your prompt here"
 *   WAIT_MS=180000 node scripts/inspect.mjs          # wait longer
 *   SKIP_PROMPT=1 node scripts/inspect.mjs           # just load the page
 *
 * Writes screenshots + report to scripts/.out/ (gitignored).
 */
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";

const PROMPT =
  process.argv[2] ??
  "Compare Redis and Memcached for session caching. Research it, then write a short report.";
const OUT = new URL("./.out/", import.meta.url).pathname;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const WAIT_MS = Number(process.env.WAIT_MS ?? 120_000);
const SKIP_PROMPT = process.env.SKIP_PROMPT === "1";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

/** Collapse repeated messages into {text -> count} so a 200-line log reads as 5 problems. */
const consoleTally = new Map();
const netFailures = new Map();
const tally = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

page.on("console", (m) => {
  const type = m.type();
  if (type !== "error" && type !== "warning") return;
  tally(consoleTally, `[${type}] ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => tally(consoleTally, `[pageerror] ${e.message.slice(0, 300)}`));
page.on("requestfailed", (r) =>
  tally(netFailures, `${r.method()} ${r.url().slice(0, 160)} — ${r.failure()?.errorText}`),
);
page.on("response", (r) => {
  if (r.status() >= 400) tally(netFailures, `HTTP ${r.status()} ${r.url().slice(0, 160)}`);
});

await page.goto(BASE, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}01-initial.png` });

if (!SKIP_PROMPT) {
  const box = page
    .locator('textarea, [contenteditable="true"], input[type="text"]')
    .first();
  await box.waitFor({ state: "visible", timeout: 15_000 });
  await box.click();
  await page.keyboard.type(PROMPT);
  await page.keyboard.press("Enter");

  const step = 20_000;
  for (let t = step, i = 2; t <= WAIT_MS; t += step, i++) {
    await page.waitForTimeout(step);
    await page.screenshot({ path: `${OUT}${String(i).padStart(2, "0")}-t${t / 1000}s.png` });
  }
}

await page.screenshot({ path: `${OUT}99-final-full.png`, fullPage: true });

// Next.js dev overlay: how many issues does it think there are?
const overlayCount = await page
  .locator("nextjs-portal")
  .evaluateAll((els) =>
    els
      .map((el) => el.shadowRoot?.textContent?.match(/(\d+)\s+Issue/i)?.[1])
      .filter(Boolean)
      .join(","),
  )
  .catch(() => "");

const section = (title, map) =>
  map.size === 0
    ? `${title}: none`
    : `${title} (${map.size} distinct):\n` +
      [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `  ${String(n).padStart(4)}x  ${k}`)
        .join("\n");

const report = [
  `URL: ${BASE}`,
  SKIP_PROMPT ? "prompt: (skipped)" : `prompt: ${PROMPT}`,
  `Next.js dev overlay issue count: ${overlayCount || "none"}`,
  "",
  section("CONSOLE errors/warnings", consoleTally),
  "",
  section("NETWORK failures", netFailures),
].join("\n");

await writeFile(`${OUT}report.txt`, report);
console.log(report);
await browser.close();
