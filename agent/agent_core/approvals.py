"""Plain-language descriptions for approval requests.

`interrupt_on` shows a person a raw shell command and asks them to approve it.
That is fine for an engineer and cryptic for everyone else, so the description
is generated per call — deterministically, with no extra model call — from two
things: what the agent said it was about to do (the text of the message that
carries the tool call), and a plain reading of the command itself (what it
reads, what it saves, and anything that deserves a warning).

The result is plain text that reads well anywhere (LangSmith Studio shows it
as-is), with a light line convention the web approval card renders richly:

    <headline>
    Why: <the agent's own words>
    - <detail>
    ! <warning>

This is a best-effort *summary*, not a security boundary: the card always
keeps the exact command one click away, and the sandbox is what actually
contains the command.
"""

from __future__ import annotations

import re
from typing import Any

_MAX_ITEMS = 3
_MAX_WHY = 220

# Workspace paths the agent uses; anything else is left out of the summary.
_PATH = r"/(?:research|reports|memories|data|tmp|workspace)/[\w.\-/]*[\w]"

_WRITE_PATTERNS = [
    rf">>?\s*({_PATH})",
    rf"\btee\s+(?:-a\s+)?({_PATH})",
    rf"""open\(\s*['"]({_PATH})['"]\s*,\s*['"][wa]""",
    rf"""\.(?:to_csv|to_json|to_excel|to_parquet|savefig|write_text|write_bytes)\(\s*['"]({_PATH})['"]""",
    rf"\b(?:cp|mv)\s+\S+\s+({_PATH})",
    rf"\s-o\s+({_PATH})",
]

_DELETE_PATTERNS = [
    rf"\brm\s+(?:-\w+\s+)*({_PATH})",
    rf"""(?:rmtree|os\.remove|os\.unlink)\(\s*['"]({_PATH})['"]""",
]

_WARNINGS: list[tuple[str, str]] = [
    (
        r"\b(?:curl|wget|git\s+clone)\b|requests\.|urllib|httpx|\b(?:pip3?|uv\s+pip|apt(?:-get)?)\s+install\b",
        "Connects to the internet",
    ),
    (r"\brm\s|\brmtree\b|os\.remove|os\.unlink|\.unlink\(", "Deletes files"),
    (r"\bsudo\b", "Asks for administrator rights inside the sandbox"),
]


def _headline(command: str) -> str:
    c = command.strip()
    if re.search(r"\b(?:pip3?|uv\s+pip|apt(?:-get)?)\s+install\b", c):
        return "Install software packages in the sandbox."
    script = re.search(r"\bpython3?\s+([\w./-]+\.py)\b", c)
    if script:
        return f"Run the Python script {script.group(1).rsplit('/', 1)[-1]}."
    if re.search(r"\bpython3?\b", c):
        return "Run a short Python program."
    if re.fullmatch(r"(?:\s*(?:ls|cat|head|tail|wc|find|du)\b[^;&|]*[;&|]*)+", c):
        return "Look at files in the workspace."
    return "Run a command in the sandbox."


def _unique(items: list[str]) -> list[str]:
    seen: dict[str, None] = {}
    for item in items:
        seen.setdefault(item, None)
    return list(seen)


def _stated_intent(state: Any) -> str:
    """The agent's own words from the message that carries the tool call."""
    messages = state.get("messages") if isinstance(state, dict) else getattr(state, "messages", None)
    if not messages:
        return ""
    content = getattr(messages[-1], "content", "")
    if isinstance(content, list):
        content = " ".join(
            b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
        )
    text = " ".join(str(content).split())
    if not text:
        return ""
    sentence = re.split(r"(?<=[.!?])\s", text, maxsplit=1)[0]
    return sentence if len(sentence) <= _MAX_WHY else sentence[: _MAX_WHY - 1].rstrip() + "…"


def describe_command(command: str, intent: str = "") -> str:
    """Plain-language description of a sandbox command. Pure; unit-testable."""
    writes = _unique([m for p in _WRITE_PATTERNS for m in re.findall(p, command)])
    deletes = _unique([m for p in _DELETE_PATTERNS for m in re.findall(p, command)])
    reads = [p for p in _unique(re.findall(_PATH, command)) if p not in writes and p not in deletes]

    lines = [_headline(command)]
    if intent:
        lines.append(f"Why: {intent}")
    lines += [f"- Uses {p}" for p in reads[:_MAX_ITEMS]]
    lines += [f"- Saves {p}" for p in writes[:_MAX_ITEMS]]
    lines += [f"- Deletes {p}" for p in deletes[:_MAX_ITEMS]]
    hidden = sum(max(0, len(group) - _MAX_ITEMS) for group in (reads, writes, deletes))
    if hidden:
        lines.append(f"- …and {hidden} more file{'s' if hidden > 1 else ''}")
    lines += [f"! {label}" for pattern, label in _WARNINGS if re.search(pattern, command)]
    return "\n".join(lines)


def describe_execute(tool_call: Any, state: Any, runtime: Any) -> str:
    """`InterruptOnConfig.description` factory for the sandbox `execute` tool."""
    command = str((tool_call.get("args") or {}).get("command", ""))
    return describe_command(command, _stated_intent(state))
