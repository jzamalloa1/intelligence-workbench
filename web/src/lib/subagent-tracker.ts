/**
 * Keeps subagent work in the conversation.
 *
 * deepagents runs a subagent inline inside the lead's `task` tool call, so the
 * subagent's messages never enter the lead's LangGraph thread. @ag-ui/langgraph
 * streams the subagent's tool calls, but it also sends MESSAGES_SNAPSHOTs built
 * from that thread (on every lead ↔ subagent switch and at the end of a run),
 * and @ag-ui/client keeps only messages present in a snapshot. Without this,
 * every search a researcher runs and every `/research/` file it writes shows up
 * live and is then erased from the Activity panel, the Workspace and the saved
 * history (docs/ARCHITECTURE.md §4d, "subagent work is visible live, then
 * silently dropped").
 *
 * This sits on the event stream between the adapter and everything downstream
 * (the browser, the in-memory runner's replay, the history snapshot):
 *
 *  - a subagent tool call is recognised by its graph path — it runs one level
 *    deeper than the lead's tools (`tools:<id>|tools:<id>`); it is tagged with
 *    `subagentRunId` (AG-UI's own field; one id per delegated `task`) and given
 *    a stable parent message id;
 *  - every MESSAGES_SNAPSHOT gets those calls re-inserted, each right after the
 *    lead message whose `task` call started it, with the same ids the client
 *    already holds — so nothing moves and nothing is dropped.
 */

import { EventType, type RunAgentInput } from "@ag-ui/client";

interface SubagentCall {
  toolCallId: string;
  name: string;
  args: string;
  subagentRunId: string;
  /** Lead message holding the `task` call this subagent run came from. */
  anchor?: string;
  resultMessageId?: string;
  result?: string;
}

type AnyEvent = { type: string; [key: string]: unknown };
type AnyMessage = { id: string; role: string; [key: string]: unknown };

export const SUBAGENT_MESSAGE_PREFIX = "subagent:";

function checkpointNamespace(event: AnyEvent): string {
  const raw = event.rawEvent as { metadata?: { langgraph_checkpoint_ns?: unknown } } | undefined;
  const ns = raw?.metadata?.langgraph_checkpoint_ns;
  return typeof ns === "string" ? ns : "";
}

export class SubagentTracker {
  private calls = new Map<string, SubagentCall>();
  private leadTaskMessage?: string;

  process<E>(event: E): E {
    const e = event as unknown as AnyEvent;
    switch (e.type) {
      case EventType.TOOL_CALL_START: {
        const ns = checkpointNamespace(e);
        const id = e.toolCallId as string;
        if (ns.includes("|")) {
          const call: SubagentCall = {
            toolCallId: id,
            name: String(e.toolCallName ?? ""),
            args: "",
            subagentRunId: ns.split("|")[0],
            anchor: this.leadTaskMessage,
          };
          this.calls.set(id, call);
          return {
            ...e,
            parentMessageId: SUBAGENT_MESSAGE_PREFIX + id,
            subagentRunId: call.subagentRunId,
          } as E;
        }
        if (e.toolCallName === "task" && typeof e.parentMessageId === "string") {
          this.leadTaskMessage = e.parentMessageId;
        }
        return event;
      }
      case EventType.TOOL_CALL_ARGS: {
        const call = this.calls.get(e.toolCallId as string);
        if (call) call.args += String(e.delta ?? "");
        return event;
      }
      case EventType.TOOL_CALL_RESULT: {
        const call = this.calls.get(e.toolCallId as string);
        if (!call) return event;
        call.resultMessageId = e.messageId as string;
        call.result = typeof e.content === "string" ? e.content : JSON.stringify(e.content ?? "");
        return { ...e, subagentRunId: call.subagentRunId } as E;
      }
      case EventType.MESSAGES_SNAPSHOT:
        return { ...e, messages: this.withSubagentCalls(e.messages as AnyMessage[]) } as E;
      default:
        return event;
    }
  }

  private withSubagentCalls(messages: AnyMessage[]): AnyMessage[] {
    if (this.calls.size === 0) return messages;
    const present = new Set(messages.map((m) => m.id));
    const out = [...messages];
    // Where each anchor's inserted block currently ends, so calls from the same
    // delegation stay in the order they happened.
    const insertAt = new Map<string, number>();

    for (const call of this.calls.values()) {
      const messageId = SUBAGENT_MESSAGE_PREFIX + call.toolCallId;
      if (present.has(messageId)) continue;
      const block: AnyMessage[] = [
        {
          id: messageId,
          role: "assistant",
          content: "",
          subagentRunId: call.subagentRunId,
          toolCalls: [{ id: call.toolCallId, type: "function", function: { name: call.name, arguments: call.args } }],
        },
      ];
      if (call.resultMessageId) {
        block.push({
          id: call.resultMessageId,
          role: "tool",
          toolCallId: call.toolCallId,
          content: call.result ?? "",
          subagentRunId: call.subagentRunId,
        });
      }

      const key = call.anchor ?? "";
      let index = insertAt.get(key);
      if (index === undefined) {
        const anchorIndex = call.anchor ? out.findIndex((m) => m.id === call.anchor) : -1;
        index = anchorIndex >= 0 ? anchorIndex + 1 : out.length;
      }
      out.splice(index, 0, ...block);
      // Shift every recorded position at or after this one, then advance ours.
      for (const [k, v] of insertAt) if (v >= index && k !== key) insertAt.set(k, v + block.length);
      insertAt.set(key, index + block.length);
    }
    return out;
  }
}

/**
 * The inbound half: drops subagent messages (and their tool results) from a
 * run's input. The adapter sends every client message its thread doesn't hold
 * as new input (`langGraphDefaultMergeState`), so without this the next turn
 * would write subagent calls into the lead's thread.
 */
export function withoutSubagentMessages(input: RunAgentInput): RunAgentInput {
  type Tagged = { id: string; role: string; subagentRunId?: unknown; toolCallId?: string; toolCalls?: { id: string }[] };
  const messages = input.messages as unknown as Tagged[];
  const isSubagent = (m: Tagged) => m.subagentRunId != null || m.id.startsWith(SUBAGENT_MESSAGE_PREFIX);
  const subagentCallIds = new Set(
    messages.filter(isSubagent).flatMap((m) => (m.toolCalls ?? []).map((c) => c.id)),
  );
  const kept = messages.filter(
    (m) => !isSubagent(m) && !(m.role === "tool" && m.toolCallId && subagentCallIds.has(m.toolCallId)),
  );
  return kept.length === messages.length
    ? input
    : { ...input, messages: kept as unknown as RunAgentInput["messages"] };
}
