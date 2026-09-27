/**
 * Addresses an approval decision to the interrupt it answers.
 *
 * Several approvals can be pending at once: researchers run in parallel, each
 * inherits the lead's `interrupt_on`, and each pauses on its own `execute`. A
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
