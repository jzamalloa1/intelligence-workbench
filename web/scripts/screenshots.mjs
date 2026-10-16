/**
 * Regenerates the README screenshots from conversations already in the local
 * history store (web/.data/workbench.sqlite) — zero API cost. Every run request
 * is aborted, so nothing clicked here can start a billed run.
 *
 *   node scripts/screenshots.mjs
 *
 * The conversations are this machine's own; pick them with env vars:
 *   SHOT_USER / SHOT_TITLE            the main conversation (light + phone)
 *   SHOT_DARK_USER / SHOT_DARK_TITLE  the one shown in dark mode
 *   SHOT_REPORT                       a report path in the main conversation
 * Titles match the start of the conversation's name in the history list.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("../docs/screenshots");
const MAIN = { user: process.env.SHOT_USER ?? "jordan", title: process.env.SHOT_TITLE ?? "Estimate the 2026 market size" };
const DARK = { user: process.env.SHOT_DARK_USER ?? "sam", title: process.env.SHOT_DARK_TITLE ?? "explain the current landscape" };
const REPORT = process.env.SHOT_REPORT ?? "/reports/ai-code-review-market-2026.md";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function openConversation({ user, title }, { width = 1600, height = 1000, colorScheme = "light", scale = 2 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme, deviceScaleFactor: scale });
  await page.route("**/api/copilotkit/agent/*/run", (r) => r.abort());
  await page.request.post(`${BASE}/api/session`, { data: { userId: user } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const history = page.getByRole("navigation", { name: "Conversation history" });
  if (!(await history.isVisible())) {
    const tab = page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "History" });
    if (await tab.isVisible()) await tab.click();
    else await page.getByRole("button", { name: "Show history" }).click();
  }
  await history.getByText(title, { exact: false }).first().click();
  await page.waitForTimeout(3000);
  return page;
}

const shot = async (target, name) => {
  await target.screenshot({ path: `${OUT}/${name}.png` });
  console.log("wrote", `${name}.png`);
};

try {
  // The whole workbench, mid-conversation.
  {
    const page = await openConversation(MAIN);
    await shot(page, "workbench");

    // The parallel-research group, scrolled into view.
    const chat = page.locator("section", { has: page.getByRole("heading", { name: "Conversation" }) });
    const lane = chat.locator("[data-lane-status]").first();
    if (await lane.count()) {
      await lane.scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, -160);
      await page.waitForTimeout(400);
      await shot(chat, "research-lanes");
    }

    // A chart from the sandbox gallery, full screen.
    const sandbox = page.locator("section", { has: page.getByRole("heading", { name: "Sandbox" }) });
    await sandbox.getByRole("tab", { name: "Charts" }).click();
    await page.waitForTimeout(600);
    await sandbox.getByRole("button", { name: "Expand chart" }).first().click();
    await page.waitForTimeout(1200);
    await shot(page, "charts");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // The report, opened from the Workspace.
    await page.getByRole("button", { name: new RegExp(`^${REPORT.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`) }).click();
    await page.waitForTimeout(1500);
    await shot(page, "report");
    await page.close();
  }

  // Dark mode, a different conversation.
  {
    const page = await openConversation(DARK, { colorScheme: "dark" });
    await shot(page, "workbench-dark");
    await page.close();
  }

  // Phone: the conversation and its plan.
  {
    const page = await openConversation(MAIN, { width: 390, height: 844, scale: 3 });
    await shot(page, "phone-chat");
    await page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Plan" }).click();
    await page.waitForTimeout(400);
    await shot(page, "phone-plan");
    await page.close();
  }
} finally {
  await browser.close();
}
