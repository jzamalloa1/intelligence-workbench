import type { Chart } from "./workbench";

/**
 * Client-side file downloads — charts (PNG, SVG, CSV) and workspace files.
 * Everything here is built from data the browser already has; nothing is
 * fetched, so a download works even after the sandbox that produced the
 * numbers has been reclaimed.
 */

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: Safari cancels the download if revoked synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  downloadBlob(filename, new Blob([text], { type: `${type};charset=utf-8` }));
}

/** Last path segment, for naming a download after a workspace file. */
export function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "file";
}

// ---------------------------------------------------------------- charts

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function chartToCsv(chart: Chart): string {
  const header = [
    chart.xLabel || "category",
    ...chart.series.map((s) => (s.unit ? `${s.name} (${s.unit})` : s.name)),
  ];
  const rows = chart.categories.map((c, i) => [c, ...chart.series.map((s) => s.values[i] ?? "")]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

const STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-opacity",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
] as const;

/**
 * Recharts paints with `var(--wb-*)` tokens, which mean nothing once the SVG
 * leaves the page. Copy each element's *computed* style onto the clone so the
 * exported file carries literal colors and fonts.
 */
function inlineComputedStyles(source: SVGElement, clone: SVGElement) {
  const src = [source, ...source.querySelectorAll<SVGElement>("*")];
  const dst = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  src.forEach((el, i) => {
    const target = dst[i];
    if (!target) return;
    const cs = getComputedStyle(el);
    const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
    target.setAttribute("style", style);
    // The computed style now carries the real value; a leftover `fill="var(…)"`
    // attribute would only confuse editors that read attributes over style.
    for (const attr of [...target.attributes]) {
      if (attr.value.includes("var(")) target.removeAttribute(attr.name);
    }
  });
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgText(
  doc: Document,
  x: number,
  y: number,
  text: string,
  attrs: Record<string, string>,
): SVGTextElement {
  const t = doc.createElementNS(SVG_NS, "text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  for (const [k, v] of Object.entries(attrs)) t.setAttribute(k, v);
  t.textContent = text;
  return t;
}

/**
 * Composes one standalone SVG from a rendered chart: title, legend, every
 * unit panel (each its own Recharts surface), and the x-axis caption. The
 * legend is redrawn here because on screen it is HTML, not part of any SVG.
 */
export function chartToSvg(container: HTMLElement, chart: Chart): string {
  const surfaces = [...container.querySelectorAll<SVGSVGElement>("svg.recharts-surface")];
  const cs = getComputedStyle(container);
  const ink = cs.getPropertyValue("--wb-text").trim() || "#111";
  const muted = cs.getPropertyValue("--wb-muted").trim() || "#555";
  const bg = cs.getPropertyValue("--wb-panel").trim() || "#fff";
  const font = cs.fontFamily || "system-ui, sans-serif";

  const pad = 24;
  const width = Math.max(480, ...surfaces.map((s) => s.getBoundingClientRect().width)) + pad * 2;
  const doc = document.implementation.createDocument(SVG_NS, "svg", null);
  const root = doc.documentElement as unknown as SVGSVGElement;
  root.setAttribute("xmlns", SVG_NS);
  root.setAttribute("font-family", font);

  let y = pad + 16;
  root.appendChild(svgText(doc, pad, y, chart.title, { "font-size": "16", "font-weight": "600", fill: ink }));
  y += 22;

  if (chart.series.length >= 2) {
    let x = pad;
    chart.series.forEach((s, i) => {
      const color = cs.getPropertyValue(`--wb-series-${i + 1}`).trim();
      const dot = doc.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(x + 4));
      dot.setAttribute("cy", String(y - 4));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", color);
      root.appendChild(dot);
      const label = s.unit ? `${s.name} (${s.unit})` : s.name;
      root.appendChild(svgText(doc, x + 12, y, label, { "font-size": "12", fill: muted }));
      x += 12 + label.length * 6.6 + 16;
    });
    y += 14;
  }

  for (const surface of surfaces) {
    const caption = surface.closest("[data-facet]")?.getAttribute("data-facet");
    if (caption) {
      y += 14;
      root.appendChild(svgText(doc, pad, y, caption, { "font-size": "11", fill: muted }));
      y += 4;
    }
    const rect = surface.getBoundingClientRect();
    const clone = surface.cloneNode(true) as SVGSVGElement;
    inlineComputedStyles(surface, clone);
    clone.setAttribute("x", String(pad));
    clone.setAttribute("y", String(y));
    clone.setAttribute("width", String(rect.width));
    clone.setAttribute("height", String(rect.height));
    root.appendChild(doc.importNode(clone, true));
    y += rect.height;
  }

  if (chart.xLabel) {
    y += 16;
    root.appendChild(
      svgText(doc, width / 2, y, chart.xLabel, { "font-size": "11", fill: muted, "text-anchor": "middle" }),
    );
  }
  const height = y + pad;

  const background = doc.createElementNS(SVG_NS, "rect");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", bg);
  root.insertBefore(background, root.firstChild);

  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return new XMLSerializer().serializeToString(root);
}

export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not rasterize the chart SVG."));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed."))), "image/png"),
  );
}
