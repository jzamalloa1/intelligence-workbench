import "server-only";

import { EventType, type BaseEvent, type Message } from "@ag-ui/client";
import type { LangGraphThreadState } from "./langgraph";
import type { ThreadSnapshot } from "./history-store";

/**
 * Turns a stored conversation back into the AG-UI events a client expects from
 * `connect`: one synthetic run carrying a MESSAGES_SNAPSHOT and a
 * STATE_SNAPSHOT (plus a pending approval, if the thread is paused on one).
 * The client's event verifier requires a run envelope, hence RUN_STARTED /
 * RUN_FINISHED around the snapshots.
 */

type LcMessage = {
  id?: string;
  type?: string;
  content?: unknown;
  tool_calls?: { id?: string; name?: string; args?: unknown }[];
  tool_call_id?: string;
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? (b as { text?: string }).text ?? "" : ""))
      .join("");
  }
  return "";
}

/**
 * LangChain messages (as LangGraph returns them) → AG-UI messages. Mirrors the
 * adapter's own converter, which @ag-ui/langgraph does not export. Reasoning
 * blocks and system messages are dropped — the UI never showed them.
 */
export function langchainToAgui(messages: unknown[]): Message[] {
  const out: Message[] = [];
  for (const raw of messages as LcMessage[]) {
    if (!raw?.id) continue;
    switch (raw.type) {
      case "human":
        out.push({ id: raw.id, role: "user", content: textOf(raw.content) });
        break;
      case "ai":
        out.push({
          id: raw.id,
          role: "assistant",
          content: textOf(raw.content),
          ...(raw.tool_calls?.length
            ? {
                toolCalls: raw.tool_calls
                  .filter((c) => c.id && c.name)
                  .map((c) => ({
                    id: c.id as string,
                    type: "function" as const,
                    function: { name: c.name as string, arguments: JSON.stringify(c.args ?? {}) },
                  })),
              }
            : {}),
        });
        break;
      case "tool":
        if (raw.tool_call_id) {
          out.push({ id: raw.id, role: "tool", content: textOf(raw.content), toolCallId: raw.tool_call_id });
        }
        break;
    }
  }
  return out;
}

/** What the UI's panels read from agent state. Everything else stays server-side. */
export function uiState(values: Record<string, unknown>): Record<string, unknown> {
  return "todos" in values ? { todos: values.todos } : {};
}

export function snapshotFromLangGraph(state: LangGraphThreadState): ThreadSnapshot {
  return { messages: langchainToAgui(state.values.messages ?? []), state: uiState(state.values) };
}

export function historyEvents(
  threadId: string,
  snapshot: ThreadSnapshot,
  pendingInterrupts: unknown[] = [],
): BaseEvent[] {
  const runId = `history-${threadId}`;
  const events: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent,
    { type: EventType.MESSAGES_SNAPSHOT, messages: snapshot.messages } as BaseEvent,
    { type: EventType.STATE_SNAPSHOT, snapshot: snapshot.state } as BaseEvent,
  ];
  // A thread paused on an approval: re-raise it the way @ag-ui/langgraph does,
  // so the card reappears and the decision still resumes the run.
  for (const value of pendingInterrupts) {
    events.push({
      type: EventType.CUSTOM,
      name: "on_interrupt",
      value: typeof value === "string" ? value : JSON.stringify(value),
    } as BaseEvent);
  }
  events.push({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
  return events;
}

export function pendingInterruptsOf(state: LangGraphThreadState | undefined): unknown[] {
  return (state?.tasks ?? []).flatMap((t) => (t.interrupts ?? []).map((i) => i.value));
}
