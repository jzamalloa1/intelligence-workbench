"use client";

import { useCallback, useState } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { INSPECTOR_ENABLED } from "@/lib/config";
import { RunnerModeContext, type RunnerMode } from "@/lib/runner-mode";

/**
 * Wraps <CopilotKit> with a live runner toggle. `headers` is re-evaluated on
 * every request (CopilotKit v2 supports a function there for exactly this —
 * refreshing auth tokens is the documented use case; a runner switch is the
 * same mechanism), so flipping modes takes effect on the very next message
 * with no server restart. See route.ts for the server side of this switch.
 */
export function AgentProvider({
  intelligenceAvailable,
  children,
}: {
  intelligenceAvailable: boolean;
  children: React.ReactNode;
}) {
  const [mode, setMode] = useState<RunnerMode>("cloud");

  const headers = useCallback((): Record<string, string> => {
    return mode === "local" ? { "x-runner": "local" } : {};
  }, [mode]);

  return (
    <RunnerModeContext.Provider value={{ mode, setMode, intelligenceAvailable }}>
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent="workbench"
        useSingleEndpoint={false}
        enableInspector={INSPECTOR_ENABLED}
        headers={headers}
      >
        {children}
      </CopilotKit>
    </RunnerModeContext.Provider>
  );
}
