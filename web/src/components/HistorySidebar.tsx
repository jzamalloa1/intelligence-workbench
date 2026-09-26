"use client";

import { useEffect, useState } from "react";
import { useRunnerMode } from "@/lib/runner-mode";
import { useSession } from "@/lib/session-client";

interface ThreadSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

const DAY = 24 * 60 * 60 * 1000;

function groupOf(updatedAt: number, now: number): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (updatedAt >= startOfToday) return "Today";
  if (updatedAt >= startOfToday - DAY) return "Yesterday";
  if (updatedAt >= startOfToday - 7 * DAY) return "Previous 7 days";
  if (updatedAt >= startOfToday - 30 * DAY) return "Previous 30 days";
  return "Older";
}

/**
 * The signed-in user's past conversations, newest first. Only ever this user's:
 * the list comes from /api/threads, which reads the owner from the session
 * cookie, and route.ts refuses to run or reopen anyone else's thread.
 */
export function HistorySidebar() {
  const { threadId, openThread, newThread, historyVersion, refreshHistory } = useSession();
  const { mode } = useRunnerMode();
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/threads")
      .then((r) => (r.ok ? r.json() : { threads: [] }))
      .then((data: { threads: ThreadSummary[] }) => !cancelled && setThreads(data.threads))
      .catch(() => !cancelled && setThreads([]));
    return () => {
      cancelled = true;
    };
  }, [historyVersion]);

  const now = Date.now();
  const groups: [string, ThreadSummary[]][] = [];
  for (const t of threads ?? []) {
    const label = groupOf(t.updatedAt, now);
    const last = groups[groups.length - 1];
    if (last?.[0] === label) last[1].push(t);
    else groups.push([label, [t]]);
  }

  return (
    <nav
      aria-label="Conversation history"
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-wb-border bg-wb-panel"
      style={{ boxShadow: "var(--wb-shadow)" }}
    >
      <div className="shrink-0 p-2">
        <button
          type="button"
          onClick={newThread}
          className="flex w-full items-center gap-2 rounded-lg border border-wb-border px-3 py-2 text-[12.5px] font-medium text-wb-text transition-colors hover:border-wb-border-strong hover:bg-wb-panel-alt"
        >
          <PlusIcon /> New conversation
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {mode === "cloud" ? (
          <p className="px-2 py-2 text-[11px] leading-relaxed text-wb-faint">
            History is kept for Local mode. Cloud conversations live in CopilotKit Intelligence.
          </p>
        ) : null}

        {threads === null ? (
          <div className="flex flex-col gap-1.5 px-2 pt-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-7 animate-pulse rounded-md bg-wb-panel-alt" />
            ))}
          </div>
        ) : threads.length === 0 ? (
          <p className="px-2 pt-3 text-[11.5px] leading-relaxed text-wb-faint">
            No conversations yet. Ask something to start one — it will be saved here.
          </p>
        ) : (
          groups.map(([label, items]) => (
            <section key={label} className="mt-2 first:mt-1">
              <h3 className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-wb-faint">
                {label}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {items.map((t) => (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    active={t.id === threadId}
                    onOpen={() => openThread(t.id)}
                    onChanged={(deleted) => {
                      if (deleted && t.id === threadId) newThread();
                      refreshHistory();
                    }}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  );
}

function ThreadRow({
  thread,
  active,
  onOpen,
  onChanged,
}: {
  thread: ThreadSummary;
  active: boolean;
  onOpen: () => void;
  onChanged: (deleted: boolean) => void;
}) {
  const [mode, setMode] = useState<"idle" | "renaming" | "confirm-delete">("idle");
  const [draft, setDraft] = useState(thread.title);

  async function rename() {
    const title = draft.trim();
    setMode("idle");
    if (!title || title === thread.title) return;
    await fetch(`/api/threads/${encodeURIComponent(thread.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    onChanged(false);
  }

  async function remove() {
    await fetch(`/api/threads/${encodeURIComponent(thread.id)}`, { method: "DELETE" });
    onChanged(true);
  }

  if (mode === "renaming") {
    return (
      <li>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void rename();
            if (e.key === "Escape") {
              setDraft(thread.title);
              setMode("idle");
            }
          }}
          aria-label="Conversation title"
          className="w-full rounded-md border border-wb-accent bg-wb-panel px-2 py-1.5 text-[12.5px] text-wb-text outline-none"
        />
      </li>
    );
  }

  if (mode === "confirm-delete") {
    return (
      <li className="flex items-center gap-1.5 rounded-md bg-wb-panel-alt px-2 py-1.5 text-[11.5px]">
        <span className="min-w-0 flex-1 truncate text-wb-muted">Delete this conversation?</span>
        <button type="button" onClick={() => void remove()} className="font-medium text-wb-warn hover:underline">
          Delete
        </button>
        <button type="button" onClick={() => setMode("idle")} className="text-wb-muted hover:text-wb-text">
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li className="group/thread relative">
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        title={thread.title}
        className={`block w-full truncate rounded-md py-1.5 pl-2 pr-14 text-left text-[12.5px] transition-colors ${
          active ? "bg-wb-accent-soft text-wb-accent" : "text-wb-text hover:bg-wb-panel-alt"
        }`}
      >
        {thread.title}
      </button>
      <span className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/thread:opacity-100">
        <IconButton label={`Rename “${thread.title}”`} onClick={() => setMode("renaming")}>
          <path d="M3 13h3l7-7-3-3-7 7zM9.5 3.5l3 3" />
        </IconButton>
        <IconButton label={`Delete “${thread.title}”`} onClick={() => setMode("confirm-delete")}>
          <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5l.5-8.5" />
        </IconButton>
      </span>
    </li>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded p-1 text-wb-faint transition-colors hover:bg-wb-panel hover:text-wb-text"
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 text-wb-muted" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
