# Changelog

## v0.1.0 — 2026-10-15

The first release. Everything runs locally: the agent under `mda dev`, the web app under
`npm run dev`. The managed layer (schedules, `mda deploy`, real sign-in) is the next milestone.

### Agent (`agent/`)

- A Managed Deep Agent on MDA 0.9: a lead agent that plans with `write_todos`, delegates focused
  questions to parallel `researcher` subagents, computes in a per-conversation sandbox, charts
  with `render_chart`, and writes reports to `/reports/`.
- Claude Opus 5.5 leads, Sonnet 5.5 researches, Haiku 5.5 is the cheap tier, each with explicit
  effort. An OpenAI (GPT-5.6) profile exists, switchable per conversation; it has been checked up
  to the API but not run end to end.
- Researchers search with Tavily and read pages with `fetch_url` (public addresses only). They
  have no shell: `HideToolsMiddleware` removes the sandbox's `execute` from them, so only the
  lead's commands need approval.
- Every sandbox command waits for approval, described in plain language.
- Skills (`market-sizing`, `competitive-analysis`, `data-analysis`), deployment-shared memory, a
  model-call ceiling per run, readable provider errors, and safety-classifier declines turned
  into a message instead of silence.

### Web app (`web/`)

- CopilotKit 1.78 / AG-UI 1.0 chat with live panels: Plan, Activity, Workspace (files and
  memory), Sandbox (console and chart gallery), plus Context and Cost meters.
- Research lanes in the chat (one per researcher), all pending approvals at once, a reasoning
  card for the lead's thinking summary, a welcome screen with starters, follow-up suggestions,
  and Regenerate / Edit that fork the conversation from the question's checkpoint.
- Reports with embedded charts, downloadable as Markdown or PDF; charts as PNG, SVG or CSV.
- Demo sign-in with per-user conversation history in SQLite. Each conversation's sandbox is
  private to it, and the panels say whose it is.
- Responsive from phone to wide desktop, light and dark following the system.
- Twelve zero-cost browser checks (`web/scripts/verify-*.mjs`) and an adapter check
  (`npx tsx scripts/verify-adapter.ts`), none of which call a model.

### Known limits

- The OpenAI path is untested end to end (no credits on the test account).
- Sign-in is a demo: anyone can pick a user. Real identity comes with the managed layer.
- Agent memory is shared by all users and conversations.
- Conversations kept only by `mda dev` are lost when it rebuilds; history in the web app's
  store survives, but Regenerate and Edit need the agent-side copy.
