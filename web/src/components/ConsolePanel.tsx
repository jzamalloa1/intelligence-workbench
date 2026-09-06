"use client";

import type { Activity } from "@/lib/workbench";
import { EmptyState } from "./Panel";

/**
 * Terminal-styled view of sandbox `execute` calls only — decluttered from
 * research/task/file activity, which already has its own home in the
 * Activity Timeline. `execute`'s result arrives as one block when the command
 * finishes (the sandbox tool has no intra-command streaming), so this shows
 * command-then-output, not a live character-by-character terminal.
 */
export function ConsolePanel({ activity }: { activity: Activity[] }) {
  const commands = activity.filter((a) => a.tool === "execute");

  if (commands.length === 0) {
    return (
      <EmptyState>
        Sandbox commands run via <code className="text-wb-muted">execute</code> appear here.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 p-3 font-mono text-[11.5px] leading-relaxed">
      {commands.map((item) => (
        <div key={item.id}>
          <p className="text-wb-text">
            <span className="text-wb-faint">$</span> {item.label || "…"}
          </p>
          {item.result ? (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-wb-panel-alt p-2 text-wb-muted">
              {item.result.slice(0, 4000)}
            </pre>
          ) : (
            <p className="mt-1 text-wb-faint">
              <span className="animate-pulse">running…</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
