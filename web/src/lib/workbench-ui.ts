"use client";

import { createContext, useContext } from "react";
import type { Chart } from "./workbench";

/**
 * UI state that both the user and the *agent* can drive.
 *
 * Lifted out of the individual panels so a `useFrontendTool` handler can move
 * the interface — that is the whole point of a frontend tool: it runs in the
 * browser, not in the agent process, so the agent can open a file or switch a
 * tab as part of its answer instead of just describing where to look.
 */
export type SandboxTab = "console" | "charts";

export interface WorkbenchUIValue {
  sandboxTab: SandboxTab;
  setSandboxTab: (tab: SandboxTab) => void;
  /** Path of the file open in the Workspace viewer, or null when closed. */
  openFilePath: string | null;
  setOpenFilePath: (path: string | null) => void;
  /** Tool-call id of the chart open in the full-screen view, or null. */
  expandedChartId: string | null;
  setExpandedChartId: (id: string | null) => void;
}

export const WorkbenchUIContext = createContext<WorkbenchUIValue | null>(null);

/**
 * Every chart in the conversation, for components that sit far from where
 * charts are derived — a report embeds a chart by id, and the expanded view
 * lists them all.
 */
export const ChartLibraryContext = createContext<Chart[]>([]);

export function useChartLibrary(): Chart[] {
  return useContext(ChartLibraryContext);
}

export function useWorkbenchUI(): WorkbenchUIValue {
  const ctx = useContext(WorkbenchUIContext);
  if (!ctx) {
    throw new Error("useWorkbenchUI must be used within WorkbenchUIContext.Provider");
  }
  return ctx;
}
