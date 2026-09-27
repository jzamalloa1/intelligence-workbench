import type { UsageRecord } from "./usage-tracker";

/**
 * Model prices and context windows for the Cost and Context meters.
 *
 * USD per million tokens, standard (global) tier, verified 2026-09-26 against:
 *   - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 *     (cache reads 0.1x input; 5-minute writes 1.25x; 1-hour writes 2x)
 *   - OpenAI:    https://developers.openai.com/api/docs/pricing
 *     (short-context rates — OpenAI also has long-context rates, but the page
 *     doesn't state the threshold, so the meter uses these and says so)
 * Re-check after a model or price change; the meter shows "estimate" for any
 * model not listed here.
 */
export interface ModelInfo {
  label: string;
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  /** Context window in tokens, when the provider publishes one. */
  contextWindow?: number;
}

export const MODELS: Record<string, ModelInfo> = {
  "claude-opus-5": { label: "Claude Opus 5", input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25, contextWindow: 1_000_000 },
  "claude-sonnet-5": { label: "Claude Sonnet 5", input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10, contextWindow: 1_000_000 },
  "claude-haiku-4-5": { label: "Claude Haiku 4.5", input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5, contextWindow: 200_000 },
  // OpenAI has one cache-write rate; it is used for both durations.
  "gpt-5.6-terra": { label: "GPT-5.6 Terra", input: 2, cacheWrite5m: 2.5, cacheWrite1h: 2.5, cacheRead: 0.2, output: 12 },
  "gpt-5.6-luna": { label: "GPT-5.6 Luna", input: 0.2, cacheWrite5m: 0.25, cacheWrite1h: 0.25, cacheRead: 0.02, output: 1.2 },
};

export function modelInfo(model: string): ModelInfo | undefined {
  // Tolerate dated snapshot ids ("claude-haiku-4-5-20251001").
  return MODELS[model] ?? Object.entries(MODELS).find(([id]) => model.startsWith(id))?.[1];
}

/** Cost of one call in USD, or undefined when the model isn't priced here. */
export function callCost(r: UsageRecord): number | undefined {
  const p = modelInfo(r.model);
  if (!p) return undefined;
  const uncached = Math.max(0, r.input - r.cacheRead - r.cacheWrite5m - r.cacheWrite1h);
  return (
    (uncached * p.input +
      r.cacheRead * p.cacheRead +
      r.cacheWrite5m * p.cacheWrite5m +
      r.cacheWrite1h * p.cacheWrite1h +
      r.output * p.output) /
    1_000_000
  );
}

export interface UsageSummary {
  calls: number;
  cost: number;
  /** Calls whose model has no price here — the total excludes them. */
  unpriced: number;
  byModel: { model: string; label: string; role: string; calls: number; input: number; cached: number; output: number; cost: number }[];
  /** Input tokens of each lead call, in order — the lead's context over time. */
  leadContext: number[];
  /** The lead's current context: its last call's input plus what it wrote. */
  currentContext: number;
  contextWindow?: number;
  leadModel?: string;
}

export function summarize(records: UsageRecord[]): UsageSummary {
  const groups = new Map<string, UsageSummary["byModel"][number]>();
  let cost = 0;
  let unpriced = 0;
  for (const r of records) {
    const c = callCost(r);
    if (c === undefined) unpriced += 1;
    else cost += c;
    const key = `${r.model}|${r.role}`;
    const g = groups.get(key) ?? {
      model: r.model,
      label: modelInfo(r.model)?.label ?? r.model,
      role: r.role,
      calls: 0,
      input: 0,
      cached: 0,
      output: 0,
      cost: 0,
    };
    g.calls += 1;
    g.input += r.input;
    g.cached += r.cacheRead;
    g.output += r.output;
    g.cost += c ?? 0;
    groups.set(key, g);
  }
  const lead = records.filter((r) => r.role === "lead");
  const last = lead[lead.length - 1];
  return {
    calls: records.length,
    cost,
    unpriced,
    byModel: [...groups.values()].sort((a, b) => b.cost - a.cost),
    leadContext: lead.map((r) => r.input),
    currentContext: last ? last.input + last.output : 0,
    contextWindow: last ? modelInfo(last.model)?.contextWindow : undefined,
    leadModel: last?.model,
  };
}

export function readUsage(state: unknown): UsageRecord[] {
  const v = (state as { workbenchUsage?: unknown } | undefined)?.workbenchUsage;
  return Array.isArray(v) ? (v as UsageRecord[]) : [];
}
