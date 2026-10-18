"""Writes land before commands that were sent in the same turn.

The model often writes a script and runs it in one turn:
``write_file /reports/analysis.py`` + ``execute "python3 analysis.py"``. Tool
calls from one turn run at the same time, so the command can start before the
upload has finished and fail with "No such file or directory" — then the model
retries, and every retry is another approval for the user. Seen twice in one
conversation (2026-10-17, ARCHITECTURE §6).

So an ``execute`` waits for the ``write_file`` / ``edit_file`` calls of its own
turn to finish, then runs. Calls from earlier turns, or already answered in the
thread, are not waited for; a stuck write releases the command after
``_MAX_WAIT`` seconds rather than hanging the run.

One registry of ``threading.Event`` serves both hooks: the async hook waits in a
worker thread, so it never blocks the event loop.
"""

from __future__ import annotations

import asyncio
import threading
from collections import OrderedDict
from collections.abc import Awaitable, Callable

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command

WRITES = frozenset({"write_file", "edit_file"})
_MAX_WAIT = 60.0
_KEEP = 2_000  # finished writes remembered, oldest forgotten first

_lock = threading.Lock()
_events: OrderedDict[str, threading.Event] = OrderedDict()


def _event(call_id: str) -> threading.Event:
    with _lock:
        ev = _events.get(call_id)
        if ev is None:
            ev = _events[call_id] = threading.Event()
            while len(_events) > _KEEP:
                _events.popitem(last=False)
        return ev


def _pending_writes(request: ToolCallRequest) -> list[str]:
    """Ids of writes sent in the same turn as this call and not yet answered."""
    call_id = request.tool_call.get("id")
    messages = (request.state or {}).get("messages", []) if isinstance(request.state, dict) else []
    answered = {m.tool_call_id for m in messages if isinstance(m, ToolMessage)}
    for m in reversed(messages):
        calls = getattr(m, "tool_calls", None) or []
        if any(c.get("id") == call_id for c in calls):
            return [c["id"] for c in calls if c.get("name") in WRITES and c.get("id") and c["id"] not in answered]
    return []


def _wait(ids: list[str]) -> None:
    for i in ids:
        _event(i).wait(_MAX_WAIT)


class WriteBeforeExecuteMiddleware(AgentMiddleware):
    """Holds an ``execute`` until its turn's file writes have finished."""

    name = "WriteBeforeExecuteMiddleware"

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        name = request.tool_call.get("name")
        if name in WRITES:
            try:
                return handler(request)
            finally:
                _event(request.tool_call["id"]).set()
        if name == "execute":
            _wait(_pending_writes(request))
        return handler(request)

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        name = request.tool_call.get("name")
        if name in WRITES:
            try:
                return await handler(request)
            finally:
                _event(request.tool_call["id"]).set()
        if name == "execute":
            if pending := _pending_writes(request):
                await asyncio.to_thread(_wait, pending)
        return await handler(request)

