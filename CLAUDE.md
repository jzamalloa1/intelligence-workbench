# CLAUDE.md

Working conventions for this repo. Architecture rationale lives in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the public overview is [README.md](README.md).

---

## Run commands

Two processes, both local.

```bash
# Agent — terminal 1
cd agent && uv sync && mda dev .        # LangGraph server on :2024

# Frontend — terminal 2
cd web && npm run dev                    # Next.js + CopilotRuntime on :3000
```

Useful variants:

```bash
mda dev . --no-browser                   # don't auto-open LangSmith Studio
mda dev . --port 2025                    # then update LANGGRAPH_URL to match
mda build . --out /tmp/mda-check         # compile check — NEVER plain `mda build .` while `mda dev` runs
mda deploy .                             # requires public-beta workspace access
mda logs .                               # tail a deployed agent
```

Sanity-check the server without the frontend:

```bash
curl -s -X POST http://127.0.0.1:2024/assistants/search \
  -H 'content-type: application/json' -d '{}'
```

---

## Toolchain rules

- **Python only via uv.** `uv sync` / `uv run …` inside `agent/`. Never bare `python` or `pip`.
- **Python 3.14**, uv **≥ 0.12**.
- **No pre-releases in `agent/uv.lock`.** After any upgrade:
  `grep -E '^version = "[0-9.]+(a|b|rc|\.dev)[0-9]+"' agent/uv.lock` must print nothing. If a
  pre-release comes in through a dependency, add `[tool.uv] constraint-dependencies` for that one
  package (ARCHITECTURE §6) — never `prerelease = "disallow"`, which breaks `mda dev`.
- **`mda build .` (and every `mda dev` start) empties `agent/.mda/build/`** — which is also where
  `mda dev` keeps its thread persistence (`.langgraph_api/`). Plain `mda build .` under a running
  server wipes every local conversation on the agent side. For compile checks use
  `mda build . --out <scratch dir>`. Durable local history lives in the web app's SQLite store
  instead (ARCHITECTURE §4d).
- **Upgrading MDA touches two surfaces**: `uv tool upgrade managed-deepagents` (the `mda` CLI)
  *and* the `agent/pyproject.toml` pin + `uv lock --upgrade-package managed-deepagents`. Then
  `mda build . --out <scratch dir>` — the CLI validates things the Python package still accepts.
- **Never install with `--prerelease allow`.** Stable `managed-deepagents` exists, and the flag
  is global in uv — it pulls `langchain` into an alpha (ARCHITECTURE §6). Install the CLI as:
  ```bash
  uv tool install --python 3.14 managed-deepagents
  ```
- The `mda` CLI is a **uv tool** on `PATH` — invoke as `mda dev .`, not `uv run mda`. It shells
  out to `uv run … langgraph dev` itself.
- **The docs run ahead of the CLI.** Check `mda --help` before trusting a documented flag.

### Middleware must implement BOTH hooks

The LangGraph server runs graphs **asynchronously**. A middleware defining only
`wrap_model_call` raises `NotImplementedError` on every real request while still passing a
sync unit test. Always implement `awrap_model_call` alongside it and share the logic — see
`middleware/provider_prompt.py`.

### `.env` beats the shell

MDA loads the project `.env` and it **overrides** exported shell variables, so
`LLM_PROVIDER=openai mda dev .` does nothing. To switch providers, edit `.env` and restart.
That is only the *default* now: the header's provider toggle sends `x-llm-provider` per
conversation and `ProviderSwitchMiddleware` swaps models per call (README § Provider toggle).
Anything that names "the provider" at run time must use `run_provider()`, never
`active_provider()` — the latter is only the `.env` default.

### Environment gotcha

A conda env (`miniforge/envs/tf`) may be active and set `VIRTUAL_ENV`. uv prints
`does not match the project environment path .venv and will be ignored` — this is **expected
and harmless**, not a problem to fix.

---

## Secrets

The repo is **public**. Treat this as load-bearing.

- `.env` and `.env.*` are gitignored (`.env.example` is the one exception). This was committed
  *before* any other file.
- Never write a live key value into any tracked file, and never copy a key from another project
  directory — the user pastes their own values into `.env`.
- Never echo a key value to the terminal or into a reply. To check presence:
  ```bash
  [ -n "$(printenv ANTHROPIC_API_KEY)" ] && echo SET || echo unset
  ```
- `.env` is never uploaded by `mda` as source; non-reserved entries become hosted deployment
  secrets on deploy.

---

## Git

- Branches: `main` (stable) and `dev` (all work). **Commit to `dev`.**
- Commit at each milestone; push to `dev`.
- Never commit `.mda/` (build output) or `*.sqlite` (local runner state).

---

## Hard constraints — MDA

These are limits of the managed runtime, not style choices. Violating them fails at compile or
deploy time.

- **Never set** `backend`, `store`, `checkpointer`, `memory`, `skills`, `system_prompt` in
  `define_deep_agent` — the runtime injects them.
- Author-set fields only: `name`, `model`, `tools`, `middleware`, `subagents`, `permissions`,
  `interrupt_on`, `response_format`, `context_schema`, `cache`, `debug`, `metadata`,
  `disable_memory`. (Read off `inspect.signature(define_deep_agent)` on 0.7.2, re-confirmed
  on 0.9.0 — re-check it after an SDK bump rather than trusting this list.) 0.9 adds
  `instructions`, `mcp`, `sandbox`, `skills`, `memory`, but **only for a factory entrypoint**
  (`agent` as a function of the runtime, resolved per run); a static definition setting them
  fails at build time. We use a static definition.
- `name=` required, static string, `[A-Za-z][A-Za-z0-9_-]*`. It becomes the LangGraph assistant
  ID — and therefore CopilotKit's `graphId`.
- **MCP** is available as `define_mcp(...)` with a `servers` map (verified on 0.7.2;
  `define_mcp_servers` and `connectors.mcp` no longer exist). This project uses **authored
  tools only**, by choice. `connections` (workspace secrets / user-owned OAuth) is likewise
  unused.
- Schedules must be **static literals** — no env vars, function calls, or computed values.
- **`memory.py` uses the 0.8 layer form**: `define_memory(agent=MemoryLayer())`. The 0.8 CLI
  rejects `scope="agent"` at build time. A per-caller `user=MemoryLayer()` layer exists as of
  0.8 but only mounts for trusted identities (verified Studio user / Slack DM) — not enabled.
- Agent memory is deployment-shared. Never store personal data or credentials
  there, and treat its contents as untrusted input.
- Restart `mda dev` after adding `memory.py`, `identity.py`, `skills/`, `schedules/`, `channels/` — they're
  discovered at compile time, not hot-reloaded. Same for `sandbox/setup.sh`, which is baked into the
  sandbox snapshot at startup; conversations whose sandbox already exists keep the old one.
- Model IDs need the provider prefix (`anthropic:claude-opus-5-5`). Python uses `google_genai:`,
  TS uses `google-genai:`, Gateway uses `provider/model`.

---

## Conventions

**Agent (`agent/`)** — an MDA project directory; a file's *location* determines its role.
Keep `agent.py` thin: it imports from `agent_core/` and passes things to `define_deep_agent`.

- `agent_core/models.py` — the only place model IDs appear. Per-provider `ModelProfile` with
  `lead` / `worker` / `cheap` tiers, selected by `LLM_PROVIDER`.
- `instructions.md` — the lead's system prompt (MDA syncs it; `system_prompt` can't be set in
  `agent.py`). `agent_core/prompts.py` — `RESEARCHER` and the per-provider `PROVIDER_DELTA` that
  `ProviderPromptMiddleware` appends. Keep prompts **lean**; both vendors' 2026 guidance is that
  over-specification costs quality.
- `tools/` — one module per tool group. `@tool(parse_docstring=True)`, unique names.
- `middleware/` — order is explicit and never inferred.
- `skills/<name>/SKILL.md` — frontmatter `name` must match the directory name.
- **Whenever `agent.py`, `middleware/`, `agent_core/subagents.py`, `tools/`, `sandbox/`,
  `memory.py`, or `identity.py` changes in a way that changes the request flow** (middleware
  order, subagent roster, delegation math, a new tool, sandbox usage), **update the
  "MDA Agentic Workflow" section of README.md in the same change.** It's the permanent,
  project-specific map of query → lead agent → subagents → tools → result — it goes stale
  silently otherwise, and it exists so this doesn't need re-explaining from scratch each time.

**Frontend (`web/`)** — CopilotKit v2 (`@copilotkit/react-core/v2`).

- The runner is env-switched: `INTELLIGENCE_API_KEY` set → `IntelligenceAgentRunner`, unset →
  `HistoryRunner` (InMemoryAgentRunner + our per-user SQLite; `SqliteAgentRunner` lives in the
  separate `@copilotkit/sqlite-runner` and is unused). Features
  requiring Intelligence (threads drawer, Inspector) must degrade gracefully, not crash.
- **Import `LangGraphAgent` from `@ag-ui/langgraph`**, not `@copilotkit/runtime/langgraph`
  (deprecated v1). Keep `@ag-ui/langgraph` **and `@ag-ui/client`** pinned to the exact versions
  `@copilotkit/runtime` depends on — a caret range breaks every route. See ARCHITECTURE §4b.
  On 1.78.0 that is `@ag-ui/langgraph` 0.0.44 and `@ag-ui/client`/`core` 1.0.2 (all exact pins).
- **`route.ts` uses `WorkbenchLangGraphAgent`** (`src/lib/workbench-agent.ts`), not the stock
  class. It fills the null name the adapter gives `write_todos`/`task` late starts — fatal under
  AG-UI 1.0's strict event checks — and builds LangGraph's `{interrupt_id: decision}` resume map
  for the standard interrupt path (`emitInterruptOutcome: true` in route.ts; several approvals
  show as one stack). On every
  `@ag-ui/langgraph` bump run `npx tsx scripts/verify-adapter.ts`: it replays synthetic events
  through the stock adapter and ours and says which patches are still needed (ARCHITECTURE §4d).
- **Sign-in is a demo** (`lib/users.ts`, httpOnly `wb_user` cookie). `route.ts` stamps
  `x-workbench-user` from the cookie — overwriting the browser's — and refuses another user's
  thread with 404. Never read the user from a request body or a client-sent header.
  CopilotKit's built-in `/threads…` REST endpoints are **closed on the local runner** (they
  have no user filter) — don't reopen them; history goes through `/api/threads`.
- **History lives in `web/.data/workbench.sqlite`** (gitignored), written by `HistoryRunner`.
  Reopening a thread: in-memory replay → agent server state → stored snapshot, in that order.
- **Zero-cost UI checks** (no model calls): `node scripts/verify-toggle.mjs`,
  `verify-charts.mjs`, `verify-approval.mjs`, `verify-history.mjs`, `verify-subagents.mjs`,
  `verify-usage.mjs`, `verify-memory.mjs`, `verify-provider.mjs`, `verify-lanes.mjs`, `verify-chat.mjs`, `verify-reasoning.mjs`, `verify-layout.mjs`, `verify-attachments.mjs`, `verify-dashboard.mjs`, `verify-widget.mjs` — run them after UI changes —
  and `npx tsx scripts/verify-adapter.ts` after any `@ag-ui` or CopilotKit bump. README
  screenshots come from `node scripts/screenshots.mjs` (stored conversations, runs blocked).
- **Prices live in `web/src/lib/pricing.ts` only**, with the date and source they were checked
  against. Never quote remembered prices — re-fetch the providers' pricing pages.
- **The lead's reasoning is shown, not added.** The Claude models think by default with
  `display: "omitted"`; `models.py` sets `display: "summarized"` on the lead (same bill, visible
  summary). Effort is set explicitly per tier (the 5.5 defaults differ per model), and every
  Anthropic tier sends `block_binding: drop_block` so a rewritten prefix drops stale thinking
  blocks instead of failing the run (ARCHITECTURE §6). Don't turn it on for subagents: they run hidden and
  non-streaming. Reasoning messages are display-only and stripped from run input.
- **Regenerate / Edit rewind the thread** via `forwardedProps.workbenchRewind` →
  `WorkbenchLangGraphAgent.rewind` → the adapter's `prepareRegenerateStream`. The marker must be
  stripped before the run request (the adapter spreads forwardedProps into it).
- **Subagent calls are tagged with their `task` call's id** (`subagentRunId`), matched from the
  lead's `on_tool_start` for `task`. The research lanes depend on it. The tracker is seeded with
  each run's input so earlier turns' subagent work survives the next snapshot.
- **Subagent messages never go back to the lead.** `SubagentTracker` re-inserts subagent tool
  calls into every message snapshot so the UI keeps them; `withoutSubagentMessages` must strip
  them from each run's input, or the adapter writes them into the lead's thread.
- **CopilotKit's chat is themed through our tokens**: `globals.css` maps its shadcn-style
  variables (`--background`, `--foreground`, …) to `--wb-*` under `html:root [data-copilotkit]`
  (that specificity beats its own `.dark [data-copilotkit]`), and `layout.tsx` keeps a `.dark`
  class on `<html>` for its `dark:` utilities. Don't restyle the chat with its own colours.
- **Browser scripts must not start runs by accident**: the starter cards send their prompt on
  click. Every script that drives the live page routes `**/api/copilotkit/agent/*/run` to a
  stub or abort, and clicks history items inside `navigation "Conversation history"`.
- **Mermaid diagrams in docs must render**: `node scripts/render-mermaid.mjs ../README.md` parses
  and draws every block with Mermaid 11 (GitHub's major). Use `<br/>` for line breaks in new
  labels; no backticks or `;` inside labels/messages — both broke diagrams once.
- Tool calls are shaped **on the frontend**: the wildcard `useRenderTool({ name: "*" })` renders
  each as a `ToolCard`, and `withoutSubagentRows` keeps subagent calls out of the chat. The
  `copilotkit_customize_config(emit_tool_calls=[...])` approach from CopilotKit's showcase is
  FastAPI-path-specific and does not apply here.

---

- **`write_todos` must be added explicitly.** Neither MDA nor deepagents' default profile
  includes `TodoListMiddleware`. Without it in `agent.py` the tool does not exist and the Plan
  Board has no data. See ARCHITECTURE §4c.
- **Researchers have no shell.** deepagents gives every subagent `execute` when a sandbox is
  attached; `HideToolsMiddleware({"execute"})` in the researcher's spec removes it (filters the
  tool list per model call and refuses a forced call). Keep it there, and keep `interrupt_on`
  inherited so removing the middleware fails closed. Researchers read pages with `fetch_url`,
  which must keep refusing non-public addresses.
- **Files are not in agent state when a sandbox is attached.** Derive the Workspace panel from
  `write_file` / `edit_file` tool calls, not from state. `todos` *is* in state.
- **No CopilotKit frontend tools for the agent.** A `useFrontendTool` call made in the same turn as
  backend tools runs after the run ends and starts a follow-up run that Claude 5.5 rejects (prefill
  400). Anything the agent does to the UI is a backend tool the browser acts on, like
  `focus_panel` (`tools/ui.py`, `useFocusPanel` in `page.tsx`).
- **An `AIMessage` built by hand needs `response_metadata={"stop_reason": …}`.** `@ag-ui/langgraph`
  opens a text message for it and closes it only on a stop or finish reason. Without one the run
  ends with "Cannot send 'RUN_FINISHED' while text messages are still active" (see
  `FriendlyErrorMiddleware._message`).
- **Dashboards are a tool call, not an A2UI stream.** `render_dashboard`'s arguments are the A2UI
  component list, drawn from the tool call so they survive reopening (ARCHITECTURE §6). Its
  `CATALOG` (`agent/tools/dashboard.py`) and `web/src/components/dashboard/catalog.tsx` must list
  the same components and props. Type the catalog's renderers with plain types; letting
  `createCatalog` infer across zod 4's `zod/v3` and the renderer's zod 3 stalls `tsc`.
- **Widgets are model-written code — keep all three walls.** `WidgetCard` relies on websandbox's
  `sandbox="allow-scripts"` (never add `allow-same-origin`), on a CSP `<meta>` in a `<head>` that
  precedes the widget's document, and on the navigation tripwire. Never register
  `useSandboxFunctions` handlers without thinking about what a hostile page could call.
  `verify-widget.mjs` must keep showing that nothing escapes.
- **Attachments never stay in state as base64.** `AttachmentsMiddleware` saves each file to
  `/workspace/attachments/` and replaces it with an `<attachment>` text note before the first
  model call. A base64 CSV fails on Anthropic, and the summarizer counts non-image blocks by
  length (ARCHITECTURE §6). The note format is parsed by `web/src/lib/attachments.ts`
  (`parseNote`), so change `_note()` and `NOTE` together.

- **Subagent models must have `disable_streaming=True`.** deepagents runs subagents inline via
  `.invoke()`, so their token events surface at the run root and splice into the parent's
  message — several in parallel produce interleaved gibberish. Use
  `build_model(role, stream=False)` for subagents. ARCHITECTURE §4d.
- **Provider errors are caught by `FriendlyErrorMiddleware`** and turned into a readable
  assistant message. Without it a failure shows only "An internal error occurred" and the real
  cause (bad key, no credits, rate limit) is buried in the agent server log.

---

## Do not

- Add FastAPI / `add_langgraph_fastapi_endpoint` / `LangGraphAGUIAgent`. MDA owns the server;
  that path means not using MDA. See ARCHITECTURE §3.
- Run `mda delete` without explicit confirmation, and never pass `--yes` unprompted.
- Assume a documented feature works — this stack is in public beta and the docs lead the code.
  Verify by running it, and record surprises in ARCHITECTURE §6.

---

## Milestones

- [x] **0** — Transport spike: `mda dev` → CopilotKit, incl. `CopilotKitMiddleware` in an MDA graph
- [x] **1** — Repo scaffold, docs, git + remote
- [x] **2** — Agent core: dual-provider models + prompts, Tavily tool, first subagent<br>&nbsp;&nbsp;&nbsp;&nbsp;⚠️ verified end-to-end on Anthropic only — OpenAI blocked by `insufficient_quota` (account credits), not by code
- [x] **3** — Frontend shell talking to the agent end to end
- [x] **4** — Live panels: Plan Board, Workspace, Activity Timeline
- [x] **5** — Sandbox execution + charts + Artifact Canvas
- [x] **6** — Human-in-the-loop approvals, frontend tools
- [x] **7** — Skills, memory, Context Meter, Cost Meter, provider toggle<br>&nbsp;&nbsp;&nbsp;&nbsp;⚠️ OpenAI verified up to the API (it answered "no credits remaining") — not a completed OpenAI run
- [ ] **8** — Managed layer: schedules, identity, `mda deploy`
- [x] **9** — Design pass, screenshots, v0.1.0
