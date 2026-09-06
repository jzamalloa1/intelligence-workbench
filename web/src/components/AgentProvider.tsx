"use client";

import { useCallback, useState } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { INSPECTOR_ENABLED } from "@/lib/config";
import { RunnerModeContext, type RunnerMode } from "@/lib/runner-mode";

/**
 * Wraps <CopilotKit> with a runner toggle. Switching modes remounts
 * <CopilotKit> (`key={mode}`) rather than just changing the `headers`
 * function — necessary, not stylistic. The client negotiates its transport
 * ONCE per agent instance via a `GET .../info` call
 * (`ensureRuntimeConfiguration` in @copilotkit/core), caches whether
 * Intelligence is available on that instance for its whole lifetime, and
 * never re-checks. So changing the `x-runner` header on later requests moves
 * the SERVER to a different runtime, but the already-negotiated CLIENT keeps
 * talking the Intelligence websocket protocol to what is now a plain SSE
 * endpoint — confirmed live: "REST run request failed: Unexpected token
 * 'd', "data: {"ty"... is not valid JSON" is exactly an Intelligence-mode
 * response parser choking on a plain AG-UI SSE chunk. `key={mode}` forces a
 * fresh agent instance (and therefore a fresh negotiation, reading the
 * current header) on every switch — at the cost of resetting the visible
 * thread, which is honest: an Intelligence-backed thread and an in-memory
 * one are not the same thread to begin with. See README's "Who sees what" /
 * ARCHITECTURE §4d for the fuller writeup.
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
        key={mode}
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
