"use client";

import { createContext, useContext } from "react";

/**
 * Which backend runner the agent runs against, chosen per-request via the
 * `x-runner` header (see route.ts) rather than the `INTELLIGENCE_API_KEY` env
 * toggle it used to require a restart to flip.
 */
export type RunnerMode = "cloud" | "local";

export interface RunnerModeContextValue {
  mode: RunnerMode;
  setMode: (mode: RunnerMode) => void;
  /** False when the server has no INTELLIGENCE_API_KEY — the toggle is then a no-op. */
  intelligenceAvailable: boolean;
}

export const RunnerModeContext = createContext<RunnerModeContextValue | null>(null);

export function useRunnerMode(): RunnerModeContextValue {
  const ctx = useContext(RunnerModeContext);
  if (!ctx) {
    throw new Error("useRunnerMode must be used within AgentProvider");
  }
  return ctx;
}
