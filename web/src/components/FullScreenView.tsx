"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChipButton, ExpandIcon } from "@/components/charts/ChartControls";

/**
 * The roomy view of something drawn in the chat (a dashboard, a widget): the
 * chat column is narrow, so its card offers this. One layer below the chart
 * dialog (z-40 vs z-50), so a chart expanded from inside still opens on top.
 */
export function FullScreenView({
  title,
  label,
  onClose,
  children,
}: {
  title: string;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3 backdrop-blur-[2px] sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-[1200px] flex-col overflow-hidden rounded-2xl border border-wb-border bg-wb-panel"
        style={{ boxShadow: "var(--wb-shadow)" }}
      >
        <header className="flex items-center justify-between gap-3 border-b border-wb-border bg-wb-panel-alt px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-wb-text">{title}</h2>
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-wb-faint">{label}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] text-wb-muted hover:bg-wb-panel hover:text-wb-text"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

/** The card header's button that opens it. */
export function ExpandButton({ onClick, what }: { onClick: () => void; what: string }) {
  return (
    <ChipButton onClick={onClick} ariaLabel={`Open ${what} full screen`} title="Open full screen">
      <ExpandIcon />
    </ChipButton>
  );
}
