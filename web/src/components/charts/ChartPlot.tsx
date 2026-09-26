"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Chart, ChartSeries } from "@/lib/workbench";

/**
 * The one chart renderer, shared by the Sandbox panel, the expanded view and
 * charts embedded in reports.
 *
 * Series are grouped by `unit` into stacked panels ("facets") that share the
 * category axis but each get their own y-scale — the dataviz rule is one axis
 * per measure, never a dual axis and never two units on one scale (a cents
 * series next to a seconds series reads as zero). Colors are the validated
 * categorical palette in fixed slot order by the series' position in the chart,
 * so a series keeps its color whichever panel it lands in.
 */

/** `--wb-series-1..6` in globals.css — fixed order, never cycled or reassigned. */
export const SERIES_COLORS = [
  "var(--wb-series-1)",
  "var(--wb-series-2)",
  "var(--wb-series-3)",
  "var(--wb-series-4)",
  "var(--wb-series-5)",
  "var(--wb-series-6)",
];

interface Facet {
  unit: string;
  series: { series: ChartSeries; color: string }[];
}

export function facetsOf(chart: Chart): Facet[] {
  const byUnit = new Map<string, Facet>();
  chart.series.forEach((series, i) => {
    const facet = byUnit.get(series.unit) ?? { unit: series.unit, series: [] };
    facet.series.push({ series, color: SERIES_COLORS[i] });
    byUnit.set(series.unit, facet);
  });
  return [...byUnit.values()];
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 });
const precise = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

export function formatValue(value: number, unit: string): string {
  const n = precise.format(value);
  if (!unit) return n;
  return unit === "%" ? `${n}%` : `${n} ${unit}`;
}

/** Legend as HTML above the plot: always for ≥ 2 series, never for one (the title names it). */
export function ChartLegend({ chart }: { chart: Chart }) {
  if (chart.series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-wb-muted">
      {chart.series.map((s, i) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ background: SERIES_COLORS[i] }} />
          {s.name}
          {s.unit ? <span className="text-wb-faint">({s.unit})</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * `facetHeight` switches from "fill the parent" to "size to content": each
 * unit panel gets that fixed height and the plot grows with the panel count.
 * Use it wherever the parent has no height of its own (a chart in a report) —
 * squeezing N panels into one fixed box is what makes them overlap.
 */
export function ChartPlot({
  chart,
  dense = false,
  facetHeight,
}: {
  chart: Chart;
  dense?: boolean;
  facetHeight?: number;
}) {
  const facets = useMemo(() => facetsOf(chart), [chart]);
  const rows = useMemo(
    () =>
      chart.categories.map((category, i) => {
        const row: Record<string, string | number> = { category };
        for (const s of chart.series) row[s.name] = s.values[i] ?? 0;
        return row;
      }),
    [chart],
  );
  // Long category names wrap onto up to three lines instead of being silently
  // dropped (Recharts' default hides ticks that would collide).
  const longest = Math.max(...chart.categories.map((c) => c.length));
  const tickLines = longest > 24 ? 3 : longest > 10 ? 2 : 1;

  return (
    <div className={`flex min-h-0 flex-col ${facetHeight ? "" : "h-full"}`}>
      <div className={`flex min-h-0 flex-col gap-1 ${facetHeight ? "" : "flex-1"}`}>
        {facets.map((facet, fi) => {
          const last = fi === facets.length - 1;
          const caption =
            facets.length > 1 ? facet.unit || "value" : chart.yLabel || facet.unit || "";
          return (
            <div
              key={facet.unit || fi}
              className={`flex min-h-0 flex-col ${facetHeight ? "" : "flex-1"}`}
              style={facetHeight ? { height: facetHeight } : undefined}
              data-facet={caption}
            >
              {caption ? (
                <p className="shrink-0 pl-1 text-[10.5px] text-wb-faint">{caption}</p>
              ) : null}
              <div className="min-h-0 flex-1">
                <ResponsiveContainer width="100%" height="100%" minHeight={dense ? 90 : 140}>
                  <FacetChart
                    chart={chart}
                    facet={facet}
                    rows={rows}
                    showCategories={last}
                    tickLines={tickLines}
                  />
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
      {chart.xLabel ? (
        <p className="shrink-0 pt-1 text-center text-[10.5px] text-wb-faint">{chart.xLabel}</p>
      ) : null}
    </div>
  );
}

function FacetChart({
  chart,
  facet,
  rows,
  showCategories,
  tickLines,
  ...rest
}: {
  chart: Chart;
  facet: Facet;
  rows: Record<string, string | number>[];
  showCategories: boolean;
  tickLines: number;
}) {
  const Component = chart.chartType === "line" ? LineChart : BarChart;
  return (
    <Component
      {...rest}
      data={rows}
      margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
      barGap={2}
      barCategoryGap="20%"
    >
      <CartesianGrid stroke="var(--wb-border)" strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="category"
        stroke="var(--wb-border-strong)"
        tickLine={false}
        interval={0}
        hide={!showCategories}
        height={showCategories ? 8 + tickLines * 13 : 0}
        tick={<WrappedTick maxLines={tickLines} />}
      />
      <YAxis
        stroke="var(--wb-border-strong)"
        tick={{ fill: "var(--wb-muted)", fontSize: 11 }}
        tickLine={false}
        tickFormatter={(v: number) => compact.format(v)}
        width={40}
      />
      <Tooltip
        content={<ChartTooltip chart={chart} />}
        cursor={chart.chartType === "line" ? { stroke: "var(--wb-border-strong)" } : { fill: "var(--wb-panel-alt)" }}
      />
      {facet.series.map(({ series, color }) =>
        chart.chartType === "line" ? (
          <Line
            key={series.name}
            dataKey={series.name}
            type="monotone"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 4, fill: color, stroke: "var(--wb-panel)", strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "var(--wb-panel)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        ) : (
          <Bar
            key={series.name}
            dataKey={series.name}
            fill={color}
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
            isAnimationActive={false}
          />
        ),
      )}
    </Component>
  );
}

function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const clipped = lines.slice(0, maxLines).map((l) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l));
  if (lines.length > maxLines) clipped[maxLines - 1] = `${clipped[maxLines - 1].replace(/…$/, "")}…`;
  return clipped;
}

function WrappedTick(props: {
  x?: number;
  y?: number;
  payload?: { value: string };
  width?: number;
  visibleTicksCount?: number;
  maxLines: number;
}) {
  const { x = 0, y = 0, payload, width = 300, visibleTicksCount = 1, maxLines } = props;
  const band = width / Math.max(1, visibleTicksCount);
  const lines = wrapLabel(String(payload?.value ?? ""), Math.max(4, Math.floor(band / 6.4)), maxLines);
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{payload?.value}</title>
      <text textAnchor="middle" fill="var(--wb-muted)" fontSize={11}>
        {lines.map((line, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 12 : 13}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function ChartTooltip({
  chart,
  active,
  payload,
  label,
}: {
  chart: Chart;
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border border-wb-border bg-wb-panel px-2.5 py-2 text-[11px]"
      style={{ boxShadow: "var(--wb-shadow)" }}
    >
      <p className="mb-1 font-medium text-wb-text">{label}</p>
      {payload.map((p) => {
        const unit = chart.series.find((s) => s.name === p.name)?.unit ?? "";
        return (
          <p key={p.name} className="flex items-center gap-1.5 text-wb-muted">
            <span aria-hidden className="size-1.5 rounded-full" style={{ background: p.color }} />
            {p.name}: <span className="font-medium tabular-nums text-wb-text">{formatValue(p.value, unit)}</span>
          </p>
        );
      })}
    </div>
  );
}

/** The accessible alternate view every chart needs — same data, as a table. */
export function ChartTable({ chart }: { chart: Chart }) {
  return (
    <div className="h-full overflow-auto rounded-lg border border-wb-border">
      <table className="w-full border-collapse text-[11.5px]">
        <thead className="sticky top-0 bg-wb-panel-alt">
          <tr>
            <th className="border-b border-wb-border px-2.5 py-1.5 text-left font-medium text-wb-muted">
              {chart.xLabel || "Category"}
            </th>
            {chart.series.map((s) => (
              <th
                key={s.name}
                className="border-b border-wb-border px-2.5 py-1.5 text-right font-medium text-wb-muted"
              >
                {s.name}
                {s.unit ? <span className="font-normal text-wb-faint"> ({s.unit})</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.categories.map((category, i) => (
            <tr key={`${category}-${i}`}>
              <td className="border-b border-wb-border px-2.5 py-1.5 text-wb-text">{category}</td>
              {chart.series.map((s) => (
                <td
                  key={s.name}
                  className="border-b border-wb-border px-2.5 py-1.5 text-right tabular-nums text-wb-text"
                >
                  {precise.format(s.values[i] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
