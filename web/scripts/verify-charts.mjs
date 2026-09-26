/**
 * Verifies the chart + download UI WITHOUT calling the agent (zero API cost):
 * the page's run request is answered with a synthetic AG-UI stream containing
 * three render_chart calls and a report that embeds one of them. Then drives
 * the gallery, the full-screen view, the exports, the report embed, the file
 * download and the print layout, and saves screenshots for a human look.
 *
 *   node scripts/verify-charts.mjs            # against http://localhost:3000
 *   OUT_DIR=/tmp/shots node scripts/verify-charts.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
fs.mkdirSync(OUT, { recursive: true });

const charts = [
  {
    title: "LangSmith judge study: cost per eval",
    chart_type: "bar",
    categories: ["Jev", "GPT-5.6 Luna", "Claude Haiku 4.5", "Claude Sonnet 4.6"],
    series: [
      { name: "Cost per call", values: [0.02, 0.03, 0.28, 2.8], unit: "cents" },
      { name: "Latency per call", values: [0.42, 2.5, 2.85, 2.2], unit: "s" },
    ],
    x_label: "Judge",
  },
  {
    title: "Weekly active developers",
    chart_type: "line",
    categories: ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"],
    series: [{ name: "Developers", values: [1200, 1900, 2600, 3900, 5200, 6100, 6900, 7400], unit: "devs" }],
  },
  {
    title: "Adoption by agentic use case",
    chart_type: "bar",
    categories: [
      "Customer support ticket triage",
      "Code review automation agents",
      "Document processing pipelines",
      "Browser automation",
    ],
    series: [{ name: "Share of deployments", values: [34, 27, 22, 17], unit: "%" }],
  },
];

const report = `# Jev adoption report

Jev is cheaper per evaluation than every alternative we measured.

\`\`\`chart
langsmith-judge-study-cost-per-eval
\`\`\`

| Judge | Cost |
|---|---|
| Jev | 0.02¢ |

A chart that does not exist degrades to a note:

\`\`\`chart
no-such-chart
\`\`\`
`;

function sse(threadId, runId) {
  const ev = [];
  const push = (e) => ev.push(`data: ${JSON.stringify(e)}\n\n`);
  push({ type: "RUN_STARTED", threadId, runId });
  push({ type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" });
  push({ type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Here are the charts and the report." });
  push({ type: "TEXT_MESSAGE_END", messageId: "m1" });
  const call = (id, name, args, result) => {
    push({ type: "TOOL_CALL_START", toolCallId: id, toolCallName: name, parentMessageId: "m1" });
    push({ type: "TOOL_CALL_ARGS", toolCallId: id, delta: JSON.stringify(args) });
    push({ type: "TOOL_CALL_END", toolCallId: id });
    push({ type: "TOOL_CALL_RESULT", toolCallId: id, messageId: `r-${id}`, role: "tool", content: result });
  };
  charts.forEach((c, i) => call(`chart-${i}`, "render_chart", c, '{"rendered": true}'));
  call("file-1", "write_file", { file_path: "/reports/jev.md", content: report }, "ok");
  push({ type: "RUN_FINISHED", threadId, runId });
  return ev.join("");
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${msg}`);
  if (!ok) failures.push(msg);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.route("**/api/copilotkit/agent/workbench/run", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  await route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body: sse(body.threadId, body.runId),
  });
});

await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator("textarea").first().fill("synthetic chart check");
await page.locator("textarea").first().press("Enter");
await page.getByRole("tab", { name: "Charts" }).click();
await page.waitForTimeout(1200);

const gallery = page.getByRole("navigation", { name: "All charts" });
check((await gallery.getByRole("button").count()) === 3, "gallery lists all 3 charts");
check(await page.getByText("Adoption by agentic use case").first().isVisible(), "follows the newest chart");
check((await page.locator("[data-facet]").count()) >= 1, "plot rendered");
await page.screenshot({ path: `${OUT}/1-panel-latest.png` });

await gallery.getByRole("button").first().click();
await page.waitForTimeout(400);
check((await page.locator("section [data-facet]").count()) === 2, "mixed units split into 2 panels");
await page.screenshot({ path: `${OUT}/2-panel-first-chart.png` });

await page.getByRole("button", { name: "Expand chart" }).first().click();
const dialog = page.getByRole("dialog");
await dialog.waitFor();
check((await dialog.getByRole("navigation").getByRole("button").count()) === 3, "full-screen rail lists all charts");
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/3-expanded.png` });

for (const [label, ext] of [["PNG", "png"], ["SVG", "svg"], ["CSV", "csv"]]) {
  const [dl] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: label }).click()]);
  const file = `${OUT}/export.${ext}`;
  await dl.saveAs(file);
  const size = fs.statSync(file).size;
  check(dl.suggestedFilename() === `langsmith-judge-study-cost-per-eval.${ext}` && size > 100, `${label} export (${size} bytes)`);
}
const svg = fs.readFileSync(`${OUT}/export.svg`, "utf8");
check(!svg.includes("var(--"), "exported SVG has literal colors, no CSS variables");
check(fs.readFileSync(`${OUT}/export.csv`, "utf8").startsWith("Judge,Cost per call (cents),Latency per call (s)"), "CSV header carries units");

await page.keyboard.press("Escape");
await page.getByRole("button", { name: "/reports/jev.md write_file" }).click();
const viewer = page.getByRole("dialog", { name: "/reports/jev.md" });
await viewer.waitFor();
await page.waitForTimeout(600);
check((await viewer.locator("figure [data-facet]").count()) === 2, "report embeds the live chart");
check(await viewer.getByText("isn’t in this conversation").isVisible(), "unknown chart id degrades to a note");
const facetBoxes = await viewer.locator("figure [data-facet]").evaluateAll((els) =>
  els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })),
);
check(facetBoxes.length === 2 && facetBoxes[0].bottom <= facetBoxes[1].top + 1, "embedded unit panels do not overlap");
await page.screenshot({ path: `${OUT}/4-report.png` });

const [md] = await Promise.all([page.waitForEvent("download"), viewer.getByRole("button", { name: ".md" }).click()]);
check(md.suggestedFilename() === "jev.md", "report downloads as jev.md");

await page.evaluate(() => {
  window.__printCalls = 0;
  window.print = () => {
    window.__printCalls += 1;
  };
});
await viewer.getByRole("button", { name: "PDF" }).click();
await page.waitForTimeout(900);
check((await page.evaluate(() => window.__printCalls)) === 1, "PDF opens the print dialog");
await page.emulateMedia({ media: "print" });
check(
  (await page.locator(".wb-print-root figure [data-facet]").count()) === 2,
  "print copy includes the chart",
);
await page.screenshot({ path: `${OUT}/5-print.png`, fullPage: true });
await page.emulateMedia({ media: "screen" });

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshots in ${OUT}`);
process.exit(failures.length ? 1 : 0);
