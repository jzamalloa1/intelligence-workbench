# Next build — plan for approval

**Status:** approved 2026-10-21, with the decisions in §5. Built in the private repo **`t-minus`** (product name **T-Minus**). Nothing in this plan has been built yet.

**Goal:** a new repo that shows off the most visual, interactive parts of CopilotKit we haven't
used in the Workbench, on top of Managed Deep Agents, without re-learning what the Workbench
already taught us ([MDA-COPILOTKIT-PLAYBOOK.md](MDA-COPILOTKIT-PLAYBOOK.md)).

---

## 1. What's new since the Workbench was built

| | Workbench uses | Latest | Matters for the next build |
|---|---|---|---|
| CopilotKit | 1.78.0 | **1.79.1** (Oct 15) | Thread replay fixes. Intelligence sockets now ping every 15 s, which may fix the 60 s "connection dropped" ceiling. **Breaking:** `headers` is evaluated per request, so switching users needs a provider remount (the Workbench already does this). |
| `@ag-ui/*` | client/core 1.0.2, langgraph 0.0.44 | core/client 1.0.3, langgraph 0.0.45 | Runtime 1.79.1 still pins 1.0.2 / 0.0.44, so the rule "match the runtime" still holds. AG-UI 1.0.3 defines `SUBAGENT_STARTED/FINISHED/ERROR` events, but neither the LangGraph adapter nor CopilotKit emits or renders them yet. |
| MDA | 0.9.0 | **0.9.4** (Oct 20) | **`mda dev` has its own build directory** (0.9.3), so compiles should stop wiping local threads. **Per-call approvals**: `HumanInTheLoopMiddleware(interrupt_mode="per_call")`. **Schedules run locally** under `mda dev` (0.9.3). Factory agents choose the model, skills, tools, MCP and sandbox per run. Built-in Parallel web search (0.8). Writes to unmounted memory layers now fail instead of disappearing. |
| deepagents | 0.7.23 | 0.7.29 | Patch releases. |
| Toolchain | — | Python 3.14.8, TypeScript 7.0.2, Next 16.4.2 | This repo already moved to 3.14.8 and TS 7 today. A new repo starts there. |

### CopilotKit features we have **not** used yet

All of these were checked against the 1.79.1 package exports, not only the docs.

| Feature | API | What it looks like |
|---|---|---|
| **State streaming** | Python `StateStreamingMiddleware(StateItem(state_key, tool, tool_argument))` (present in our installed `copilotkit` 0.1.96) | A tool argument streams into shared state **token by token**. A document or plan visibly writes itself on a canvas. |
| **Two-way shared state** | `agent.setState(...)`, `useAgent` | The user edits the canvas and the agent reads the edit on its next turn. "Co-agent" apps. |
| **Read-only UI context** | `useAgentContext` | What's selected or open on screen becomes agent context automatically. |
| **Streaming Open Generative UI** | `CopilotRuntime({ openGenerativeUI })`, `generateSandboxedUi`, `useSandboxFunctions` | The UI builds live (CSS, then HTML, then JS). It can load Chart.js, D3 or Three.js, and sandbox functions let a widget call back into the app. |
| **Dynamic A2UI, streamed** | `a2ui: { injectA2UITool: true }` + Python `CopilotKitMiddleware` auto-injecting `generate_a2ui` | Dashboards paint progressively as their spec streams in. |
| **Fixed-schema A2UI** | Python `copilotkit.a2ui.render / load_schema`, [A2UI Composer](https://a2ui-composer.ag-ui.com/) | Cards designed once, filled with data, shown instantly. |
| **MCP Apps** | runtime MCP Apps middleware; demo servers in `modelcontextprotocol/ext-apps` | Interactive UIs shipped *by an MCP server* (budget allocators, visualizations), sandboxed, with zero frontend code. |
| **Components as tools** | `useComponent` | The agent "calls" a React component, which renders inline with typed props. |
| ~~**Voice input**~~ | mic in `CopilotChat` + runtime `transcriptionService` | *Dropped for this build (decision 3).* |
| **Sidebar / popup / headless** | `CopilotSidebar`, `CopilotPopup`, headless hooks | The app is the canvas, and chat is a companion rather than the whole screen. |
| **Threads drawer** | `CopilotThreadsDrawer`, `useThreads` | A ready-made conversation list: switch, archive, delete. *Needs Intelligence.* |
| **User memories** | `useMemories` | "Remember I sell B2B." Recalled semantically in later conversations. *Needs Intelligence.* |
| **Automatic learning** | `useLearnFromUserAction`, Learning Spaces | Turns real use into skills you review and publish. *Needs Intelligence.* |
| **Headless interrupts** | resolving interrupts outside `useInterrupt`'s render | Approve or decide *on the canvas* (a board, a modal), not in the chat. |
| **Slots** | every chat sub-component overridable (class string, props or component) | A fully branded chat, beyond the token theming we did. |
| **Feedback** | `CopilotChatFeedbackMessage` | Thumbs up/down on answers. |
| **WebMCP** (experimental) | `useFrontendTool({ webmcp: true })` | Exposes app actions to browser agents (Chrome 149 origin trial). Stretch goal only. |

Out of scope, and not visual: Slack/Teams channels, Angular/Vue/React Native, product analytics.

---

## 2. The concept: **Launch Room**

> Describe a product idea. A deep agent researches the market and builds a
> **live, editable launch plan on a canvas** while you watch. You steer it by editing the canvas,
> dragging cards and answering its questions in place, and it can keep watching the market
> afterwards.

The domain is a cousin of the Workbench's research agent, which lets us reuse the research
stack. But the **canvas is the product**: chat moves to a sidebar, and every new CopilotKit
feature gets a natural place on the canvas.

### Screen

```
┌──────────────┬──────────────────────────────────────────────┬──────────────────┐
│ Threads      │  CANVAS  (tabs: Brief · Landscape · Pricing  │  Copilot sidebar │
│ drawer       │          · Roadmap · Dashboard)              │  (slots-themed)  │
│              │                                              │  provider toggle │
│ past launch  │  Brief      — writes itself (state streaming)│  suggestions     │
│ rooms        │  Landscape  — live D3 market map (Open Gen UI)│  reasoning cards │
│              │  Pricing    — interactive simulator           │  feedback 👍👎   │
│ memories ⓘ  │               (Open Gen UI + sandbox fns)     │                  │
│              │  Roadmap    — kanban, two-way shared state,  │                  │
│              │               approvals on the board         │                  │
│              │  Dashboard  — streamed A2UI + fixed cards    │                  │
│              │  + an MCP App (budget allocator) inline      │                  │
└──────────────┴──────────────────────────────────────────────┴──────────────────┘
```

### Feature → where it lives

| Moment | CopilotKit / MDA feature |
|---|---|
| Brief types itself paragraph by paragraph | `StateStreamingMiddleware` → `brief` state |
| User fixes a sentence in the brief; the agent adapts | `agent.setState` (two-way) |
| Agent "knows" which tab or card you're looking at | `useAgentContext` |
| Live competitor map builds in front of you, then is clickable | Streaming Open Generative UI + D3; a click calls a sandbox function → shared state |
| Pricing sliders recompute margin and payback; "apply" writes back | Open Gen UI + `useSandboxFunctions` |
| Marketing budget split | MCP App (ext-apps budget allocator), no frontend code |
| KPI dashboard paints progressively | Dynamic A2UI (`injectA2UITool`) |
| Consistent "competitor card" / "risk card" | Fixed-schema A2UI, or `useComponent` |
| Agent proposes moving a milestone; you approve on the board | Headless interrupts, per-call HITL (MDA 0.9.3) |
| User drags roadmap cards; the agent sees the new order | Two-way shared state |
| "Quick scan" vs "Deep dive" toggle | MDA factory agent: model and subagents chosen per run |
| "Watch competitors every Monday" | MDA schedules (local in `mda dev` ≥ 0.9.3); results land in the thread |
| "Remember we're B2B and price conservatively" | `useMemories` (Intelligence) |
| Switch between launch rooms | `CopilotThreadsDrawer` (Intelligence) |
| Rate an answer | Feedback |

**Kept from the Workbench**, copied rather than rebuilt:
- the patched `LangGraphAgent` (null tool names, keyed resume, rewind);
- the subagent and usage trackers;
- the history runner;
- the error, ordering and attachment middleware;
- reasoning cards;
- the zero-cost `verify-*.mjs` harness;
- all the [playbook](MDA-COPILOTKIT-PLAYBOOK.md) rules.

**Deliberately dropped**, to keep the build focused:
- the Workbench's panel layout (the Plan Board, Activity timeline and Workspace become canvas tabs or go away).

---

## 3. Risks to settle first (Phase 0 spikes)

These are the places where the docs and our own experience disagree. Each spike is zero-cost
where possible, with at most a few cents of live calls.

| # | Question | Why it matters | Fallback if it fails |
|---|---|---|---|
| S1 | Do **`useComponent`**, the runtime-injected **`generateSandboxedUi`** (Open Gen UI) and **`generate_a2ui`** (A2UI) trigger a frontend-tool follow-up run? | In the Workbench, a frontend tool in a mixed turn caused a follow-up run that **Claude 5.5 rejects (prefill 400)**. | Backend tools rendered by the browser, which is the Workbench's proven pattern, plus our own streaming renderers. |
| S2 | Do **activity messages** (Open Gen UI, A2UI, MCP Apps) survive reopening a conversation on the local runner? 1.79 has new activity-history code, and the MCP Apps docs claim "restored on reconnect". | Generative UI that disappears on reload looks broken. | Re-derive from tool calls (Workbench pattern), or store activity snapshots in our history runner. |
| S3 | Does the **MCP Apps middleware** work with an MDA (plain LangGraph) agent, given that the runtime injects MCP tools as frontend tools? | It's the zero-code showpiece. | Run the MCP server's tool from the agent (MDA's `define_mcp`) and render its UI resource ourselves. |
| S4 | Does **`StateStreamingMiddleware`** compose inside `define_deep_agent`, alongside our trackers (which add keys to every `STATE_SNAPSHOT`)? | It's the heart of the canvas. | Stream from tool-call args on the frontend (we already parse partial args). |
| S5 | Open Gen UI + **CDN libraries** versus our CSP wall | The docs advertise D3 and Three.js via `<script src>`. Our CSP blocks all network access. | Allow `script-src` from **one pinned CDN** (cdnjs) and nothing else: `connect-src 'none'` stays, so no fetch, beacons or images. |
| S6 | **Intelligence** on the Developer (free) plan: the threads drawer, memories, learning, and whether the 15 s ping fixed long runs | Three headline features depend on it. | The Workbench's own history sidebar, plus MDA memory. Memories and learning would be cut. |
| S7 | MDA **0.9.4** upgrade: per-call HITL, local schedules, the separate build dir, and whether Parallel search works under `mda dev` | Simplifies approvals and enables the "watch" feature. | Keep keyed resume and Tavily. Schedules are cut (no deploy in scope). |

**Exit from Phase 0:** a one-page spike report with go / fallback for each row, before any
feature work.

---

## 4. Phases

Each phase ends with zero-cost checks (`verify-*.mjs` with stubbed streams, `tsc`, build) and
one small live run. Then you test the running app yourself, as agreed.

| Phase | Builds | Done when |
|---|---|---|
| **0 — Scaffold + spikes** | New repo from the playbook: Python 3.14.8 / TS 7 / Next 16.4 / CopilotKit 1.79.1 / MDA 0.9.4. Patched agent, trackers and history runner copied in. Spikes S1–S7. | Spike report approved. A streamed "reply OK" works end to end. |
| **1 — Shell** | Canvas-first layout. `CopilotSidebar` themed through slots. Threads drawer (Intelligence, Developer plan). Anthropic / OpenAI provider toggle (kept from the Workbench). Suggestions, feedback, reasoning cards. | The whole frame works with a stubbed agent. The drawer lists threads. |
| **2 — Live canvas** | Shared-state schema (brief, competitors, pricing, roadmap). State-streamed Brief. Roadmap kanban with two-way state. `useAgentContext`. Approvals on the board (headless interrupts, per-call HITL). | The brief writes itself live. A drag is seen by the agent. An approval resolves on the board. |
| **3 — Generative UI** | Streaming Open Gen UI (landscape map, pricing simulator with sandbox functions). Dynamic A2UI dashboard. Fixed-schema cards. `useComponent` cards. One MCP App. Full-screen views. | Each renders live, survives reopening (S2), and the security checks pass: no network escape except the allowlisted CDN. |
| **4 — Memory and time** | Factory agent modes (Quick / Deep). Memories panel (`useMemories`). Schedules ("watch competitors weekly") with results in the thread. Learning, optional. | A schedule fires under `mda dev` and posts into the thread. A memory is saved and recalled in a new conversation. |
| **5 — Polish and ship** | Motion and transitions, empty states, screenshots, README, playbook updates. No `mda deploy` or hosting (decision 6). | v0.1.0 tagged. |

**Minimum showcase** if we need to cut: phases 0–3. Phase 4 is the "wow, it remembers and keeps
working" layer.

**Model spend while building** (my verification runs, not yours): a few cents per feature,
roughly **$2–5 in total**, using one-call checks wherever possible. Your full test runs on top
of that will cost what research runs cost now (~$1–2 for a deep run).

---

## 5. Decisions (answered 2026-10-21)

1. **Concept:** Launch Room, as described.
2. **CopilotKit Intelligence:** yes, on the free Developer plan. The threads drawer, memories and learning are in scope.
3. **Voice:** skipped. No speech-to-text in this build.
4. **Providers:** keep the Anthropic / OpenAI toggle (per conversation, as in the Workbench).
5. **CDN in the widget sandbox:** yes, scripts from one pinned CDN (cdnjs) only; all other network access stays blocked.
6. **Repo:** private, named `t-minus` (product: T-Minus). No `mda deploy` and no web hosting.
7. **Workbench `main`:** not fast-forwarded again; this plan is committed to `dev` as the record.

---

## Sources

- CopilotKit releases: <https://github.com/CopilotKit/CopilotKit/releases>
- CopilotKit docs index and full text: <https://docs.copilotkit.ai/llms.txt>, <https://docs.copilotkit.ai/llms-full.txt>
- Generative UI overview: <https://docs.copilotkit.ai/concepts/generative-ui-overview>
- Deep Agents integration: <https://docs.copilotkit.ai/deepagents>; shared state: <https://docs.copilotkit.ai/deepagents/shared-state>; WebMCP: <https://docs.copilotkit.ai/deepagents/webmcp>; subagents: <https://docs.copilotkit.ai/deepagents/multi-agent/subagents>
- MCP Apps demo servers: <https://github.com/modelcontextprotocol/ext-apps>
- MDA changelog: <https://github.com/langchain-ai/managed-deepagents/blob/main/CHANGELOG.md>
- MDA v0.9 announcement: <https://www.langchain.com/blog/managed-deep-agents-schedules-per-run-configuration-slack>
- MDA docs: <https://docs.langchain.com/langsmith/managed-deep-agents-overview>
- Package checks: `@copilotkit/react-core@1.79.1` exports, `@copilotkit/runtime@1.79.1` dependencies, `@ag-ui/langgraph@0.0.44/0.0.45` and `@ag-ui/core@1.0.3` sources, installed Python `copilotkit` 0.1.96 exports.
