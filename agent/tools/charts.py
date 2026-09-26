"""Structured chart tool — the sandbox computes, this hands off the result.

Why not a chart image: a script run via `execute` that saves a PNG inside the
sandbox VM is a plain file write, invisible to the frontend — only tool-call
arguments and results ever cross to the browser (see README's "Who sees what"
diagram in the MDA Agentic Workflow section). Passing the finished numbers as
this tool's arguments reuses the same streaming mechanism that already renders
every other tool call, at a fraction of the token cost of a base64-encoded
image, and lets the frontend render a real, interactive chart instead of a
static picture.

Validation here mirrors research.py's pattern: return a descriptive error
dict rather than raising, so the model can adapt (fix the shape, retry) instead
of the whole run aborting on one malformed chart request.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from langchain.tools import tool

_MAX_SERIES = 6
_MAX_CATEGORIES = 12
_MAX_ID_LENGTH = 48


def chart_slug(text: str) -> str:
    """Normalize a chart id (or, when none is given, the title) into a slug.

    Mirrored exactly by `chartSlug` in web/src/lib/workbench.ts — the frontend
    derives the same id from the same arguments, which is what lets a report's
    ```chart <id>``` block find the chart it names. Change both or neither.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:_MAX_ID_LENGTH].strip("-") or "chart"


@tool(parse_docstring=True)
def render_chart(
    title: str,
    chart_type: Literal["bar", "line"],
    categories: list[str],
    series: list[dict[str, Any]],
    x_label: str = "",
    y_label: str = "",
    chart_id: str = "",
) -> dict[str, Any]:
    """Render a chart in the Artifact Canvas from already-computed numbers.

    Compute the numbers first (via `execute` if the math is nontrivial) — never
    generate a chart image file; the sandbox filesystem never reaches the
    frontend. Only "bar" and "line" are supported: bar for comparing
    magnitudes across categories, line for a trend across an ordered axis
    (time, versions). Never ask for a pie chart — a bar chart reads better for
    the comparisons this tool exists for.

    Args:
        title: Chart title, shown above the plot.
        chart_type: "bar" for comparing magnitudes across categories, "line"
            for a trend across an ordered axis.
        categories: The x-axis labels, in display order. 2-12 items — a
            single category is not a chart, use a sentence instead.
        series: 1-6 series, each `{"name": str, "values": [number, ...],
            "unit": str}` with exactly one value per category, in the same
            order. Always set `unit` (e.g. "USD", "ms", "%"). Series with
            different units are drawn as separate stacked panels, each with
            its own axis — never forced onto one shared scale, where the
            smaller-unit series would look like zero. More than 6 series stops
            reading as a chart — fold minor series into "Other" or split.
        x_label: Optional x-axis label.
        y_label: Optional y-axis label, used when every series shares a unit.
        chart_id: Optional short id; defaults to a slug of the title. Use the
            id this tool returns to embed the chart in a markdown report.
    """
    if len(categories) < 2:
        return {
            "error": (
                "categories needs at least 2 items — a one-category chart "
                "is not a chart, say the number in prose instead"
            )
        }
    if len(categories) > _MAX_CATEGORIES:
        return {
            "error": (
                f"{len(categories)} categories is too many to read — cap at "
                f"{_MAX_CATEGORIES}. Aggregate the smaller ones or split the chart."
            )
        }

    if not series:
        return {"error": "series must be non-empty"}
    if len(series) > _MAX_SERIES:
        return {
            "error": (
                f"{len(series)} series is too many to read as a chart — cap "
                f"at {_MAX_SERIES}. Fold minor series into an 'Other' bucket, "
                "or split into more than one chart."
            )
        }

    for s in series:
        name = s.get("name")
        values = s.get("values")
        if not name or not isinstance(values, list):
            return {"error": f"each series needs a 'name' and a 'values' list, got {s!r}"}
        if len(values) != len(categories):
            return {
                "error": (
                    f"series {name!r} has {len(values)} values but there are "
                    f"{len(categories)} categories — they must match 1:1"
                )
            }

    resolved_id = chart_slug(chart_id or title)
    units = {str(s.get("unit") or "") for s in series}
    return {
        "rendered": True,
        "chart_id": resolved_id,
        "chart_type": chart_type,
        "series_count": len(series),
        "category_count": len(categories),
        "panels": len(units),
        "embed_in_report": f"```chart\n{resolved_id}\n```",
    }
