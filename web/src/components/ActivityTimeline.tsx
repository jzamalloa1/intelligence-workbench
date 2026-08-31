"use client";

import { useState } from "react";
import type { Activity } from "@/lib/workbench";
import { EmptyState, Panel, Pill } from "./Panel";

/**
 * Delegation and tool activity — subagent `task` calls, research, and sandbox
 * `execute`. This is where subagent work becomes visible: the parent agent only
 * sees a summary, so without this panel the fan-out is invisible.
 */
export function ActivityTimeline({ activity }: { activity: Activity[] }) {
  const running = activity.filter((a) => a.status === "running").length;

  return (
    <Panel
      title="Activity"
      badge={
        running > 0 ? (
          <Pill tone="accent">{running} running</Pill>
        ) : activity.length > 0 ? (
          <Pill>{activity.length} calls</Pill>
        ) : (
          <Pill>subagents</Pill>
        )
      }
    >
      {activity.length === 0 ? (
        <EmptyState>
          Subagent delegation, research, and sandbox commands stream here as the
          agent works.
        </EmptyState>
      ) : (
        <ul className="flex flex-col p-2">
          {activity.map((item, i) => (
            <ActivityRow key={item.id} item={item} last={i === activity.length - 1} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

const TOOL_TONE: Record<string, string> = {
  task: "text-wb-accent",
  research: "text-wb-good",
  execute: "text-wb-warn",
};

function ActivityRow({ item, last }: { item: Activity; last: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = Boolean(item.result);

  return (
    <li className="relative flex gap-2.5 pl-1">
      {/* Timeline rail */}
      <div className="flex flex-col items-center">
        <span
          className={`mt-2 size-2 shrink-0 rounded-full ${
            item.status === "running" ? "animate-pulse bg-wb-warn" : "bg-wb-border-strong"
          }`}
        />
        {!last && <span className="w-px flex-1 bg-wb-border" />}
      </div>

      <div className="min-w-0 flex-1 pb-2">
        <button
          type="button"
          onClick={() => canExpand && setExpanded((v) => !v)}
          disabled={!canExpand}
          aria-expanded={canExpand ? expanded : undefined}
          className="w-full rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-wb-panel-alt disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="flex items-baseline gap-1.5">
            <code
              className={`shrink-0 text-[11px] font-medium ${TOOL_TONE[item.tool] ?? "text-wb-muted"}`}
            >
              {item.tool}
            </code>
            <span className="min-w-0 flex-1 truncate text-[12px] text-wb-muted">
              {item.label}
            </span>
          </span>
        </button>

        {expanded && item.result ? (
          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-wb-panel-alt p-2.5 font-mono text-[11px] leading-relaxed text-wb-muted">
            {item.result.slice(0, 4000)}
          </pre>
        ) : null}
      </div>
    </li>
  );
}
