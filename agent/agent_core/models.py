"""Provider-agnostic model selection.

The only place model IDs appear. Everything else asks for a *role* — lead, worker,
or cheap — and gets back a configured chat model for whichever provider
``LLM_PROVIDER`` names.

Why roles instead of models: a deep agent multiplies API calls (planning loop x
subagent fan-out x tool retries). Tiering by role is the single biggest cost lever,
and it only works if no module hardcodes a model name.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

Role = Literal["lead", "worker", "cheap"]
Provider = Literal["anthropic", "openai"]


@dataclass(frozen=True)
class Tier:
    """One role's model plus the knobs that control how hard it thinks."""

    model: str
    # How hard the model thinks. Anthropic: `output_config.effort` — thinking is
    # adaptive and always on for the 5.5 models, so this is the only control.
    # OpenAI: reasoning effort; GPT-5.6 accepts none|low|medium|high|xhigh|max
    # (langchain-openai's docstring lists the older four, but the field is a
    # pass-through string, so the newer levels work).
    effort: str | None = None
    # Return a readable summary of the model's reasoning, for the chat's
    # reasoning cards. Lead only — subagents run hidden and non-streaming.
    # Anthropic: the models think either way with `display: "omitted"` by
    # default, and billing is identical — "summarized" only makes it visible.
    # OpenAI: reasoning tokens are billed whether or not a summary is returned.
    show_reasoning: bool = False


@dataclass(frozen=True)
class ModelProfile:
    provider: Provider
    lead: Tier
    worker: Tier
    cheap: Tier


PROFILES: dict[Provider, ModelProfile] = {
    "anthropic": ModelProfile(
        provider="anthropic",
        # Effort is explicit because the defaults differ per model (Opus 5.5:
        # medium, Sonnet 5.5: high). Opus 5.5 at medium matches or beats Opus 5
        # at high on knowledge work, per Anthropic's migration guide; the
        # researchers keep Sonnet's default. Re-tune these against real runs.
        lead=Tier(model="claude-opus-5-5", effort="medium", show_reasoning=True),
        worker=Tier(model="claude-sonnet-5-5", effort="high"),
        cheap=Tier(model="claude-haiku-5-5", effort="low"),
    ),
    "openai": ModelProfile(
        provider="openai",
        # GPT-5.6 family: sol (flagship) / terra (balanced, $2-$12 per MTok) /
        # luna (high-volume, $0.20-$1.20). Terra leads; luna absorbs fan-out.
        lead=Tier(model="gpt-5.6-terra", effort="medium", show_reasoning=True),
        worker=Tier(model="gpt-5.6-terra", effort="low"),
        cheap=Tier(model="gpt-5.6-luna", effort="low"),
    ),
}


def active_provider() -> Provider:
    raw = (os.environ.get("LLM_PROVIDER") or "anthropic").strip().lower()
    if raw not in PROFILES:
        valid = ", ".join(sorted(PROFILES))
        raise ValueError(f"LLM_PROVIDER={raw!r} is not supported. Use one of: {valid}")
    return raw  # type: ignore[return-value]


def active_profile() -> ModelProfile:
    return PROFILES[active_provider()]


#: Request header the web app sets per conversation. CopilotKit's LangGraph
#: adapter forwards `x-` headers into every run's config as
#: `configurable.copilotkit_forwarded_headers`, and deepagents passes the
#: parent's configurable on to subagents — so one header reaches every call.
PROVIDER_HEADER = "x-llm-provider"


def run_provider() -> Provider:
    """The provider for the current run: the header if valid, else ``LLM_PROVIDER``.

    Only meaningful inside a running graph (it reads the run's config); anywhere
    else it falls back to the environment default.
    """
    try:
        from langgraph.config import get_config  # noqa: PLC0415

        configurable = get_config().get("configurable") or {}
    except RuntimeError:
        return active_provider()
    headers = configurable.get("copilotkit_forwarded_headers") or {}
    raw = next((v for k, v in headers.items() if k.lower() == PROVIDER_HEADER), None)
    value = str(raw or "").strip().lower()
    return value if value in PROFILES else active_provider()  # type: ignore[return-value]


def provider_of(model: object) -> Provider | None:
    if isinstance(model, ChatAnthropic):
        return "anthropic"
    if isinstance(model, ChatOpenAI):
        return "openai"
    return None


def _tier(role: Role, provider: Provider | None = None) -> Tier:
    profile = PROFILES[provider] if provider else active_profile()
    # LLM_TIER_OVERRIDE collapses every role onto one tier. Useful for cost
    # experiments ("what if everything ran on cheap?") without editing code.
    override = (os.environ.get("LLM_TIER_OVERRIDE") or "").strip().lower()
    effective: Role = override if override in ("lead", "worker", "cheap") else role  # type: ignore[assignment]
    return getattr(profile, effective)


#: Thinking blocks on the 5.5 models are bound to the exact conversation that
#: produced them: if the system prompt, the tools, or any earlier message differs
#: when a block is replayed, the API rejects the request (enforced by default for
#: accounts created on or after 2026-08-31). Parts of our stack rewrite the prefix
#: and aren't ours to make append-only — deepagents' summarization replaces old
#: turns, and the memory and skills middleware re-render the system prompt — so
#: blocks that no longer match are dropped instead of failing the run.
_THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01"
_BLOCK_BINDING = {"prefix_mismatch_behavior": "drop_block"}


def build_model(role: Role, *, stream: bool = True, provider: Provider | None = None) -> BaseChatModel:
    """Return a configured chat model for ``role`` on the active provider.

    Returns an *instance* rather than a ``provider:model`` string because the
    OpenAI profile needs constructor arguments (Responses API, reasoning effort)
    that a string spec cannot express. ``define_deep_agent`` accepts instances.

    ``stream=False`` disables token-level streaming for this model. That matters
    for subagents: deepagents runs them inline via ``.invoke()``, so their token
    events surface at the root of the run and the frontend splices them into the
    parent's message — with several subagents in flight the transcript becomes
    interleaved gibberish. Non-streaming subagents still work exactly the same;
    they just return their result in one piece instead of token by token.
    """
    profile = PROFILES[provider] if provider else active_profile()
    tier = _tier(role, profile.provider)

    if profile.provider == "anthropic":
        thinking: dict = {"type": "adaptive", "block_binding": _BLOCK_BINDING}
        if tier.show_reasoning and stream:
            thinking["display"] = "summarized"
        return ChatAnthropic(
            model=tier.model,
            disable_streaming=not stream,
            effort=tier.effort,
            thinking=thinking,
            betas=[_THINKING_BINDING_BETA],
        )

    # OpenAI: GPT-5.6 guidance is to use the Responses API for reasoning,
    # tool-calling, and multi-turn work — which is all three of what we do here.
    kwargs: dict = {
        "model": tier.model,
        "use_responses_api": True,
        "disable_streaming": not stream,
    }
    if tier.effort:
        kwargs["reasoning"] = {"effort": tier.effort}
        if tier.show_reasoning and stream:
            kwargs["reasoning"]["summary"] = "auto"
    return ChatOpenAI(**kwargs)


@lru_cache(maxsize=None)
def model_for(provider: Provider, role: Role, stream: bool) -> BaseChatModel:
    """``build_model`` memoised — the switching middleware asks for these per call."""
    return build_model(role, stream=stream, provider=provider)


def describe() -> str:
    """One-line summary of the active configuration, for startup logs."""
    p = active_profile()
    parts = [
        f"{role}={getattr(p, role).model}" + (f"@{getattr(p, role).effort}" if getattr(p, role).effort else "")
        for role in ("lead", "worker", "cheap")
    ]
    return f"provider={p.provider} " + " ".join(parts)
