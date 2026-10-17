"""focus_panel — the agent points the user at something it just made.

This used to be a CopilotKit *frontend* tool (run in the browser), which broke
when the model called it in the same turn as backend tools: the agent carried
on without its result, the browser ran it after the run ended and appended the
result after the final answer, then started a follow-up run whose conversation
ended on an assistant message — which the Claude 5.5 models reject ("does not
support assistant message prefill").

As a backend tool it returns at once, and the browser acts on the call itself
(``useFocusPanel`` in web/src/app/page.tsx), the way it renders every other
tool call. No round trip, no follow-up run, no extra model call.
"""

from __future__ import annotations

from typing import Literal

from langchain.tools import tool


@tool(parse_docstring=True)
def focus_panel(
    panel: Literal["console", "charts"] | None = None,
    file_path: str | None = None,
    chart_id: str | None = None,
) -> str:
    """Bring part of the workbench to the user's attention.

    Call it when you have just produced something the user should look at:
    switch the Sandbox panel's tab, open a file you wrote in the Workspace
    viewer, or open a chart full screen.

    Args:
        panel: Which Sandbox tab to show: "console" or "charts" (use "charts"
            right after render_chart).
        file_path: Absolute path of a file you wrote, e.g. /reports/summary.md.
        chart_id: A chart_id returned by render_chart, to open it full screen.
    """
    shown = [
        f"the {panel} tab" if panel else "",
        file_path or "",
        f"chart {chart_id}" if chart_id else "",
    ]
    shown = [s for s in shown if s]
    return f"Shown to the user: {', '.join(shown)}." if shown else "Nothing to show; pass panel, file_path or chart_id."
