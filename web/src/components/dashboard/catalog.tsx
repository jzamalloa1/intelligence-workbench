"use client";

import type { ReactNode } from "react";
import { createCatalog, type CatalogDefinitions, type CatalogRenderers, type RendererProps } from "@copilotkit/a2ui-renderer";
// The renderer is built on zod 3 (it turns these schemas into JSON Schema);
// zod 4 ships that API as `zod/v3`. Its types are a different copy from the
// renderer's own zod 3, and letting TypeScript infer across the two makes a type
// check take minutes — so the renderers below use the plain prop types instead.
import { z } from "zod/v3";
import { ChartLegend, ChartPlot } from "@/components/charts/ChartPlot";
import { ChipButton, ExpandIcon } from "@/components/charts/ChartControls";
import { useChartLibrary, useWorkbenchUI } from "@/lib/workbench-ui";

/**
 * The components a dashboard is built from — the A2UI catalog behind
 * `render_dashboard`. Layout keeps A2UI's basic-catalog names and props
 * (Column, Row, Card, Text, Divider) so the format stays standard; Metric,
 * Chart and Table are ours. Every one is drawn here with the workbench's own
 * tokens rather than A2UI's default theme.
 *
 * Mirrors CATALOG in agent/tools/dashboard.py, which validates the agent's
 * layout before it ever reaches the browser — change both or neither.
 */

export const DASHBOARD_CATALOG_ID = "workbench-dashboard";

const ids = z.array(z.string());
const justify = z.enum(["start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly", "stretch"]);
const align = z.enum(["start", "center", "end", "stretch"]);
const cell = z.union([z.string(), z.number(), z.null()]);

const definitions = {
  Column: { description: "Stacks children vertically.", props: z.object({ children: ids, align: align.optional() }) },
  Row: {
    description: "Lays children side by side; wraps on narrow screens.",
    props: z.object({ children: ids, justify: justify.optional(), align: align.optional() }),
  },
  Card: { description: "A bordered panel around one child.", props: z.object({ child: z.string() }) },
  Text: {
    description: "A heading or paragraph.",
    props: z.object({ text: z.string(), variant: z.enum(["h2", "h3", "body", "caption"]).optional() }),
  },
  Divider: { description: "A horizontal rule.", props: z.object({}) },
  Metric: {
    description: "A headline number with an optional change and caption.",
    props: z.object({
      label: z.string(),
      value: z.string(),
      delta: z.string().optional(),
      trend: z.enum(["up", "down", "flat"]).optional(),
      caption: z.string().optional(),
    }),
  },
  Chart: { description: "A chart drawn earlier with render_chart, by its chart_id.", props: z.object({ chartId: z.string() }) },
  Table: {
    description: "A small table.",
    props: z.object({ columns: z.array(z.string()), rows: z.array(z.array(cell)), caption: z.string().optional() }),
  },
};

type Align = "start" | "center" | "end" | "stretch";
type Props = {
  Column: { children: string[]; align?: Align };
  Row: { children: string[]; justify?: string; align?: Align };
  Card: { child: string };
  Text: { text: string; variant?: "h2" | "h3" | "body" | "caption" };
  Divider: Record<string, never>;
  Metric: { label: string; value: string; delta?: string; trend?: "up" | "down" | "flat"; caption?: string };
  Chart: { chartId: string };
  Table: { columns: string[]; rows: (string | number | null)[][]; caption?: string };
};

const JUSTIFY: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
  spaceAround: "justify-around",
  spaceEvenly: "justify-evenly",
  stretch: "justify-stretch",
};
const ALIGN: Record<string, string> = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" };

/** Children arrive as the ids the agent listed. */
function kids(list: unknown, render: (id: string) => ReactNode): ReactNode {
  return Array.isArray(list) ? list.map((id) => <div key={String(id)} className="min-w-0">{render(String(id))}</div>) : null;
}

/** A column whose cells are all numbers is right-aligned, header included. */
function numeric(rows: unknown[][], i: number): boolean {
  return rows.every((r) => typeof r[i] === "number" || r[i] == null);
}

const TREND = {
  up: { glyph: "▲", tone: "text-wb-good" },
  down: { glyph: "▼", tone: "text-wb-warn" },
  flat: { glyph: "▬", tone: "text-wb-muted" },
} as const;

function DashboardChart({ chartId }: { chartId: string }) {
  const charts = useChartLibrary();
  const { setExpandedChartId } = useWorkbenchUI();
  // Latest wins, as in reports: re-rendering a chart under the same id replaces it.
  const chart = [...charts].reverse().find((c) => c.chartId === chartId);
  if (!chart) {
    return (
      <div className="rounded-lg border border-dashed border-wb-border-strong px-3 py-2.5 text-[11.5px] text-wb-faint">
        Chart <code className="font-mono">{chartId}</code> isn’t in this conversation.
      </div>
    );
  }
  return (
    <figure className="rounded-lg border border-wb-border bg-wb-panel p-3">
      <figcaption className="mb-2 flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium text-wb-text">{chart.title}</span>
        <ChipButton onClick={() => setExpandedChartId(chart.id)} ariaLabel="Expand chart" title="Open full screen">
          <ExpandIcon />
        </ChipButton>
      </figcaption>
      <div className="mb-2">
        <ChartLegend chart={chart} />
      </div>
      <ChartPlot chart={chart} facetHeight={180} />
    </figure>
  );
}

type P<K extends keyof Props> = RendererProps<Props[K]>;

const renderers: { [K in keyof Props]: (p: P<K>) => ReactNode } = {
    Column: ({ props, children }: P<"Column">) => (
      <div className={`flex flex-col gap-3 ${ALIGN[props.align ?? "stretch"]}`}>{kids(props.children, children)}</div>
    ),
    Row: ({ props, children }: P<"Row">) => (
      <div
        className={`grid gap-3 ${JUSTIFY[props.justify ?? "start"]} ${ALIGN[props.align ?? "stretch"]}`}
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr))` }}
      >
        {kids(props.children, children)}
      </div>
    ),
    Card: ({ props, children }: P<"Card">) => (
      <div className="rounded-lg border border-wb-border bg-wb-panel p-3">{children(props.child)}</div>
    ),
    Text: ({ props }: P<"Text">) => {
      const v = props.variant ?? "body";
      const cls =
        v === "h2"
          ? "text-[15px] font-semibold text-wb-text"
          : v === "h3"
            ? "text-[13px] font-semibold text-wb-text"
            : v === "caption"
              ? "text-[11px] text-wb-faint"
              : "text-[12.5px] leading-relaxed text-wb-text";
      return <p className={cls}>{props.text}</p>;
    },
    Divider: () => <hr className="border-wb-border" />,
    Metric: ({ props }: P<"Metric">) => {
      const trend = props.trend ? TREND[props.trend] : null;
      return (
        <div className="h-full rounded-lg border border-wb-border bg-wb-panel px-3 py-2.5" data-testid="dashboard-metric">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-wb-muted">{props.label}</div>
          <div className="mt-1 text-[20px] font-semibold leading-tight tabular-nums text-wb-text">{props.value}</div>
          {props.delta ? (
            <div className={`mt-0.5 text-[11.5px] font-medium tabular-nums ${trend?.tone ?? "text-wb-muted"}`}>
              {trend ? <span aria-hidden className="mr-1 text-[9px]">{trend.glyph}</span> : null}
              {props.delta}
            </div>
          ) : null}
          {props.caption ? <div className="mt-1 text-[10.5px] text-wb-faint">{props.caption}</div> : null}
        </div>
      );
    },
    Chart: ({ props }: P<"Chart">) => <DashboardChart chartId={props.chartId} />,
    Table: ({ props }: P<"Table">) => (
      <figure className="overflow-x-auto rounded-lg border border-wb-border bg-wb-panel">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-wb-border bg-wb-panel-alt text-left">
              {props.columns.map((c, i) => (
                <th key={i} className={`px-3 py-1.5 font-medium text-wb-muted ${numeric(props.rows, i) ? "text-right" : ""}`}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, r) => (
              <tr key={r} className="border-b border-wb-border last:border-0">
                {row.map((v, i) => (
                  <td key={i} className={`px-3 py-1.5 text-wb-text ${typeof v === "number" ? "text-right tabular-nums" : ""}`}>
                    {v ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {props.caption ? <figcaption className="px-3 py-1.5 text-[10.5px] text-wb-faint">{props.caption}</figcaption> : null}
      </figure>
    ),
};

export const dashboardCatalog = createCatalog(
  definitions as unknown as CatalogDefinitions,
  renderers as unknown as CatalogRenderers<CatalogDefinitions>,
  { catalogId: DASHBOARD_CATALOG_ID },
);
