/**
 * Per-call token usage for the Context and Cost meters.
 *
 * The source is each model call's `on_chat_model_end` event (it arrives in the
 * stream as an AG-UI RAW event), not RUN_FINISHED's `usage`: the adapter builds
 * that total only from streamed chunks, which misses every non-streaming
 * subagent call — on a recorded run it saw 1 of 32 calls' worth of input.
 *
 * Each finished call becomes a compact record. The conversation's running list
 * lives in agent state under `workbenchUsage`:
 *
 *  - a STATE_DELTA publishes it as soon as a call ends;
 *  - every STATE_SNAPSHOT gets it added, since a snapshot replaces client state
 *    and the agent's own state has no such key;
 *  - the list carries across turns through the run input's `state` — and is
 *    taken *out* of that state before the adapter sees it, so it never reaches
 *    the graph.
 *
 * Token counts only. Prices live in lib/pricing.ts and are applied in the
 * browser, so a price change never needs a re-run.
 */

import { EventType, type RunAgentInput } from "@ag-ui/client";

export const USAGE_STATE_KEY = "workbenchUsage";

export interface UsageRecord {
  /** e.g. "claude-opus-5". */
  model: string;
  provider: string;
  /** The lead agent, or a subagent running inside a `task` call. */
  role: "lead" | "subagent";
  /** All input tokens the call was billed for, cached or not. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  at: number;
}

type AnyEvent = { type: string; [key: string]: unknown };

/** Normalises LangChain `usage_metadata`; providers report cache writes differently. */
export function usageRecord(raw: unknown): UsageRecord | undefined {
  const ev = raw as {
    event?: string;
    metadata?: { ls_model_name?: string; ls_provider?: string; langgraph_checkpoint_ns?: string };
    data?: { output?: { usage_metadata?: Record<string, unknown> } };
  };
  if (ev?.event !== "on_chat_model_end") return undefined;
  const u = ev.data?.output?.usage_metadata;
  if (!u) return undefined;
  const details = (u.input_token_details ?? {}) as Record<string, number | undefined>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  // Anthropic via LangChain: the lead reports writes as `cache_creation`, while
  // the (non-streaming) subagents report them as `ephemeral_5m_input_tokens`
  // with `cache_creation: 0`. Take whichever is larger rather than summing.
  const write1h = n(details.ephemeral_1h_input_tokens);
  const write5m = Math.max(n(details.ephemeral_5m_input_tokens), n(details.cache_creation) - write1h);

  return {
    model: ev.metadata?.ls_model_name ?? "unknown",
    provider: ev.metadata?.ls_provider ?? "unknown",
    role: (ev.metadata?.langgraph_checkpoint_ns ?? "").includes("|") ? "subagent" : "lead",
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheRead: n(details.cache_read),
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
    at: Date.now(),
  };
}

export class UsageTracker {
  private records: UsageRecord[];

  constructor(previous: unknown) {
    this.records = Array.isArray(previous) ? (previous as UsageRecord[]) : [];
  }

  process<E>(event: E): E[] {
    const e = event as unknown as AnyEvent;
    if (e.type === EventType.RAW) {
      const record = usageRecord(e.event);
      if (!record) return [event];
      this.records = [...this.records, record];
      const delta = {
        type: EventType.STATE_DELTA,
        delta: [{ op: "add", path: `/${USAGE_STATE_KEY}`, value: this.records }],
      };
      return [event, delta as unknown as E];
    }
    if (e.type === EventType.STATE_SNAPSHOT) {
      const snapshot = (e.snapshot ?? {}) as Record<string, unknown>;
      return [{ ...e, snapshot: { ...snapshot, [USAGE_STATE_KEY]: this.records } } as E];
    }
    return [event];
  }
}

/** Splits the carried-over usage out of the run input, so the graph never sees it. */
export function takeUsageFromInput(input: RunAgentInput): { input: RunAgentInput; previous: unknown } {
  const state = (input.state ?? {}) as Record<string, unknown>;
  if (!(USAGE_STATE_KEY in state)) return { input, previous: [] };
  const { [USAGE_STATE_KEY]: previous, ...rest } = state;
  return { input: { ...input, state: rest }, previous };
}
