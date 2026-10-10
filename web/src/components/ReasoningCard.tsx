"use client";

import { useState } from "react";
import type { ReasoningMessage } from "@ag-ui/core";
import { CopilotChatReasoningMessage } from "@copilotkit/react-core/v2";

/**
 * The lead model's reasoning, as a card in the chat — replaces CopilotKit's
 * default reasoning message (`messageView.reasoningMessage`).
 *
 * What it shows is the provider's *summary* of the model's thinking (Anthropic
 * `display: "summarized"`, OpenAI `reasoning.summary`), never the raw chain of
 * thought. Open while it streams, folded once the answer starts.
 */
function ReasoningCardView({
  message,
  isRunning,
  isLatest,
}: {
  message: ReasoningMessage;
  isRunning?: boolean;
  isLatest?: boolean;
}) {
  const streaming = Boolean(isRunning && isLatest);
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? streaming;
  const text = typeof message.content === "string" ? message.content : "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="wb-rise my-1.5" data-testid="reasoning-card">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="group flex items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[11.5px] text-wb-muted transition-colors hover:bg-wb-panel-alt"
      >
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-md bg-wb-accent-soft text-wb-accent"
        >
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M6 13.5h4M6.5 11.5h3M8 2.5a4 4 0 0 0-2.5 7.1c.4.3.6.8.6 1.3v.6h3.8v-.6c0-.5.2-1 .6-1.3A4 4 0 0 0 8 2.5Z" strokeLinejoin="round" />
          </svg>
        </span>
        {streaming ? (
          <span className="wb-shimmer-text font-medium">Thinking…</span>
        ) : (
          <span className="font-medium text-wb-text">Reasoning</span>
        )}
        {!streaming && words ? <span className="text-wb-faint">· {words} words</span> : null}
        <span aria-hidden className={`text-[10px] text-wb-faint transition-transform ${expanded ? "rotate-90" : ""}`}>
          ▶
        </span>
      </button>
      {expanded && text ? (
        <div className="ml-[13px] mt-1 max-h-72 overflow-auto whitespace-pre-wrap border-l-2 border-wb-accent/30 pl-3 text-[12px] italic leading-relaxed text-wb-muted">
          {text}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The slot is typed as CopilotKit's component, sub-parts included, so ours
 * carries them along (unused) to fit `messageView.reasoningMessage`.
 */
export const ReasoningCard = Object.assign(ReasoningCardView, {
  Header: CopilotChatReasoningMessage.Header,
  Content: CopilotChatReasoningMessage.Content,
  Toggle: CopilotChatReasoningMessage.Toggle,
});
