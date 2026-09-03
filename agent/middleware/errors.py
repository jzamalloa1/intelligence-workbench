"""Turns provider failures into a readable message instead of a blank screen.

Why this exists: when a model call fails, the run aborts and CopilotKit shows a
toast reading "An internal error occurred". The real cause — an expired key, an
exhausted credit balance, a rate limit — is only in the agent server log. That is
the single most expensive failure mode when learning this stack, because every
problem looks identical from the UI.

This catches provider errors at the model-call boundary and returns an assistant
message explaining what happened and what to do about it. The run then completes
normally with the explanation in the transcript, rather than dying.

The exception classes live in `langchain_core.exceptions` and are shared by
`langchain-anthropic` and `langchain-openai`, so one handler covers both.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from langchain_core.exceptions import (
    ModelAPIError,
    ModelAuthenticationError,
    ModelInvalidRequestError,
    ModelRateLimitError,
)
from langchain_core.messages import AIMessage
from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse

from agent_core.models import active_provider

logger = logging.getLogger(__name__)

_BILLING_HINTS = {
    "anthropic": "https://console.anthropic.com/settings/billing",
    "openai": "https://platform.openai.com/settings/organization/billing",
}


def _explain(exc: Exception) -> str:
    """A short, actionable description of a provider failure."""
    provider = active_provider()
    billing = _BILLING_HINTS.get(provider, "your provider's billing page")
    raw = str(exc)
    low = raw.lower()

    # Billing exhaustion is by far the most common cause and the least obvious
    # from the generic error, so it gets its own branch.
    if "credit balance" in low or "insufficient_quota" in low or "billing" in low:
        return (
            f"**{provider.title()} is out of credits.** The API rejected the request "
            f"because the account balance is too low.\n\n"
            f"Add credits at {billing}, or switch providers by setting "
            f"`LLM_PROVIDER` in `.env` and restarting `mda dev`."
        )

    if isinstance(exc, ModelAuthenticationError):
        return (
            f"**{provider.title()} rejected the API key.** Check the key in `.env` "
            f"and restart `mda dev` — the agent reads it at startup."
        )

    if isinstance(exc, ModelRateLimitError):
        return (
            f"**{provider.title()} rate limit hit.** Wait and retry, or lower the "
            f"fan-out (fewer parallel subagents) for this request."
        )

    if isinstance(exc, ModelInvalidRequestError):
        return f"**{provider.title()} rejected the request.**\n\n```\n{raw[:600]}\n```"

    return f"**{provider.title()} call failed.**\n\n```\n{raw[:600]}\n```"


class FriendlyErrorMiddleware(AgentMiddleware):
    """Converts provider errors into an explanatory assistant message."""

    name = "FriendlyErrorMiddleware"

    @staticmethod
    def _message(exc: Exception) -> AIMessage:
        # Full detail goes to the server log; the chat gets the readable version.
        logger.exception("Model call failed: %s", exc)
        return AIMessage(content=_explain(exc))

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse | AIMessage:
        try:
            return handler(request)
        except ModelAPIError as exc:
            return self._message(exc)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse | AIMessage:
        try:
            return await handler(request)
        except ModelAPIError as exc:
            return self._message(exc)
