"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MemoryEdit } from "@/lib/workbench";
import { markdownComponents } from "./Workspace";

interface MemoryFile {
  path: string;
  content: string;
  updatedAt: number;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The agent's durable memory: what is stored now (from /api/memory) and what
 * this conversation changed (its write_file / edit_file calls on /memories/).
 * Agent memory is deployment-wide — the same file for every user — so the
 * panel says so up front.
 */
export function MemoryView({ edits }: { edits: MemoryEdit[] }) {
  const [state, setState] = useState<{ available: boolean; files: MemoryFile[] } | null>(null);

  // Re-read after every change the agent makes, so "stored now" catches up.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/memory")
      .then((r) => (r.ok ? r.json() : { available: false, files: [] }))
      .then((d) => !cancelled && setState(d))
      .catch(() => !cancelled && setState({ available: false, files: [] }));
    return () => {
      cancelled = true;
    };
  }, [edits.length]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="rounded-lg border border-wb-warn/40 bg-wb-warn/10 px-3 py-2 text-[11.5px] leading-relaxed text-wb-text">
        <span className="font-medium">Shared by everyone who uses this agent.</span> It is loaded into
        every conversation, for every user — the agent keeps working preferences here, never personal data.
      </p>

      {edits.length > 0 ? (
        <section>
          <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-wb-faint">
            Changed in this conversation
          </h3>
          <ul className="flex flex-col gap-1.5">
            {edits.map((e) => (
              <li key={e.id} className="rounded-lg border border-wb-border p-2.5">
                <p className="mb-1 font-mono text-[11px] text-wb-muted">
                  {e.tool === "edit_file" ? "edited" : "wrote"} {e.path}
                </p>
                {e.replaced ? (
                  <p className="whitespace-pre-wrap break-words rounded bg-wb-panel-alt px-2 py-1 font-mono text-[11px] text-wb-faint line-through">
                    {e.replaced}
                  </p>
                ) : null}
                {e.content ? (
                  <p className="mt-1 whitespace-pre-wrap break-words rounded bg-wb-accent-soft/60 px-2 py-1 font-mono text-[11px] text-wb-text">
                    {e.content.length > 1200 ? `${e.content.slice(0, 1200)}…` : e.content}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-wb-faint">Stored now</h3>
        {state === null ? (
          <div className="h-16 animate-pulse rounded-lg bg-wb-panel-alt" aria-busy="true" />
        ) : !state.available ? (
          <p className="text-[11.5px] leading-relaxed text-wb-faint">
            A deployed agent keeps memory in LangSmith Context Hub, which this view doesn’t read — only
            this conversation’s changes are shown above.
          </p>
        ) : state.files.every((f) => !f.content.trim()) ? (
          <p className="text-[11.5px] leading-relaxed text-wb-faint">
            Empty — the agent hasn’t saved anything yet. It saves durable working preferences (your
            domain, recurring topics, how you like reports) when it learns them; ask it to remember
            something to see this fill in.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.files
              .filter((f) => f.content.trim())
              .map((f) => (
                <li key={f.path} className="rounded-lg border border-wb-border">
                  <p className="flex items-baseline justify-between gap-2 border-b border-wb-border px-2.5 py-1.5">
                    <span className="font-mono text-[11px] text-wb-muted">{f.path}</span>
                    <span className="text-[10.5px] text-wb-faint">{when.format(f.updatedAt)}</span>
                  </p>
                  <div className="p-2.5">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {f.content}
                    </ReactMarkdown>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
