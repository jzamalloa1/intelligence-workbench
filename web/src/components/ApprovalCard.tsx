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
const PRIMARY_ARG: Record<string, string> = {
  execute: "command",
  research: "query",
  write_file: "file_path",
};

function primaryArg(name: string, args: Record<string, unknown>): string | undefined {
  const key = PRIMARY_ARG[name];
  const v = key ? args[key] : undefined;
  return typeof v === "string" ? v : undefined;
}

/** Fallback headline when a request carries no plain-language description. */
const FRIENDLY_NAME: Record<string, string> = {
  execute: "Run a command in the sandbox.",
  write_file: "Save a file in the workspace.",
  research: "Search the web.",
};

interface Explained {
  headline: string;
  why?: string;
  details: { verb: string; target: string }[];
  warnings: string[];
  notes: string[];
}

/**
 * Reads the description `agent_core/approvals.py` generates — a headline, then
 * `Why:`, `- detail` and `! warning` lines. Anything else (a static
 * description, another tool's) is shown as plain notes under a generic headline.
 */
function explain(action: ActionRequest): Explained {
  const lines = (action.description ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const structured = lines.some((l) => /^(Why: |- |! )/.test(l));
  const out: Explained = {
    headline: structured && lines[0] ? lines[0] : FRIENDLY_NAME[action.name] ?? `Use the ${action.name} tool.`,
    details: [],
    warnings: [],
    notes: [],
  };
  for (const line of structured ? lines.slice(1) : lines) {
    if (line.startsWith("Why: ")) out.why = line.slice(5);
    else if (line.startsWith("- ")) {
      const [verb, ...rest] = line.slice(2).split(" ");
      out.details.push({ verb, target: rest.join(" ") });
    } else if (line.startsWith("! ")) out.warnings.push(line.slice(2));
    else out.notes.push(line);
  }
  return out;
}

const DECIDED_LABEL: Record<Decision["type"], string> = {
  approve: "Approved — it will run.",
  edit: "Approved with your changes.",
  reject: "Not run.",
};

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
    setReason("");
    // Resolve as soon as every request has a decision — the middleware requires
    // exactly one per request, so a partial response is never valid.
    if (Object.keys(next).length === total && !submitted) {
      setSubmitted(true);
      onDecide(request.action_requests.map((_, i) => next[i]));
    }
  }

  if (submitted) {
    const allRejected = Object.values(decisions).every((d) => d.type === "reject");
    return (
      <div className="my-2 flex items-center gap-2 rounded-xl border border-wb-border bg-wb-panel-alt px-3.5 py-2.5 text-[12px] text-wb-muted">
        <span aria-hidden className={`size-1.5 rounded-full ${allRejected ? "bg-wb-faint" : "bg-wb-good"}`} />
        {allRejected
          ? "Got it — the assistant will continue without running it."
          : "Thanks — the assistant is continuing."}
      </div>
    );
  }

  return (
    <div
      className="my-2 overflow-hidden rounded-xl border border-wb-warn/40 bg-wb-panel"
      style={{ boxShadow: "var(--wb-shadow)" }}
    >
      <header className="border-b border-wb-border bg-wb-panel-alt px-4 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-wb-warn" />
          <h3 className="text-[12.5px] font-semibold text-wb-text">Your OK is needed</h3>
          {total > 1 ? (
            <span className="ml-auto text-[10.5px] tabular-nums text-wb-faint">
              {Object.keys(decisions).length} of {total} decided
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-wb-muted">
          The assistant wants to run something in its sandbox — a private, temporary computer
          used only for this conversation. It can’t reach your own computer or files. Nothing
          runs until you choose.
        </p>
      </header>

      <div className="flex flex-col divide-y divide-wb-border">
        {request.action_requests.map((action, i) => {
          const config = request.review_configs.find((c) => c.action_name === action.name);
          const allowed = config?.allowed_decisions ?? ["approve", "reject"];
          const decided = decisions[i];
          const primary = primaryArg(action.name, action.args);
          const info = explain(action);

          return (
            <div key={`${action.name}-${i}`} className="flex flex-col gap-2.5 px-4 py-3.5">
              <div>
                <p className="text-[13.5px] font-medium leading-snug text-wb-text">{info.headline}</p>
                {info.why ? (
                  <p className="mt-1 text-[12px] leading-relaxed text-wb-muted">
                    <span className="text-wb-faint">In the assistant’s words: </span>“{info.why}”
                  </p>
                ) : null}
                {info.notes.map((note) => (
                  <p key={note} className="mt-1 text-[12px] leading-relaxed text-wb-muted">
                    {note}
                  </p>
                ))}
              </div>

              {info.details.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {info.details.map((d) => (
                    <li key={`${d.verb}-${d.target}`} className="flex items-baseline gap-2 text-[11.5px]">
                      <span className="w-12 shrink-0 text-wb-faint">{d.verb}</span>
                      <code className="min-w-0 truncate rounded bg-wb-panel-alt px-1.5 py-0.5 font-mono text-[11px] text-wb-text">
                        {d.target}
                      </code>
                    </li>
                  ))}
                </ul>
              ) : null}

              {info.warnings.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {info.warnings.map((w) => (
                    <li
                      key={w}
                      className="flex items-center gap-1.5 rounded-full border border-wb-warn/40 bg-wb-warn/10 px-2.5 py-0.5 text-[11px] font-medium text-wb-text"
                    >
                      <WarnIcon /> {w}
                    </li>
                  ))}
                </ul>
              ) : null}

              {primary && editing !== i ? (
                <details className="group rounded-lg border border-wb-border bg-wb-panel-alt">
                  <summary className="cursor-pointer select-none list-none px-2.5 py-1.5 text-[11px] text-wb-muted transition-colors hover:text-wb-text">
                    <span className="inline-block transition-transform group-open:rotate-90">›</span>{" "}
                    Show the exact {action.name === "execute" ? "command" : "details"}
                  </summary>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-wb-border p-2.5 font-mono text-[11px] leading-relaxed text-wb-text">
                    {primary}
                  </pre>
                </details>
              ) : null}

              {editing === i ? (
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] text-wb-muted" htmlFor={`edit-${i}`}>
                    Change the command before it runs (for people comfortable with code):
                  </label>
                  <textarea
                    id={`edit-${i}`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={5}
                    className="w-full rounded-lg border border-wb-border bg-wb-panel-alt p-2.5 font-mono text-[11.5px] text-wb-text outline-none focus:border-wb-accent"
                  />
                  <div className="flex gap-2">
                    <Action
                      tone="accent"
                      onClick={() =>
                        decide(i, {
                          type: "edit",
                          edited_action: {
                            name: action.name,
                            args: { ...action.args, [PRIMARY_ARG[action.name] ?? "command"]: draft },
                          },
                        })
                      }
                    >
                      Run my version
                    </Action>
                    <Action onClick={() => setEditing(null)}>Cancel</Action>
                  </div>
                </div>
              ) : rejecting === i ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Tell the assistant why, or what to do instead (optional)"
                    aria-label="Reason for not running it"
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
                      Don’t run it
                    </Action>
                    <Action onClick={() => setRejecting(null)}>Back</Action>
                  </div>
                </div>
              ) : decided ? (
                <p className="text-[11.5px] text-wb-muted">{DECIDED_LABEL[decided.type]}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {allowed.includes("approve") ? (
                    <Action tone="accent" onClick={() => decide(i, { type: "approve" })}>
                      Run it
                    </Action>
                  ) : null}
                  {allowed.includes("edit") && primary ? (
                    <Action
                      onClick={() => {
                        setDraft(primary);
                        setEditing(i);
                      }}
                    >
                      Change it
                    </Action>
                  ) : null}
                  {allowed.includes("reject") ? (
                    <Action tone="warn" onClick={() => setRejecting(i)}>
                      Don’t run
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

function WarnIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3 text-wb-warn" aria-hidden>
      <path d="M8 2 14.5 13.5h-13z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6.5v3.2M8 11.6v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
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
