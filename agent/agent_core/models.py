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
    # OpenAI reasoning models only. GPT-5.6 accepts none|low|medium|high|xhigh|max.
    # langchain-openai's docstring still lists the older four values, but the field
    # is a pass-through string, so the newer levels work.
    effort: str | None = None


@dataclass(frozen=True)
class ModelProfile:
    provider: Provider
    lead: Tier
    worker: Tier
    cheap: Tier


PROFILES: dict[Provider, ModelProfile] = {
    "anthropic": ModelProfile(
        provider="anthropic",
        # Opus 5 plans and synthesizes; thinking is adaptive and on by default.
        lead=Tier(model="claude-opus-5"),
        worker=Tier(model="claude-sonnet-5"),
        cheap=Tier(model="claude-haiku-4-5"),
    ),
    "openai": ModelProfile(
        provider="openai",
        # GPT-5.6 family: sol (flagship) / terra (balanced, $2-$12 per MTok) /
        # luna (high-volume, $0.20-$1.20). Terra leads; luna absorbs fan-out.
        lead=Tier(model="gpt-5.6-terra", effort="medium"),
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


def _tier(role: Role) -> Tier:
    profile = active_profile()
    # LLM_TIER_OVERRIDE collapses every role onto one tier. Useful for cost
    # experiments ("what if everything ran on cheap?") without editing code.
    override = (os.environ.get("LLM_TIER_OVERRIDE") or "").strip().lower()
    effective: Role = override if override in ("lead", "worker", "cheap") else role  # type: ignore[assignment]
    return getattr(profile, effective)


def build_model(role: Role) -> BaseChatModel:
    """Return a configured chat model for ``role`` on the active provider.

    Returns an *instance* rather than a ``provider:model`` string because the
    OpenAI profile needs constructor arguments (Responses API, reasoning effort)
    that a string spec cannot express. ``define_deep_agent`` accepts instances.
    """
    profile = active_profile()
    tier = _tier(role)

    if profile.provider == "anthropic":
        return ChatAnthropic(model=tier.model)

    # OpenAI: GPT-5.6 guidance is to use the Responses API for reasoning,
    # tool-calling, and multi-turn work — which is all three of what we do here.
    kwargs: dict = {"model": tier.model, "use_responses_api": True}
    if tier.effort:
        kwargs["reasoning"] = {"effort": tier.effort}
    return ChatOpenAI(**kwargs)


def describe() -> str:
    """One-line summary of the active configuration, for startup logs."""
    p = active_profile()
    parts = [
        f"{role}={getattr(p, role).model}" + (f"@{getattr(p, role).effort}" if getattr(p, role).effort else "")
        for role in ("lead", "worker", "cheap")
    ]
    return f"provider={p.provider} " + " ".join(parts)
