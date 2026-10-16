"""Files the user attaches in the chat: saved to the sandbox, described to the model.

CopilotChat sends an attachment as an AG-UI content part; ``@ag-ui/langgraph``
turns it into a LangChain block on the user's message — an ``image_url`` data URL
for images, a base64 ``file`` block for everything else. Left like that, two
things go wrong:

- Anthropic accepts base64 *documents* only as PDF, so a CSV fails the call, and
  nothing in the agent can open a file that exists only inside a message.
- The base64 stays in state. deepagents' summarization counts tokens by length
  for non-image blocks, so a 1 MB PDF reads as ~330K tokens and compacts the
  conversation on the first call — and every later call re-sends it.

So before the agent's first model call (``before_agent``), each new user message
carrying files is rewritten once, in state, by id:

- every file is written to the conversation's sandbox under ``/workspace/attachments/``
  (MDA's own Slack integration uses the same directory), where the lead can
  ``read_file`` it or analyse it with Python;
- non-image blocks are replaced by an ``<attachment>`` text note: name, type,
  size, path, and what's inside — the whole text for a small file, a preview
  for a large one, extracted text for a PDF (also saved next to it as ``.txt``);
- images stay as image blocks, so the model still sees them, with a note added
  for their sandbox copy.

Text notes rather than custom blocks, so the rewritten message is valid input
for every provider and for the summarization model alike. The web app renders
the notes back as file chips (``web/src/lib/attachments.ts``). The rewrite is
deterministic and happens once, so the conversation prefix stays stable for
prompt caching and preserved thinking.
"""

from __future__ import annotations

import base64
import binascii
import io
import posixpath
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from langchain.agents.middleware import AgentMiddleware, AgentState
from langchain_core.messages import AnyMessage, HumanMessage
from langgraph.runtime import Runtime

ATTACHMENTS_DIR = "/workspace/attachments"
#: A text file up to this size goes to the model whole; larger ones as a preview.
INLINE_CHARS = 12_000
PREVIEW_LINES = 20
PREVIEW_CHARS = 4_000

_TEXT_EXTENSIONS = {"csv", "tsv", "txt", "md", "markdown", "json", "jsonl", "xml", "html", "yaml", "yml", "log"}
_TABULAR = {"csv": ",", "tsv": "\t"}
# The adapter's key for image filenames, which it can't put on the block itself.
_AGUI_KEY = "ag-ui"


@dataclass
class _File:
    index: int  # position of its block in the message
    name: str
    mime: str
    data: bytes
    is_image: bool
    path: str = ""


# -- reading blocks ----------------------------------------------------------


def _data_url(url: str) -> tuple[str, bytes] | None:
    """``data:<mime>;base64,<payload>`` → (mime, bytes)."""
    if not url.startswith("data:") or "," not in url:
        return None
    head, payload = url[5:].split(",", 1)
    parts = head.split(";")
    if "base64" not in (p.strip().lower() for p in parts[1:]):
        return None
    try:
        return parts[0].strip().lower(), base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError):
        return None


def _image_names(message: HumanMessage) -> dict[int, str]:
    entries = (message.additional_kwargs.get(_AGUI_KEY) or {}).get("attachments") or []
    return {e["index"]: e["filename"] for e in entries if isinstance(e, dict) and "index" in e and e.get("filename")}


def _file_of(index: int, block: Any, image_names: dict[int, str]) -> _File | None:
    """The attachment a content block carries, or None for text and plain URLs."""
    if not isinstance(block, dict):
        return None
    kind = block.get("type")
    if kind == "image_url":
        url = block.get("image_url")
        url = url.get("url") if isinstance(url, dict) else url
        decoded = _data_url(url) if isinstance(url, str) else None
        if not decoded:
            return None
        mime, data = decoded
        ext = mime.split("/")[-1].replace("jpeg", "jpg")
        return _File(index, image_names.get(index) or f"image-{index + 1}.{ext}", mime, data, mime.startswith("image/"))
    if kind in {"file", "image", "audio", "video"}:
        payload = block.get("data") or block.get("base64")
        if not payload and isinstance(block.get("url"), str):
            decoded = _data_url(block["url"])
            if decoded:
                mime, data = decoded
                block = {**block, "mime_type": block.get("mime_type") or mime}
                payload = base64.b64encode(data).decode()
        if not isinstance(payload, str) or not payload:
            return None
        try:
            data = base64.b64decode(payload, validate=False)
        except (binascii.Error, ValueError):
            return None
        mime = str(block.get("mime_type") or "application/octet-stream").lower()
        name = (block.get("metadata") or {}).get("filename") or block.get("filename") or f"attachment-{index + 1}"
        return _File(index, str(name), mime, data, kind == "image" and mime.startswith("image/"))
    return None


def _noted(message: HumanMessage) -> bool:
    """Already rewritten: its images keep their bytes, so look for our notes instead."""
    return any(
        isinstance(b, dict) and b.get("type") == "text" and str(b.get("text", "")).startswith("<attachment ")
        for b in message.content
    )


def _files(message: AnyMessage) -> list[_File]:
    if not isinstance(message, HumanMessage) or not isinstance(message.content, list) or _noted(message):
        return []
    names = _image_names(message)
    return [f for i, b in enumerate(message.content) if (f := _file_of(i, b, names))]


# -- naming ------------------------------------------------------------------


def _safe_name(name: str) -> str:
    base = posixpath.basename(name.replace("\\", "/"))
    return re.sub(r"[^A-Za-z0-9._-]", "_", base)[:120].strip("._") or "file"


def _assign_paths(files: Sequence[_File], taken: set[str]) -> None:
    for f in files:
        f.name = _safe_name(f.name)
        stem, dot, ext = f.name.rpartition(".")
        stem, ext = (stem, f".{ext}") if dot and stem else (f.name, "")
        candidate, n = f.name, 2
        while candidate in taken:
            candidate, n = f"{stem}-{n}{ext}", n + 1
        taken.add(candidate)
        f.path = f"{ATTACHMENTS_DIR}/{candidate}"


# -- describing --------------------------------------------------------------


def _size(n: int) -> str:
    for unit in ("B", "KB", "MB"):
        if n < 1024 or unit == "MB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n} B"


def _ext(f: _File) -> str:
    return f.name.rsplit(".", 1)[-1].lower() if "." in f.name else ""


def _as_text(f: _File) -> str | None:
    if not (f.mime.startswith("text/") or f.mime in {"application/json", "application/xml"} or _ext(f) in _TEXT_EXTENSIONS):
        return None
    try:
        return f.data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return f.data.decode("latin-1")


def _pdf_text(data: bytes) -> tuple[int, str] | None:
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages = [(p.extract_text() or "").strip() for p in reader.pages]
    except Exception:  # noqa: BLE001 - a malformed PDF is described, not fatal
        return None
    return len(pages), "\n\n".join(f"[page {i}]\n{t}" for i, t in enumerate(pages, 1) if t)


def _pages(n: int) -> str:
    return f"{n} page" if n == 1 else f"{n} pages"


def _text_body(f: _File, text: str) -> str:
    lines = text.splitlines()
    sep = _TABULAR.get(_ext(f)) or (_TABULAR["csv"] if f.mime == "text/csv" else None)
    summary = f"{len(lines):,} lines" + (f" ({max(len(lines) - 1, 0):,} data rows + header)" if sep and lines else "")
    if len(text) <= INLINE_CHARS:
        return f"{summary}. Full contents:\n{text}"
    preview = "\n".join(lines[:PREVIEW_LINES])[:PREVIEW_CHARS]
    return f"{summary}. First {PREVIEW_LINES} lines (the full file is at the path above):\n{preview}"


def _body(f: _File, extra: dict[str, bytes]) -> str:
    if f.is_image:
        return "The image itself is attached to this message."
    if (text := _as_text(f)) is not None:
        return _text_body(f, text)
    if f.mime == "application/pdf" or _ext(f) == "pdf":
        parsed = _pdf_text(f.data)
        if parsed is None:
            return "PDF that could not be parsed. Try opening it with Python in the sandbox."
        pages, text = parsed
        if not text:
            return f"PDF, {_pages(pages)}, with no extractable text (probably scanned)."
        extra[f"{f.path}.txt"] = text.encode()
        if len(text) <= INLINE_CHARS:
            return f"PDF, {_pages(pages)}. Extracted text:\n{text}"
        return (
            f"PDF, {_pages(pages)}. The full extracted text is at {f.path}.txt; "
            f"the first {INLINE_CHARS:,} characters:\n{text[:INLINE_CHARS]}"
        )
    return "Binary file. Open it with Python in the sandbox (e.g. pandas for spreadsheets)."


def _note(f: _File, body: str, error: str | None) -> str:
    path = "" if error else f.path
    status = f"Not saved to the sandbox ({error}). " if error else ""
    body = body.replace("</attachment>", "<\\/attachment>")
    return (
        f'<attachment name="{f.name}" type="{f.mime}" size="{_size(len(f.data))}" path="{path}">\n'
        f"{status}{body}\n</attachment>"
    )


# -- the rewrite -------------------------------------------------------------


def _pending(messages: Sequence[AnyMessage]) -> list[HumanMessage]:
    """User messages after the last AI turn that still carry raw files."""
    out: list[HumanMessage] = []
    for m in reversed(messages):
        if m.type == "ai":
            break
        if isinstance(m, HumanMessage) and _files(m):
            out.append(m)
    return out[::-1]


def _rewrite(message: HumanMessage, files: list[_File], bodies: dict[int, str], errors: dict[str, str]) -> HumanMessage:
    by_index = {f.index: f for f in files}
    content: list[Any] = []
    moved: dict[int, int] = {}  # old block index → new, for image filenames
    for i, block in enumerate(message.content):
        f = by_index.get(i)
        if f is None or f.is_image:
            moved[i] = len(content)
            content.append(block)
    content += [{"type": "text", "text": _note(f, bodies[f.index], errors.get(f.path))} for f in files]

    kwargs = dict(message.additional_kwargs)
    agui = dict(kwargs.get(_AGUI_KEY) or {})
    if agui.get("attachments"):
        agui["attachments"] = [
            {**e, "index": moved[e["index"]]}
            for e in agui["attachments"]
            if isinstance(e, dict) and e.get("index") in moved
        ]
        kwargs[_AGUI_KEY] = agui
    return HumanMessage(id=message.id, content=content, additional_kwargs=kwargs, name=message.name)


@dataclass
class _Plan:
    message: HumanMessage
    files: list[_File]
    bodies: dict[int, str]
    uploads: list[tuple[str, bytes]]


def _plan(messages: list[HumanMessage], taken: set[str]) -> list[_Plan]:
    plans = []
    for m in messages:
        files = _files(m)
        _assign_paths(files, taken)
        extra: dict[str, bytes] = {}
        bodies = {f.index: _body(f, extra) for f in files}
        uploads = [(f.path, f.data) for f in files] + list(extra.items())
        plans.append(_Plan(m, files, bodies, uploads))
    return plans


def _errors(uploads: list[tuple[str, bytes]], results: Sequence[Any] | None, reason: str | None) -> dict[str, str]:
    if reason:
        return {path: reason for path, _ in uploads}
    return {path: str(r.error) for (path, _), r in zip(uploads, results or [], strict=False) if getattr(r, "error", None)}


def _taken(listing: Any) -> set[str]:
    entries = getattr(listing, "entries", None) or []
    return {posixpath.basename(e["path"].rstrip("/")) for e in entries if isinstance(e, dict) and e.get("path")}


class AttachmentsMiddleware(AgentMiddleware):
    """Saves attached files to the sandbox and swaps their bytes for a text note."""

    name = "AttachmentsMiddleware"

    def before_agent(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        pending = _pending(state["messages"])
        if not pending:
            return None
        backend = getattr(runtime, "backend", None)
        taken: set[str] = set()
        if backend is not None:
            try:
                taken = _taken(backend.ls(ATTACHMENTS_DIR))
            except Exception:  # noqa: BLE001 - a fresh sandbox has no such directory
                pass
        plans = _plan(pending, taken)
        uploads = [u for p in plans for u in p.uploads]
        results, reason = None, None if backend is not None else "no sandbox attached"
        if backend is not None:
            try:
                results = backend.upload_files(uploads)
            except Exception as e:  # noqa: BLE001 - the note says so; the run goes on
                reason = type(e).__name__
        errors = _errors(uploads, results, reason)
        return {"messages": [_rewrite(p.message, p.files, p.bodies, errors) for p in plans]}

    async def abefore_agent(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        pending = _pending(state["messages"])
        if not pending:
            return None
        backend = getattr(runtime, "backend", None)
        taken: set[str] = set()
        if backend is not None:
            try:
                taken = _taken(await backend.als(ATTACHMENTS_DIR))
            except Exception:  # noqa: BLE001 - a fresh sandbox has no such directory
                pass
        plans = _plan(pending, taken)
        uploads = [u for p in plans for u in p.uploads]
        results, reason = None, None if backend is not None else "no sandbox attached"
        if backend is not None:
            try:
                results = await backend.aupload_files(uploads)
            except Exception as e:  # noqa: BLE001 - the note says so; the run goes on
                reason = type(e).__name__
        errors = _errors(uploads, results, reason)
        return {"messages": [_rewrite(p.message, p.files, p.bodies, errors) for p in plans]}
