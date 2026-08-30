"""Appends the active provider's steering block to the system prompt.

Why middleware rather than just editing ``instructions.md``: MDA owns the main
agent's system prompt. It syncs ``instructions.md`` to Context Hub and injects it
at run time, and ``system_prompt`` is on the forbidden-fields list for
``define_deep_agent``. Composing a per-provider prompt therefore has to happen at
model-call time, which is exactly what ``wrap_model_call`` is for.

Bonus: because it runs per model call, it also reaches subagents.

Both the sync and async hooks are implemented. The async one is not optional —
the LangGraph server runs graphs asynchronously, so a middleware defining only
``wrap_model_call`` raises NotImplementedError on every real request even though
it passes a synchronous unit test.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse

from agent_core.prompts import provider_delta


class ProviderPromptMiddleware(AgentMiddleware):
    """Suffixes the system prompt with provider-specific steering."""

    name = "ProviderPromptMiddleware"

    @staticmethod
    def _merge(request: ModelRequest) -> ModelRequest:
        """Return a request whose system prompt carries the provider delta.

        Returns the request unchanged when there is nothing to add, or when the
        delta is already present — middleware can be re-entered on retries, and
        appending twice would waste tokens and break the prompt-cache prefix.
        """
        delta = provider_delta()
        if not delta:
            return request

        base = request.system_prompt
        if base and delta in base:
            return request

        merged = f"{base}\n\n{delta}" if base else delta
        return request.override(system_prompt=merged)

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        return handler(self._merge(request))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return await handler(self._merge(request))
