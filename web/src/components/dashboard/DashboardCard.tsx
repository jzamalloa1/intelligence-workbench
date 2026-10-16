"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { A2UIProvider, A2UIRenderer, useA2UIActions, useA2UIError } from "@copilotkit/a2ui-renderer";
import { DASHBOARD_CATALOG_ID, dashboardCatalog } from "./catalog";

/**
 * A `render_dashboard` call in the chat. Its arguments are an A2UI v0.9
 * component list; this turns them into the two A2UI operations a surface
 * needs (create it, then set its components) and lets CopilotKit's A2UI
 * renderer draw them with our catalog.
 *
 * Rendered from the tool call, not from an A2UI activity stream, so a
 * dashboard comes back with the conversation like any chart does. Drawn once
 * the call completes: the agent's layout is validated server-side first, and a
 * half-streamed component list is not a layout.
 */

type Args = { title?: string; components?: unknown[]; dashboard_id?: string };

function parseResult(result: unknown): { error?: string } {
  if (typeof result !== "string") return (result as { error?: string }) ?? {};
  try {
    return JSON.parse(result) as { error?: string };
  } catch {
    return {};
  }
}

export function DashboardCard({
  toolCallId,
  parameters,
  status,
  result,
}: {
  toolCallId: string;
  parameters: Args | Partial<Args>;
  status: string;
  result?: unknown;
}) {
  const title = parameters.title || "Dashboard";
  const error = status === "complete" ? parseResult(result).error : undefined;

  if (status !== "complete") {
    return (
      <div className="my-2 flex items-center gap-2 rounded-xl border border-wb-border bg-wb-panel-alt px-3 py-2.5 text-[12px] text-wb-muted" data-testid="dashboard-building">
        <span className="size-1.5 animate-pulse rounded-full bg-wb-accent" aria-hidden />
        Laying out {parameters.title ? <span className="font-medium text-wb-text">{parameters.title}</span> : "a dashboard"}…
      </div>
    );
  }
  if (error) {
    // The agent sees the same error as the tool's result and lays it out again.
    return (
      <div className="my-1 rounded-lg border border-dashed border-wb-border-strong px-3 py-2 text-[11.5px] text-wb-faint" data-testid="dashboard-rejected">
        Dashboard layout sent back to the agent: {error}
      </div>
    );
  }
  return (
    <section className="my-2 overflow-hidden rounded-xl border border-wb-border bg-wb-panel-alt" aria-label={title} data-testid="dashboard">
      <header className="flex items-center justify-between gap-2 border-b border-wb-border px-3 py-2">
        <h3 className="text-[13px] font-semibold text-wb-text">{title}</h3>
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-wb-faint">Dashboard</span>
      </header>
      <div className="p-3">
        <Surface surfaceId={`dashboard-${toolCallId}`} components={(parameters.components ?? []) as Record<string, unknown>[]} />
      </div>
    </section>
  );
}

const Surface = memo(function Surface({ surfaceId, components }: { surfaceId: string; components: Record<string, unknown>[] }) {
  return (
    <A2UIProvider catalog={dashboardCatalog}>
      <Operations surfaceId={surfaceId} components={components} />
      <SurfaceOrError surfaceId={surfaceId} />
    </A2UIProvider>
  );
});

/** Feeds the surface its operations once per distinct layout. */
function Operations({ surfaceId, components }: { surfaceId: string; components: Record<string, unknown>[] }) {
  const { processMessages, getSurface } = useA2UIActions();
  const ops = useMemo(
    () => [
      { version: "v0.9", createSurface: { surfaceId, catalogId: DASHBOARD_CATALOG_ID } },
      { version: "v0.9", updateComponents: { surfaceId, components } },
    ],
    [surfaceId, components],
  );
  const last = useRef("");
  useEffect(() => {
    const hash = JSON.stringify(ops);
    if (hash === last.current) return;
    last.current = hash;
    processMessages(getSurface(surfaceId) ? ops.filter((op) => !("createSurface" in op)) : ops);
  }, [ops, processMessages, getSurface, surfaceId]);
  return null;
}

function SurfaceOrError({ surfaceId }: { surfaceId: string }) {
  const error = useA2UIError();
  if (error) {
    return <div className="text-[11.5px] text-wb-faint">This dashboard couldn’t be drawn: {error}</div>;
  }
  return <A2UIRenderer surfaceId={surfaceId} />;
}
