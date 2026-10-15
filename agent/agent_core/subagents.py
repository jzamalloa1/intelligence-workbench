"""Subagent definitions.

Subagents exist for context isolation: the parent sees only the final summary, not
the dozen tool calls that produced it. That is what keeps a long research run from
filling the main context with raw search results.

Two things do NOT inherit and must be passed explicitly:
  - tools (a subagent with no `tools` gets none)
  - system_prompt (no inheritance from the main agent)
"""

from __future__ import annotations

from typing import Any

from agent_core.models import build_model
from agent_core.prompts import RESEARCHER
from middleware.provider_prompt import ProviderPromptMiddleware
from middleware.provider_switch import ProviderSwitchMiddleware
from middleware.tool_access import HideToolsMiddleware
from tools.fetch import fetch_url
from tools.research import research


def build_subagents() -> list[dict[str, Any]]:
    """Subagents for the active provider.

    Built as a function, not a module constant, so that model selection reads
    LLM_PROVIDER at construction time rather than at import time.
    """
    return [
        {
            "name": "researcher",
            # The parent reads this description to decide when to delegate, so it
            # is written as a capability, not a job title.
            "description": (
                "Researches one focused question on the web and returns a sourced "
                "summary. Delegate each distinct question separately — several "
                "researchers can run in parallel."
            ),
            "system_prompt": RESEARCHER,
            # Read-only web access. No shell: see HideToolsMiddleware below.
            "tools": [research, fetch_url],
            # Non-streaming: see build_model() — inline subagent token
            # events otherwise splice into the parent transcript.
            "model": build_model("worker", stream=False),
            # Subagents don't inherit the lead's middleware. The provider pair
            # makes the researcher follow the conversation's provider
            # (x-llm-provider) and get that provider's prompt steering, like the
            # lead does.
            #
            # HideToolsMiddleware takes away the sandbox shell deepagents gives
            # every subagent. Researchers read untrusted web pages; the agent
            # that reads them shouldn't be the one that can run commands. It
            # also means approvals only ever come from the lead. fetch_url
            # covers what they used the shell for (curl a page).
            "middleware": [
                ProviderPromptMiddleware(),
                ProviderSwitchMiddleware("worker", stream=False),
                HideToolsMiddleware({"execute"}),
            ],
        },
    ]
