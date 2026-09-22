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

await page.goto(BASE, { waitUntil: "networkidle" });
console.log(`after load: ${infoCalls.length} /info call(s)`, infoCalls);

// Default is Local, so exercise the switch in both directions: Cloud (no
// header) then back to Local. Written against the *transition*, not against a
// particular default, so flipping the default doesn't invalidate the check.
await page.getByRole("radio", { name: "cloud" }).click();
await page.waitForTimeout(1500);
console.log(`after clicking Cloud: ${infoCalls.length} /info call(s)`, infoCalls);

await page.getByRole("radio", { name: "local" }).click();
await page.waitForTimeout(1500);
console.log(`after clicking Local: ${infoCalls.length} /info call(s)`, infoCalls);

const ok =
  infoCalls.length >= 3 &&
  infoCalls[0].xRunner === "local" &&
  infoCalls[1].xRunner === "(none)" &&
  infoCalls[2].xRunner === "local";
console.log(ok ? "PASS — negotiation re-fires with the current header on every toggle" : "FAIL — see calls above");

await browser.close();
process.exit(ok ? 0 : 1);
