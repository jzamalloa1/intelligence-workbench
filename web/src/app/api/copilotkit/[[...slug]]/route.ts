/**
 * CopilotKit runtime endpoint.
 *
 * This is a *library* running inside the Next.js server — not a service deployed
 * to CopilotKit. It relays between the browser and the Managed Deep Agent that
 * `mda dev` serves on :2024.
 *
 * Two things here are not what the docs suggest, both verified against the
 * installed packages (see docs/ARCHITECTURE.md §6):
 *
 *  1. `LangGraphAgent` is imported from `@ag-ui/langgraph`, NOT from
 *     `@copilotkit/runtime/langgraph`. The latter is the v1 SDK and is marked
 *     `@deprecated since 1.68.2` in its own type definitions.
 *
 *  2. `SqliteAgentRunner` does not exist in @copilotkit/runtime 1.69.3 despite
 *     being documented. The non-Intelligence fallback is `InMemoryAgentRunner`,
 *     which loses thread history on server restart.
 */

import {
  CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HistoryRunner } from "@/lib/server/history-runner";
import { currentUser, json, mayAccess } from "@/lib/server/session";
import { USER_HEADER } from "@/lib/users";
import { WorkbenchLangGraphAgent } from "@/lib/workbench-agent";

/** Must match `define_deep_agent(name=...)` — MDA registers it as the graph id. */
export const AGENT_ID = "workbench";

const deploymentUrl = process.env.LANGGRAPH_URL ?? "http://127.0.0.1:2024";
const intelligenceApiKey = process.env.INTELLIGENCE_API_KEY;

/**
 * A `LangGraphAgent` subclass, not the stock one: it patches two
 * @ag-ui/langgraph stream-translation bugs that froze the UI whenever the model
 * wrote text and then called a tool in the same turn. See workbench-agent.ts.
 */
function buildAgent() {
  return new WorkbenchLangGraphAgent({
    deploymentUrl,
    graphId: AGENT_ID,
    // Only needed once the agent is deployed (`mda deploy`), where identity.py's
    // auth.langsmith_api_key() expects it as x-api-key. Harmless locally.
    langsmithApiKey: process.env.LANGSMITH_API_KEY,
  });
}

/**
 * Always available: threads live only in this process's memory, but nothing
 * about it can fail mid-run — no extra network hop to a hosted service. This is
 * what a long, heavy research turn (several subagents + sandbox execution)
 * should run against, since the Intelligence runner's hosted realtime gateway
 * gives up reconnecting after a fixed 60s and fails the run (see
 * docs/ARCHITECTURE.md §4d — that ceiling isn't configurable from here).
 */
const localHandler = createCopilotRuntimeHandler({
  runtime: new CopilotRuntime({
    agents: { [AGENT_ID]: buildAgent() },
    // InMemoryAgentRunner + durable per-user history (lib/server/history-runner.ts).
    runner: new HistoryRunner(),
  }),
  basePath: "/api/copilotkit",
});

/**
 * Only built when a key is configured. Durable threads, the threads drawer,
 * and the Inspector — at the cost of conversation history living on
 * CopilotKit's servers, and the reconnect ceiling noted above.
 */
const intelligenceHandler = intelligenceApiKey
  ? createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        agents: { [AGENT_ID]: buildAgent() },
        intelligence: new CopilotKitIntelligence({ apiKey: intelligenceApiKey }),
        // Required by the Intelligence variant of the options union: threads are
        // stored per user, so it needs to know who is asking — the demo user the
        // handler below stamped on the request.
        identifyUser: (request: Request) => {
          const id = request.headers.get(USER_HEADER) ?? "anonymous";
          return { id, name: id };
        },
      }),
      basePath: "/api/copilotkit",
    })
  : undefined;

/**
 * Runner choice is a per-request header, not a server restart. The frontend's
 * runner toggle (`useRunnerMode` / the header pill) sets `x-runner: local` on
 * every request via `<CopilotKit headers={...}>` when the user wants a heavy
 * run to be immune to the Intelligence gateway's reconnect ceiling. Defaults to
 * Intelligence whenever a key is configured, since that is what the threads
 * drawer and Inspector need — and note flipping the header switches ALL
 * requests, thread listing included, so the drawer goes empty while "local" is
 * active (it has nothing to list from the in-memory runner).
 */
async function handler(request: Request): Promise<Response> {
  const wantsLocal = request.headers.get("x-runner") === "local";
  const active = wantsLocal || !intelligenceHandler ? localHandler : intelligenceHandler;
  const prepared = await withUser(request);
  return prepared instanceof Response ? prepared : active(prepared);
}

/**
 * Identity and ownership, before CopilotKit sees the request.
 *
 * The signed-in user comes from the httpOnly session cookie and is stamped on
 * the request as `x-workbench-user` — overwriting anything the browser sent, so
 * the header can be trusted downstream (the runtime forwards it to the agent,
 * where it becomes thread metadata and the history runner's owner). Any agent
 * call naming a thread that belongs to someone else is refused with a 404, the
 * same answer as for a thread that doesn't exist.
 */
async function withUser(request: Request): Promise<Response | Request> {
  const url = new URL(request.url);
  const call = /\/agent\/[^/]+\/(run|connect|stop)(?:\/([^/]+))?/.exec(url.pathname);
  const user = await currentUser();
  if (call && !user) return json({ error: "Not signed in" }, 401);

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();

  if (call && user) {
    const threadId = call[1] === "stop" ? call[2] : threadIdOf(body);
    if (threadId && !mayAccess(decodeURIComponent(threadId), user.id)) {
      return json({ error: "Not found" }, 404);
    }
  }

  const headers = new Headers(request.headers);
  headers.delete(USER_HEADER);
  if (user) headers.set(USER_HEADER, user.id);
  return new Request(request.url, { method: request.method, headers, body, signal: request.signal });
}

function threadIdOf(body: string | undefined): string | undefined {
  try {
    const parsed = JSON.parse(body ?? "") as { threadId?: unknown; input?: { threadId?: unknown } };
    const id = parsed.threadId ?? parsed.input?.threadId;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

export const GET = handler;
export const POST = handler;

// The agent streams for a long time; don't let the platform cut it short.
export const maxDuration = 300;
