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

We select the runner by env var so the repo works either way:

| `INTELLIGENCE_API_KEY` | Runner | Tradeoff |
|---|---|---|
| set | `IntelligenceAgentRunner` | Threads drawer + Inspector; history stored by CopilotKit |
| unset | `SqliteAgentRunner` | Durable locally; nothing leaves the machine |

Note the redundancy: MDA already persists threads via its LangGraph checkpointer, but
CopilotKit's threads drawer reads Intelligence, not MDA. Two layers, not a conflict.

---

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

### Cost control

A deep agent multiplies calls: planning loop × subagent fan-out × tool retries. Four levers:
per-role tiering, `reasoning_effort: low` on subagents, `ModelCallLimitMiddleware(run_limit=…)`
as a hard ceiling, and Deep Agents' summarization/context-offload (on by default).

Rather than hide this, the UI surfaces it — a Cost Meter and a provider toggle, so the same
question can be run both ways and compared.

---

## 6. Toolchain findings

Things that cost time and are not obvious from the docs:

- **Don't use `--prerelease allow`.** LangChain's docs say to install `managed-deepagents` with
  it. That is stale private-beta guidance — stable releases exist (0.6.1+). Worse, uv applies
  the flag globally, so it silently resolved `langchain` to **1.4.0a2** and `pydantic` to
  **2.14.0b1**.
- **`mda` requires Python ≥ 3.10.** Under 3.9, uv resolves an ancient 0.4.0 which crashes on
  import (`str | SomeTypedDict` — PEP 604 at runtime).
- **Python 3.14 is fine.** The whole stack installs and imports clean; nothing is downgraded or
  excluded. Verified by real install, not just resolution.
- **uv ≥ 0.12 required.** Older uv has a stale Python index (0.8.22 only knew 3.14.0rc3) and
  lacks `[tool.uv] prerelease-package` for scoped prereleases.
- `mda init` scaffolds `requires-python = ">=3.11"` and pins `managed-deepagents==0.6.1`
  exactly; we relax both.
- **The docs run ahead of the CLI.** Verify flags against `mda --help` before trusting them.

---

## 7. MDA constraints that shape the design

From MDA's authoring contract — these are not preferences, they're hard limits:

- **Never set** `backend`, `store`, `checkpointer`, `memory`, `skills`, or `system_prompt` in
  `define_deep_agent`. The managed runtime injects them. (This is also why the code cannot be
  shared with an OSS `create_deep_agent` build.)
- **No MCP connectors.** `define_mcp_servers` was removed. Authored tools only.
- `name=` is required and must be a static identifier string.
- Schedule declarations must be **static literals** — the compiler extracts them without
  executing your code.
- Memory is **deployment-shared**: one `/memories/agent/` tree for all callers, no per-user
  memory. Treat its contents as untrusted input; never let it grant authority.
- Slack is the only channel. US LangSmith Cloud only. One agent entry per project.
- Build archive capped at 200 MB.
- Restart `mda dev` after adding `memory.py`, `identity.py`, `schedules/`, or `channels/` —
  these are discovered at compile time, not by hot reload.
