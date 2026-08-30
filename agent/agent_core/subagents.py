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
            "tools": [research],
            "model": build_model("worker"),
        },
    ]
