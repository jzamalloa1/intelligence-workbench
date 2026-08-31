"use client";

import { useState } from "react";
import type { WorkspaceFile } from "@/lib/workbench";
import { EmptyState, Panel, Pill } from "./Panel";

/**
 * Files the agent has written, derived from write_file / edit_file tool calls.
 *
 * Not read from agent state: with a sandbox attached the filesystem lives in the
 * remote VM and never lands in LangGraph state. See src/lib/workbench.ts.
 */
export function Workspace({ files }: { files: WorkspaceFile[] }) {
  const [open, setOpen] = useState<WorkspaceFile | null>(null);

  return (
    <>
      <Panel
        title="Workspace"
        badge={files.length > 0 ? <Pill>{files.length} files</Pill> : <Pill>virtual FS</Pill>}
      >
        {files.length === 0 ? (
          <EmptyState>
            Files the agent writes to{" "}
            <code className="text-wb-muted">/research/</code> and{" "}
            <code className="text-wb-muted">/reports/</code> appear here.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-0.5 p-2">
            {files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => setOpen(file)}
                  disabled={!file.content}
                  className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-wb-panel-alt disabled:cursor-default disabled:opacity-70"
                >
                  <FileIcon />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-wb-text">
                      {file.path}
                    </span>
                    <span className="block text-[10.5px] text-wb-faint">
                      {file.lastTool}
                      {file.revisions > 1 ? ` · ${file.revisions} revisions` : ""}
                      {!file.content ? " · content not captured" : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {open?.content ? (
        <FileViewer file={open} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-wb-faint" aria-hidden>
      <path
        d="M4 1.5h5L12.5 5v9.5h-8.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9 1.5V5h3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function FileViewer({ file, onClose }: { file: WorkspaceFile; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={file.path}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-wb-border bg-wb-panel"
        style={{ boxShadow: "var(--wb-shadow)" }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-wb-border px-4 py-2.5">
          <h3 className="truncate font-mono text-[12px] text-wb-text">{file.path}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-[12px] text-wb-muted transition-colors hover:bg-wb-panel-alt hover:text-wb-text"
          >
            Esc
          </button>
        </header>
        {/* Wide content scrolls inside its own container. */}
        <div className="min-h-0 flex-1 overflow-auto">
          <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-wb-text">
            {file.content}
          </pre>
        </div>
      </div>
    </div>
  );
}
