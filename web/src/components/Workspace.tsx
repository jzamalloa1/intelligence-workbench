"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
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

/** Extension off a workspace path, lowercased, without the dot ("" if none). */
function extOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function FileViewer({ file, onClose }: { file: WorkspaceFile; onClose: () => void }) {
  const isMarkdown = extOf(file.path) === "md";

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
          <div className="flex items-center gap-2">
            {isMarkdown ? (
              <Pill>rendered</Pill>
            ) : extOf(file.path) ? (
              <Pill>{extOf(file.path)}</Pill>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md px-2 py-1 text-[12px] text-wb-muted transition-colors hover:bg-wb-panel-alt hover:text-wb-text"
            >
              Esc
            </button>
          </div>
        </header>
        {/* Wide content scrolls inside its own container. */}
        <div className="min-h-0 flex-1 overflow-auto">
          {isMarkdown ? (
            <div className="p-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {file.content}
              </ReactMarkdown>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-wb-text">
              {file.content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Styles markdown with the app's own tokens rather than pulling in
 * @tailwindcss/typography — matches how every other panel is hand-styled.
 */
const markdownComponents: Components = {
  h1: (p) => <h1 className="mb-3 mt-1 text-[16px] font-semibold text-wb-text" {...p} />,
  h2: (p) => (
    <h2
      className="mb-2 mt-5 border-t border-wb-border pt-4 text-[14px] font-semibold text-wb-text first:mt-0 first:border-none first:pt-0"
      {...p}
    />
  ),
  h3: (p) => <h3 className="mb-1.5 mt-4 text-[13px] font-semibold text-wb-text" {...p} />,
  p: (p) => <p className="mb-3 text-[12.5px] leading-relaxed text-wb-text" {...p} />,
  a: (p) => (
    <a
      className="text-wb-accent underline decoration-wb-border-strong underline-offset-2 hover:decoration-wb-accent"
      target="_blank"
      rel="noreferrer"
      {...p}
    />
  ),
  ul: (p) => <ul className="mb-3 list-disc space-y-1 pl-5 text-[12.5px] text-wb-text" {...p} />,
  ol: (p) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-[12.5px] text-wb-text" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  strong: (p) => <strong className="font-semibold text-wb-text" {...p} />,
  code: (p) => (
    <code className="rounded bg-wb-panel-alt px-1 py-0.5 font-mono text-[11.5px] text-wb-text" {...p} />
  ),
  pre: (p) => (
    <pre
      className="mb-3 overflow-x-auto rounded-lg border border-wb-border bg-wb-panel-alt p-3 font-mono text-[11.5px] leading-relaxed text-wb-text"
      {...p}
    />
  ),
  blockquote: (p) => (
    <blockquote className="mb-3 border-l-2 border-wb-border-strong pl-3 text-wb-muted" {...p} />
  ),
  hr: () => <hr className="my-4 border-wb-border" />,
  table: (p) => (
    <div className="mb-3 overflow-x-auto rounded-lg border border-wb-border">
      <table className="w-full border-collapse text-[12px]" {...p} />
    </div>
  ),
  thead: (p) => <thead className="bg-wb-panel-alt" {...p} />,
  th: (p) => (
    <th className="border-b border-wb-border px-2.5 py-1.5 text-left font-medium text-wb-muted" {...p} />
  ),
  td: (p) => <td className="border-b border-wb-border px-2.5 py-1.5 text-wb-text" {...p} />,
};
