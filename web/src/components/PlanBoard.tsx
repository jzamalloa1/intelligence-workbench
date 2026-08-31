"use client";

import type { Todo } from "@/lib/workbench";
import { EmptyState, Panel, Pill } from "./Panel";

/** Live view of the agent's `write_todos` plan, read from agent state. */
export function PlanBoard({ todos }: { todos: Todo[] }) {
  const done = todos.filter((t) => t.status === "completed").length;

  return (
    <Panel
      title="Plan"
      badge={
        todos.length > 0 ? (
          <Pill tone={done === todos.length ? "good" : "accent"}>
            {done}/{todos.length}
          </Pill>
        ) : (
          <Pill>write_todos</Pill>
        )
      }
    >
      {todos.length === 0 ? (
        <EmptyState>
          The plan appears here once the agent calls{" "}
          <code className="text-wb-muted">write_todos</code>.
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-0.5 p-2">
          {todos.map((todo, i) => (
            <li
              key={`${i}-${todo.content}`}
              className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-wb-panel-alt"
            >
              <StatusDot status={todo.status} />
              <span
                className={`text-[12.5px] leading-snug ${
                  todo.status === "completed"
                    ? "text-wb-faint line-through decoration-wb-border-strong"
                    : todo.status === "in_progress"
                      ? "font-medium text-wb-text"
                      : "text-wb-muted"
                }`}
              >
                {todo.content}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function StatusDot({ status }: { status: Todo["status"] }) {
  const label =
    status === "completed" ? "Completed" : status === "in_progress" ? "In progress" : "Pending";

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="mt-[3px] flex size-3.5 shrink-0 items-center justify-center"
    >
      {status === "completed" ? (
        <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden>
          <circle cx="7" cy="7" r="6.25" className="fill-wb-good/15 stroke-wb-good" strokeWidth="1" />
          <path
            d="M4.2 7.2 6.1 9l3.7-4"
            fill="none"
            className="stroke-wb-good"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : status === "in_progress" ? (
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-wb-warn opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-wb-warn" />
        </span>
      ) : (
        <span className="size-2.5 rounded-full border border-wb-border-strong" />
      )}
    </span>
  );
}
