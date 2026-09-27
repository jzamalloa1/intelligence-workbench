"""Swaps the model to the run's provider, per model call.

The agent is defined once, with the ``LLM_PROVIDER`` default's models. A
conversation started under the web app's Anthropic/OpenAI toggle carries an
``x-llm-provider`` header, which reaches every run's config (see
``agent_core.models.run_provider``). When that names the other provider, this
replaces the request's model with the same role's model from that provider's
profile — a dynamic model swap, not a second agent definition.

One instance per role: the lead's stack gets ``role="lead"``, the researcher's
``role="worker", stream=False`` (subagents must not stream — see
``build_model``). Both hooks are implemented, as every middleware here must be.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.messages import SystemMessage
from langchain_core.tools import BaseTool

from agent_core.models import Role, model_for, provider_of, run_provider


class ProviderSwitchMiddleware(AgentMiddleware):
    name = "ProviderSwitchMiddleware"

    def __init__(self, role: Role, *, stream: bool = True) -> None:
        super().__init__()
        self.role = role
        self.stream = stream

    def _switch(self, request: ModelRequest) -> ModelRequest:
        wanted = run_provider()
        if provider_of(request.model) == wanted:
            return request
        swapped = request.override(model=model_for(wanted, self.role, self.stream))
        return swapped if wanted == "anthropic" else _without_anthropic_caching(swapped)

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        return handler(self._switch(request))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return await handler(self._switch(request))


def _without_anthropic_caching(request: ModelRequest) -> ModelRequest:
    """Removes the prompt-caching marks deepagents' Anthropic middleware added.

    That middleware sits outside this one, so it saw the original (Anthropic)
    model and tagged the request in three places — `model_settings`, the last
    system-message block and the last tool's `extras` (langchain-anthropic
    `middleware/prompt_caching.py`). None of it means anything to another
    provider, and a stray `cache_control` parameter is a request error there.
    """
    settings = {k: v for k, v in request.model_settings.items() if k != "cache_control"}

    system = request.system_message
    if system is not None and isinstance(system.content, list):
        blocks: list[Any] = [
            {k: v for k, v in b.items() if k != "cache_control"} if isinstance(b, dict) else b
            for b in system.content
        ]
        if len(blocks) == 1 and isinstance(blocks[0], dict) and set(blocks[0]) == {"type", "text"}:
            system = SystemMessage(content=blocks[0]["text"])
        else:
            system = SystemMessage(content=blocks)

    tools = [
        t.model_copy(update={"extras": {k: v for k, v in t.extras.items() if k != "cache_control"}})
        if isinstance(t, BaseTool) and t.extras and "cache_control" in t.extras
        else t
        for t in (request.tools or [])
    ]
    return request.override(model_settings=settings, system_message=system, tools=tools)
