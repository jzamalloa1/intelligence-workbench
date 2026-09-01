"use client";

import { useState } from "react";
import { summarizeTool } from "@/lib/workbench";

/**
 * Inline rendering for every tool call in the transcript.
 *
 * Registered as the wildcard (`name: "*"`) renderer, which overrides
 * CopilotKit's built-in one — that default is what renders the repeated
 * "View in Inspector (local only)" rows, which say nothing about what the
 * agent actually did.
 *
 * Kept deliberately compact: the Activity panel is the detailed view, so in
 * the transcript these are one-line markers of work done, expandable only
 * when there is a result worth reading.
 */

type Status = "inProgress" | "executing" | "complete";

const TOOL_TONE: Record<string, string> = {
  task: "text-wb-accent",
  research: "text-wb-good",
  execute: "text-wb-warn",
  write_file: "text-wb-accent",
  edit_file: "text-wb-accent",
};

export function ToolCard(props: {
  name?: string;
  args?: unknown;
  status?: Status | string;
  result?: unknown;
}) {
  const [open, setOpen] = useState(false);

  const name = props.name ?? "tool";
  const done = props.status === "complete";
  const args = (props.args ?? {}) as Record<string, unknown>;
  const label = summarizeTool(name, args);

  const resultText =
    typeof props.result === "string"
      ? props.result
      : props.result != null
        ? JSON.stringify(props.result, null, 2)
        : "";
  const canExpand = done && resultText.trim().length > 0;

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => canExpand && setOpen((v) => !v)}
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
        className="group flex w-full max-w-full items-center gap-2 rounded-lg border border-wb-border bg-wb-panel-alt px-2.5 py-1.5 text-left transition-colors hover:border-wb-border-strong disabled:cursor-default disabled:hover:border-wb-border"
      >
        <StatusGlyph done={done} />
        <code
          className={`shrink-0 text-[11px] font-medium ${TOOL_TONE[name] ?? "text-wb-muted"}`}
        >
          {name}
        </code>
        {label ? (
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-wb-muted">
            {label}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {canExpand ? (
          <span
            aria-hidden
            className={`shrink-0 text-[10px] text-wb-faint transition-transform ${open ? "rotate-90" : ""}`}
          >
            ▶
          </span>
        ) : null}
      </button>

      {open && canExpand ? (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-wb-border bg-wb-panel p-2.5 font-mono text-[11px] leading-relaxed text-wb-muted">
          {resultText.slice(0, 6000)}
          {resultText.length > 6000 ? "\n… truncated" : ""}
        </pre>
      ) : null}
    </div>
  );
}

function StatusGlyph({ done }: { done: boolean }) {
  if (!done) {
    return (
      <span className="relative flex size-2 shrink-0" aria-label="Running">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-wb-warn opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-wb-warn" />
      </span>
    );
  }
  return (
    <svg viewBox="0 0 12 12" className="size-3 shrink-0" aria-label="Done">
      <path
        d="M2.5 6.2 4.8 8.5 9.5 3.5"
        fill="none"
        className="stroke-wb-good"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
