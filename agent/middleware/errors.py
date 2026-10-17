"""Turns provider failures into a readable message instead of a blank screen.

Why this exists: when a model call fails, the run aborts and CopilotKit shows a
toast reading "An internal error occurred". The real cause — an expired key, an
exhausted credit balance, a rate limit — is only in the agent server log. That is
the single most expensive failure mode when learning this stack, because every
problem looks identical from the UI.

This catches provider errors at the model-call boundary and returns an assistant
message explaining what happened and what to do about it. The run then completes
normally with the explanation in the transcript, rather than dying.

It also catches the one failure that isn't an error: a safety-classifier decline.
The 5.5 models answer some requests with HTTP 200 and `stop_reason: "refusal"`,
with empty or partial content — which would otherwise end the run in silence.
Server-side fallbacks (`fallbacks: "default"`) would retry those on another model,
but a mid-stream fallback adds a `fallback` content block and changes which blocks
may be sent back, and langchain-anthropic doesn't handle either yet.

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


def _declined(message: object) -> bool:
    meta = getattr(message, "response_metadata", None) or {}
    return isinstance(message, AIMessage) and meta.get("stop_reason") == "refusal"


def _refusal_text(message: AIMessage) -> str:
    details = message.response_metadata.get("stop_details") or {}
    category = details.get("category") if isinstance(details, dict) else None
    why = f" (category: `{category}`)" if category else ""
    return (
        f"**The model declined this request.** Its safety classifier flagged it{why}, "
        "so nothing it had started was kept.\n\nRephrase the question, or start a new "
        "conversation on the other provider with the switch in the header."
    )


def _without_refusal(response: ModelResponse | AIMessage) -> ModelResponse | AIMessage:
    """Replace a declined reply with an explanation, keeping its id.

    The partial output of a mid-stream decline is discarded — including any tool
    calls, which must not run — and the same id lets the explanation replace the
    streamed partial in the chat.
    """
    messages = response.result if isinstance(response, ModelResponse) else [response]
    if not any(_declined(m) for m in messages):
        return response
    replaced = [
        AIMessage(content=_refusal_text(m), id=m.id, response_metadata=m.response_metadata)
        if _declined(m)
        else m
        for m in messages
    ]
    logger.warning("Model declined the request: %s", messages[-1].response_metadata.get("stop_details"))
    if isinstance(response, ModelResponse):
        return ModelResponse(result=replaced, structured_response=response.structured_response)
    return replaced[0]


class FriendlyErrorMiddleware(AgentMiddleware):
    """Converts provider errors into an explanatory assistant message."""

    name = "FriendlyErrorMiddleware"

    @staticmethod
    def _message(exc: Exception) -> AIMessage:
        # Full detail goes to the server log; the chat gets the readable version.
        logger.exception("Model call failed: %s", exc)
        # A stop reason marks the message finished. @ag-ui/langgraph opens a text
        # message for it and only closes one that carries a stop/finish reason;
        # without it the run ends with the message still open, which AG-UI 1.0
        # rejects ("Cannot send 'RUN_FINISHED' while text messages are still
        # active") — the readable error then arrives wrapped in a second one.
        return AIMessage(content=_explain(exc), response_metadata={"stop_reason": "end_turn"})

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse | AIMessage:
        try:
            return _without_refusal(handler(request))
        except _PROVIDER_ERRORS as exc:
            return self._message(exc)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse | AIMessage:
        try:
            return _without_refusal(await handler(request))
        except _PROVIDER_ERRORS as exc:
            return self._message(exc)
