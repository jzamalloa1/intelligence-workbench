"""Dashboard tool — an A2UI v0.9 surface laid out from the workbench's own components.

The lead describes a dashboard as a flat A2UI component list (each component has
an ``id`` and a ``component`` type; containers name their children by id). The
browser renders it with CopilotKit's A2UI renderer and a catalog of our own
components (``web/src/components/dashboard/catalog.tsx``) — headline metrics,
charts already drawn with ``render_chart``, small tables — inline in the chat.

Like ``render_chart``, the arguments *are* the payload: the frontend renders from
the tool call, so a dashboard survives reopening the conversation the same way a
chart does. Validation returns a descriptive error instead of raising, so the
model fixes the layout and calls again rather than the run failing.

Only literal values are supported — no data-model paths, templates or actions.
That keeps the format small enough to describe in this docstring.
"""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.charts import chart_slug

_MAX_COMPONENTS = 40
_MAX_DEPTH = 6
_MAX_TABLE_ROWS = 20
_MAX_TABLE_COLUMNS = 8

#: Component type → (required props, optional props). Mirrors the catalog in
#: web/src/components/dashboard/catalog.tsx — change both or neither.
CATALOG: dict[str, tuple[set[str], set[str]]] = {
    "Column": ({"children"}, {"align"}),
    "Row": ({"children"}, {"justify", "align"}),
    "Card": ({"child"}, set()),
    "Text": ({"text"}, {"variant"}),
    "Divider": (set(), set()),
    "Metric": ({"label", "value"}, {"delta", "trend", "caption"}),
    "Chart": ({"chartId"}, set()),
    "Table": ({"columns", "rows"}, {"caption"}),
}
_ENUMS = {
    "variant": {"h2", "h3", "body", "caption"},
    "trend": {"up", "down", "flat"},
    "justify": {"start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly", "stretch"},
    "align": {"start", "center", "end", "stretch"},
}


def _check(components: list[dict[str, Any]]) -> str | None:
    """The first problem with the layout, phrased for the model, or None."""
    if not components:
        return "components must be non-empty"
    if len(components) > _MAX_COMPONENTS:
        return f"{len(components)} components is too many — cap at {_MAX_COMPONENTS}; a dashboard is an overview"
    by_id: dict[str, dict[str, Any]] = {}
    for c in components:
        if not isinstance(c, dict) or not isinstance(c.get("id"), str) or not c["id"]:
            return f"every component needs a string 'id', got {c!r}"
        if c["id"] in by_id:
            return f"duplicate component id {c['id']!r} — ids must be unique"
        by_id[c["id"]] = c
    if "root" not in by_id:
        return "one component must have id 'root' — usually a Column"

    for cid, c in by_id.items():
        kind = c.get("component")
        if kind not in CATALOG:
            return f"{cid!r}: unknown component {kind!r}; use one of {', '.join(CATALOG)}"
        required, optional = CATALOG[kind]
        props = set(c) - {"id", "component"}
        if missing := required - props:
            return f"{cid!r} ({kind}) is missing {', '.join(sorted(missing))}"
        if extra := props - required - optional:
            return f"{cid!r} ({kind}) has unsupported props {', '.join(sorted(extra))}"
        for key, allowed in _ENUMS.items():
            if key in c and c[key] not in allowed:
                return f"{cid!r}: {key} must be one of {', '.join(sorted(allowed))}"
        refs = c.get("children", []) if kind in {"Column", "Row"} else [c["child"]] if kind == "Card" else []
        if kind in {"Column", "Row"} and (not isinstance(refs, list) or not refs):
            return f"{cid!r}: children must be a non-empty list of component ids"
        for ref in refs:
            if ref not in by_id:
                return f"{cid!r} names child {ref!r}, which is not a component in this list"
            if ref == cid:
                return f"{cid!r} lists itself as a child"
        if kind == "Table":
            cols, rows = c["columns"], c["rows"]
            if not isinstance(cols, list) or not 1 <= len(cols) <= _MAX_TABLE_COLUMNS:
                return f"{cid!r}: columns must list 1-{_MAX_TABLE_COLUMNS} headers"
            if not isinstance(rows, list) or not 1 <= len(rows) <= _MAX_TABLE_ROWS:
                return f"{cid!r}: rows must hold 1-{_MAX_TABLE_ROWS} rows — put the full table in the report"
            if any(not isinstance(r, list) or len(r) != len(cols) for r in rows):
                return f"{cid!r}: every row needs exactly {len(cols)} cell{'' if len(cols) == 1 else 's'}, one per column"

    # Reachable from root, acyclic, not too deep.
    seen: set[str] = set()

    def walk(cid: str, depth: int, path: tuple[str, ...]) -> str | None:
        if cid in path:
            return f"cycle: {' → '.join((*path, cid))}"
        if depth > _MAX_DEPTH:
            return f"nesting deeper than {_MAX_DEPTH} levels under {path[0]!r} — flatten the layout"
        seen.add(cid)
        c = by_id[cid]
        refs = c.get("children", []) if c["component"] in {"Column", "Row"} else [c["child"]] if c["component"] == "Card" else []
        for ref in refs:
            if err := walk(ref, depth + 1, (*path, cid)):
                return err
        return None

    if err := walk("root", 1, ()):
        return err
    if orphans := set(by_id) - seen:
        return f"components not reachable from 'root': {', '.join(sorted(orphans))}"
    return None


@tool(parse_docstring=True)
def render_dashboard(title: str, components: list[dict[str, Any]], dashboard_id: str = "") -> dict[str, Any]:
    """Lay out a dashboard in the chat: headline metrics, charts and a small table.

    Use it to give an overview of an answer that rests on a few numbers — once,
    after the numbers are final; the report stays the full deliverable. Draw any
    chart with `render_chart` first and place it here by its chart_id.

    `components` is a flat A2UI list. Each item is
    `{"id": str, "component": <type>, ...props}`; one has id "root". Containers
    name children by id. Literal values only. Types and props (* = required):

    - Column: children* [ids], align ("start"|"center"|"end"|"stretch")
    - Row: children* [ids], justify ("start"|"center"|"end"|"spaceBetween"|...), align
    - Card: child* (id)
    - Text: text*, variant ("h2"|"h3"|"body"|"caption")
    - Divider
    - Metric: label*, value* (formatted, e.g. "$4.2B"), delta (e.g. "+12% YoY"),
      trend ("up"|"down"|"flat"), caption (source or period)
    - Chart: chartId* (returned by render_chart in this conversation)
    - Table: columns* [headers], rows* [[cell, ...], ...] (max 20 rows, 8 columns), caption

    Example — three metrics over a chart:
    [{"id": "root", "component": "Column", "children": ["kpis", "trend"]},
     {"id": "kpis", "component": "Row", "children": ["m1", "m2", "m3"]},
     {"id": "m1", "component": "Metric", "label": "Market size", "value": "$4.2B", "delta": "+18% YoY", "trend": "up"},
     ...,
     {"id": "trend", "component": "Chart", "chartId": "market-size-2020-2026"}]

    Args:
        title: Dashboard title, shown in its header.
        components: The flat A2UI component list described above.
        dashboard_id: Optional short id; defaults to a slug of the title.
    """
    if err := _check(components):
        return {"error": err}
    return {
        "rendered": True,
        "dashboard_id": chart_slug(dashboard_id or title),
        "components": len(components),
    }
