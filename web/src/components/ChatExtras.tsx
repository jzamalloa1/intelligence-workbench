"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfigureSuggestions, useCopilotKit } from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/core";
import { userText, withUserText } from "@/lib/attachments";
import type { ResearchLane } from "@/lib/lanes";
import type { Chart, WorkspaceFile } from "@/lib/workbench";

/**
 * The chat's welcome screen, its suggestions, and regenerate / edit.
 *
 * Suggestions are static and computed in the browser from what the conversation
 * has produced — CopilotKit's "dynamic" suggestions would make an extra model
 * call through the deep agent on every turn.
 */

const STARTERS = [
  {
    title: "Size a market",
    message: "Estimate the 2026 market size for AI code-review tools, top-down and bottom-up, and chart both estimates.",
  },
  {
    title: "Compare competitors",
    message: "Compare Linear, Jira and Asana on pricing, target customer and their most recent launches.",
  },
  {
    title: "Explain a trend",
    message: "How has the price of lithium-ion battery packs changed since 2015? Chart it and explain the drivers.",
  },
  {
    title: "Quick fact check",
    message: "What is the current US federal funds rate, and when did it last change?",
  },
];

/**
 * The empty conversation. CopilotChat only shows its own welcome screen when no
 * thread id is given, and we always give one (history needs it), so this is
 * drawn over the empty message area instead. Each starter sends its prompt.
 */
export function WelcomeHero({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="wb-rise flex w-full max-w-xl flex-col items-center text-center">
      <span
        aria-hidden
        className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-wb-accent-soft text-wb-accent"
        style={{ boxShadow: "var(--wb-shadow)" }}
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="m15 15 5 5" strokeLinecap="round" />
          <path d="M8 10.5h5M10.5 8v5" strokeLinecap="round" />
        </svg>
      </span>
      <h2 className="bg-gradient-to-r from-wb-text to-wb-accent bg-clip-text text-[22px] font-semibold tracking-tight text-transparent">
        What should we research?
      </h2>
      <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-wb-muted">
        Ask a question. The lead agent plans it, sends researchers out in parallel, runs the
        numbers in a sandbox and writes up a report with charts. You approve anything it runs.
      </p>
      <ul className="mt-4 flex flex-wrap justify-center gap-1.5" aria-label="What it does">
        {["Plans", "Parallel researchers", "Sandboxed Python", "Charts", "Reports"].map((c, i) => (
          <li
            key={c}
            className="flex items-center gap-1.5 rounded-full border border-wb-border bg-wb-panel px-2.5 py-1 text-[11px] text-wb-muted"
          >
            <span aria-hidden className="size-1.5 rounded-full" style={{ background: `var(--wb-series-${i + 1})` }} />
            {c}
          </li>
        ))}
      </ul>
      <div className="mt-6 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {STARTERS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.message)}
            className="group flex flex-col gap-1 rounded-xl border border-wb-border bg-wb-panel px-3.5 py-3 text-left transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-wb-border-strong"
            style={{ boxShadow: "var(--wb-shadow)" }}
          >
            <span className="flex items-center gap-2 text-[12.5px] font-medium text-wb-text">
              <span aria-hidden className="size-1.5 rounded-full" style={{ background: `var(--wb-series-${i + 1})` }} />
              {s.title}
              <span aria-hidden className="ml-auto text-wb-faint transition-transform group-hover:translate-x-0.5">→</span>
            </span>
            <span className="line-clamp-2 text-[11.5px] leading-snug text-wb-muted">{s.message}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Follow-up suggestions from what the run produced (the starters live in WelcomeHero). */
export function useWorkbenchSuggestions({
  charts,
  files,
  lanes,
  running,
}: {
  charts: Chart[];
  files: WorkspaceFile[];
  lanes: Map<string, ResearchLane>;
  running: boolean;
}) {
  const report = [...files].reverse().find((f) => f.path.startsWith("/reports/"));
  const deepest = [...lanes.values()].filter((l) => l.status === "done" && l.description).at(-1);
  const followUps = useMemo(() => {
    if (running) return [];
    const out: { title: string; message: string }[] = [];
    if (charts.length && !report) {
      out.push({
        title: "Turn this into a report",
        message: "Write a short report in /reports/ that embeds the charts you made, with a one-paragraph takeaway under each.",
      });
    }
    if (report) {
      out.push({ title: "Summarize the report", message: `Summarize ${report.path} in five bullets for an executive.` });
    }
    if (deepest) {
      const short = deepest.description.length > 40 ? `${deepest.description.slice(0, 39).trimEnd()}…` : deepest.description;
      out.push({
        title: `Go deeper: ${short}`,
        message: `Go deeper on "${deepest.description}": find two more independent sources, then tell me what changed.`,
      });
    }
    if (out.length) out.push({ title: "What's least certain?", message: "Which of your findings is least certain, and what would settle it?" });
    return out;
  }, [running, charts.length, report, deepest]);

  useConfigureSuggestions(
    followUps.length ? { suggestions: followUps, available: "after-first-message" } : null,
    [followUps.map((s) => s.message).join("|")],
  );
}

type AgentLike = {
  messages: Message[];
  setMessages: (messages: Message[]) => void;
  isRunning?: boolean;
};

/**
 * Regenerate an answer, or edit a question and re-run from it. Both rewind the
 * conversation to a user message: the browser trims its list there and the
 * server forks the thread from that message's checkpoint
 * (`WorkbenchLangGraphAgent.rewind`).
 */
export function useMessageActions(agent: AgentLike | undefined) {
  const { copilotkit } = useCopilotKit();
  const [editing, setEditing] = useState<Editing | null>(null);

  /** Sends a prompt as if typed — used by the welcome screen's starters. */
  const send = useCallback(
    (content: string) => {
      if (!agent || agent.isRunning) return;
      agent.setMessages([...agent.messages, { id: crypto.randomUUID(), role: "user", content } as Message]);
      void copilotkit.runAgent({ agent: agent as never });
    },
    [agent, copilotkit],
  );

  /** Re-runs from a user message; `content` keeps its files when it has any. */
  const rewind = useCallback(
    (messageId: string, content: Message["content"]) => {
      if (!agent || agent.isRunning) return;
      const index = agent.messages.findIndex((m) => m.id === messageId);
      if (index < 0) return;
      const original = agent.messages[index];
      agent.setMessages([...agent.messages.slice(0, index), { ...original, content } as Message]);
      void copilotkit.runAgent({
        agent: agent as never,
        forwardedProps: { workbenchRewind: { messageId, content } },
      });
    },
    [agent, copilotkit],
  );

  const onRegenerate = useCallback(
    (message: Message) => {
      if (!agent) return;
      const index = agent.messages.findIndex((m) => m.id === message.id);
      const user = agent.messages.slice(0, index).findLast((m) => m.role === "user");
      if (user) rewind(user.id, user.content);
    },
    [agent, rewind],
  );

  const onEditMessage = useCallback(
    ({ message }: { message: Message }) => {
      // CopilotChat passes the message as displayed, with file chips in place of
      // the agent's notes; re-run from the one the thread actually holds.
      const raw = agent?.messages.find((m) => m.id === message.id) ?? message;
      setEditing({ id: raw.id, text: userText(raw.content), content: raw.content });
    },
    [agent],
  );

  /** Re-runs from the message being edited: the new text, the same files. */
  const submitEdit = useCallback(() => {
    if (!editing) return;
    rewind(editing.id, withUserText(editing.content, editing.text) as Message["content"]);
    setEditing(null);
  }, [editing, rewind]);

  return { editing, setEditing, send, rewind, onRegenerate, onEditMessage, submitEdit };
}

type Editing = { id: string; text: string; content: Message["content"] };

/**
 * Replaces the chat input's "+" menu, whose only item would be "Add
 * attachments": one click opens the file picker. Used as the input's
 * `addMenuButton` slot, which hands it `onAddFile` when attachments are on.
 */
export function AttachButton({ onAddFile, disabled }: { onAddFile?: () => void; disabled?: boolean }) {
  if (!onAddFile) return null;
  return (
    <button
      type="button"
      onClick={onAddFile}
      disabled={disabled}
      aria-label="Attach files"
      title="Attach files: images, PDF, CSV, text, JSON or Excel"
      className="ml-1 grid size-9 place-items-center rounded-full text-wb-muted transition-colors hover:bg-wb-panel-alt hover:text-wb-text disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
      </svg>
    </button>
  );
}

/** Why a file wasn't attached (wrong type, too large). Clears itself after a few seconds. */
export function AttachmentNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  return (
    <div role="alert" className="wb-rise flex items-center justify-between gap-3 border-b border-wb-border bg-wb-warn/10 px-3 py-2 text-[12px] text-wb-text">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 rounded px-2 py-0.5 text-[11.5px] text-wb-muted hover:bg-wb-panel">
        Dismiss
      </button>
    </div>
  );
}

/** The edit form for a user message, docked under the chat header. */
export function EditBar({
  editing,
  onChange,
  onCancel,
  onSubmit,
}: {
  editing: Editing;
  onChange: (text: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="wb-rise flex flex-col gap-2 border-b border-wb-border bg-wb-accent-soft/40 px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (editing.text.trim()) onSubmit();
      }}
      aria-label="Edit your message"
    >
      <label htmlFor="wb-edit" className="text-[11.5px] font-medium text-wb-text">
        Edit your message — the conversation re-runs from here
      </label>
      <textarea
        id="wb-edit"
        value={editing.text}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        autoFocus
        className="w-full resize-y rounded-lg border border-wb-border bg-wb-panel px-2.5 py-2 text-[12.5px] text-wb-text outline-none focus:border-wb-accent"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-[11.5px] text-wb-muted hover:bg-wb-panel">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!editing.text.trim()}
          className="rounded-lg bg-wb-accent px-3 py-1.5 text-[11.5px] font-medium text-wb-panel disabled:opacity-50"
        >
          Re-run from here
        </button>
      </div>
    </form>
  );
}
