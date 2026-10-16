/**
 * Verifies the responsive layout and dark theme WITHOUT calling the agent
 * (zero API cost — every run request is blocked, so nothing clicked here can
 * start a billed run). Checks:
 *   - laptop (1280): the history sidebar starts hidden and the conversation
 *     gets real width; the toggle brings the sidebar back
 *   - desktop (1600): the sidebar shows by default
 *   - phone (390): nothing overflows sideways, and the view switch reaches the
 *     history, plan and workspace panels
 *   - dark: CopilotKit's chat takes the workbench palette, not its own black
 *
 *   node scripts/verify-layout.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${msg}`);
  if (!ok) failures.push(msg);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function open(width, height, colorScheme = "light") {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/copilotkit/agent/*/run", (r) => r.abort());
  await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  return { page, errors };
}

const history = (page) => page.getByRole("navigation", { name: "Conversation history" });
const conversation = (page) => page.locator("section", { has: page.getByRole("heading", { name: "Conversation" }) });

try {
  // --- laptop
  {
    const { page, errors } = await open(1280, 800);
    check(!(await history(page).isVisible()), "laptop: history sidebar starts hidden");
    const width = (await conversation(page).boundingBox())?.width ?? 0;
    check(width >= 500, `laptop: the conversation gets real width (${Math.round(width)}px)`);
    check(await page.getByRole("heading", { name: "Workspace" }).isVisible(), "laptop: workspace column is on screen");
    await page.getByRole("button", { name: "Show history" }).click();
    check(await history(page).isVisible(), "laptop: the toggle shows the sidebar");
    await page.screenshot({ path: `${OUT}/layout-laptop.png` });
    check(errors.length === 0, `laptop: no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    await page.close();
  }

  // --- desktop
  {
    const { page } = await open(1600, 1000);
    check(await history(page).isVisible(), "desktop: history sidebar shows by default");
    await page.close();
  }

  // --- phone
  {
    const { page, errors } = await open(390, 844);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, `phone: no sideways scroll (overflow ${overflow}px)`);
    const nav = page.getByRole("navigation", { name: "Panels" });
    check(await conversation(page).isVisible(), "phone: opens on the conversation");
    await nav.getByRole("button", { name: "History" }).click();
    check(await history(page).isVisible(), "phone: History shows the conversation list");
    check(!(await conversation(page).isVisible()), "…in place of the conversation");
    await nav.getByRole("button", { name: "Plan" }).click();
    check(await page.getByRole("heading", { name: "Plan" }).isVisible(), "phone: Plan shows the plan");
    await nav.getByRole("button", { name: "Workspace" }).click();
    check(await page.getByRole("heading", { name: "Workspace" }).isVisible(), "phone: Workspace shows the files");
    await nav.getByRole("button", { name: "Chat" }).click();
    await page.screenshot({ path: `${OUT}/layout-phone.png` });
    check(errors.length === 0, `phone: no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    await page.close();
  }

  // --- dark
  {
    const { page } = await open(1600, 1000, "dark");
    check(await page.evaluate(() => document.documentElement.classList.contains("dark")), "dark: <html> carries the .dark class");
    const [chatBg, panelBg] = await page.evaluate(() => {
      const chat = document.querySelector(".copilotKitChat");
      const panel = chat?.closest("section");
      return [chat && getComputedStyle(chat).backgroundColor, panel && getComputedStyle(panel).backgroundColor];
    });
    check(Boolean(chatBg) && chatBg === panelBg, `dark: the chat uses the panel colour (${chatBg} vs ${panelBg})`);
    await page.screenshot({ path: `${OUT}/layout-dark.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshots in ${OUT}`);
process.exit(failures.length ? 1 : 0);
