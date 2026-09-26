import "server-only";

import { EventType, type BaseEvent } from "@ag-ui/client";
import {
  InMemoryAgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerRunRequest,
} from "@copilotkit/runtime/v2";
import { Observable } from "rxjs";
import { USER_HEADER } from "../users";
import { historyEvents, pendingInterruptsOf, snapshotFromLangGraph, uiState } from "./history-events";
import { getSnapshot, saveSnapshot, touchThread } from "./history-store";
import { getThreadState } from "./langgraph";

/**
 * The Local runner, plus durable per-user history.
 *
 * `InMemoryAgentRunner` keeps a thread's events only in this process — a Next
 * restart forgets every conversation, and reopening one it doesn't hold yields
 * an empty chat. This subclass:
 *
 *  - on `run`: registers the thread under the signed-in user (title from the
 *    first message) and, once the run ends, saves the run's last message and
 *    state snapshots — subagent work included — into the history store;
 *  - on `connect`: serves the in-memory replay when there is one, and otherwise
 *    rebuilds the conversation from the saved snapshot (the agent server's
 *    thread only when there is none).
 *
 * Ownership is enforced before either is reached, in route.ts.
 */
export class HistoryRunner extends InMemoryAgentRunner {
  override run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    // The runtime copies forwarded request headers onto the per-request agent
    // clone; `headers` lives on LangGraphAgent, not on AbstractAgent's type.
    const userId = userOf((request.agent as { headers?: Record<string, string> }).headers);
    const threadId = request.threadId;
    if (userId) touchThread(threadId, userId, firstUserText(request.input.messages));

    // The last snapshots of the run, as the browser received them — which,
    // unlike the agent server's thread, include subagent work (the agent's
    // SubagentTracker re-inserts it into every MESSAGES_SNAPSHOT).
    let messages: unknown[] | undefined;
    let state: Record<string, unknown> | undefined;
    const save = () => {
      // Fire and forget: history is a convenience and must never fail a run.
      void snapshot(threadId, messages, state);
    };

    const source = super.run(request);
    return new Observable<BaseEvent>((subscriber) => {
      const sub = source.subscribe({
        next: (event) => {
          const e = event as BaseEvent & { messages?: unknown[]; snapshot?: Record<string, unknown> };
          if (e.type === EventType.MESSAGES_SNAPSHOT && e.messages) messages = e.messages;
          if (e.type === EventType.STATE_SNAPSHOT && e.snapshot) state = uiState(e.snapshot);
          subscriber.next(event);
        },
        error: (err) => {
          save();
          subscriber.error(err);
        },
        complete: () => {
          save();
          subscriber.complete();
        },
      });
      return () => sub.unsubscribe();
    });
  }

  override connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const source = super.connect(request);
    return new Observable<BaseEvent>((subscriber) => {
      let replayed = 0;
      const sub = source.subscribe({
        next: (event) => {
          replayed += 1;
          subscriber.next(event);
        },
        error: (err) => subscriber.error(err),
        complete: () => {
          if (replayed > 0) return subscriber.complete();
          restore(request.threadId)
            .then((events) => {
              for (const event of events) subscriber.next(event);
              subscriber.complete();
            })
            .catch((err) => subscriber.error(err));
        },
      });
      return () => sub.unsubscribe();
    });
  }
}

function userOf(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === USER_HEADER);
  return key ? headers[key] : undefined;
}

function firstUserText(messages: readonly { role: string; content?: unknown }[]): string {
  const first = messages.find((m) => m.role === "user");
  const content = first?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p === "object" && "text" in p ? String(p.text) : "")).join(" ");
  }
  return "";
}

async function snapshot(
  threadId: string,
  messages: unknown[] | undefined,
  state: Record<string, unknown> | undefined,
): Promise<void> {
  if (messages) {
    saveSnapshot(threadId, { messages, state: state ?? {} });
    return;
  }
  // No snapshot came through (a run that failed early): fall back to the agent
  // server's thread, which has the lead's messages only.
  const live = await getThreadState(threadId);
  if (live) saveSnapshot(threadId, snapshotFromLangGraph(live));
}

/**
 * Reopening a thread this process no longer holds. The stored snapshot comes
 * first — it is the only copy that includes subagent work. The agent server is
 * still asked, for a pending approval to re-raise, and as the source when there
 * is no snapshot yet.
 */
async function restore(threadId: string): Promise<BaseEvent[]> {
  const live = await getThreadState(threadId);
  const stored = getSnapshot(threadId);
  const snap = stored ?? (live?.values.messages?.length ? snapshotFromLangGraph(live) : undefined);
  return snap ? historyEvents(threadId, snap, pendingInterruptsOf(live)) : [];
}
