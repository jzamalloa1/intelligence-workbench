/**
 * Replays synthetic LangGraph stream events through the @ag-ui/langgraph adapter
 * — the stock `LangGraphAgent` and our `WorkbenchLangGraphAgent` side by side —
 * and checks the AG-UI events that come out. No network, no agent server, zero
 * API cost. Run it after every @ag-ui/langgraph bump: it says which of our
 * patches upstream has made redundant and which are still load-bearing.
 *
 *   npx tsx scripts/verify-adapter.ts
 */
import { EventType } from "@ag-ui/client";
import { EventSchemas } from "@ag-ui/core/schemas";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { WorkbenchLangGraphAgent } from "../src/lib/workbench-agent";

type Emitted = { type: string; toolCallName?: string | null; toolCallId?: string; delta?: string };

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${msg}`);
  if (!ok) failures.push(msg);
};
const info = (msg: string) => console.log(`INFO — ${msg}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function harness(agent: any): Emitted[] {
  const out: Emitted[] = [];
  agent.activeRun = { id: "run-1", threadId: "t-1", hasFunctionStreaming: false, modelMadeToolCall: false, usage: [] };
  agent.subscriber = { next: (e: Emitted) => out.push(e), closed: false };
  agent.messagesInProcess = {};
  return out;
}

const chunk = (content: string, toolCallChunks: object[] = []) => ({
  event: "on_chat_model_stream",
  metadata: {},
  data: { chunk: { id: "ai-1", content, tool_call_chunks: toolCallChunks, response_metadata: {} } },
});

/** (a) The model writes a sentence, then calls a tool in the same response. */
const textThenTool = [
  chunk("Let me plan this first."),
  chunk("", [{ name: "write_todos", id: "call-1", args: "" }]),
  chunk("", [{ args: '{"todos": []}' }]),
  { event: "on_chat_model_end", metadata: {}, data: { output: {} } },
];

/** (b) A Command-returning tool (task, write_todos) ends without a streamed start. */
const namelessToolEnd = [
  {
    event: "on_tool_end",
    name: "task",
    metadata: {},
    data: {
      input: { description: "research x", subagent_type: "researcher" },
      output: { update: { messages: [{ type: "tool", tool_call_id: "call-9", content: "done", name: null }] } },
    },
  },
];

function replay(make: () => LangGraphAgent, events: object[]) {
  const agent = make();
  const out = harness(agent);
  for (const e of events) agent.handleSingleEvent(e);
  return out;
}

const stock = () => new LangGraphAgent({ deploymentUrl: "http://127.0.0.1:1", graphId: "workbench" });
const ours = () => new WorkbenchLangGraphAgent({ deploymentUrl: "http://127.0.0.1:1", graphId: "workbench" });

const startOf = (out: Emitted[], id: string) => out.find((e) => e.type === EventType.TOOL_CALL_START && e.toolCallId === id);

// (a)
for (const [label, make] of [["stock adapter", stock], ["WorkbenchLangGraphAgent", ours]] as const) {
  const out = replay(make, textThenTool);
  const start = startOf(out, "call-1");
  const args = out.find((e) => e.type === EventType.TOOL_CALL_ARGS && e.toolCallId === "call-1");
  const textEnds = out.filter((e) => e.type === EventType.TEXT_MESSAGE_END).length;
  if (label === "stock adapter") {
    info(`(a) stock adapter ${start?.toolCallName === "write_todos" ? "now keeps" : "still drops"} a tool call that follows text`);
  } else {
    check(start?.toolCallName === "write_todos", `(a) ${label}: tool call after text is emitted (TOOL_CALL_START write_todos)`);
    check(!!args, `(a) ${label}: its arguments stream`);
    check(textEnds === 1, `(a) ${label}: the text message closes exactly once (got ${textEnds})`);
  }
}

// (b)
for (const [label, make] of [["stock adapter", stock], ["WorkbenchLangGraphAgent", ours]] as const) {
  const out = replay(make, namelessToolEnd);
  const start = startOf(out, "call-9");
  if (label === "stock adapter") {
    info(`(b) stock adapter names a Command tool's late start ${JSON.stringify(start?.toolCallName ?? null)}`);
  } else {
    check(start?.toolCallName === "task", `(b) ${label}: late TOOL_CALL_START is named "task" (got ${JSON.stringify(start?.toolCallName)})`);
  }
}

// AG-UI 1.0 rejects a malformed required field outright, ending the run on
// screen — so everything our subclass emits must pass the protocol schema.
for (const [name, events] of [["text then tool", textThenTool], ["nameless tool end", namelessToolEnd]] as const) {
  const bad = replay(ours, events as object[])
    .map((e) => ({ e, r: EventSchemas.safeParse(e) }))
    .filter(({ r }) => !r.success);
  check(bad.length === 0, `AG-UI 1.0 schema accepts every event from "${name}"${bad.length ? `: ${bad.map(({ e }) => e.type).join(", ")}` : ""}`);
}

console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS");
process.exit(failures.length ? 1 : 0);
