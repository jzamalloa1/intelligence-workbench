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
  // Local is the default, deliberately. Cloud's realtime gateway gives up
  // reconnecting after a fixed 60s and fails the run client-side even when the
  // agent completed fine server-side (observed: a 6-minute run logged
  // "Background run succeeded" while the browser showed only "Runner connection
  // dropped"). Runs here are routinely minutes long, and Milestone 6's approval
  // gate adds human-length pauses on top, so the failure is likely rather than
  // exotic. Cloud is one click away when the threads drawer or Inspector is
  // wanted — but it should be the deliberate choice, not the one you get by
  // default and lose a long run to.
  const [mode, setMode] = useState<RunnerMode>("local");

  const [dropped, setDropped] = useState(false);

  const headers = useCallback((): Record<string, string> => {
    return mode === "local" ? { "x-runner": "local" } : {};
  }, [mode]);

  // A dropped gateway otherwise surfaces only as console noise, which reads as
  // "the agent failed" when the agent in fact finished. Name it instead.
  const onError = useCallback((event: { error?: unknown }) => {
    const text = String(
      (event?.error as { message?: string } | undefined)?.message ?? event?.error ?? "",
    );
    if (/runner connection dropped|connection dropped/i.test(text)) setDropped(true);
  }, []);

  return (
    <RunnerModeContext.Provider value={{ mode, setMode, intelligenceAvailable }}>
      <CopilotKit
        key={mode}
        runtimeUrl="/api/copilotkit"
        agent="workbench"
        useSingleEndpoint={false}
        enableInspector={INSPECTOR_ENABLED}
        headers={headers}
        onError={onError}
      >
        {children}
        {dropped ? (
          <ConnectionDroppedBanner
            onSwitch={() => {
              setDropped(false);
              setMode("local");
            }}
            onDismiss={() => setDropped(false)}
          />
        ) : null}
      </CopilotKit>
    </RunnerModeContext.Provider>
  );
}

/**
 * Shown when the Intelligence realtime gateway drops mid-run. The important
 * part is the second sentence: the run usually *did* finish on the agent
 * server, so this is a lost view of a completed run, not a failed run.
 */
function ConnectionDroppedBanner({
  onSwitch,
  onDismiss,
}: {
  onSwitch: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(34rem,calc(100%-2rem))] rounded-xl border border-wb-warn/40 bg-wb-panel p-3.5"
      style={{ boxShadow: "var(--wb-shadow)" }}
    >
      <p className="mb-1 text-[12.5px] font-medium text-wb-text">
        Lost the connection to CopilotKit Intelligence
      </p>
      <p className="mb-2.5 text-[12px] leading-relaxed text-wb-muted">
        Cloud mode gives up reconnecting after 60s. The agent has very likely finished the run
        anyway — this is a lost view of it, not a failed run. Local mode has no such ceiling.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSwitch}
          className="rounded-full border border-transparent bg-wb-accent-soft px-3 py-1 text-[11.5px] font-medium text-wb-accent transition-colors hover:brightness-95"
        >
          Switch to Local
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full border border-wb-border px-3 py-1 text-[11.5px] font-medium text-wb-muted transition-colors hover:border-wb-border-strong hover:text-wb-text"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
