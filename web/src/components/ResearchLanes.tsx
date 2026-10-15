"use client";

import { useState } from "react";
import type { MessageGroupWrapperProps } from "@copilotkit/react-core/v2";
import { taskCallIds, useLanes, type LaneStatus, type ResearchLane } from "@/lib/lanes";

/**
 * Research lanes: each delegation (`task` call) in the chat renders as a live
 * card of what its subagent is doing, a parallel delegation is framed with a
 * progress header, and a banner over the chat names who is working right now.
 * All three read the lanes derived from the message list (lib/lanes.ts).
 */

const SERIES = 6;
const laneColor = (index: number) => `var(--wb-series-${(index % SERIES) + 1})`;

function titleCase(s: string) {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The renderer for one `task` call — registered with useRenderTool. */
export function TaskLaneCard(props: { toolCallId?: string; args?: unknown; status?: string; result?: unknown }) {
  const lanes = useLanes();
  const [open, setOpen] = useState(false);
  const lane = props.toolCallId ? lanes.get(props.toolCallId) : undefined;
  const a = (props.args ?? {}) as Record<string, unknown>;
  const description = lane?.description || (typeof a.description === "string" ? a.description : "");
  const type = lane?.subagentType || (typeof a.subagent_type === "string" ? a.subagent_type : "researcher");
  const status: LaneStatus = lane?.status ?? (props.status === "complete" ? "done" : "starting");
  const steps = lane?.steps ?? [];
  const latest = [...steps].reverse().find((s) => s.label) ?? steps.at(-1);
  const color = laneColor(lane?.index ?? 0);

  return (
    <div
      className="wb-rise my-1.5 overflow-hidden rounded-xl border border-wb-border bg-wb-panel"
      style={{ boxShadow: "var(--wb-shadow)" }}
      data-lane-status={status}
    >
      <div className="flex">
        <span aria-hidden className="w-1 shrink-0" style={{ background: color }} />
        <div className="min-w-0 flex-1 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <LaneIcon color={color} />
            <span className="text-[11.5px] font-semibold text-wb-text">{titleCase(type)}</span>
            <StatusPill status={status} />
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-wb-faint">
              {lane ? <Stats lane={lane} /> : null}
            </span>
          </div>

          {description ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-wb-muted">{description}</p>
          ) : null}

          {status !== "done" ? (
            <div className="mt-2">
              <div className="wb-shimmer h-1 rounded-full" style={{ ["--lane" as string]: color }} />
              <p key={latest?.id ?? "waiting"} className="wb-rise mt-1.5 truncate text-[11.5px] text-wb-faint">
                {latest ? (
                  <>
                    <code className="text-[10.5px] text-wb-muted">{latest.tool}</code>{" "}
                    {latest.label || "…"}
                  </>
                ) : (
                  "Getting started…"
                )}
              </p>
            </div>
          ) : lane?.result ? (
            <p className="mt-1.5 line-clamp-2 text-[11.5px] text-wb-faint">{firstLine(lane.result)}</p>
          ) : null}

          {steps.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="mt-1.5 text-[11px] text-wb-accent hover:underline"
            >
              {open ? "Hide steps" : `Show ${steps.length} step${steps.length === 1 ? "" : "s"}`}
            </button>
          ) : null}

          {open ? (
            <ol className="mt-1.5 max-h-56 space-y-1 overflow-auto border-l border-wb-border pl-2.5">
              {steps.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-[11.5px]">
                  <StepDot done={s.done} color={color} />
                  <code className="shrink-0 text-[10.5px] text-wb-muted">{s.tool}</code>
                  <span className="min-w-0 truncate text-wb-faint">{s.label}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Frames an assistant message that delegated to several subagents at once:
 * a header with the count and a segmented progress bar, collapsible (the
 * open/closed state is kept by the chat per group, across virtualization).
 */
export function DelegationGroup({ messages, children, state, setState }: MessageGroupWrapperProps<{ collapsed: boolean }>) {
  const lanes = useLanes();
  const own = messages.flatMap(taskCallIds).map((id) => lanes.get(id)).filter((l): l is ResearchLane => !!l);
  const done = own.filter((l) => l.status === "done").length;
  const collapsed = state?.collapsed ?? false;

  return (
    <div className="my-2 rounded-2xl border border-wb-border bg-wb-panel-alt/60 p-2.5" data-testid="delegation-group">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11.5px] font-semibold text-wb-text">Parallel research</span>
        <span className="text-[11px] text-wb-faint">
          {own.length} researchers · {done} of {own.length} done
        </span>
        <button
          type="button"
          onClick={() => setState({ collapsed: !collapsed })}
          aria-expanded={!collapsed}
          className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-wb-muted hover:bg-wb-panel hover:text-wb-text"
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>
      <div className="mt-2 flex gap-1 px-1" aria-hidden>
        {own.map((l) => (
          <span
            key={l.taskId}
            className={`h-1.5 flex-1 rounded-full ${l.status === "done" ? "" : "wb-shimmer"}`}
            style={l.status === "done" ? { background: laneColor(l.index) } : { ["--lane" as string]: laneColor(l.index) }}
          />
        ))}
      </div>
      {collapsed ? (
        <div className="mt-2 flex flex-wrap gap-1.5 px-1">
          {own.map((l) => (
            <LaneChip key={l.taskId} lane={l} />
          ))}
        </div>
      ) : (
        <div className="mt-1">{children}</div>
      )}
    </div>
  );
}

/** Sits over the chat while any subagent is working. */
export function ResearchBanner() {
  const lanes = useLanes();
  const active = [...lanes.values()].filter((l) => l.status !== "done");
  if (active.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="wb-rise flex items-center gap-2 overflow-x-auto border-b border-wb-border bg-wb-panel-alt/80 px-3 py-1.5 backdrop-blur"
    >
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-wb-accent opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-wb-accent" />
      </span>
      <span className="shrink-0 text-[11.5px] font-medium text-wb-text">
        {active.length} {active.length === 1 ? "researcher" : "researchers"} working
      </span>
      <div className="flex min-w-0 gap-1.5">
        {active.map((l) => (
          <LaneChip key={l.taskId} lane={l} />
        ))}
      </div>
    </div>
  );
}

function LaneChip({ lane }: { lane: ResearchLane }) {
  return (
    <span className="flex max-w-56 shrink-0 items-center gap-1.5 rounded-full border border-wb-border bg-wb-panel px-2 py-0.5 text-[11px] text-wb-muted">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: laneColor(lane.index) }} />
      <span className="truncate">{lane.description || titleCase(lane.subagentType)}</span>
      <span className="shrink-0 tabular-nums text-wb-faint">
        {lane.status === "done" ? "✓" : lane.steps.length}
      </span>
    </span>
  );
}

function Stats({ lane }: { lane: ResearchLane }) {
  const parts = [
    lane.searches ? `${lane.searches} search${lane.searches === 1 ? "" : "es"}` : "",
    lane.pages ? `${lane.pages} page${lane.pages === 1 ? "" : "s"} read` : "",
    lane.files.length ? `${lane.files.length} note${lane.files.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return <>{parts.join(" · ")}</>;
}

function StatusPill({ status }: { status: LaneStatus }) {
  const label = status === "done" ? "Done" : status === "working" ? "Researching" : "Starting";
  return (
    <span
      className={`rounded-full px-1.5 py-px text-[10.5px] font-medium ${
        status === "done" ? "bg-wb-good/15 text-wb-good" : "bg-wb-accent-soft text-wb-accent"
      }`}
    >
      {label}
    </span>
  );
}

function StepDot({ done, color }: { done: boolean; color: string }) {
  return done ? (
    <span aria-label="Done" className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
  ) : (
    <span aria-label="Running" className="size-1.5 shrink-0 animate-pulse rounded-full bg-wb-warn" />
  );
}

function LaneIcon({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-md"
      style={{ background: `color-mix(in oklch, ${color} 16%, transparent)`, color }}
    >
      <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="7" cy="7" r="4.25" />
        <path d="m10.2 10.2 3.3 3.3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function firstLine(text: string) {
  return text.replace(/^#+\s*/gm, "").split(/\n+/).find((l) => l.trim()) ?? "";
}
