"""Web research via Tavily.

Returns a structured result rather than a prose blob: the frontend renders sources
as a component (see the Sources panel), and the agent gets clean text to reason
over. Keeping both in one payload avoids a second round trip.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from langchain.tools import tool
from tavily import TavilyClient


@lru_cache(maxsize=1)
def _client() -> TavilyClient:
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        raise RuntimeError(
            "TAVILY_API_KEY is not set. Add it to .env — the research tool cannot "
            "run without it."
        )
    return TavilyClient(api_key=key)


@tool(parse_docstring=True)
def research(query: str, depth: str = "basic") -> dict[str, Any]:
    """Search the web and return sourced findings.

    Use this instead of answering from memory whenever the answer depends on
    current facts, prices, releases, or anything specific enough to cite.

    Args:
        query: A focused, self-contained question. Prefer several narrow queries
            over one broad one — results are better and cheaper.
        depth: "basic" for a quick lookup, "advanced" for a slower, deeper crawl.
            Use "advanced" only when a basic search came back thin.
    """
    if depth not in ("basic", "advanced"):
        depth = "basic"

    try:
        raw = _client().search(
            query=query,
            search_depth=depth,
            include_answer=True,
            max_results=6,
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the model, not raised
        # Returning the error lets the agent adapt (rephrase, try again, or tell
        # the user) instead of aborting the whole run on one bad search.
        return {"query": query, "error": str(exc), "summary": "", "sources": []}

    sources = [
        {
            "url": item.get("url", ""),
            "title": item.get("title", "") or item.get("url", ""),
            "content": (item.get("content") or "")[:1500],
            "score": item.get("score"),
        }
        for item in raw.get("results", [])
    ]

    return {
        "query": query,
        "summary": raw.get("answer") or "",
        "sources": sources,
    }
