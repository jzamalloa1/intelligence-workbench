import { type RunAgentInput } from "@ag-ui/client";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { Observable } from "rxjs";
import { addressResume, type PendingInterrupt } from "./interrupt-resume";
import { SubagentTracker, withoutSubagentMessages } from "./subagent-tracker";
import { takeUsageFromInput, UsageTracker } from "./usage-tracker";
import { USER_HEADER } from "./users";

/**
 * `LangGraphAgent` that records thread ownership, with the adapter gaps that
 * @ag-ui/langgraph 0.0.44 still has patched (docs/ARCHITECTURE.md §4d).
 *
 * **The fallback start has no name for Command-returning tools.** When a tool
 * call's streamed start never arrived (non-streamed calls, e.g. subagents), the
 * adapter emits one late from `on_tool_end`, taking the name from the
 * ToolMessage. Tools that return a `Command` (`write_todos`, `task`) build that
 * ToolMessage without a `name`, so the event goes out with `toolCallName: null`.
 * Under @ag-ui/client 1.0 a malformed required field is fatal, so this ends the
 * run on screen. Fix: fill the name from the event itself.
 *
 * Fixed upstream in 0.0.44 and removed here: a tool call directly following text
 * in the same response was dropped (the old `closeTextBeforeToolCall`).
 *
 * `npx tsx scripts/verify-adapter.ts` replays both cases through the stock
 * adapter and this class — run it on every @ag-ui/langgraph bump, and drop
 * this subclass's patches once the stock adapter passes.
 */
export class WorkbenchLangGraphAgent extends LangGraphAgent {
  /**
   * Stream bookkeeping, both directions. Usage (usage-tracker.ts) rides along:
   * it is taken out of the input state and added to outgoing state.
   *
   * Subagents (see subagent-tracker.ts):
   *
   *  out — every event passes through a SubagentTracker, so subagent tool calls
   *        are tagged and survive MESSAGES_SNAPSHOTs;
   *  in  — those same messages are stripped from the input before the adapter
   *        sees it. The adapter sends every client message the thread doesn't
   *        already hold as new input (`langGraphDefaultMergeState`), so without
   *        this the next turn would write subagent calls into the lead's thread.
   */
  override run(input: RunAgentInput): ReturnType<LangGraphAgent["run"]> {
    const tracker = new SubagentTracker(input.messages);
    const { input: cleaned, previous } = takeUsageFromInput(withoutSubagentMessages(input));
    const usage = new UsageTracker(previous);
    const source = super.run(cleaned);
    return new Observable((subscriber) => {
      const sub = source.subscribe({
        next: (event) => {
          for (const out of usage.process(tracker.process(event))) subscriber.next(out);
        },
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });
      return () => sub.unsubscribe();
    });
  }

  /**
   * Stamps the owner on every thread this agent creates on the agent server,
   * from the `x-workbench-user` header route.ts sets. The web app's history
   * store is what enforces ownership locally; this makes the same fact visible
   * on the agent side (LangSmith traces, `/threads/search`), where a deployed
   * agent's durable threads live.
   */
  override createThread(payload?: Parameters<LangGraphAgent["createThread"]>[0]) {
    const userId = Object.entries(this.headers ?? {}).find(([k]) => k.toLowerCase() === USER_HEADER)?.[1];
    return super.createThread({
      ...payload,
      metadata: { ...(payload?.metadata ?? {}), ...(userId ? { user_id: userId } : {}) },
    });
  }

  /**
   * An approval decision arrives as a bare `forwardedProps.command.resume`,
   * which LangGraph refuses while several interrupts are pending (parallel
   * researchers each pausing on `execute`). Address it to the interrupt the
   * card showed — see interrupt-resume.ts.
   */
  override async prepareStream(...args: Parameters<LangGraphAgent["prepareStream"]>) {
    const [input, streamMode] = args;
    const command = input.forwardedProps?.command;
    if (command?.resume !== undefined && !input.resume?.length && input.threadId) {
      const state = await this.client.threads.getState(input.threadId).catch(() => undefined);
      const pending = (state?.tasks ?? []).flatMap((t) => t.interrupts ?? []) as PendingInterrupt[];
      const resume = addressResume(command.resume, command.interruptEvent, pending);
      if (resume !== command.resume) {
        return super.prepareStream(
          { ...input, forwardedProps: { ...input.forwardedProps, command: { ...command, resume } } },
          streamMode,
        );
      }
    }
    return super.prepareStream(input, streamMode);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the base signature
  override handleSingleEvent(event: any): void {
    if (event && !Array.isArray(event) && event.event === "on_tool_end") nameAnonymousToolMessages(event);
    super.handleSingleEvent(event);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nameAnonymousToolMessages(event: any) {
  const toolName: unknown = event.name;
  const output = event.data?.output;
  if (typeof toolName !== "string" || !output || typeof output !== "object") return;

  const candidates = output.tool_call_id ? [output] : (output.update?.messages ?? []);
  for (const message of candidates) {
    if (message?.type === "tool" || message?.tool_call_id) message.name ??= toolName;
  }
}
