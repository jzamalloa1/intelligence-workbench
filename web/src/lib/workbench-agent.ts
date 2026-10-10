import { type RunAgentInput } from "@ag-ui/client";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { Observable } from "rxjs";
import { addressResume, resumeMap, type PendingInterrupt } from "./interrupt-resume";
import { SubagentTracker, withoutReasoningMessages, withoutSubagentMessages } from "./subagent-tracker";
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
    const { input: cleaned, previous } = takeUsageFromInput(withoutReasoningMessages(withoutSubagentMessages(input)));
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
    const rewind = rewindRequest(input.forwardedProps);
    if (rewind && input.threadId) return this.rewind(input, streamMode, rewind);
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

  /**
   * Regenerate / edit: re-run the conversation from one of the user's messages,
   * with its text possibly changed. The browser trims its message list to end
   * at that message and asks for it by id (`forwardedProps.workbenchRewind`).
   *
   * The adapter can already fork a thread from the checkpoint before a message
   * (`prepareRegenerateStream`), but only triggers it on its own when the
   * browser sends a message the thread doesn't hold — never for a plain trim
   * or an edit. So it is asked for explicitly here. The marker is removed
   * first: the adapter spreads forwardedProps into the LangGraph run request.
   */
  private async rewind(
    input: Parameters<LangGraphAgent["prepareStream"]>[0],
    streamMode: Parameters<LangGraphAgent["prepareStream"]>[1],
    { messageId, content }: { messageId: string; content: string },
  ) {
    const { workbenchRewind: _drop, ...forwardedProps } = input.forwardedProps ?? {};
    void _drop;
    this.assistant ||= await this.getAssistant();
    const thread = await this.getOrCreateThread(input.threadId as string);
    if (this.activeRun) {
      this.activeRun.threadId = thread.thread_id;
      this.activeRun.schemaKeys ??= await this.getSchemaKeys();
    }
    try {
      return await this.prepareRegenerateStream(
        { ...input, forwardedProps, threadId: thread.thread_id, messageCheckpoint: { id: messageId, type: "human", content } },
        streamMode,
      );
    } catch (err) {
      if (err instanceof Error && /Message not found/.test(err.message)) {
        throw new Error(
          "This conversation can't be rewound: its earlier turns are no longer on the agent server (it was restarted or rebuilt). Ask again as a new message.",
        );
      }
      throw err;
    }
  }

  /**
   * Standard interrupt path: CopilotKit sends one answer per open interrupt as
   * `resume[]`. Address each to its interrupt id — see interrupt-resume.ts.
   */
  protected override buildCommandResumeFromAgui(
    ...[entries, ctx]: Parameters<LangGraphAgent["buildCommandResumeFromAgui"]>
  ) {
    return resumeMap(entries, ctx.openInterrupts);
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

function rewindRequest(forwardedProps: unknown): { messageId: string; content: string } | undefined {
  const r = (forwardedProps as { workbenchRewind?: { messageId?: unknown; content?: unknown } } | undefined)?.workbenchRewind;
  return r && typeof r.messageId === "string" && typeof r.content === "string"
    ? { messageId: r.messageId, content: r.content }
    : undefined;
}
