"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Chart, ChartSeries } from "@/lib/workbench";
import { EmptyState } from "./Panel";

/**
 * Renders `render_chart` calls as real, interactive charts — not the images a
 * sandboxed script would have produced (see README's "Who sees what" diagram:
 * a file written inside the sandbox VM never reaches here at all; only tool
 * arguments do). Colors are the dataviz skill's validated categorical palette
 * (`--wb-series-*` in globals.css) in fixed slot order — never reassigned per
 * chart, never generated past slot 6.
 */
export function ArtifactCanvas({ charts }: { charts: Chart[] }) {
  const [tableView, setTableView] = useState(false);
  const latest = charts[charts.length - 1];

  if (!latest) {
    return (
      <EmptyState>
        Charts the agent renders via <code className="text-wb-muted">render_chart</code> appear
        here.
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-[12.5px] font-medium text-wb-text">{latest.title}</h3>
        <button
          type="button"
          onClick={() => setTableView((v) => !v)}
          className="shrink-0 rounded-full border border-wb-border px-2.5 py-1 text-[10.5px] font-medium text-wb-muted transition-colors hover:border-wb-border-strong hover:text-wb-text"
        >
          {tableView ? "Chart" : "Table"}
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {tableView ? <ChartTable chart={latest} /> : <Plot chart={latest} />}
      </div>

      {charts.length > 1 ? (
        <p className="shrink-0 text-[10.5px] text-wb-faint">
          Showing the most recent of {charts.length} charts.
        </p>
      ) : null}
    </div>
  );
}

/** `--wb-series-1..6` in globals.css — fixed order, never cycled or reassigned. */
const SERIES_COLORS = [
  "var(--wb-series-1)",
  "var(--wb-series-2)",
  "var(--wb-series-3)",
  "var(--wb-series-4)",
  "var(--wb-series-5)",
  "var(--wb-series-6)",
];

function toRows(chart: Chart): Record<string, string | number>[] {
  return chart.categories.map((category, i) => {
    const row: Record<string, string | number> = { category };
    for (const s of chart.series) row[s.name] = s.values[i] ?? 0;
    return row;
  });
}

function Plot({ chart }: { chart: Chart }) {
  const rows = useMemo(() => toRows(chart), [chart]);
  const showLegend = chart.series.length >= 2;
  const ChartComponent = chart.chartType === "line" ? LineChart : BarChart;

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={180}>
      <ChartComponent data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--wb-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="category"
          stroke="var(--wb-border-strong)"
          tick={{ fill: "var(--wb-muted)", fontSize: 11 }}
          tickLine={false}
          label={
            chart.xLabel
              ? { value: chart.xLabel, position: "insideBottom", offset: -2, fontSize: 11, fill: "var(--wb-faint)" }
              : undefined
          }
        />
        <YAxis
          stroke="var(--wb-border-strong)"
          tick={{ fill: "var(--wb-muted)", fontSize: 11 }}
          tickLine={false}
          width={36}
          label={
            chart.yLabel
              ? { value: chart.yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--wb-faint)" }
              : undefined
          }
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--wb-panel-alt)" }} />
        {showLegend ? (
          <Legend
            wrapperStyle={{ fontSize: 11, color: "var(--wb-muted)" }}
            iconType="circle"
            iconSize={8}
          />
        ) : null}
        {chart.series.map((s, i) =>
          chart.chartType === "line" ? (
            <Line
              key={s.name}
              dataKey={s.name}
              type="monotone"
              stroke={SERIES_COLORS[i]}
              strokeWidth={2}
              dot={{ r: 4, fill: SERIES_COLORS[i], strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ) : (
            <Bar
              key={s.name}
              dataKey={s.name}
              fill={SERIES_COLORS[i]}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          ),
        )}
      </ChartComponent>
    </ResponsiveContainer>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
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
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5 text-wb-muted">
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-wb-text">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** The accessible alternate view every chart needs — same data, as a table. */
function ChartTable({ chart }: { chart: Chart }) {
  return (
    <div className="h-full overflow-auto rounded-lg border border-wb-border">
      <table className="w-full border-collapse text-[11.5px]">
        <thead className="bg-wb-panel-alt">
          <tr>
            <th className="border-b border-wb-border px-2.5 py-1.5 text-left font-medium text-wb-muted">
              {chart.xLabel || "Category"}
            </th>
            {chart.series.map((s: ChartSeries) => (
              <th
                key={s.name}
                className="border-b border-wb-border px-2.5 py-1.5 text-right font-medium text-wb-muted"
              >
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.categories.map((category, i) => (
            <tr key={category}>
              <td className="border-b border-wb-border px-2.5 py-1.5 text-wb-text">{category}</td>
              {chart.series.map((s) => (
                <td
                  key={s.name}
                  className="border-b border-wb-border px-2.5 py-1.5 text-right tabular-nums text-wb-text"
                >
                  {s.values[i]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
