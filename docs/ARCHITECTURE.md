# Architecture & Decisions

Why this project is built the way it is — including the approaches we rejected and, where it
matters, the difference between what the documentation claims and what actually happens when
you run it.

---

## 1. The central question

Managed Deep Agents (MDA) is a **hosted** runtime. CopilotKit is a **frontend** that talks to
agents over the AG-UI protocol. Can they be connected at all?

The documentation suggests no. MDA's own authoring contract lists this under beta limits:

> **CLI-first, public beta** — No public create/update/invoke REST surface. **Calling a deployed
> agent from your own application is not documented during beta** — tell the user to contact
> their LangChain team.

Taken at face value, that closes the door. It doesn't, because it describes *deployed* agents.

**Local development is a different story.** `mda dev` compiles the project and then runs
`uv run --with langgraph-cli[inmem] langgraph dev` — an ordinary LangGraph server. And
CopilotKit's runtime reference for `LangGraphAgent` states it supports *"LangGraph Platform
deployments **and self-hosted LangGraph servers**"* via `deploymentUrl` + `graphId`.

So the connection is:

```ts
new LangGraphAgent({
  deploymentUrl: process.env.LANGGRAPH_URL,  // http://127.0.0.1:2024
  graphId: "workbench",                       // == define_deep_agent(name=...)
})
```

`define_deep_agent(name=...)` becomes the LangGraph assistant ID, which is exactly what
`graphId` expects.

---

## 2. What we verified by execution

The above was an inference from two independently-documented halves. Before building anything
on it, we proved it. Results:

| Check | Result |
|---|---|
| `mda dev` runs **without beta access** | ✅ No LangSmith key validated at any point |
| Serves the LangGraph Server API | ✅ `127.0.0.1:2024`, **60 paths**, OpenAPI title "LangSmith Deployment" |
| `graphId` == agent `name` | ✅ `{"graph_id":"probe","name":"probe"}` |
| Local auth is permissive | ✅ HTTP 200 with no `x-api-key` — `identity.py` gates deploy, not dev |
| Runs dispatch and the graph executes | ✅ `PatchToolCallsMiddleware.before_agent` fired |
| **`CopilotKitMiddleware` runs inside an MDA graph** | ✅ **`CopilotKitMiddleware.before_agent` fired** |

That last row was the load-bearing assumption. `middleware=` is an author-set field in MDA, so
CopilotKit's middleware composes into the managed graph directly — no fork, no shim.

Only `mda deploy` is gated on public-beta workspace access.

---

## 3. Rejected: the FastAPI / AG-UI path

The official CopilotKit Deep Agents quickstart wires things up like this:

```python
add_langgraph_fastapi_endpoint(app=app, agent=LangGraphAGUIAgent(graph=agent), path="/")
```

We do **not** do this, for a reason worth stating plainly: that pattern exists to expose an
AG-UI endpoint for a graph *you* compiled and serve yourself. MDA owns the server. Adding
FastAPI would mean bypassing MDA entirely — building the CopilotKit sample project rather than
the one we set out to build.

The tradeoff is honest: the FastAPI path is the documented, proven one, and going MDA-native
meant the transport had to be verified first (§2). We accepted that risk deliberately, and
treated "it doesn't work" as a legitimate finding rather than a reason to quietly substitute a
different architecture.

One consequence: the showcase's `copilotkit_customize_config(emit_tool_calls=[...])` trick for
suppressing subagent tool noise is FastAPI-path-specific. Under MDA we filter on the frontend
in `useRenderToolCall` instead.

---

## 4. What runs where

`CopilotRuntime` is an npm **library** inside the Next.js API route, not a service you deploy
to CopilotKit.

| Process | Port | Role |
|---|---|---|
| `mda dev .` | 2024 | The agent — MDA-compiled LangGraph server |
| `npm run dev` | 3000 | Next.js: React UI **and** CopilotRuntime, same process |

Model provider credentials live in these processes and never reach CopilotKit.

### CopilotKit Intelligence is optional

Intelligence is a persistence and observability layer — durable threads, the Inspector,
cross-instance scaling — reached over an outbound websocket from the runtime. **The agent never
executes there.**

`INTELLIGENCE_API_KEY` decides whether Cloud mode *exists*; the in-app pill decides which one a
session *uses*, defaulting to Local (see §4d — Cloud loses long runs):

| Mode | Runner | Tradeoff |
|---|---|---|
| Local (default) | `InMemoryAgentRunner` | Nothing leaves the machine; history lost on restart |
| Cloud | `IntelligenceAgentRunner` | Threads drawer + Inspector; history stored by CopilotKit; 60s reconnect ceiling |

Note the redundancy: MDA already persists threads via its LangGraph checkpointer, but
CopilotKit's threads drawer reads Intelligence, not MDA. Two layers, not a conflict.

---

## 4b. Wiring CopilotKit v2 — three corrections to the docs

Every one of these was found by reading the installed package or by running it, and
each contradicts published guidance.

**`LangGraphAgent` comes from `@ag-ui/langgraph`, not `@copilotkit/runtime/langgraph`.**
CopilotKit's own runtime reference shows the latter, but its type definitions mark
that whole module `@deprecated since 1.68.2 — the v1 SDK is deprecated`. The v2
runtime exports only `BasicAgent` and `BuiltInAgent`; LangGraph support comes from
the AG-UI package, which v2's `agents` map accepts as any `AbstractAgent`.

**Pin `@ag-ui/langgraph` to the exact version `@copilotkit/runtime` depends on.** (On
1.70.0 that was `0.0.42`; on 1.73.0 it is `0.0.43` — the rule is "match theirs", not any
particular number.) It ships as a transitive dependency
of `@copilotkit/runtime`, pinned exactly, alongside `@ag-ui/core@0.0.57`. Installing
it with a caret resolves `0.0.43`, which imports `aggregateTokenUsage` and
`tokenUsageFromLangChainMetadata` from a newer core — every route then 500s with
`Export ... doesn't exist in target module`.

**`SqliteAgentRunner` does not exist** in `@copilotkit/runtime` 1.69.3 despite being
documented. The runners actually exported are `InMemoryAgentRunner` and
`IntelligenceAgentRunner`, so the no-Intelligence fallback loses thread history on
restart rather than persisting to disk.

Two smaller notes: `CopilotRuntime`'s options are a *union*, and the Intelligence
variant additionally requires `identifyUser` (or `channels`) — omitting it is a type
error, not a runtime one. And in Intelligence mode a run does not stream over the
HTTP response; it returns a `joinToken` plus a `wss://` topic, and events arrive on
that websocket. Verifying by curl therefore shows an empty-looking response even on
success — check the agent server log for `Background run succeeded` instead.

## 4c. Where the UI panels get their data

Two different sources, because the agent does not expose them the same way.

**`write_todos` does not exist until you add it.** Neither MDA nor `deepagents`'
default profile includes `TodoListMiddleware` — verified three ways: the
`managed_deepagents` package has zero references to it, `deepagents` only adds it
in the opt-in `_openai_codex` harness profile, and the compiled agent's tool list
was `delete, edit_file, execute, glob, grep, ls, read_file, research, task,
write_file` with no `write_todos`. We add it explicitly in `agent.py`. Once added,
`todos` appears in agent state and streams to the client in `STATE_SNAPSHOT` as
`[{content, status}]`.

**Files never appear in state when a sandbox is attached.** With `sandbox/`
declared, the filesystem lives in the remote VM; the final state snapshot contains
only `ag-ui`, `copilotkit`, `messages`, and `todos`. So the Workspace panel derives
files from streamed `write_file` / `edit_file` **tool calls** instead. That has a
side benefit: it keeps working if the sandbox is later removed, whereas a
state-based reader would silently switch data sources.

Both derivations are pure functions over `agent.messages` / `agent.state`
(`src/lib/workbench.ts`) — no side effects during render, so there is no
duplicate-event bookkeeping to get wrong. Note `edit_file` sends a patch rather
than full content, so the viewer can only show content captured from `write_file`.

### On the sandbox

Enabling it is what makes `execute` real. Both backends *list* an `execute` tool,
but `deepagents`' filesystem middleware gates it:

```python
if not supports_execution(resolved_backend):
    return ToolMessage(content="Error: Execution not available...", status="error")
```

`StateBackend` does not implement execution, so without a sandbox the model can
call `execute` and it always fails. With one, commands run in a real Linux VM
(verified: `python3 -c "print(2**16)"` → `65536`, `uname -s` → `Linux`). The
feature is gated per organization — without it every file operation raises
`SandboxAuthenticationError: Sandbox feature is not enabled for this organization`,
which surfaces as a generic "An internal error occurred" in the run stream.

## 4d. UI issues found by looking at it in a browser

Verified with `web/scripts/inspect.mjs`, which drives the real page via
playwright-core against the locally installed Chrome (no browser download) and
captures screenshots plus the console log.

**"View in Inspector (local only)" repeated once per assistant message.** Not a
tool renderer, as it first appears — it is the *assistant message toolbar*
(`assistantMessageToolbarInspectorLabel`), gated by `isInspectorEnabled`.
CopilotKit turns the Inspector on by default in development, which also mounts a
floating launcher over the top-right of the page. Fixed with
`enableInspector={INSPECTOR_ENABLED}` on the provider, defaulting off and
re-enabled with `NEXT_PUBLIC_ENABLE_INSPECTOR=true` — the Inspector is a good way
to learn the AG-UI event flow, so it is one env var away rather than deleted.

**Every tool call rendered as a bare row.** CopilotKit's built-in *wildcard* tool
renderer (`WILDCARD_TOOL_NAME === "*"`) says nothing about what ran. Overridden
via `useRenderTool({ name: "*", render })` with a card showing the tool, its
target, and an expandable result.

**`flushSync` console errors (unresolved, upstream).** Fires repeatedly from
`@copilotkit/react-core` during a run. All three call sites are inside CopilotKit
— an image-lightbox view transition and, more suspiciously,
`flushSync(async () => ...)` in its action-execution path, which is an
anti-pattern (flushSync with an async callback). Still present in 1.70.0, so
upgrading does not fix it. Dev-mode console noise; functionality is unaffected.

**Duplicate `@ag-ui/client` after upgrading to CopilotKit 1.70.0.** The root had
0.0.57 (left from 1.69.3) while 1.70.0 nests 0.0.59, producing two `AbstractAgent`
declarations and `Types have separate declarations of a private property '_debug'`.
Fixed with npm `overrides` pinning `@ag-ui/client`/`core`/`encoder` to 0.0.59.

**Garbled transcript during parallel delegation — fixed by disabling subagent
token streaming.** With several `task` subagents in flight the transcript showed
character-level splicing: "Replica promices", "independotion", "Let me
dvs-memcached". Two hypotheses were tested and rejected before the real cause:

1. *Duplicate stream modes.* `@ag-ui/langgraph` defaults to
   `["events","values","updates","messages-tuple"]`, and both `events`
   (`on_chat_model_stream`) and `messages-tuple` carry the same tokens —
   confirmed by querying the LangGraph server directly, where each returned the
   identical sentence. But dropping either one did not fix the splicing:
   removing `events` silenced the UI entirely (it is the primary projection
   source), and removing `messages-tuple` changed nothing.

2. The actual cause is that **deepagents runs subagents inline via
   `subagent.invoke()`** (`deepagents/middleware/subagents.py`), not as a
   separate subgraph. Their LLM calls therefore emit `on_chat_model_stream`
   events at the *root* of the run, and the frontend appends every one of them
   to the parent's assistant message. With three researchers running at once,
   three token streams interleave into one message.

The fix is `disable_streaming=True` on subagent models only
(`build_model(role, stream=False)`). Subagents behave identically — they just
return their result in one piece rather than token by token — and the parent
keeps full token streaming. The Activity panel still shows each subagent's
progress, so nothing observable is lost.

This is the same problem CopilotKit's own Deep Agents showcase sidesteps by not
delegating at all, wrapping research in a tool that calls `.invoke()` internally
"so its text doesn't stream to the frontend". Disabling streaming per-model keeps
real subagents.

**"Runner connection dropped" mid-run on the Intelligence runner — a beta ceiling,
not a bug in this project.** Surfaces as `agent_run_failed_event` /
`agent_run_error_event` in the browser console, several times per occurrence,
during a long turn (multiple subagents + sandbox `execute` calls, several
minutes). Traced into `@copilotkit/channels-intelligence`'s
`connectRealtimeGateway`: the runtime holds a Phoenix WebSocket to CopilotKit's
hosted realtime gateway (`wss://realtime.intelligence.copilotkit.ai` by default),
and if that connection drops mid-run it retries with backoff for
`reconnectGiveUpMs` — **60 seconds by default** — before giving up and failing
the run. `CopilotKitIntelligenceConfig` (the public constructor options on
`CopilotKitIntelligence`) does not expose `reconnectGiveUpMs`, `timeoutMs`, or
`connectTimeoutMs` — confirmed by reading its `.d.mts` — so there is no supported
way to extend that window from `route.ts`. This is infrastructure on
CopilotKit's hosted beta service, outside this repo's code.

Practical mitigation: unset `INTELLIGENCE_API_KEY` for long/heavy runs — the
`InMemoryAgentRunner` path talks straight to `mda dev` over plain HTTP with no
extra hop, so it cannot hit this failure mode. Keep Intelligence on for shorter
interactive sessions where the threads drawer and Inspector are worth it. This
is exactly the env-toggle already built for a different reason (§4).

**Source volume comes from fan-out, not from any single call.** `research()`
already caps at `max_results=6` per call. What multiplies it is the `researcher`
subagent prompt ("run several searches... before concluding") times however many
subagents the lead delegates to in parallel — 4 subagents × several searches ×
6 sources is a lot of ground covered for one question. Tightened both prompts
(`agent_core/prompts.py`, `instructions.md`) to 2-3 searches per subagent and
2-4 subagents per topic, framed as a cost tradeoff rather than a hard cap, so the
agent can still go deeper when a question genuinely needs it.

**Workspace file preview was plain-text for everything, including `.md`.**
`FileViewer` piped `file.content` through one `<pre>` regardless of extension, so
markdown reports were unreadable as reports. Fixed by rendering `.md` files
through `react-markdown` (already a transitive dependency of
`@copilotkit/react-ui` at 10.1.0 — added directly rather than reaching into the
nested copy) with `remark-gfm` for tables, styled with the app's own `--wb-*`
tokens rather than pulling in `@tailwindcss/typography`. Non-markdown files keep
the monospace view with an extension badge.

**No chart ever renders inline — fixed in Milestone 5.** `instructions.md` used to tell the
agent it could "generate a chart" via the sandbox, but nothing in the UI consumed an image
the agent wrote — the Workspace panel's file viewer rendered text and markdown, not images,
and there was no dedicated chart tool or canvas component. Fixed with `render_chart`
(`agent/tools/charts.py`) — structured data as the tool's arguments, not an image — and an
Artifact Canvas component (Recharts). See README's "Who sees what" diagram for the full
argument on why structured data, not a picture.

**The runner toggle's first design was broken, and only a real end-to-end run caught it.**
Every earlier test in this project ran on the Cloud/Intelligence runner by default (the env
var was always set), so the Local path had never actually been exercised until Milestone 5's
verification run deliberately used it. First attempt: `agent_run_failed` — *"REST run request
failed: Unexpected token 'd', "data: {"ty"... is not valid JSON"*. Root cause, confirmed by
reading `@copilotkit/core`'s source: `ProxiedCopilotRuntimeAgent.ensureRuntimeConfiguration()`
negotiates transport with one `GET .../info` call and caches whether Intelligence is available
on that agent **instance**, for its whole lifetime — it never re-checks. The toggle's `headers`
function only changes what the *server* does on later requests (route.ts correctly routed to
`InMemoryAgentRunner`), but the *client* had already committed to `IntelligenceAgent`'s
websocket-oriented protocol during the page-load negotiation, before the toggle was ever
touched — so it kept using that protocol against what was now a plain AG-UI SSE endpoint,
and its REST-run response parser choked on the raw `data: {...}` chunk. Fixed with
`key={mode}` on `<CopilotKit>` (`AgentProvider.tsx`): switching modes now remounts the
provider, forcing a fresh agent instance and a fresh negotiation that reads the current
header. Cost: switching resets the visible conversation — correct, not a compromise, since an
Intelligence-backed thread and an in-memory one were never the same thread. Verified two ways
before trusting it: `web/scripts/verify-toggle.mjs` confirms the `/info` negotiation re-fires
with the right header on every toggle, at zero API cost; then a real end-to-end research +
sandbox + chart run against the Local runner completed clean.

**Milestone 6: `useInterrupt`, not `useHumanInTheLoop`.** CopilotKit v2 exports both, and for
LangGraph-style approvals only one of them is right. `useHumanInTheLoop` registers a *frontend
tool* whose handler happens to be a human — the agent calls a tool that is answered in the
browser. `interrupt_on` is a different mechanism entirely: LangChain's
`HumanInTheLoopMiddleware` raises a LangGraph **interrupt**, which `@ag-ui/langgraph` forwards
as a custom event. The decisive evidence is in the installed types —
`INTERRUPT_EVENT_NAME = "on_interrupt"` in `@copilotkit/react-core` is character-for-character
the event `@ag-ui/langgraph` dispatches, and `useInterrupt`'s own docstring says it handles
"the legacy custom-event flow (`on_interrupt`)". Two consequences worth knowing: on that legacy
path the standard `interrupt` prop is **null**, so the payload must be read from `event.value`,
and it arrives **JSON-stringified** (the adapter does
`value: typeof e.value === "string" ? e.value : JSON.stringify(e.value)`), so the card parses
defensively.

The resume contract is unforgiving and worth stating once: `interrupt(hitl_request)["decisions"]`
expects **exactly one decision per action request, in order**, and raises on a count mismatch —
which is why `ApprovalCard` holds a decision per request and only resolves once all are made,
rather than firing on the first click. Verified without spending any API credits by rendering
the card against the real payload shape in a throwaway route and asserting the emitted payloads:
`{"decisions":[{"type":"approve"}]}`,
`{"decisions":[{"type":"reject","message":"…"}]}`, and
`{"decisions":[{"type":"edit","edited_action":{"name":"execute","args":{"command":"…"}}}]}`.
**Not verified:** the live round trip — that the run actually pauses and resumes — which needs a
real agent run.

**The reconnect ceiling hit again, and the agent log settled what it costs.** A Milestone 6 test
run on Cloud mode failed in the browser with four `Runner connection dropped` errors
(`IntelligenceAgent.createThreadNotifications`, Phoenix `Socket.onConnMessage`). The agent server
told the other half of the story: `Background run succeeded`, `run_exec_ms=356661` — the run
executed for **six minutes and completed**. So this failure mode does not break the agent; it
throws away a finished run's output before the browser sees it. Three changes followed:

1. **Local is now the default mode** (`AgentProvider.tsx`). Runs here are routinely minutes
   long, and Milestone 6's approval gate adds human-length pauses, so a 60s reconnect budget is
   a poor fit. Cloud remains one click away for the threads drawer and Inspector.
2. **The drop is surfaced in the UI**, via `<CopilotKit onError>` → a banner that says the run
   probably *finished* and offers to switch to Local. Previously it existed only as console
   noise, which reads as "the agent failed" when the agent did nothing wrong.
3. **CopilotKit 1.70.0 → 1.73.0.** Their release notes claim no fix for this specifically
   (1.71.2 mentions unspecified "runtime hardening"), so the upgrade is not a claimed remedy —
   but it is three minors of fixes, and it *released the `@ag-ui/langgraph` pin*: 1.73.0 depends
   on `0.0.43`, the version §4b had us holding back from. The npm `overrides` block is gone too
   — with 1.73.0's own dependencies internally consistent, a clean lockfile re-resolve yields a
   single `@ag-ui/client@0.0.59` without it. Verified with tsc, `next build`, and
   `verify-toggle.mjs`; **not** verified against a live long Cloud run.

**The nameless tool call — UI froze at the plan step while the agent kept working
(2026-09-26).** Symptom: send a query, the first sentence and a couple of `research` cards
appear, then nothing — no plan, no subagents, header back to "Idle" — while `mda dev` keeps
making model calls and logs `Background run succeeded` minutes later. Not a network drop and
not event volume; the browser simply stopped consuming the stream.

Diagnosed at zero API cost. The Local runner keeps every event per thread, so
`POST /api/copilotkit/agent/workbench/connect {threadId}` replays exactly what the browser was
sent. That recording was then (a) served back to headless Chrome via Playwright
`route.fulfill`, which reproduced the freeze, and (b) its `RAW` events — which carry the
original LangGraph events — fed through the adapter's `handleSingleEvent` offline, stock vs
patched.

Cause, in `@ag-ui/langgraph` 0.0.43's `on_chat_model_stream` handler: when a text message is
open and a chunk arrives with no text, it emits `TEXT_MESSAGE_END` and **`break`s**, discarding
that chunk — which, when the model writes a sentence and then calls a tool in the same reply,
is the chunk carrying the tool call's name and id. The later args chunks are dropped too (no
open tool call). The adapter then emits a late start from `on_tool_end`, naming it from the
ToolMessage — and tools that return a `Command` (`write_todos`, `task`) build that ToolMessage
without a `name`. Result: `TOOL_CALL_START` with `toolCallName: null`, which the client rejects,
ending the run on screen. For ordinary tools (`research`) the fallback *does* recover the name,
which is why the bug only bites on the plan/delegation step.

Not caused by the same-day upgrade: the adapter is unchanged (0.0.43 before and after) and
`langchain-anthropic`'s streaming code is identical between 1.7.0 and 1.7.4. It is latent, and
fires whenever the lead narrates before `write_todos`/`task`.

Fix: `web/src/lib/workbench-agent.ts`, a `LangGraphAgent` subclass used by `route.ts`. It closes
the open text message *before* the adapter sees a named tool-call chunk, and fills a missing
ToolMessage name from the `on_tool_end` event. Offline replay of the recorded run: stock emits
`write_todos` with a null name and 1 (late) args chunk; patched emits it named, streamed live in
78 chunks, zero nameless starts. And replaying the recording into Chrome with only that one name
corrected renders the whole run — plan, three `task`s, 47 `research` cards, the Workspace file.
`@ag-ui/client` became a direct dependency (for `EventType`), pinned to the same 0.0.59
CopilotKit uses. Re-check the subclass against the adapter source on every `@ag-ui/langgraph`
bump, and delete it once upstream fixes both paths.

Seen in the same recording, not the cause, left alone for now: one run relayed ~53 MB — 733
full `STATE_SNAPSHOT`s (~40 KB each, the whole message list every time) plus ~2,600 `RAW`
events. The browser handled it, but it is worth trimming if long runs start to feel sluggish.

**Local agent-side history is wiped by every compile (2026-09-26).** Mid-session, the agent server
suddenly had zero threads — including the user's earlier research runs. Cause: `mda dev` runs
LangGraph's in-memory server inside `agent/.mda/build/`, and its dev persistence
(`.langgraph_api/*.pckl`) lives in that directory. `mda build --help` says it plainly: *"The
directory is emptied before the build."* A compile check (`mda build .`) run while `mda dev` was
up emptied it under the live server — the persistence files were recreated at that minute, 6
bytes each. `mda dev` compiles into the same directory on start, so every agent restart does the
same. Two consequences: compile checks now use `mda build . --out <scratch>` (CLAUDE.md), and
per-user history is kept by the web app in its own SQLite store (`lib/server/history-store.ts`),
snapshotted from the agent server after every run — the agent server is read live when it still
has a thread, and the snapshot is the fallback. A deployed MDA agent has durable threads, so this
is a local-dev concern only.

## 5. Provider-agnostic model layer

The agent runs identically on Anthropic or OpenAI, switched by `LLM_PROVIDER`. MDA supports
this: `define_deep_agent(model=...)` accepts a constructed chat-model instance, and each
subagent takes its own `model` override.

### Tiering

| Role | anthropic | openai |
|---|---|---|
| Lead | `claude-opus-5` | `gpt-5.6-terra` |
| Worker | `claude-sonnet-5` | `gpt-5.6-terra` @ effort `low` |
| Cheap | `claude-haiku-4-5` | `gpt-5.6-luna` |

GPT-5.6 (Jul 2026): `sol` flagship · `terra` balanced ($2/$12 per MTok) · `luna` high-volume
($0.20/$1.20, ~1.05M context).

OpenAI's guidance is to use the **Responses API** for reasoning + tool-calling + multi-turn, so
that profile builds `ChatOpenAI(use_responses_api=True, reasoning={"effort": ...})`.
GPT-5.6 accepts `none|low|medium|high|xhigh|max`; `langchain-openai`'s docstring still lists
only the older four values, but it's a pass-through string.

### Prompting

Both vendors' 2026 guidance converges on the same headline: **modern models need less
scaffolding, and over-specification costs quality.** OpenAI measured stripping repeated
instructions as +10–15% eval score with 33–67% lower cost. Anthropic now explicitly
deprioritizes XML tags and heavy role prompting.

So the core prompt stays lean and only a thin per-provider delta differs:

| Dimension | Anthropic | OpenAI |
|---|---|---|
| Structure | Markdown headers; XML only for genuinely nested blocks | Numbered lists + section headers — XML *underperforms* on GPT-5.x |
| Reasoning | Adaptive thinking is built in — never request CoT in prose | `reasoning.effort` **parameter**, not prose |
| Autonomy | Naturally persistent; keep instructions minimal | Effort is the dial; add a `user_updates_spec` block to stop tool-call narration |
| Caching | Deep Agents prompt caching (`cache=`) | Automatic prefix caching; writes bill at 1.25× |

### Two findings from running it

**Async middleware is not optional.** A middleware that defines only
`wrap_model_call` raises `NotImplementedError` on every real request — the
LangGraph server invokes graphs asynchronously. It will still pass a synchronous
unit test, which makes this easy to ship broken. Implement `awrap_model_call`
too; `ProviderPromptMiddleware` shares one `_merge()` between both.

**The provider toggle cannot be an environment variable.** MDA's project `.env`
overrides the shell environment, so `LLM_PROVIDER=openai mda dev .` is silently
ignored — the startup line still reads `provider=anthropic`. More importantly,
the planned in-app provider toggle flips *while the server is already running*,
which no env var can express. It has to be per-run runtime context
(`context_schema` on `define_deep_agent`), with `LLM_PROVIDER` demoted to the
default. Deferred to the milestone that builds the toggle; `build_model()` is
already the single choke point that will need to read it.

### Cost control

A deep agent multiplies calls: planning loop × subagent fan-out × tool retries. Four levers:
per-role tiering, `reasoning_effort: low` on subagents, `ModelCallLimitMiddleware(run_limit=…)`
as a hard ceiling, and Deep Agents' summarization/context-offload (on by default).

Rather than hide this, the UI surfaces it — a Cost Meter and a provider toggle, so the same
question can be run both ways and compared.

---

## 6. Toolchain findings

Things that cost time and are not obvious from the docs:

- **Don't use `--prerelease allow`.** The private-beta docs said to install
  `managed-deepagents` with it — stable releases exist (0.6.1+), and uv applies the flag
  globally, so it silently resolved `langchain` to **1.4.0a2** and `pydantic` to **2.14.0b1**.
  Re-checked 2026-09-11: the current quickstart no longer mentions the flag, so the docs and
  this project now agree. Kept here because the failure mode is invisible — nothing errors,
  you just end up on alphas.
- **`mda` requires Python ≥ 3.10.** Under 3.9, uv resolves an ancient 0.4.0 which crashes on
  import (`str | SomeTypedDict` — PEP 604 at runtime).
- **Python 3.14 is fine.** The whole stack installs and imports clean; nothing is downgraded or
  excluded. Verified by real install, not just resolution.
- **uv ≥ 0.12 required.** Older uv has a stale Python index (0.8.22 only knew 3.14.0rc3) and
  lacks `[tool.uv] prerelease-package` for scoped prereleases.
- `mda init` scaffolds `requires-python = ">=3.11"` and pins `managed-deepagents==0.6.1`
  exactly; we relax both.
- **The docs run ahead of the CLI.** Verify flags against `mda --help` before trusting them.

**Version audit (re-checked 2026-09-26)**, against PyPI/npm rather than assumed — both
ecosystems ship weekly, so a version pinned a few weeks ago is worth re-verifying rather than
trusting. The MDA row below is the proof: 0.7.3 → 0.8.3 was **four releases in three days**
(0.8.0 and 0.8.1 on 09-24, 0.8.2 on 09-25, 0.8.3 on 09-26).

| Package | Installed | Latest | Note |
|---|---|---|---|
| `managed-deepagents` (CLI + project) | 0.8.3 | 0.8.3 | 0.7.3 → 0.8.3 on 09-26 — see below |
| `deepagents` | resolved by `mda dev` | 0.7.19 | not ours to pin — the compiled build asks for `>=0.7.5` |
| `copilotkit` (Python) | 0.1.96 | 0.1.96 | current |
| `langchain` | 1.4.2 | 1.4.2 | 1.4 is now stable — the old `1.4.0a2` warning below was about the alpha |
| `langchain-core` | 1.6.5 | 1.6.5 | current |
| `langchain-anthropic` | 1.7.4 | 1.7.4 | current |
| `langchain-openai` | 1.6.6 | 1.6.6 | current |
| `langgraph` | 1.2.12 | 1.2.12 | current |
| `pydantic` | 2.13.5 | 2.13.5 (stable) | **constrained** `<2.14.0a0` — see below |
| `@copilotkit/react-core` / `react-ui` / `runtime` | 1.74.0 | 1.74.0 | bumped from 1.73.0 on 09-26 |
| `@ag-ui/langgraph` | 0.0.43 | 0.0.43 | still exactly what `@copilotkit/runtime@1.74.0` depends on |
| `@ag-ui/client` | 0.0.59 | 1.0.0 | **deliberately behind** — CopilotKit 1.74 still depends on 0.0.59 |
| `next` | 16.3.6 | 16.3.6 | patch bump |
| `react` / `react-dom` | 19.3.0 | 19.3.0 | minor bump; every peer range (`^19`) accepts it |
| `typescript` | 5.9.3 | 7.0.2 | **deliberately behind** — 7 is the native-compiler major; not verified with Next 16's build-time typecheck |
| `@types/node` | 24.x | 26.x | tracks the installed Node major (v24), not the newest types |

The `@ag-ui/langgraph` / `@ag-ui/client` rule is "match CopilotKit, not npm latest": bumping
either past what `@copilotkit/runtime` itself depends on reintroduces the duplicate-
`@ag-ui/client` crash in §4d. Verified by reading `@copilotkit/runtime@1.74.0`'s own
dependencies, and after install `npm ls` shows a single `@ag-ui/client@0.0.59`.

**CopilotKit 1.73 → 1.74 (2026-09-26).** Nothing breaking. Relevant fixes: per-message state
cloning removed from react-core (long runs re-render less), and the realtime gateway no longer
refreshes credentials for a socket that never opened. The gateway's **60 s reconnect ceiling is
unchanged** (`reconnectGiveUpMs ?? 60_000`, still only on the internal
`channels-intelligence/realtime-gateway` module, not on any public config) — so Local stays
the default runner (§4d). `INTERRUPT_EVENT_NAME` is still `"on_interrupt"`, which the Milestone 6
approval card depends on.

**MDA 0.7.3 → 0.8.3 (2026-09-26).** The package repo is private, so this was read off a diff
of the two published wheels. What touches us:

- **`define_memory(scope="agent")` is rejected by the 0.8 CLI** at build time ("Use named
  `agent` and `user` options with layer constructors") even though the Python function still
  accepts `scope=` as legacy. `memory.py` now uses `define_memory(agent=MemoryLayer())`. This is
  the one change that would have broken `mda dev` on restart.
- **Per-user memory exists now**: `define_memory(user=MemoryLayer(allow=...))` mounts
  `/memories/user/` scoped to the caller. It is only granted to a "trusted person" — a
  verified Studio user or a managed Slack DM — which a browser reaching `mda dev` through
  CopilotKit is not. Not enabled; revisit alongside `identity.py` in Milestone 8.
- `define_deep_agent`'s author-set fields are **unchanged**; 0.8 only adds `**kwargs` so that
  passing a runtime-owned key (`backend`, `store`, `memory`, …) raises a message naming where it
  belongs instead of a bare `TypeError`.
- New but unused: an `HttpChannel` (so Slack is no longer the only channel type), sandbox
  egress `proxy_config` with `bearer()`/`basic()` connection headers, `ManagedRunContext` /
  `ChannelContext`. `connectors.mcp` is gone as announced — we never used it.

Verified without spending API credits: `mda build .` compiles, `mda dev` registers
`workbench`, the compiled graph lists every middleware node (incl. `HumanInTheLoopMiddleware`
and `CopilotKitMiddleware`), `tsc` + `next build` clean, `verify-toggle.mjs` PASS.

**The pydantic beta that came in sideways.** A plain `uv lock --upgrade` resolved pydantic to
**2.14.0b2** with no requirement anywhere naming a pre-release. Traced with `uv lock -vv`:
`copilotkit` (Python) requires `pydantic-core>=2.35` *directly*; uv picks the newest
stable-*numbered* core, 2.49.0, which is only paired with pydantic 2.14.0b2, so uv's default
"if necessary" pre-release fallback kicks in for pydantic. The obvious fix,
`[tool.uv] prerelease = "disallow"`, was tried and **broke `mda dev`**: mda runs
`uv run --with langgraph-cli[inmem]` inside the project, so the setting applies there too, and
langgraph-api needs `opentelemetry-semantic-conventions`, which only ever publishes `0.NNbN`
versions. The fix is scoped instead — `constraint-dependencies = ["pydantic<2.14.0a0"]` in
`agent/pyproject.toml` — and must be **lifted once pydantic 2.14.0 final ships**, or it will
hold us back from it.

**0.7.3 (2026-09-21).** Patch bump, nothing breaking. The one line that touches us:
*"Remove MDA's default recursion limit"* — the managed runtime no longer imposes its own
graph recursion ceiling, so `ModelCallLimitMiddleware(run_limit=60)` in `middleware/guards.py`
is now the **only** ceiling on a run. That is the arrangement we want (an explicit, cost-shaped
limit rather than an opaque platform default), but it does mean that guard is now load-bearing
— don't remove it. The rest is CLI/deploy ergonomics that lands in Milestone 8. Verified
without spending any API credits: `import agent` clean, `mda dev` compiles and registers
`workbench`.

**On the 0.6.1 → 0.7.2 bump.** `uv tool install` pins at install time and never
self-upgrades, and `uv.lock` governs the project venv regardless of a `>=` constraint — so
both surfaces sat on 0.6.1 while three stable releases shipped (0.7.0 Sep 8, 0.7.1 and 0.7.2
Sep 10). Upgrade both with `uv tool upgrade managed-deepagents` and
`uv sync --upgrade-package managed-deepagents`. What the changelog flags as breaking:
`runtime.identity` → `serverInfo` with *no compatibility shim*, and the MCP rename above.
Neither touches us — we import only `define_deep_agent`, `define_memory`, `define_identity`,
`auth`, and `define_sandbox`. 0.7.2's "require local provider keys for direct models" lands on
our `build_model()` instances but was a non-event, since the keys are in `.env` already.
Verified after the bump: `import agent` clean, `mda dev` compiles and registers `workbench`,
`verify-toggle.mjs` passes, and a live research + `render_chart` run completed with zero
console errors.

**Known drift, deliberately not fixed:** the interpreter is **3.14.0rc3**, not stable —
a leftover from the uv 0.8.22 stale-index era (§6 above), which uv now warns about on every
command. `cpython-3.14.7` is available via `uv python install 3.14`. Docs elsewhere that say
"Python 3.14 (latest stable)" are, strictly, describing an RC.

---

## 7. MDA constraints that shape the design

From MDA's authoring contract — these are not preferences, they're hard limits:

- **Never set** `backend`, `store`, `checkpointer`, `memory`, `skills`, or `system_prompt` in
  `define_deep_agent`. The managed runtime injects them. (This is also why the code cannot be
  shared with an OSS `create_deep_agent` build.)
- **MCP: removed in 0.6.x, reinstated in 0.7.0** as `define_mcp(...)` taking a `servers` map
  (`connectors.mcp` is a deprecated alias, removed in 0.8.0). Verified present on 0.7.2 by
  introspecting the installed package. We stay on authored tools only — now a design choice,
  not a platform constraint. A good reminder that on a public-beta SDK a "hard constraint"
  has a shelf life: re-verify against the installed package, not against notes.
- `name=` is required and must be a static identifier string.
- Schedule declarations must be **static literals** — the compiler extracts them without
  executing your code.
- Agent memory is **deployment-shared**: one `/memories/agent/` tree for all callers. Treat
  its contents as untrusted input; never let it grant authority. (0.8 added a per-caller
  `user` layer, but only for trusted identities — see the 0.8.3 notes in §6.)
- US LangSmith Cloud only. One agent entry per project. (Slack was the only channel through
  0.7; 0.8 exports an `HttpChannel` too — not evaluated.)
- Build archive capped at 200 MB.
- Restart `mda dev` after adding `memory.py`, `identity.py`, `schedules/`, or `channels/` —
  these are discovered at compile time, not by hot reload.
