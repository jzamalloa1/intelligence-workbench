"use client";

import { useState } from "react";
import type { Chart } from "@/lib/workbench";
import { useWorkbenchUI } from "@/lib/workbench-ui";
import { ChipButton, ExpandIcon } from "./charts/ChartControls";
import { ChartLegend, ChartPlot, ChartTable } from "./charts/ChartPlot";
import { EmptyState } from "./Panel";

/**
 * Renders `render_chart` calls as real, interactive charts — not the images a
 * sandboxed script would have produced (see README's "Who sees what" diagram:
 * a file written inside the sandbox VM never reaches here at all; only tool
 * arguments do).
 *
 * A gallery, not a single slot: every chart in the conversation stays
 * reachable from the strip at the bottom. It follows the newest chart by
 * default; picking an older one holds it until the next chart arrives.
 */
export function ArtifactCanvas({ charts }: { charts: Chart[] }) {
  const { setExpandedChartId } = useWorkbenchUI();
  const [tableView, setTableView] = useState(false);
  // A pick is only honoured while the chart count is what it was when the user
  // made it — a new chart arriving moves the view to it, without an effect.
  const [pick, setPick] = useState<{ id: string; atCount: number } | null>(null);

  if (charts.length === 0) {
    return (
      <EmptyState>
        Charts the agent renders via <code className="text-wb-muted">render_chart</code> appear
        here.
      </EmptyState>
    );
  }

  const picked = pick && pick.atCount === charts.length ? charts.find((c) => c.id === pick.id) : undefined;
  const chart = picked ?? charts[charts.length - 1];

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <h3 className="line-clamp-2 min-w-0 text-[12.5px] font-medium leading-snug text-wb-text" title={chart.title}>
          {chart.title}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          <ChipButton active={tableView} onClick={() => setTableView((v) => !v)} title="Toggle table view">
            Table
          </ChipButton>
          <ChipButton
            onClick={() => setExpandedChartId(chart.id)}
            title="Open full screen — all charts, exports"
            ariaLabel="Expand chart"
          >
            <ExpandIcon />
          </ChipButton>
        </div>
      </div>

      {tableView ? (
        <div className="min-h-0 flex-1">
          <ChartTable chart={chart} />
        </div>
      ) : (
        <>
          <ChartLegend chart={chart} />
          {/* Double-click is a shortcut only; the Expand button is the real control. */}
          <div className="min-h-0 flex-1" onDoubleClick={() => setExpandedChartId(chart.id)}>
            <ChartPlot chart={chart} dense />
          </div>
        </>
      )}

      {charts.length > 1 ? (
        <nav aria-label="All charts" className="-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 pb-0.5">
          {charts.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setPick({ id: c.id, atCount: charts.length })}
              aria-current={c.id === chart.id}
              title={c.title}
              className={`flex max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] transition-colors ${
                c.id === chart.id
                  ? "border-transparent bg-wb-accent-soft text-wb-accent"
                  : "border-wb-border text-wb-muted hover:border-wb-border-strong hover:text-wb-text"
              }`}
            >
              <span className="tabular-nums opacity-70">{i + 1}</span>
              <span className="truncate">{c.title}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
