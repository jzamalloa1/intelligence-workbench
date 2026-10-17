/**
 * Writes the sample attachments in ../samples/ — one fictional business case
 * (Brightline Coffee Co.) that exercises every part of the workbench:
 *
 *   brightline-sales-2024-2025.csv  too big to travel whole (preview only), so
 *                                   the agent has to analyse it in the sandbox
 *   brightline-board-memo.pdf       claims about the market to check against
 *                                   public sources, plus the launch economics
 *   competitor-shelf-prices.png     prices the model can only get by looking
 *
 * Deterministic (seeded), so regenerating gives the same files. No model calls.
 *
 *   node scripts/make-samples.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.env.OUT_DIR ?? "../samples");
fs.mkdirSync(OUT, { recursive: true });

// --- CSV: 24 months × 4 regions × 3 product lines -----------------------------

let seed = 20261016;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const noise = (spread) => 1 + (rand() * 2 - 1) * spread;

const REGIONS = { Northeast: 1.15, Midwest: 0.85, South: 0.95, West: 1.2 };
// Cold brew skews west and warm; hot coffee skews north.
const COLD_TILT = { Northeast: 0.9, Midwest: 0.8, South: 1.1, West: 1.35 };
const LINES = {
  "Hot coffee": { price: 4.1, margin: 0.68, base: 21000 },
  "Iced & cold brew": { price: 5.2, margin: 0.72, base: 9000 },
  Pastries: { price: 3.6, margin: 0.45, base: 11000 },
};

const rows = [["month", "region", "product_line", "units", "revenue_usd", "cogs_usd"]];
for (let m = 0; m < 24; m++) {
  const date = new Date(Date.UTC(2024, m, 1));
  const month = date.toISOString().slice(0, 7);
  const moy = date.getUTCMonth(); // 0 = Jan
  const summer = Math.cos(((moy - 6.5) / 12) * 2 * Math.PI); // +1 mid-summer, -1 mid-winter
  for (const [region, size] of Object.entries(REGIONS)) {
    for (const [line, p] of Object.entries(LINES)) {
      let factor = size;
      if (line === "Hot coffee") factor *= (1 - 0.12 * summer) * (1 - 0.004 * m); // slowly eroding
      if (line === "Iced & cold brew") factor *= COLD_TILT[region] * (1 + 0.35 * summer) * 1.028 ** m; // ~40%/yr growth
      if (line === "Pastries") factor *= 1 + 0.002 * m;
      const units = Math.round(p.base * factor * noise(0.06));
      const price = p.price * (m >= 12 ? 1.04 : 1) * noise(0.015); // a 4% price rise in Jan 2025
      const revenue = units * price;
      const cogs = revenue * (1 - p.margin * noise(0.03));
      rows.push([month, region, line, units, revenue.toFixed(2), cogs.toFixed(2)]);
    }
  }
}
// Two real-world quirks for a careful analysis to catch: a missing cost, and a
// row exported twice.
rows[150][5] = "";
rows.splice(201, 0, [...rows[200]]);
fs.writeFileSync(path.join(OUT, "brightline-sales-2024-2025.csv"), rows.map((r) => r.join(",")).join("\n") + "\n");

// --- PDF memo and PNG price photo, drawn by Chrome ----------------------------

const MEMO = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0.9in 0.9in; }
  body { font: 11pt/1.5 Georgia, serif; color: #1d1d1f; }
  h1 { font: 600 18pt/1.2 -apple-system, "Helvetica Neue", Arial, sans-serif; margin: 0 0 4px; }
  h2 { font: 600 12pt -apple-system, "Helvetica Neue", Arial, sans-serif; margin: 22px 0 6px; }
  .meta { color: #666; font: 9.5pt -apple-system, Arial, sans-serif; margin-bottom: 18px; }
  table { border-collapse: collapse; width: 100%; font: 10pt -apple-system, Arial, sans-serif; margin: 8px 0; }
  td, th { border-bottom: 1px solid #ddd; padding: 5px 8px; text-align: left; }
  td.n { text-align: right; }
  .note { font: 8.5pt -apple-system, Arial, sans-serif; color: #888; margin-top: 28px; }
</style></head><body>
<h1>Ready-to-drink cold brew: launch proposal</h1>
<div class="meta">Brightline Coffee Co. · Board memo · Prepared by Strategy &amp; Finance · October 2026 · Confidential (fictional sample)</div>

<h2>1. Recommendation</h2>
<p>We propose launching a canned ready-to-drink (RTD) cold brew line in 2026, sold through regional
grocery chains in our four store regions, starting in the West where in-store cold brew is strongest.
The launch budget is <b>$2.5 million</b>, covering co-packer setup, packaging, first production runs,
slotting fees and launch marketing.</p>

<h2>2. Why now</h2>
<p>In-store iced and cold brew has been our fastest-growing line over the last two years (see the
attached sales export), while hot coffee is flat to declining. Our team estimates the U.S. RTD coffee
market at <b>about $5.2 billion in 2025, growing roughly 9% a year</b>, with cold brew the fastest-growing
segment. <i>These figures come from a 2024 trade-press summary and have not been re-checked.</i></p>

<h2>3. Unit economics (draft)</h2>
<table>
  <tr><th>Assumption</th><th>Value</th></tr>
  <tr><td>Can size</td><td class="n">11 fl oz</td></tr>
  <tr><td>Landed unit cost at co-packer (liquid, can, freight)</td><td class="n">$1.15</td></tr>
  <tr><td>Distributor and retailer share of shelf price</td><td class="n">45%</td></tr>
  <tr><td>Target gross margin on our net revenue</td><td class="n">at least 35%</td></tr>
  <tr><td>Planned volume after ramp-up</td><td class="n">120,000–180,000 cans / month</td></tr>
  <tr><td>Payback target on the launch budget</td><td class="n">under 24 months</td></tr>
</table>
<p>Shelf price is open. The attached photo shows what competing cans cost at a partner grocery store in
September 2026.</p>

<h2>4. Questions for the board</h2>
<ol>
  <li>Are the market size and growth assumptions in section 2 still right?</li>
  <li>What shelf price clears a 35% gross margin, and is it competitive?</li>
  <li>At planned volumes, how long until the $2.5 million is paid back?</li>
  <li>Which region should launch first, based on our own cold brew sales?</li>
</ol>

<h2>5. Risks</h2>
<p>Shelf competition from national brands with larger marketing budgets; co-packer minimum runs that
exceed early demand; cannibalisation of in-store cold brew; and slotting fees above the budgeted
$400,000.</p>

<p class="note">Brightline Coffee Co., its figures and this memo are fictional, made for testing the
Intelligence Workbench. Market figures in section 2 are deliberately unverified.</p>
</body></html>`;

const SHELF = [
  ["Summit Cold Brew", "Original Black", "11 fl oz can", "3.49"],
  ["Harbor Black", "Unsweetened", "12 fl oz can", "2.99"],
  ["Night Owl Nitro", "Nitro Cold Brew", "11 fl oz can", "3.99"],
  ["Grove", "Oat Milk Latte", "11 fl oz can", "3.79"],
  ["Cascade Roasters", "Vanilla Cold Brew", "11 fl oz can", "3.29"],
  ["FreshMart", "Store brand, black", "12 fl oz can", "2.29"],
];
const PHOTO = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1200px; height: 760px; background: linear-gradient(#cfd6dc, #b9c2ca);
         font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; }
  .label { position: absolute; top: 22px; left: 30px; font-size: 15px; color: #39434d; letter-spacing: .04em; }
  .shelf { position: absolute; left: 30px; right: 30px; height: 300px; display: flex; gap: 18px; align-items: flex-end; }
  .s1 { top: 60px } .s2 { top: 400px }
  .shelf::after { content: ""; position: absolute; left: -10px; right: -10px; bottom: -22px; height: 22px;
                  background: #e9edf0; box-shadow: 0 6px 10px rgba(0,0,0,.25); }
  .item { flex: 1; display: flex; flex-direction: column; align-items: center; }
  .can { width: 92px; height: 190px; border-radius: 14px 14px 10px 10px; box-shadow: inset -14px 0 18px rgba(0,0,0,.25);
         color: white; font-weight: 700; font-size: 12px; text-align: center; padding-top: 70px; box-sizing: border-box; }
  .tag { position: relative; z-index: 1; margin-top: 30px; background: #fffbe6; border: 1px solid #d8c97a; border-radius: 3px;
         padding: 6px 10px; width: 150px; transform: rotate(var(--r)); box-shadow: 0 2px 3px rgba(0,0,0,.2); }
  .brand { font-weight: 700; font-size: 13px; color: #1d1d1f; }
  .desc { font-size: 11px; color: #4a4a4a; }
  .price { font-size: 30px; font-weight: 800; color: #b3261e; margin-top: 2px; }
  .price sup { font-size: 15px; }
</style></head><body>
<div class="label">AISLE 7 · CHILLED COFFEE · photo taken Sept 2026</div>
${[SHELF.slice(0, 3), SHELF.slice(3)].map((group, g) => `
<div class="shelf s${g + 1}">${group.map(([brand, desc, size, price], i) => {
  const hue = (g * 3 + i) * 47 + 10;
  const [dollars, cents] = price.split(".");
  return `<div class="item">
    <div class="can" style="background: hsl(${hue} 45% 30%)">${brand.split(" ")[0].toUpperCase()}</div>
    <div class="tag" style="--r:${(i - 1) * 1.2}deg">
      <div class="brand">${brand}</div><div class="desc">${desc} · ${size}</div>
      <div class="price"><sup>$</sup>${dollars}.<sup>${cents}</sup></div>
    </div></div>`;
}).join("")}</div>`).join("")}
</body></html>`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(MEMO, { waitUntil: "load" });
  await page.pdf({ path: path.join(OUT, "brightline-board-memo.pdf"), format: "Letter", printBackground: true });
  const shot = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  await shot.setContent(PHOTO, { waitUntil: "load" });
  await shot.screenshot({ path: path.join(OUT, "competitor-shelf-prices.png") });
} finally {
  await browser.close();
}
for (const f of fs.readdirSync(OUT).filter((f) => !f.endsWith(".md"))) {
  console.log(`${f}  ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)} KB`);
}
