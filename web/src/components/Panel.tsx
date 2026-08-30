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
  children,
  className = "",
}: {
  title: string;
  badge?: ReactNode;
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
    </section>
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
