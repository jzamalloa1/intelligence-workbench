"use client";

import { useEffect, useRef, useState } from "react";
import { useChartLibrary, useWorkbenchUI } from "@/lib/workbench-ui";
import { ChartExports, ChipButton } from "./ChartControls";
import { ChartLegend, ChartPlot, ChartTable } from "./ChartPlot";

/**
 * Full-screen chart view: every chart in the conversation in a rail on the
 * left, the selected one large on the right, with table view and exports.
 * Opened from the Sandbox panel, from a chart embedded in a report, or by the
 * agent via `focus_panel`.
 */
export function ChartDialog() {
  const charts = useChartLibrary();
  const { expandedChartId, setExpandedChartId } = useWorkbenchUI();
  const [tableView, setTableView] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const index = charts.findIndex((c) => c.id === expandedChartId);
  const chart = index >= 0 ? charts[index] : undefined;
  const open = chart !== undefined;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpandedChartId(null);
      if (e.key === "ArrowDown" || e.key === "ArrowRight") step(1);
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") step(-1);
    }
    function step(delta: number) {
      const next = charts[index + delta];
      if (next) setExpandedChartId(next.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, charts, setExpandedChartId]);

  if (!chart) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 backdrop-blur-[2px] sm:p-6"
      onClick={() => setExpandedChartId(null)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={chart.title}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full max-h-[900px] w-full max-w-[1400px] overflow-hidden rounded-2xl border border-wb-border bg-wb-panel"
        style={{ boxShadow: "var(--wb-shadow)" }}
      >
        {charts.length > 1 ? (
          <nav
            aria-label="Charts in this conversation"
            className="hidden w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-wb-border bg-wb-panel-alt p-2 md:flex"
          >
            <p className="px-2 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-wb-faint">
              {charts.length} charts
            </p>
            {charts.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setExpandedChartId(c.id)}
                aria-current={c.id === chart.id}
                className={`rounded-lg px-2.5 py-2 text-left transition-colors ${
                  c.id === chart.id ? "bg-wb-panel text-wb-text" : "text-wb-muted hover:bg-wb-panel/60"
                }`}
                style={c.id === chart.id ? { boxShadow: "var(--wb-shadow)" } : undefined}
              >
                <span className="block text-[10px] tabular-nums text-wb-faint">
                  {i + 1} · {c.chartType}
                </span>
                <span className="line-clamp-2 text-[12px] leading-snug">{c.title}</span>
              </button>
            ))}
          </nav>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-wb-border px-5 py-3.5">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold leading-snug text-wb-text">{chart.title}</h2>
              <p className="mt-0.5 font-mono text-[10.5px] text-wb-faint">chart: {chart.chartId}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <ChipButton active={!tableView} onClick={() => setTableView(false)}>
                Chart
              </ChipButton>
              <ChipButton active={tableView} onClick={() => setTableView(true)}>
                Table
              </ChipButton>
              <span className="mx-1 h-4 w-px bg-wb-border" aria-hidden />
              <ChartExports chart={chart} plotRef={plotRef} plotVisible={!tableView} />
              <button
                ref={closeRef}
                type="button"
                onClick={() => setExpandedChartId(null)}
                aria-label="Close"
                className="ml-1 rounded-md px-2 py-1 text-[12px] text-wb-muted transition-colors hover:bg-wb-panel-alt hover:text-wb-text"
              >
                Esc
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
            {tableView ? (
              <ChartTable chart={chart} />
            ) : (
              <div ref={plotRef} className="flex min-h-0 flex-1 flex-col gap-3">
                <ChartLegend chart={chart} />
                <div className="min-h-0 flex-1">
                  <ChartPlot chart={chart} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
