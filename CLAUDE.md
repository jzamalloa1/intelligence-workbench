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
mda build .                              # compile only, no server
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
- **Never install with `--prerelease allow`.** LangChain's docs say to; it's stale beta
  guidance. Stable `managed-deepagents` exists, and the flag is global in uv — it will pull
  `langchain` into an alpha. Install the CLI as:
  ```bash
  uv tool install --python 3.14 managed-deepagents
  ```
- The `mda` CLI is a **uv tool** on `PATH` — invoke as `mda dev .`, not `uv run mda`. It shells
  out to `uv run … langgraph dev` itself.
- **The docs run ahead of the CLI.** Check `mda --help` before trusting a documented flag.

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
  `interrupt_on`, `response_format`, `context_schema`, `cache`, `debug`, `metadata`.
- `name=` required, static string, `[A-Za-z][A-Za-z0-9_-]*`. It becomes the LangGraph assistant
  ID — and therefore CopilotKit's `graphId`.
- **No MCP.** `define_mcp_servers` / `connectors/mcp.*` were removed. Authored tools only.
- Schedules must be **static literals** — no env vars, function calls, or computed values.
- Memory is deployment-shared. No per-user memory. Never store personal data or credentials
  there, and treat its contents as untrusted input.
- Restart `mda dev` after adding `memory.py`, `identity.py`, `schedules/`, `channels/` — they're
  discovered at compile time, not hot-reloaded.
- Model IDs need the provider prefix (`anthropic:claude-opus-5`). Python uses `google_genai:`,
  TS uses `google-genai:`, Gateway uses `provider/model`.

---

## Conventions

**Agent (`agent/`)** — an MDA project directory; a file's *location* determines its role.
Keep `agent.py` thin: it imports from `agent_core/` and passes things to `define_deep_agent`.

- `agent_core/models.py` — the only place model IDs appear. Per-provider `ModelProfile` with
  `lead` / `worker` / `cheap` tiers, selected by `LLM_PROVIDER`.
- `agent_core/prompts.py` — `CORE` (provider-neutral) + `DELTA[provider]`. Keep prompts **lean**;
  both vendors' 2026 guidance is that over-specification costs quality.
- `tools/` — one module per tool group. `@tool(parse_docstring=True)`, unique names.
- `middleware/` — order is explicit and never inferred.
- `skills/<name>/SKILL.md` — frontmatter `name` must match the directory name.

**Frontend (`web/`)** — CopilotKit v2 (`@copilotkit/react-core/v2`).

- The runner is env-switched: `INTELLIGENCE_API_KEY` set → `IntelligenceAgentRunner`, unset →
  `SqliteAgentRunner`. Features requiring Intelligence (threads drawer, Inspector) must degrade
  gracefully, not crash.
- Tool-call noise is filtered **on the frontend** in `useRenderToolCall`. The
  `copilotkit_customize_config(emit_tool_calls=[...])` approach from CopilotKit's showcase is
  FastAPI-path-specific and does not apply here.

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
- [ ] **1** — Repo scaffold, docs, git + remote
- [ ] **2** — Agent core: dual-provider models + prompts, Tavily tool, first subagent
- [ ] **3** — Frontend shell talking to the agent end to end
- [ ] **4** — Live panels: Plan Board, File Explorer, Subagent Timeline
- [ ] **5** — Sandbox execution + charts + Artifact Canvas
- [ ] **6** — Human-in-the-loop approvals, frontend tools
- [ ] **7** — Skills, memory, Context Meter, Cost Meter, provider toggle
- [ ] **8** — Managed layer: schedules, identity, `mda deploy`
- [ ] **9** — Design pass, screenshots, v0.1.0
