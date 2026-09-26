import "server-only";

/**
 * The few direct LangGraph Server calls the web app makes outside the
 * `LangGraphAgent` adapter: reading a thread's state to snapshot or restore a
 * conversation, and deleting one. Same server and key as route.ts.
 */

const deploymentUrl = process.env.LANGGRAPH_URL ?? "http://127.0.0.1:2024";

function headers(): Record<string, string> {
  const key = process.env.LANGSMITH_API_KEY;
  return { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) };
}

export interface LangGraphThreadState {
  values: Record<string, unknown> & { messages?: unknown[] };
  tasks?: { interrupts?: { value?: unknown }[] }[];
}

/** The thread's current state, or undefined if the agent server doesn't have it. */
export async function getThreadState(threadId: string): Promise<LangGraphThreadState | undefined> {
  try {
    const res = await fetch(`${deploymentUrl}/threads/${encodeURIComponent(threadId)}/state`, {
      headers: headers(),
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const state = (await res.json()) as LangGraphThreadState;
    return state?.values ? state : undefined;
  } catch {
    // Agent server down or restarting — callers fall back to the local snapshot.
    return undefined;
  }
}

export async function deleteLangGraphThread(threadId: string): Promise<void> {
  try {
    await fetch(`${deploymentUrl}/threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
      headers: headers(),
    });
  } catch {
    // Best effort: the local record is what the user sees, and it is gone.
  }
}
