/**
 * Verifies the runner-toggle remount fix WITHOUT sending a chat message (zero
 * API cost): confirms a fresh `/info` negotiation fires — with the right
 * x-runner header — every time the toggle changes, rather than being cached
 * from the initial page-load negotiation.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const infoCalls = [];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

page.on("request", (r) => {
  if (r.url().includes("/api/copilotkit/info")) {
    infoCalls.push({ at: Date.now(), xRunner: r.headers()["x-runner"] ?? "(none)" });
  }
});

// The app sits behind demo sign-in; the cookie is shared by the page's context.
await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });
await page.goto(BASE, { waitUntil: "networkidle" });
const afterLoad = infoCalls.length;
console.log(`after load: ${infoCalls.length} /info call(s)`, infoCalls);

// Default is Local, so exercise the switch in both directions: Cloud (no
// header) then back to Local. Written against the *transition*, not against a
// particular default, so flipping the default doesn't invalidate the check.
await page.getByRole("radio", { name: "cloud" }).click();
await page.waitForTimeout(1500);
const afterCloud = infoCalls.length;
console.log(`after clicking Cloud: ${infoCalls.length} /info call(s)`, infoCalls);

await page.getByRole("radio", { name: "local" }).click();
await page.waitForTimeout(1500);
console.log(`after clicking Local: ${infoCalls.length} /info call(s)`, infoCalls);

// Asserted per phase, not per call index: how many /info calls one negotiation
// makes is CopilotKit's business (two since an explicit threadId was passed);
// what matters is that every call after a toggle carries the new mode's header.
const phase = (from, to) => infoCalls.slice(from, to).map((c) => c.xRunner);
const allAre = (calls, value) => calls.length > 0 && calls.every((v) => v === value);
const ok =
  allAre(phase(0, afterLoad), "local") &&
  allAre(phase(afterLoad, afterCloud), "(none)") &&
  allAre(phase(afterCloud), "local");
console.log(ok ? "PASS — negotiation re-fires with the current header on every toggle" : "FAIL — see calls above");

await browser.close();
process.exit(ok ? 0 : 1);
