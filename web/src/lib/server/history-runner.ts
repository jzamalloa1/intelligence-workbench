import "server-only";

import type { BaseEvent } from "@ag-ui/client";
import {
  InMemoryAgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerRunRequest,
} from "@copilotkit/runtime/v2";
import { Observable } from "rxjs";
import { USER_HEADER } from "../users";
import { historyEvents, pendingInterruptsOf, snapshotFromLangGraph } from "./history-events";
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
 *    first message) and, once the run ends, snapshots the conversation from the
 *    agent server into the history store;
 *  - on `connect`: serves the in-memory replay when there is one, and otherwise
 *    rebuilds the conversation — live from the agent server if it still has the
 *    thread, else from the last snapshot.
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

    const source = super.run(request);
    return new Observable<BaseEvent>((subscriber) => {
      const sub = source.subscribe({
        next: (event) => subscriber.next(event),
        error: (err) => {
          void snapshot(threadId);
          subscriber.error(err);
        },
        complete: () => {
          // After the run, so the snapshot includes its final messages. Fire and
          // forget: history is a convenience and must never fail a run.
          void snapshot(threadId);
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

async function snapshot(threadId: string): Promise<void> {
  const state = await getThreadState(threadId);
  if (state) saveSnapshot(threadId, snapshotFromLangGraph(state));
}

async function restore(threadId: string): Promise<BaseEvent[]> {
  const live = await getThreadState(threadId);
  if (live?.values.messages?.length) {
    return historyEvents(threadId, snapshotFromLangGraph(live), pendingInterruptsOf(live));
  }
  const stored = getSnapshot(threadId);
  return stored ? historyEvents(threadId, stored) : [];
}
