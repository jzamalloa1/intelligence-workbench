# Changelog

## Unreleased

- **TypeScript 7.** The web app moves from TypeScript 5.9 to 7.0.2, the native compiler. Type checks
  run in under a second; `next build` uses the `tsc` command, so no config changed.
- **Stable Python.** The agent moves from Python 3.14.0rc3 to 3.14.8, pinned in `agent/.python-version`;
  uv 0.13 or later is now expected. No dependency changed.
- **Playbook for new projects.** `docs/MDA-COPILOTKIT-PLAYBOOK.md` distills what this build taught
  about MDA and CopilotKit into one guide a coding agent can follow from an empty repo.
- **File attachments.** A paperclip in the chat input attaches images, PDFs, CSV/TSV, text,
  Markdown, JSON or Excel files, up to 5 MB each. Images are downscaled to Claude's 2576 px limit.
  The agent saves each file to the conversation's sandbox under `/workspace/attachments/` and
  reads a note with its contents: the whole file, a preview, or a PDF's extracted text. The chat
  shows the files as chips, the Workspace lists them as "Attached by you", and Regenerate and
  Edit keep them. New check: `verify-attachments.mjs`.
- **A2UI dashboards.** A new lead tool, `render_dashboard`, lays out an overview in the chat as an
  A2UI component list: headline metrics, charts placed by id, and a small table. It is drawn by
  CopilotKit's A2UI renderer with the workbench's own components, in light and dark, and comes
  back when the conversation is reopened. New check: `verify-dashboard.mjs`.
- **Interactive widgets (Open Generative UI).** A new lead tool, `render_widget`, runs a small HTML
  page the agent writes, such as a calculator or a what-if with sliders, in the chat. It runs in a
  script-only sandboxed iframe, a Content-Security-Policy blocks all network access, and a widget
  that navigates away is closed. Used only when asked. New check: `verify-widget.mjs`.
- Line charts no longer clip their first and last axis labels.
- Dashboards and widgets open full screen from their card.
- The sandbox comes with pandas, numpy and openpyxl (`sandbox/setup.sh`), and the lead runs its
  analysis as one script, not many commands that each need approval.
- Fixed: an agent turn that opened a panel alongside other tools started a broken follow-up run
  ("does not support assistant message prefill"). `focus_panel` is now a backend tool the
  browser acts on.
- Fixed: a provider error shown in the chat also failed the run with "text messages are still
  active".
- Fixed: files waiting to be sent overlapped the welcome screen and had no background.
- Fixed: writing a script and running it in the same turn could fail with "No such file" (the two
  calls ran at the same time). Commands now wait for that turn's file writes.
- Long conversations are summarized from about 170K tokens instead of about 850K (a declared 200K
  context budget), and the Context meter shows the budget and where summarization starts.

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
