import { EventType } from "@ag-ui/client";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { USER_HEADER } from "./users";

/**
 * `LangGraphAgent` that records thread ownership, with two stream-translation
 * bugs in @ag-ui/langgraph 0.0.43 patched. The bugs surfaced together and froze
 * the UI mid-run while the agent kept working server-side (docs/ARCHITECTURE.md §4d, "the nameless tool call").
 *
 * 1. **A tool call that directly follows text is dropped.** In the adapter's
 *    `on_chat_model_stream` branch, a chunk with no text while a text message is
 *    open emits TEXT_MESSAGE_END and then `break`s — discarding that same chunk,
 *    which is the one carrying the tool call's name and id. Every later args
 *    chunk is then dropped too (no open tool call to attach it to). Claude
 *    routinely writes a sentence and then calls a tool in one response, so this
 *    is the common case, not an edge case. Fix: close the text message here
 *    first, so the adapter sees a clean slate and emits TOOL_CALL_START.
 *
 * 2. **The fallback start has no name for Command-returning tools.** When the
 *    streamed start was lost, the adapter emits one late from `on_tool_end`,
 *    taking the name from the ToolMessage. Tools that return a `Command`
 *    (`write_todos`, `task`) build that ToolMessage without a `name`, so the
 *    event goes out with `toolCallName: null` — invalid AG-UI, which the client
 *    rejects, ending the run on screen. Fix: fill the name from the event itself.
 *
 * Re-check both against the adapter source whenever @ag-ui/langgraph is bumped;
 * drop this subclass once upstream handles them.
 */
export class WorkbenchLangGraphAgent extends LangGraphAgent {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the base signature
  override handleSingleEvent(event: any): void {
    if (event && !Array.isArray(event)) {
      if (event.event === "on_chat_model_stream") this.closeTextBeforeToolCall(event);
      else if (event.event === "on_tool_end") nameAnonymousToolMessages(event);
    }
    super.handleSingleEvent(event);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private closeTextBeforeToolCall(event: any) {
    const runId = this.activeRun?.id;
    const toolChunk = event.data?.chunk?.tool_call_chunks?.[0];
    if (!runId || !toolChunk?.name) return;
    if (event.metadata?.["emit-tool-calls"] === false) return;

    const inProgress = this.getMessageInProgress(runId);
    if (!inProgress?.id || inProgress.toolCallId) return;

    this.dispatchEvent({ type: EventType.TEXT_MESSAGE_END, messageId: inProgress.id });
    this.messagesInProcess[runId] = null;
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
