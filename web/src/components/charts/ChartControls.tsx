"use client";

import { useState, type ReactNode, type RefObject } from "react";
import {
  chartToCsv,
  chartToSvg,
  downloadBlob,
  downloadText,
  svgToPngBlob,
} from "@/lib/downloads";
import type { Chart } from "@/lib/workbench";

/** Small rounded control used across chart chrome. */
export function ChipButton({
  children,
  onClick,
  active = false,
  title,
  ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] font-medium transition-colors ${
        active
          ? "border-transparent bg-wb-accent-soft text-wb-accent"
          : "border-wb-border text-wb-muted hover:border-wb-border-strong hover:text-wb-text"
      }`}
    >
      {children}
    </button>
  );
}

export function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
      <path
        d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
      <path
        d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * PNG / SVG / CSV export for one chart. PNG and SVG are composed from what is
 * on screen (`plotRef` must wrap a rendered ChartPlot), so they need the chart
 * view — not the table — to be showing. CSV comes straight from the data.
 */
export function ChartExports({
  chart,
  plotRef,
  plotVisible,
}: {
  chart: Chart;
  plotRef: RefObject<HTMLDivElement | null>;
  plotVisible: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const name = chart.chartId;

  async function exportImage(kind: "png" | "svg") {
    setError(null);
    const el = plotRef.current;
    if (!el) return;
    try {
      const svg = chartToSvg(el, chart);
      if (kind === "svg") downloadText(`${name}.svg`, svg, "image/svg+xml");
      else downloadBlob(`${name}.png`, await svgToPngBlob(svg));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {plotVisible ? (
        <>
          <ChipButton onClick={() => void exportImage("png")} title="Download as PNG image">
            <DownloadIcon /> PNG
          </ChipButton>
          <ChipButton onClick={() => void exportImage("svg")} title="Download as SVG (vector)">
            SVG
          </ChipButton>
        </>
      ) : null}
      <ChipButton
        onClick={() => downloadText(`${name}.csv`, chartToCsv(chart), "text/csv")}
        title="Download the data as CSV"
      >
        {plotVisible ? null : <DownloadIcon />} CSV
      </ChipButton>
      {error ? <span className="text-[10.5px] text-wb-warn">{error}</span> : null}
    </div>
  );
}
