"use client";

import { useEffect, useRef, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { UsageSummary } from "@/lib/pricing";

const tokens = new Intl.NumberFormat(undefined, { notation: "compact", maximumSignificantDigits: 3 });

function money(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return "<$0.01";
  return `$${v.toFixed(v < 10 ? 2 : 0)}`;
}

/**
 * Context and Cost meters for the open conversation. Numbers come from each
 * model call's own usage report (lib/usage-tracker.ts) priced with
 * lib/pricing.ts — an estimate of the model bill, nothing else.
 */
export function UsageMeters({ summary }: { summary: UsageSummary }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (summary.calls === 0) return null;
  const share = summary.contextWindow ? summary.currentContext / summary.contextWindow : undefined;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Context and cost for this conversation"
        className="flex items-center gap-3 rounded-full border border-wb-border bg-wb-panel-alt px-3 py-1 text-[11px] text-wb-muted transition-colors hover:border-wb-border-strong"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-wb-faint">Context</span>
          {share !== undefined ? (
            <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-wb-border">
              <span
                className={`block h-full rounded-full ${share > 0.7 ? "bg-wb-warn" : "bg-wb-accent"}`}
                style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }}
              />
            </span>
          ) : null}
          <span className="tabular-nums text-wb-text">{tokens.format(summary.currentContext)}</span>
        </span>
        <span aria-hidden className="h-3 w-px bg-wb-border" />
        <span className="flex items-center gap-1.5">
          <span className="text-wb-faint">Cost</span>
          <span className="tabular-nums text-wb-text">{money(summary.cost)}</span>
        </span>
      </button>

      {open ? <UsagePopover summary={summary} share={share} /> : null}
    </div>
  );
}

function UsagePopover({ summary, share }: { summary: UsageSummary; share?: number }) {
  const series = summary.leadContext.map((v, i) => ({ call: i + 1, tokens: v }));
  // A lead call whose input dropped well below the previous one: the
  // summarization middleware compacted the conversation.
  const compactions = summary.leadContext.filter((v, i) => i > 0 && v < summary.leadContext[i - 1] * 0.75).length;

  return (
    <div
      role="dialog"
      aria-label="Usage for this conversation"
      className="absolute right-0 top-full z-40 mt-2 w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border border-wb-border bg-wb-panel p-4"
      style={{ boxShadow: "var(--wb-shadow)" }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10.5px] uppercase tracking-[0.08em] text-wb-faint">Estimated cost</p>
          <p className="mt-0.5 text-[22px] font-semibold tabular-nums leading-none text-wb-text">{money(summary.cost)}</p>
          <p className="mt-1 text-[11px] text-wb-faint">{summary.calls} model calls</p>
        </div>
        <div>
          <p className="text-[10.5px] uppercase tracking-[0.08em] text-wb-faint">Lead context</p>
          <p className="mt-0.5 text-[22px] font-semibold tabular-nums leading-none text-wb-text">
            {tokens.format(summary.currentContext)}
          </p>
          <p className="mt-1 text-[11px] text-wb-faint">
            {share !== undefined && summary.contextWindow
              ? `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}% of ${tokens.format(summary.contextWindow)}`
              : "window not published"}
            {compactions ? ` · compacted ${compactions}×` : ""}
          </p>
        </div>
      </div>

      {series.length > 1 ? (
        <div className="mt-3">
          <p className="mb-1 text-[10.5px] text-wb-faint">Lead context per call (tokens)</p>
          <div className="h-20">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="call" hide />
                <YAxis hide domain={[0, "dataMax"]} />
                <Tooltip
                  formatter={(v) => [tokens.format(Number(v)), "context"]}
                  labelFormatter={(l) => `Lead call ${l}`}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--wb-border)", background: "var(--wb-panel)" }}
                />
                <Line dataKey="tokens" type="monotone" stroke="var(--wb-series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      <div className="mt-3 overflow-x-auto rounded-lg border border-wb-border">
        <table className="w-full border-collapse text-[11px]">
          <thead className="bg-wb-panel-alt text-wb-muted">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Model</th>
              <th className="px-2 py-1.5 text-right font-medium">Calls</th>
              <th className="px-2 py-1.5 text-right font-medium">Input</th>
              <th className="px-2 py-1.5 text-right font-medium">Cached</th>
              <th className="px-2 py-1.5 text-right font-medium">Output</th>
              <th className="px-2 py-1.5 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {summary.byModel.map((m) => (
              <tr key={`${m.model}-${m.role}`} className="border-t border-wb-border">
                <td className="px-2 py-1.5 text-wb-text">
                  {m.label}
                  <span className="ml-1 text-wb-faint">{m.role === "lead" ? "lead" : "subagents"}</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-wb-muted">{m.calls}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-wb-muted">{tokens.format(m.input)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-wb-muted">{tokens.format(m.cached)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-wb-muted">{tokens.format(m.output)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-wb-text">{money(m.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10.5px] leading-relaxed text-wb-faint">
        Estimate: each call’s reported tokens × published per-token prices (checked 2026-09-26),
        with cache reads and writes at their own rates. Model calls only — web search (Tavily) and
        sandbox time aren’t included.
        {summary.unpriced ? ` ${summary.unpriced} call(s) use a model without a listed price and are excluded.` : ""}
      </p>
    </div>
  );
}
