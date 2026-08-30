# Intelligence Workbench

A research-and-analysis console built on **LangChain Managed Deep Agents** (backend) and
**CopilotKit** (frontend) — an agentic system you interact with, built to exercise the full
capability surface of both stacks.

Give it a topic. It plans, delegates to a fleet of subagents, researches the web, runs Python
in a sandbox to compute and chart, writes artifacts to a virtual filesystem, and renders all of
it live — plan board, subagent timeline, file explorer, artifact canvas — while pausing for your
approval on anything expensive.

> **Status:** in active development. See [Roadmap](#roadmap).

---

## What runs where

Everything runs on your machine. There is no deploy-to-CopilotKit step — `CopilotRuntime` is an
npm library that runs *inside* the Next.js API route, not a hosted service.

```
YOUR MACHINE
┌──────────────────────────────────────────────────────────┐
│  browser → localhost:3000                                │
│                                                           │
│  ┌── Next.js (:3000) ─── npm run dev ─────────────────┐  │
│  │  React UI · CopilotChat · generative UI panels     │  │
│  │  CopilotRuntime  (library, in app/api/copilotkit)  │  │
│  └───────────────────────┬────────────────────────────┘  │
│                          │ LangGraph Server API           │
│  ┌── mda dev (:2024) ────▼────────────────────────────┐  │
│  │  MDA agent · tools · subagents · skills · sandbox  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
              │ outbound websocket — OPTIONAL
              ▼
   CopilotKit Intelligence (durable threads + Inspector)
```

Model provider keys stay in your processes and never reach CopilotKit.

**CopilotKit Intelligence is optional.** It's a persistence/observability layer — your agent
never executes there. The runner is chosen by env var:

| `INTELLIGENCE_API_KEY` | Runner | Result |
|---|---|---|
| set | `IntelligenceAgentRunner` | Durable threads, threads drawer, Inspector. History stored by CopilotKit. |
| unset | `SqliteAgentRunner` | Durable locally. Nothing leaves your machine. Drawer/Inspector hidden. |

---

## What it demonstrates

**Deep Agents**

| Capability | Where you see it |
|---|---|
| `write_todos` planning | Plan Board — live checklist, animates as todos flip status |
| Subagents | Subagent Timeline — swimlanes, nested tool calls |
| Virtual filesystem | File Explorer — tree, viewer, diff on `edit_file` |
| Skills (progressive disclosure) | Skills Rail — which `SKILL.md` activated, and when |
| Sandbox code execution | Console panel — streamed stdout, then the chart it produced |
| Human-in-the-loop (`interrupt_on`) | Approval Card — approve / edit / reject inline |
| Summarization + context offload | Context Meter — token gauge, marks each compaction |
| Durable memory (`AGENTS.md`) | Memory panel — what it carried across sessions |
| Managed schedules (cron) | Daily Brief card |

**CopilotKit**

`CopilotChat` · `useRenderToolCall` generative UI · `useFrontendTool` (the agent drives the app —
opens files, switches panels) · `useHumanInTheLoop` · shared state via `useAgent` ·
threads drawer · suggestions · Inspector.

**Provider-agnostic.** The same agent runs on Anthropic or OpenAI, switched by one env var, with
per-provider model tiering *and* per-provider prompt variants. A Cost Meter and a provider
toggle let you run the same question both ways and compare cost, latency, and output.

| Role | `LLM_PROVIDER=anthropic` | `LLM_PROVIDER=openai` |
|---|---|---|
| Lead (plan/synthesize) | `claude-opus-5` | `gpt-5.6-terra` |
| Worker (research/analyze) | `claude-sonnet-5` | `gpt-5.6-terra` @ effort `low` |
| Cheap (extract/classify) | `claude-haiku-4-5` | `gpt-5.6-luna` |

---

## Quickstart

**Prerequisites:** Python 3.14, Node 20+, [uv](https://docs.astral.sh/uv/) ≥ 0.12.

```bash
# 1. Install the Managed Deep Agents CLI (Python 3.10+ required)
uv tool install --python 3.14 managed-deepagents

# 2. Configure
cp .env.example .env      # then fill in your keys

# 3. Run the agent  (terminal 1)
cd agent && uv sync && mda dev .

# 4. Run the frontend  (terminal 2)
cd web && npm install && npm run dev
```

Open <http://localhost:3000>.

> **Note:** LangChain's docs tell you to install `managed-deepagents` with `--prerelease allow`.
> That is stale private-beta guidance — stable releases exist, and the flag will silently pull
> `langchain` into an alpha. Don't use it.

---

## Roadmap

- [x] **0** — Transport spike: prove `mda dev` → CopilotKit
- [x] **1** — Repo scaffold, docs, git + remote
- [x] **2** — Agent core: dual-provider models + prompts, Tavily tool, first subagent<br>&nbsp;&nbsp;&nbsp;&nbsp;⚠️ verified end-to-end on Anthropic only — OpenAI blocked by `insufficient_quota` (account credits), not by code
- [x] **3** — Frontend shell talking to the agent end to end
- [ ] **4** — Live panels: Plan Board, File Explorer, Subagent Timeline
- [ ] **5** — Sandbox execution + charts + Artifact Canvas
- [ ] **6** — Human-in-the-loop approvals, frontend tools
- [ ] **7** — Skills, memory, Context Meter, Cost Meter, provider toggle
- [ ] **8** — Managed layer: schedules, identity, `mda deploy`
- [ ] **9** — Design pass, screenshots, v0.1.0

---

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — why it's built this way: the research, the
  rejected approaches, and what was verified by execution rather than assumed
- **[CLAUDE.md](CLAUDE.md)** — working conventions, run commands, MDA constraints, gotchas

### Upstream references

| | |
|---|---|
| Deep Agents | <https://docs.langchain.com/oss/python/deepagents/overview> |
| Managed Deep Agents | <https://docs.langchain.com/langsmith/python/managed-deep-agents-overview> |
| MDA authoring contract | <https://github.com/langchain-ai/langchain-skills/blob/main/config/skills/managed-deep-agents/SKILL.md> |
| CopilotKit | <https://docs.copilotkit.ai/> |
| CopilotKit Deep Agents | <https://docs.copilotkit.ai/deepagents> |

---

## License

MIT
