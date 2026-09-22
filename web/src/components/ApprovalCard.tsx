"use client";

import { useState } from "react";

/**
 * Human-in-the-loop approval, rendered inline in the chat by `useInterrupt`.
 *
 * The wire contract, read off the installed packages rather than the docs
 * (see README § Steering):
 *
 *   in   `{ action_requests: [{name, args, description?}],
 *            review_configs: [{action_name, allowed_decisions, args_schema?}] }`
 *   out  `{ decisions: [Decision, ...] }` — exactly one per action request, in
 *        the same order. LangChain's HumanInTheLoopMiddleware does
 *        `interrupt(hitl_request)["decisions"]` and raises if the count differs.
 *
 * `@ag-ui/langgraph` emits interrupts as the *legacy* `on_interrupt` custom
 * event and JSON-stringifies the value, so the payload arrives as a string and
 * `interrupt` is null — hence parsing `event.value` here rather than reading
 * the standard `interrupt` prop.
 */

type DecisionType = "approve" | "edit" | "reject" | "respond";

interface ActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

interface ReviewConfig {
  action_name: string;
  allowed_decisions: DecisionType[];
}

export interface HITLRequest {
  action_requests: ActionRequest[];
  review_configs: ReviewConfig[];
}

type Decision =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | { type: "edit"; edited_action: { name: string; args: Record<string, unknown> } };

/** Tolerant of both the stringified legacy payload and an already-parsed object. */
export function parseHITLRequest(value: unknown): HITLRequest | null {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<HITLRequest>;
  if (!Array.isArray(obj.action_requests) || obj.action_requests.length === 0) return null;
  return {
    action_requests: obj.action_requests,
    review_configs: Array.isArray(obj.review_configs) ? obj.review_configs : [],
  };
}

/** The one argument worth showing large, per tool. Everything else is detail. */
function primaryArg(name: string, args: Record<string, unknown>): string | undefined {
  const key = { execute: "command", research: "query", write_file: "file_path" }[name];
  const v = key ? args[key] : undefined;
  return typeof v === "string" ? v : undefined;
}

export function ApprovalCard({
  request,
  onDecide,
}: {
  request: HITLRequest;
  onDecide: (decisions: Decision[]) => void;
}) {
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const total = request.action_requests.length;

  function decide(index: number, decision: Decision) {
    const next = { ...decisions, [index]: decision };
    setDecisions(next);
    setEditing(null);
    setRejecting(null);
    // Resolve as soon as every request has a decision — the middleware requires
    // exactly one per request, so a partial response is never valid.
    if (Object.keys(next).length === total && !submitted) {
      setSubmitted(true);
      onDecide(request.action_requests.map((_, i) => next[i]));
    }
  }

  if (submitted) {
    return (
      <div className="my-2 rounded-xl border border-wb-border bg-wb-panel-alt px-3.5 py-2.5 text-[12px] text-wb-muted">
        Decision sent — resuming the run.
      </div>
    );
  }

  return (
    <div
      className="my-2 overflow-hidden rounded-xl border border-wb-warn/40 bg-wb-panel"
      style={{ boxShadow: "var(--wb-shadow)" }}
    >
      <header className="flex items-center gap-2 border-b border-wb-border bg-wb-panel-alt px-3.5 py-2">
        <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-wb-warn" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-wb-muted">
          Approval required
        </h3>
        {total > 1 ? (
          <span className="ml-auto text-[10.5px] text-wb-faint">
            {Object.keys(decisions).length}/{total} decided
          </span>
        ) : null}
      </header>

      <div className="flex flex-col divide-y divide-wb-border">
        {request.action_requests.map((action, i) => {
          const config = request.review_configs.find((c) => c.action_name === action.name);
          const allowed = config?.allowed_decisions ?? ["approve", "reject"];
          const decided = decisions[i];
          const primary = primaryArg(action.name, action.args);

          return (
            <div key={`${action.name}-${i}`} className="px-3.5 py-3">
              <div className="mb-2 flex items-baseline gap-2">
                <code className="text-[11px] font-medium text-wb-warn">{action.name}</code>
                {decided ? (
                  <span className="text-[10.5px] text-wb-faint">{decided.type}ed</span>
                ) : null}
              </div>

              {action.description ? (
                <p className="mb-2 text-[12px] leading-relaxed text-wb-muted">
                  {action.description}
                </p>
              ) : null}

              {/* While editing, the textarea below already shows the command —
                  repeating it read-only above just doubles it. */}
              {editing === i ? null : primary ? (
                <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-wb-border bg-wb-panel-alt p-2.5 font-mono text-[11.5px] leading-relaxed text-wb-text">
                  {primary}
                </pre>
              ) : (
                <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-wb-border bg-wb-panel-alt p-2.5 font-mono text-[11px] text-wb-muted">
                  {JSON.stringify(action.args, null, 2)}
                </pre>
              )}

              {editing === i ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={4}
                    aria-label="Edited command"
                    className="w-full rounded-lg border border-wb-border bg-wb-panel-alt p-2.5 font-mono text-[11.5px] text-wb-text outline-none focus:border-wb-accent"
                  />
                  <div className="flex gap-2">
                    <Action
                      tone="accent"
                      onClick={() => {
                        const key =
                          { execute: "command", research: "query", write_file: "file_path" }[
                            action.name
                          ] ?? "command";
                        decide(i, {
                          type: "edit",
                          edited_action: {
                            name: action.name,
                            args: { ...action.args, [key]: draft },
                          },
                        });
                      }}
                    >
                      Run edited
                    </Action>
                    <Action onClick={() => setEditing(null)}>Cancel</Action>
                  </div>
                </div>
              ) : rejecting === i ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why? (optional — the agent sees this)"
                    aria-label="Rejection reason"
                    className="w-full rounded-lg border border-wb-border bg-wb-panel-alt px-2.5 py-1.5 text-[12px] text-wb-text outline-none focus:border-wb-accent"
                  />
                  <div className="flex gap-2">
                    <Action
                      tone="warn"
                      onClick={() =>
                        decide(i, {
                          type: "reject",
                          ...(reason.trim() ? { message: reason.trim() } : {}),
                        })
                      }
                    >
                      Confirm reject
                    </Action>
                    <Action onClick={() => setRejecting(null)}>Cancel</Action>
                  </div>
                </div>
              ) : decided ? null : (
                <div className="flex flex-wrap gap-2">
                  {allowed.includes("approve") ? (
                    <Action tone="accent" onClick={() => decide(i, { type: "approve" })}>
                      Approve
                    </Action>
                  ) : null}
                  {allowed.includes("edit") && primary ? (
                    <Action
                      onClick={() => {
                        setDraft(primary);
                        setEditing(i);
                      }}
                    >
                      Edit
                    </Action>
                  ) : null}
                  {allowed.includes("reject") ? (
                    <Action tone="warn" onClick={() => setRejecting(i)}>
                      Reject
                    </Action>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Action({
  children,
  onClick,
  tone = "neutral",
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "neutral" | "accent" | "warn";
}) {
  const tones = {
    neutral: "border-wb-border text-wb-muted hover:text-wb-text hover:border-wb-border-strong",
    accent: "border-transparent bg-wb-accent-soft text-wb-accent hover:brightness-95",
    warn: "border-wb-warn/40 text-wb-warn hover:bg-wb-warn/10",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors ${tones[tone]}`}
    >
      {children}
    </button>
  );
}
