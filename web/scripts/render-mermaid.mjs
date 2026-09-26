/**
 * Renders every ```mermaid block in a Markdown file with the Mermaid build
 * already in node_modules (11.x — the same major GitHub uses), in headless
 * Chrome. Fails on any diagram Mermaid can't parse, and writes a PNG per
 * diagram so the result can be looked at, not just parsed. No network.
 *
 *   node scripts/render-mermaid.mjs ../README.md
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const file = process.argv[2] ?? "../README.md";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out/mermaid");
fs.mkdirSync(OUT, { recursive: true });

const markdown = fs.readFileSync(file, "utf8");
const blocks = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => ({
  code: m[1],
  line: markdown.slice(0, m.index).split("\n").length,
}));
const mermaidJs = fs.readFileSync(createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js"), "utf8");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1.5 });
await page.setContent(`<html><body style="margin:0;background:#fff"><div id="out"></div></body></html>`);
await page.addScriptTag({ content: mermaidJs });
await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict" }));

let failed = 0;
for (const [i, block] of blocks.entries()) {
  const result = await page.evaluate(async ({ code, i }) => {
    try {
      await window.mermaid.parse(code);
      const { svg } = await window.mermaid.render(`d${i}`, code);
      document.getElementById("out").innerHTML = `<div style="padding:16px;display:inline-block">${svg}</div>`;
      const literalNewlines = [...document.querySelectorAll("#out .nodeLabel, #out .edgeLabel")].filter((n) =>
        n.textContent.includes("\\n"),
      ).length;
      return { ok: true, literalNewlines };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e).split("\n").slice(0, 3).join(" ") };
    }
  }, { code: block.code, i });

  const name = `diagram-${i + 1}-line-${block.line}.png`;
  if (result.ok) {
    await page.locator("#out > div").screenshot({ path: path.join(OUT, name) });
    const warn = result.literalNewlines ? `  (WARN: ${result.literalNewlines} labels show a literal "\\n")` : "";
    console.log(`PASS — diagram ${i + 1} (line ${block.line}) → ${name}${warn}`);
    if (result.literalNewlines) failed++;
  } else {
    failed++;
    console.log(`FAIL — diagram ${i + 1} (line ${block.line}): ${result.error}`);
  }
}
await browser.close();
console.log(failed ? `\n${failed} of ${blocks.length} need attention` : `\nALL ${blocks.length} RENDER`, `— PNGs in ${OUT}`);
process.exit(failed ? 1 : 0);
