/**
 * Addresses an approval decision to the interrupt it answers.
 *
 * Several approvals can be pending at once — originally parallel researchers,
 * each pausing on its own `execute` (they no longer have a shell; see
 * agent/middleware/tool_access.py), and still any turn that asks for several. A
 * bare resume value is then refused by LangGraph ("When there are multiple
 * pending interrupts, you must specify the interrupt id when resuming").
 *
 * CopilotKit's `useInterrupt` shows one card at a time (the legacy
 * `on_interrupt` path keeps only the latest) and resumes with that card's
 * decision plus the event value it rendered. That value identifies the
 * interrupt, so the decision goes out as `{ [id]: decision }` — LangGraph's
 * resume map. The other interrupts stay pending and re-raise at the end of the
 * resumed run, so their cards follow one by one.
 */

export interface PendingInterrupt {
  id: string;
  value: unknown;
}

export function addressResume(resume: unknown, interruptEvent: unknown, pending: PendingInterrupt[]): unknown {
  if (pending.length < 2) return resume;
  const shown = canonical(interruptEvent);
  const target = pending.find((p) => canonical(p.value) === shown) ?? pending[0];
  return { [target.id]: parse(resume) };
}

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(parse(value));
}

/**
 * The resume value for CopilotKit's standard interrupt path, which collects an
 * answer per interrupt and sends them as `RunAgentInput.resume[]`. The adapter
 * would wrap them as `{"__agui_resume_map__": …}`, which only the Python AG-UI
 * server unwraps; a plain LangGraph server (MDA) needs `{interrupt_id: value}`.
 *
 * A cancelled entry becomes a rejection of every action in that request — the
 * approval middleware requires exactly one decision per action.
 */
export function resumeMap(
  entries: readonly { interruptId: string; status: string; payload?: unknown }[],
  open: readonly { id: string; metadata?: { langgraph?: { raw?: unknown } } }[],
): unknown {
  const map: Record<string, unknown> = {};
  for (const e of entries) {
    if (e.status === "resolved") {
      map[e.interruptId] = parse(e.payload);
      continue;
    }
    const raw = parse(open.find((i) => i.id === e.interruptId)?.metadata?.langgraph?.raw) as
      | { action_requests?: unknown[] }
      | undefined;
    const count = Array.isArray(raw?.action_requests) ? raw.action_requests.length : 1;
    map[e.interruptId] = { decisions: Array.from({ length: count }, () => ({ type: "reject", message: "Cancelled." })) };
  }
  return map;
}
