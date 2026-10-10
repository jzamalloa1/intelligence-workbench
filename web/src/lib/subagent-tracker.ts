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
 *
 * Which `task` a subagent call belongs to: the lead's `on_tool_start` for
 * `task` runs in the very namespace the subagent then runs under
 * (`tools:<id>`), and carries the task's arguments. Matching those to the
 * streamed `task` call gives the call's id, which becomes the `subagentRunId`
 * — so the UI can draw one lane per delegation, labelled by its task, and the
 * link survives in saved history. If no match is found the namespace is used.
 *
 * Reasoning: the lead's thinking summary streams as REASONING_* events, but the
 * adapter's snapshots don't carry it, so a saved or reopened conversation would
 * lose it. Reasoning messages are kept the same way, each re-inserted right
 * before the message that followed it.
 *
 * Earlier turns: a new run starts a new tracker, and the adapter's snapshots
 * hold the lead's thread only. The tracker is seeded with the run's input
 * messages, so subagent work from previous turns is re-inserted too, and
 * `task` calls still in flight (a run resumed after an approval) can be
 * matched again.
 */

import { EventType, type RunAgentInput } from "@ag-ui/client";
import { contentToText, type ContentPart } from "@ag-ui/core";

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

interface TaskCall {
  toolCallId: string;
  /** The lead message that holds the call. */
  messageId?: string;
  args: string;
  /** Namespace of the subagent run this call started, once matched. */
  namespace?: string;
}

/** A reasoning message, re-inserted right before the message that followed it. */
interface Reasoning {
  message: AnyMessage;
  before?: string;
}

/** Messages carried over from an earlier turn, re-inserted after `anchor`. */
interface CarriedBlock {
  anchor?: string;
  messages: AnyMessage[];
}

export const SUBAGENT_MESSAGE_PREFIX = "subagent:";

function checkpointNamespace(event: AnyEvent): string {
  const raw = event.rawEvent as { metadata?: { langgraph_checkpoint_ns?: unknown } } | undefined;
  const ns = raw?.metadata?.langgraph_checkpoint_ns;
  return typeof ns === "string" ? ns : "";
}

function isSubagentMessage(m: AnyMessage): boolean {
  return m.subagentRunId != null || m.id.startsWith(SUBAGENT_MESSAGE_PREFIX);
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class SubagentTracker {
  private calls = new Map<string, SubagentCall>();
  private tasks = new Map<string, TaskCall>();
  /** Subagent namespace (`tools:<id>`) → the `task` call that started it. */
  private taskByNamespace = new Map<string, string>();
  private carried: CarriedBlock[] = [];
  private reasoning = new Map<string, Reasoning>();
  /** Reasoning that has ended and waits for the message it precedes. */
  private awaitingNext: Reasoning[] = [];
  private leadTaskMessage?: string;

  constructor(previous: readonly unknown[] = []) {
    const messages = previous as AnyMessage[];
    const subagentCallIds = new Set(
      messages
        .filter(isSubagentMessage)
        .flatMap((m) => ((m.toolCalls as { id: string }[] | undefined) ?? []).map((c) => c.id)),
    );
    const answered = new Set(messages.filter((m) => m.role === "tool").map((m) => m.toolCallId as string));
    let anchor: string | undefined;
    let block: CarriedBlock | undefined;
    let pendingReasoning: Reasoning[] = [];
    for (const m of messages) {
      if (m.role === "reasoning") {
        const r: Reasoning = { message: m };
        this.reasoning.set(m.id, r);
        pendingReasoning.push(r);
        continue;
      }
      for (const r of pendingReasoning) r.before = m.id;
      pendingReasoning = [];
      const isSub =
        isSubagentMessage(m) || (m.role === "tool" && subagentCallIds.has(m.toolCallId as string));
      if (isSub) {
        if (!block || block.anchor !== anchor) this.carried.push((block = { anchor, messages: [] }));
        block.messages.push(m);
        continue;
      }
      anchor = m.id;
      block = undefined;
      // A `task` still without a result is in flight: its subagent may resume
      // in this run and has to be matched again.
      for (const c of (m.toolCalls as { id: string; function?: { name?: string; arguments?: string } }[] | undefined) ?? []) {
        if (c.function?.name === "task" && !answered.has(c.id)) {
          this.tasks.set(c.id, { toolCallId: c.id, messageId: m.id, args: c.function.arguments ?? "" });
        }
      }
    }
  }

  process<E>(event: E): E {
    const e = event as unknown as AnyEvent;
    switch (e.type) {
      case EventType.RAW:
        this.observe(e.event);
        return event;
      case EventType.REASONING_MESSAGE_START: {
        const id = e.messageId as string;
        this.reasoning.set(id, { message: { id, role: "reasoning", content: "" } });
        return event;
      }
      case EventType.REASONING_MESSAGE_CONTENT: {
        const r = this.reasoning.get(e.messageId as string);
        if (r) r.message.content = String(r.message.content ?? "") + String(e.delta ?? "");
        return event;
      }
      case EventType.REASONING_MESSAGE_END: {
        const r = this.reasoning.get(e.messageId as string);
        if (r) this.awaitingNext.push(r);
        return event;
      }
      case EventType.TEXT_MESSAGE_START:
        this.settleReasoning(e.messageId as string);
        return event;
      case EventType.TOOL_CALL_START: {
        const ns = checkpointNamespace(e);
        const id = e.toolCallId as string;
        if (ns.includes("|")) {
          const namespace = ns.split("|")[0];
          const taskId = this.taskByNamespace.get(namespace);
          const call: SubagentCall = {
            toolCallId: id,
            name: String(e.toolCallName ?? ""),
            args: "",
            subagentRunId: taskId ?? namespace,
            anchor: (taskId && this.tasks.get(taskId)?.messageId) || this.leadTaskMessage,
          };
          this.calls.set(id, call);
          return {
            ...e,
            parentMessageId: SUBAGENT_MESSAGE_PREFIX + id,
            subagentRunId: call.subagentRunId,
          } as E;
        }
        if (typeof e.parentMessageId === "string") this.settleReasoning(e.parentMessageId);
        if (e.toolCallName === "task") {
          const messageId = typeof e.parentMessageId === "string" ? e.parentMessageId : undefined;
          this.tasks.set(id, { toolCallId: id, messageId, args: "" });
          if (messageId) this.leadTaskMessage = messageId;
        }
        return event;
      }
      case EventType.TOOL_CALL_ARGS: {
        const call = this.calls.get(e.toolCallId as string);
        if (call) call.args += String(e.delta ?? "");
        const task = this.tasks.get(e.toolCallId as string);
        if (task) task.args += String(e.delta ?? "");
        return event;
      }
      case EventType.TOOL_CALL_RESULT: {
        const call = this.calls.get(e.toolCallId as string);
        if (!call) return event;
        call.resultMessageId = e.messageId as string;
        // String or (AG-UI 1.0) content parts. No local imports in this module:
        // scripts/verify-subagents.mjs loads it with Node's type stripping.
        call.result =
          typeof e.content === "string" || Array.isArray(e.content)
            ? contentToText(e.content as string | ContentPart[])
            : JSON.stringify(e.content ?? "");
        return { ...e, subagentRunId: call.subagentRunId } as E;
      }
      case EventType.MESSAGES_SNAPSHOT:
        return { ...e, messages: this.withReasoning(this.withSubagentCalls(e.messages as AnyMessage[])) } as E;
      default:
        return event;
    }
  }

  /**
   * The lead's `task` tool starting: its namespace is the one its subagent will
   * run under. Match it to a streamed `task` call by its arguments; the end
   * event names the call outright, which settles any match the start missed.
   */
  private observe(raw: unknown) {
    const ev = raw as {
      event?: string;
      name?: string;
      metadata?: { langgraph_checkpoint_ns?: unknown };
      data?: { input?: Record<string, unknown>; output?: { update?: { messages?: { tool_call_id?: string }[] } } };
    };
    if (ev?.name !== "task") return;
    const ns = ev.metadata?.langgraph_checkpoint_ns;
    if (typeof ns !== "string" || !ns || ns.includes("|")) return;

    if (ev.event === "on_tool_start" && !this.taskByNamespace.has(ns)) {
      const input = ev.data?.input ?? {};
      const match = [...this.tasks.values()].find((t) => {
        if (t.namespace) return false;
        const args = parseArgs(t.args);
        return (
          args.description === input.description &&
          (input.subagent_type === undefined || args.subagent_type === input.subagent_type)
        );
      });
      if (match) this.link(ns, match.toolCallId);
    } else if (ev.event === "on_tool_end" && !this.taskByNamespace.has(ns)) {
      const id = ev.data?.output?.update?.messages?.find((m) => m.tool_call_id)?.tool_call_id;
      if (id && this.tasks.has(id)) this.link(ns, id);
    }
  }

  private link(namespace: string, taskId: string) {
    this.taskByNamespace.set(namespace, taskId);
    const task = this.tasks.get(taskId);
    if (task) task.namespace = namespace;
    // Calls already seen under the bare namespace move to the task's lane.
    for (const call of this.calls.values()) {
      if (call.subagentRunId === namespace) {
        call.subagentRunId = taskId;
        call.anchor = task?.messageId ?? call.anchor;
      }
    }
  }

  private settleReasoning(nextMessageId: string) {
    for (const r of this.awaitingNext) r.before = nextMessageId;
    this.awaitingNext = [];
  }

  private withReasoning(messages: AnyMessage[]): AnyMessage[] {
    if (this.reasoning.size === 0) return messages;
    const out = [...messages];
    const present = new Set(out.map((m) => m.id));
    for (const r of this.reasoning.values()) {
      if (present.has(r.message.id) || !String(r.message.content ?? "").trim()) continue;
      const at = r.before ? out.findIndex((m) => m.id === r.before) : -1;
      out.splice(at >= 0 ? at : out.length, 0, r.message);
    }
    return out;
  }

  private withSubagentCalls(messages: AnyMessage[]): AnyMessage[] {
    if (this.calls.size === 0 && this.carried.length === 0) return messages;
    const present = new Set(messages.map((m) => m.id));
    const out = [...messages];
    // Where each anchor's inserted block currently ends, so calls from the same
    // delegation stay in the order they happened.
    const insertAt = new Map<string, number>();
    const insert = (anchor: string | undefined, block: AnyMessage[]) => {
      const key = anchor ?? "";
      let index = insertAt.get(key);
      if (index === undefined) {
        const anchorIndex = anchor ? out.findIndex((m) => m.id === anchor) : -1;
        index = anchorIndex >= 0 ? anchorIndex + 1 : out.length;
      }
      out.splice(index, 0, ...block);
      // Shift every recorded position at or after this one, then advance ours.
      for (const [k, v] of insertAt) if (v >= index && k !== key) insertAt.set(k, v + block.length);
      insertAt.set(key, index + block.length);
    };

    // Earlier turns first, so a resumed delegation's new calls follow its old ones.
    for (const carried of this.carried) {
      const missing = carried.messages.filter((m) => !present.has(m.id));
      if (missing.length) insert(carried.anchor, missing);
    }

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

      insert(call.anchor, block);
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
  type Tagged = AnyMessage & { toolCallId?: string; toolCalls?: { id: string }[] };
  const messages = input.messages as unknown as Tagged[];
  const isSubagent = isSubagentMessage;
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

/**
 * Reasoning messages are display-only: the lead's thread already holds the real
 * (signed) thinking blocks, so the summaries the browser shows are never sent
 * back as input.
 */
export function withoutReasoningMessages(input: RunAgentInput): RunAgentInput {
  const messages = input.messages as unknown as AnyMessage[];
  const kept = messages.filter((m) => m.role !== "reasoning");
  return kept.length === messages.length ? input : { ...input, messages: kept as unknown as RunAgentInput["messages"] };
}
