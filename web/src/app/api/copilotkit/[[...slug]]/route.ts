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
 * Intelligence is optional, so the runtime is built two different ways.
 *
 * With a key: durable threads, the threads drawer, and the Inspector — at the
 * cost of conversation history living on CopilotKit's servers.
 * Without: everything stays on this machine, but history dies with the process.
 */
const runtime = intelligenceApiKey
  ? new CopilotRuntime({
      agents: { [AGENT_ID]: buildAgent() },
      intelligence: new CopilotKitIntelligence({ apiKey: intelligenceApiKey }),
      // Required by the Intelligence variant of the options union: threads are
      // stored per user, so it needs to know who is asking. This is a local
      // single-user demo, so everyone is the same user — swap in real auth
      // before exposing this to anyone else.
      identifyUser: () => ({ id: "local", name: "Local User" }),
    })
  : new CopilotRuntime({
      agents: { [AGENT_ID]: buildAgent() },
      runner: new InMemoryAgentRunner(),
    });

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;

// The agent streams for a long time; don't let the platform cut it short.
export const maxDuration = 300;
