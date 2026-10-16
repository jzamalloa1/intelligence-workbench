"use client";

import type { ReactNode } from "react";

/**
 * Shared chrome for the workbench side panels.
 *
 * Milestone 4 fills these with live agent state (plan, files, subagents); for
 * now they carry the layout and an honest empty state rather than fake data.
 */
export function Panel({
  title,
  badge,
  footer,
  children,
  className = "",
}: {
  title: string;
  badge?: ReactNode;
  /** A slim strip under the content — e.g. a `ScopeNote`. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-wb-border bg-wb-panel ${className}`}
      style={{ boxShadow: "var(--wb-shadow)" }}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-wb-border px-3.5 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-wb-muted">
          {title}
        </h2>
        {badge}
      </header>
      {/* Content scrolls inside the panel; the page itself never scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer}
    </section>
  );
}

/**
 * Whose sandbox a panel shows. Each conversation gets its own sandbox VM and
 * belongs to one user, so its files are private to the signed-in user's
 * conversation — there are no per-user folders because there is no shared disk.
 * (Agent memory is the exception, and the Memory tab says so itself.)
 */
export function ScopeNote({ owner }: { owner: string }) {
  return (
    <footer
      data-testid="scope-note"
      className="flex shrink-0 items-center gap-1.5 border-t border-wb-border px-3.5 py-1.5 text-[10.5px] text-wb-faint"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M4.5 7V5.5a3.5 3.5 0 0 1 7 0V7M3.5 7h9v6.5h-9z" strokeLinejoin="round" />
      </svg>
      <span>
        <span className="text-wb-muted">{owner}</span> · this conversation&apos;s private sandbox
      </span>
    </footer>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10 text-center">
      <p className="max-w-[24ch] text-[12.5px] leading-relaxed text-wb-faint">
        {children}
      </p>
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "accent";
}) {
  const tones = {
    neutral: "border-wb-border text-wb-faint",
    good: "border-transparent bg-wb-accent-soft text-wb-good",
    accent: "border-transparent bg-wb-accent-soft text-wb-accent",
  } as const;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium tabular-nums ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
