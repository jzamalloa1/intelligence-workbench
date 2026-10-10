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
import { resumeMap } from "../src/lib/interrupt-resume";
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

// Standard interrupt path: one answer per open interrupt, as LangGraph's resume
// map ({interrupt_id: value}) — not the adapter's `__agui_resume_map__` wrapper,
// which a plain LangGraph server can't read.
{
  const open = [
    { id: "int-a", metadata: { langgraph: { raw: { action_requests: [{}, {}] } } } },
    { id: "int-b", metadata: { langgraph: { raw: { action_requests: [{}] } } } },
  ];
  const map = resumeMap(
    [
      { interruptId: "int-a", status: "cancelled" },
      { interruptId: "int-b", status: "resolved", payload: { decisions: [{ type: "approve" }] } },
    ],
    open,
  ) as Record<string, { decisions: { type: string }[] }>;
  check(Object.keys(map).join() === "int-a,int-b", "resume map is keyed by interrupt id");
  check(map["int-b"].decisions[0].type === "approve", "a resolved answer passes through");
  check(map["int-a"].decisions.length === 2 && map["int-a"].decisions.every((d) => d.type === "reject"), "a cancelled one rejects every action in its request");
  const agent = ours() as unknown as { buildCommandResumeFromAgui: (e: unknown, c: unknown) => unknown };
  const built = agent.buildCommandResumeFromAgui([{ interruptId: "int-b", status: "resolved", payload: { ok: 1 } }], { openInterrupts: open });
  check(JSON.stringify(built) === JSON.stringify({ "int-b": { ok: 1 } }), "WorkbenchLangGraphAgent builds the resume map, not __agui_resume_map__");
}

// Regenerate / edit: the browser's rewind request forks from the user
// message's checkpoint, and its marker never reaches the LangGraph run request.
async function rewindChecks() {
  const agent = ours() as unknown as Record<string, unknown> & {
    activeRun: unknown;
    prepareStream: (input: unknown, mode: unknown) => Promise<unknown>;
  };
  let captured: { forwardedProps?: Record<string, unknown>; messageCheckpoint?: unknown } | undefined;
  agent.getAssistant = async () => ({ assistant_id: "a" });
  agent.getOrCreateThread = async (id: string) => ({ thread_id: id });
  agent.getSchemaKeys = async () => ({});
  agent.prepareRegenerateStream = async (input: typeof captured) => {
    captured = input;
    return { streamResponse: null, state: {}, streamMode: [] };
  };
  agent.activeRun = { id: "r", threadId: "t", hasFunctionStreaming: false, modelMadeToolCall: false, usage: [] };
  await agent.prepareStream(
    { threadId: "t-1", runId: "r", messages: [], tools: [], context: [], state: {}, forwardedProps: { workbenchRewind: { messageId: "u-1", content: "edited" }, keep: 1 } },
    ["events"],
  );
  check(JSON.stringify(captured?.messageCheckpoint) === JSON.stringify({ id: "u-1", type: "human", content: "edited" }), "rewind forks from the user message, with its new text");
  check(captured?.forwardedProps?.workbenchRewind === undefined && captured?.forwardedProps?.keep === 1, "the rewind marker is stripped before the run request");
}

void rewindChecks().then(() => {
  console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS");
  process.exit(failures.length ? 1 : 0);
});
