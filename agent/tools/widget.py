"""Widget tool — Open Generative UI: a small interactive page the lead writes itself.

For the cases a chart or a dashboard can't cover: a calculator, a what-if with
sliders, a small simulation. The lead writes self-contained HTML (inline CSS and
JS); the browser runs it with CopilotKit's Open Generative UI renderer inside a
sandboxed iframe (``web/src/components/WidgetCard.tsx``).

It is model-written code, so the browser contains it rather than trusting it:
the iframe is ``sandbox="allow-scripts"`` only (no access to the app, its
cookies or its storage), a Content-Security-Policy blocks every network request
and external resource, and a widget whose frame navigates away is closed. Like
the other render tools, the arguments are the payload, so a widget comes back
when the conversation is reopened.
"""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.charts import chart_slug

_MAX_HTML = 40_000
_MIN_HEIGHT, _MAX_HEIGHT = 120, 900


@tool(parse_docstring=True)
def render_widget(title: str, html: str, initial_height: int = 360) -> dict[str, Any]:
    """Run a small interactive widget in the chat: a calculator, sliders, a simulation.

    Use it only when the user asks for something interactive, or a what-if is
    clearly better explored than described. Prefer `render_chart` or
    `render_dashboard` for showing numbers. Each widget costs a full page of
    output, so keep it small and use one per answer at most.

    Write one self-contained HTML document with inline `<style>` and `<script>`.
    It runs in a sandbox with no network: no fetch, CDN scripts, web fonts or
    remote images (use inline SVG). Embed any data it needs. For colours, use
    the CSS variables that are already defined, so it matches light and dark
    mode: --wb-panel (background), --wb-text, --wb-muted, --wb-border,
    --wb-accent, --wb-good, --wb-warn. The system font is already set.

    Args:
        title: Short title, shown above the widget.
        html: The complete HTML document (max 40,000 characters).
        initial_height: Starting height in pixels (120-900); it grows to fit.
    """
    if not html.strip():
        return {"error": "html is empty"}
    if len(html) > _MAX_HTML:
        return {"error": f"html is {len(html):,} characters — keep the widget under {_MAX_HTML:,}"}
    if not _MIN_HEIGHT <= initial_height <= _MAX_HEIGHT:
        return {"error": f"initial_height must be between {_MIN_HEIGHT} and {_MAX_HEIGHT}"}
    return {"rendered": True, "widget_id": chart_slug(title)}
