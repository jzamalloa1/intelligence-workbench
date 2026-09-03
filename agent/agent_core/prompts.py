"""Prompts, split into a provider-neutral core and a thin per-provider delta.

Design note — why the delta is small:

Both OpenAI's and Anthropic's 2026 guidance land on the same conclusion: modern
models need *less* scaffolding, and over-specification costs quality. OpenAI
measured stripping repeated instructions as +10-15% eval score at 33-67% lower
cost; Anthropic now explicitly deprioritizes XML tags and heavy role prompting.

So the shared behavior lives in ``instructions.md`` (the main agent) and in the
subagent prompts below, and only genuinely provider-specific steering goes in
``PROVIDER_DELTA``. Resist growing these.

The main agent's system prompt is owned by the managed runtime — MDA injects
``instructions.md`` and forbids setting ``system_prompt`` in ``define_deep_agent``.
The delta is therefore applied at model-call time by ProviderPromptMiddleware.
"""

from __future__ import annotations

from agent_core.models import active_provider

# ─────────────────────────────────────────────────────────────────────────────
# Per-provider delta, appended to whatever system prompt is in play.
# ─────────────────────────────────────────────────────────────────────────────

# Anthropic: extended thinking is adaptive and on by default, so asking for
# step-by-step reasoning in prose is redundant and hurts. Markdown structure is
# understood natively; XML tags are no longer the recommended default.
_ANTHROPIC_DELTA = """
## Response style

Write in prose. Never emit raw JSON, tool payloads, or code fences as your reply
to the user — the interface renders those from the tool calls themselves.
""".strip()

# OpenAI: reasoning depth is a *parameter* (reasoning.effort), not something to
# request in prose. GPT-5.x follows numbered lists and section headers more
# reliably than XML. The update spec below is OpenAI's own recommended block —
# without it GPT-5.x narrates routine tool calls, which is noise in a UI that
# already renders every tool call as a component.
_OPENAI_DELTA = """
## Response style

1. Write in prose. Never emit raw JSON, tool payloads, or code fences as your
   reply to the user — the interface renders those from the tool calls themselves.
2. Send brief updates (1-2 sentences) only when you start a major phase of work,
   or when you discover something that changes the plan.
3. Do not narrate routine tool calls ("searching now...", "writing the file...").
   Each update must carry a concrete outcome.
4. Do not expand the task beyond what was asked. If you notice adjacent work,
   name it as optional and move on.
""".strip()

PROVIDER_DELTA: dict[str, str] = {
    "anthropic": _ANTHROPIC_DELTA,
    "openai": _OPENAI_DELTA,
}


def provider_delta() -> str:
    """The steering block for the active provider."""
    return PROVIDER_DELTA[active_provider()]


# ─────────────────────────────────────────────────────────────────────────────
# Subagent prompts.
#
# Subagents do NOT inherit the main agent's system prompt — each one is stated
# in full. They also do not inherit tools; both are passed explicitly in
# agent_core/subagents.py.
# ─────────────────────────────────────────────────────────────────────────────

RESEARCHER = """
You research one focused question and report back.

Search with the `research` tool rather than answering from memory — you are used
precisely when current, sourced information is needed. Two or three searches with
different phrasings is normal; stop once you can answer confidently. Only go
beyond that if results are genuinely thin — more searches is not automatically a
better answer, and each one costs real time and money.

Write your findings to a file under `/research/` as you go, then return a concise
summary. The summary is all the parent agent sees, so it must stand alone: the
answer, the evidence, and the URLs. Note disagreement between sources rather than
silently picking one, and say plainly when the evidence is thin.
""".strip()
