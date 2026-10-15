"""Hides tools from one agent that its framework hands it anyway.

deepagents builds every subagent on its own base stack, and that stack starts
with ``FilesystemMiddleware`` — which contributes ``ls``, ``read_file``,
``write_file``, ``edit_file``, ``glob``, ``grep`` and, whenever the backend is a
sandbox, ``execute``. A subagent spec's ``tools`` list only *adds* to that; there
is no field to take one away. (deepagents has a private equivalent of this class,
but it is switched on by a harness profile, which is chosen per *model* — it would
hide the tool from everything running that model, not from one subagent.)

So the researcher gets its shell taken away here, in two layers:

1. ``wrap_model_call`` — removes the tool from the list sent to the model. The
   model never sees a schema for it, so it has no way to ask for it. This is the
   layer that actually changes behaviour.
2. ``wrap_tool_call`` — the tool is still *registered* (FilesystemMiddleware put
   it there), and the executor dispatches on whatever name the model emits. If a
   call to a hidden tool arrives anyway, it is answered with an error instead of
   run. Belt and braces: it keeps what runs consistent with what was advertised.

Approval (``interrupt_on``) is deliberately still inherited from the lead. With
the tool hidden it should never fire for the researcher; if this middleware were
ever removed by mistake, the shell comes back *gated*, not open.

Both the sync and async hooks are implemented — the LangGraph server runs graphs
asynchronously and a sync-only middleware raises NotImplementedError there.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from typing import Any

from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.messages import ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command


def _tool_name(tool: Any) -> str | None:
    """A tool's name, whether it is a ``BaseTool`` or a provider-format dict."""
    if isinstance(tool, dict):
        name = tool.get("name") or (tool.get("function") or {}).get("name")
    else:
        name = getattr(tool, "name", None)
    return name if isinstance(name, str) else None


class HideToolsMiddleware(AgentMiddleware):
    """Removes the named tools from this agent's model calls and refuses calls to them."""

    name = "HideToolsMiddleware"

    def __init__(self, hidden: Iterable[str]) -> None:
        super().__init__()
        self.hidden = frozenset(hidden)

    # -- layer 1: the model never sees them -----------------------------------

    def _without_hidden(self, request: ModelRequest) -> ModelRequest:
        kept = [t for t in request.tools if _tool_name(t) not in self.hidden]
        if len(kept) == len(request.tools):
            return request
        return request.override(tools=kept)

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        return handler(self._without_hidden(request))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return await handler(self._without_hidden(request))

    # -- layer 2: a call that names one anyway is refused, not run -------------

    def _refusal(self, request: ToolCallRequest) -> ToolMessage | None:
        name = request.tool_call["name"]
        if name not in self.hidden:
            return None
        return ToolMessage(
            content=f"Error: {name} is not available to you.",
            tool_call_id=request.tool_call["id"] or "",
            name=name,
            status="error",
        )

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        return self._refusal(request) or handler(request)

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        return self._refusal(request) or await handler(request)
