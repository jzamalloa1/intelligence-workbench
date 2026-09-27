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

from agent_core.models import run_provider

logger = logging.getLogger(__name__)

# LangChain's shared exception classes cover errors raised when a request is
# made. An error that arrives *inside* an accepted stream (OpenAI's "You have
# no credits remaining", for one) surfaces as the SDK's own `APIError`
# instead — not a `ModelAPIError` subclass — so both SDKs' bases are caught too.
_PROVIDER_ERRORS: tuple[type[Exception], ...] = (ModelAPIError,)
try:
    import openai

    _PROVIDER_ERRORS += (openai.APIError,)
except ImportError:  # pragma: no cover - both SDKs are project dependencies
    pass
try:
    import anthropic

    _PROVIDER_ERRORS += (anthropic.APIError,)
except ImportError:  # pragma: no cover
    pass

_NAMES = {"anthropic": "Anthropic", "openai": "OpenAI"}

_BILLING_HINTS = {
    "anthropic": "https://console.anthropic.com/settings/billing",
    "openai": "https://platform.openai.com/settings/organization/billing",
}


def _explain(exc: Exception) -> str:
    """A short, actionable description of a provider failure."""
    # The run's provider, not the .env default — with the per-conversation
    # toggle they differ, and naming the wrong one sends people to the wrong
    # billing page.
    provider = run_provider()
    other = "OpenAI" if provider == "anthropic" else "Anthropic"
    billing = _BILLING_HINTS.get(provider, "your provider's billing page")
    raw = str(exc)
    low = raw.lower()

    # Billing exhaustion is by far the most common cause and the least obvious
    # from the generic error, so it gets its own branch.
    if any(h in low for h in ("credit balance", "insufficient_quota", "no credits", "billing")):
        return (
            f"**{_NAMES.get(provider, provider)} is out of credits.** The API rejected the "
            f"request because the account balance is too low.\n\n"
            f"Add credits at {billing}, or start a new conversation on {other} with the "
            f"provider switch in the header."
        )

    if isinstance(exc, ModelAuthenticationError):
        return (
            f"**{_NAMES.get(provider, provider)} rejected the API key.** Check the key in `.env` "
            f"and restart `mda dev` — the agent reads it at startup."
        )

    if isinstance(exc, ModelRateLimitError):
        return (
            f"**{_NAMES.get(provider, provider)} rate limit hit.** Wait and retry, or lower the "
            f"fan-out (fewer parallel subagents) for this request."
        )

    if isinstance(exc, ModelInvalidRequestError):
        return f"**{_NAMES.get(provider, provider)} rejected the request.**\n\n```\n{raw[:600]}\n```"

    return f"**{_NAMES.get(provider, provider)} call failed.**\n\n```\n{raw[:600]}\n```"


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
        except _PROVIDER_ERRORS as exc:
            return self._message(exc)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse | AIMessage:
        try:
            return await handler(request)
        except _PROVIDER_ERRORS as exc:
            return self._message(exc)
