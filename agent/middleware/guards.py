"""Cost and safety guards.

A deep agent multiplies API calls — planning loop x subagent fan-out x tool
retries — so a runaway loop is a real (and expensive) failure mode rather than a
theoretical one. ModelCallLimitMiddleware is the hard ceiling behind the softer
levers (per-role model tiering, low reasoning effort on workers).
"""

from __future__ import annotations

import os

from langchain.agents.middleware import ModelCallLimitMiddleware

# Generous enough for a genuine multi-question research run, low enough that a
# loop gets caught in seconds rather than dollars. Override per environment.
_DEFAULT_RUN_LIMIT = 60


def call_limit() -> ModelCallLimitMiddleware:
    limit = int(os.environ.get("MODEL_CALL_LIMIT", _DEFAULT_RUN_LIMIT))
    # "end" exits gracefully with whatever the agent has so far, rather than
    # raising — a truncated report is more useful to the user than a stack trace.
    return ModelCallLimitMiddleware(run_limit=limit, exit_behavior="end")
