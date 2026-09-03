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

import { LangGraphAgent } from "@ag-ui/langgraph";
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

/** Must match `define_deep_agent(name=...)` — MDA registers it as the graph id. */
export const AGENT_ID = "workbench";

const deploymentUrl = process.env.LANGGRAPH_URL ?? "http://127.0.0.1:2024";
const intelligenceApiKey = process.env.INTELLIGENCE_API_KEY;

function buildAgent() {
  return new LangGraphAgent({
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
    runner: new InMemoryAgentRunner(),
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
        // stored per user, so it needs to know who is asking. This is a local
        // single-user demo, so everyone is the same user — swap in real auth
        // before exposing this to anyone else.
        identifyUser: () => ({ id: "local", name: "Local User" }),
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
  return active(request);
}

export const GET = handler;
export const POST = handler;

// The agent streams for a long time; don't let the platform cut it short.
export const maxDuration = 300;
