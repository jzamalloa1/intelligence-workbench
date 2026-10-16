/**
 * Verifies A2UI dashboards WITHOUT calling the agent (zero API cost): the run
 * request is answered with a synthetic stream holding a render_chart call, a
 * render_dashboard call that places that chart among metrics and a table, and
 * a second dashboard the server rejected. Checks the surface renders through
 * CopilotKit's A2UI renderer with our catalog, light and dark.
 *
 *   node scripts/verify-dashboard.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
fs.mkdirSync(OUT, { recursive: true });

const chart = {
  title: "Market size 2022-2026",
  chart_type: "line",
  categories: ["2022", "2023", "2024", "2025", "2026"],
  series: [{ name: "Revenue", values: [1.9, 2.4, 3.0, 3.6, 4.2], unit: "USD bn" }],
};
const dashboard = {
  title: "AI code review market at a glance",
  components: [
    { id: "root", component: "Column", children: ["kpis", "trend", "split", "note"] },
    { id: "kpis", component: "Row", children: ["m1", "m2", "m3"] },
    { id: "m1", component: "Metric", label: "Market size 2026", value: "$4.2B", delta: "+18% YoY", trend: "up", caption: "Analyst consensus" },
    { id: "m2", component: "Metric", label: "CAGR 2022-26", value: "21.9%" },
    { id: "m3", component: "Metric", label: "Top-3 share", value: "58%", delta: "-4 pts", trend: "down" },
    { id: "trend", component: "Chart", chartId: "market-size-2022-2026" },
    { id: "split", component: "Table", columns: ["Vendor", "Share"], rows: [["GitHub", 31], ["GitLab", 15], ["Others", 54]], caption: "2025 revenue share, %" },
    { id: "note", component: "Text", text: "Figures are estimates; see the report for sources.", variant: "caption" },
  ],
};

function sse(threadId, runId) {
  const ev = [];
  const push = (e) => ev.push(`data: ${JSON.stringify(e)}\n\n`);
  push({ type: "RUN_STARTED", threadId, runId });
  push({ type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" });
  push({ type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Here is the overview." });
  push({ type: "TEXT_MESSAGE_END", messageId: "m1" });
  const call = (id, name, args, result) => {
    push({ type: "TOOL_CALL_START", toolCallId: id, toolCallName: name, parentMessageId: "m1" });
    push({ type: "TOOL_CALL_ARGS", toolCallId: id, delta: JSON.stringify(args) });
    push({ type: "TOOL_CALL_END", toolCallId: id });
    push({ type: "TOOL_CALL_RESULT", toolCallId: id, messageId: `r-${id}`, role: "tool", content: JSON.stringify(result) });
  };
  call("c1", "render_chart", chart, { rendered: true, chart_id: "market-size-2022-2026" });
  call("d0", "render_dashboard", { title: "Draft", components: [{ id: "top", component: "Text", text: "x" }] }, {
    error: "one component must have id 'root' — usually a Column",
  });
  call("d1", "render_dashboard", dashboard, { rendered: true, dashboard_id: "ai-code-review-market-at-a-glance", components: 8 });
  push({ type: "RUN_FINISHED", threadId, runId });
  return ev.join("");
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${msg}`);
  if (!ok) failures.push(msg);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function run(colorScheme) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, colorScheme, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.route("**/api/copilotkit/agent/*/run", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sse(body.threadId, body.runId) });
  });
  await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator("textarea").first().fill("Size the AI code review market");
  await page.locator("textarea").first().press("Enter");
  const dash = page.getByTestId("dashboard");
  await dash.waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
  return { page, dash, errors };
}

try {
  const { page, dash, errors } = await run("light");
  check(await dash.getByRole("heading", { name: dashboard.title }).isVisible(), "the dashboard renders with its title");
  check((await dash.getByTestId("dashboard-metric").count()) === 3, "three metric tiles");
  check(await dash.getByText("$4.2B").isVisible() && await dash.getByText("+18% YoY").isVisible(), "…with values and deltas");
  const tiles = await dash.getByTestId("dashboard-metric").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  check(new Set(tiles).size === 1, "the Row lays the tiles side by side");
  check(await dash.getByText(chart.title).isVisible(), "the chart drawn by render_chart is placed by its id");
  check((await dash.locator("svg.recharts-surface").count()) > 0, "…as a real plot");
  check(await dash.getByRole("cell", { name: "GitHub" }).isVisible() && await dash.getByRole("cell", { name: "31" }).isVisible(), "the table renders its rows");
  check(await page.getByTestId("dashboard-rejected").getByText("must have id 'root'").isVisible(), "a rejected layout shows as sent back, not as a broken surface");
  await dash.getByRole("button", { name: "Expand chart" }).click();
  check(await page.getByRole("dialog").isVisible(), "the chart opens full screen from the dashboard");
  await page.keyboard.press("Escape");
  await dash.scrollIntoViewIfNeeded();
  await dash.screenshot({ path: `${OUT}/dashboard.png` });
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.close();

  const dark = await run("dark");
  const [bg, text] = await dark.dash.getByTestId("dashboard-metric").first().evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e.querySelector("div:nth-child(2)")).color]);
  check(bg !== "rgb(255, 255, 255)" && text !== "rgb(0, 0, 0)", `dark: tiles take the dark palette (${bg}, ${text})`);
  await dark.dash.screenshot({ path: `${OUT}/dashboard-dark.png` });
  await dark.page.close();
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshots in ${OUT}`);
process.exit(failures.length ? 1 : 0);
