import type { Message } from "@ag-ui/client";
import type { AttachmentsConfig } from "@copilotkit/react-core/v2";

/**
 * Files in the chat. CopilotChat uploads them as base64 content parts; the
 * agent's AttachmentsMiddleware saves each one to the conversation's sandbox
 * and replaces it in the thread with an `<attachment>` text note (images keep
 * their bytes so the model still sees them). This module is the browser half:
 * what may be attached, how images are sized, and turning those notes back into
 * file chips so the user sees their file, not the note written for the model.
 */

/** Images, PDFs, and the text/data formats the agent can read or load in Python. */
export const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,.csv,.tsv,.txt,.md,.json,.xlsx";

/**
 * Per non-image file. The message carrying it goes through AG-UI before the
 * agent rewrites it, and AG-UI caps one event at 10 MB — base64 adds a third.
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** What CopilotChat lets through before `onUpload`; images are downscaled there. */
const MAX_PICKED_BYTES = 25 * 1024 * 1024;

/** Claude's largest image: 2576 px on the long edge, 3.75 MP. Bigger is downscaled by the API anyway. */
const MAX_EDGE = 2576;
const MAX_PIXELS = 3_750_000;

const MIME_BY_EXT: Record<string, string> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Browsers disagree on CSV (text/csv, application/vnd.ms-excel, or nothing); trust the extension. */
function mimeOf(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? (file.type || "application/octet-stream");
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Downscales to Claude's limit; anything already within it is sent untouched. GIFs pass as-is (animation). */
async function fitImage(file: File): Promise<{ data: ArrayBuffer; mimeType: string }> {
  if (file.type === "image/gif") return { data: await file.arrayBuffer(), mimeType: file.type };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height), Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
  if (scale === 1 && file.size <= MAX_FILE_BYTES) {
    bitmap.close();
    return { data: await file.arrayBuffer(), mimeType: file.type };
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, 0.9));
  if (!blob) throw new Error(`Couldn't read the image "${file.name}".`);
  return { data: await blob.arrayBuffer(), mimeType };
}

/** CopilotChat's attachment settings; `onError` shows a rejected file's reason. */
export function attachmentsConfig(onError: (message: string) => void): AttachmentsConfig {
  return {
    enabled: true,
    accept: ATTACHMENT_ACCEPT,
    maxSize: MAX_PICKED_BYTES,
    async onUpload(file) {
      if (file.type.startsWith("image/")) {
        const { data, mimeType } = await fitImage(file);
        return { type: "data", value: toBase64(data), mimeType };
      }
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`"${file.name}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
      }
      return { type: "data", value: toBase64(await file.arrayBuffer()), mimeType: mimeOf(file) };
    },
    onUploadFailed: ({ reason, file, message }) =>
      onError(reason === "invalid-type" ? `"${file.name}" isn't a supported file type.` : message),
  };
}

// -- the agent's notes --------------------------------------------------------

type Part = { type: string; text?: string; source?: { type: string; value?: string; mimeType?: string }; metadata?: unknown };

/** Mirrors `_note()` in agent/middleware/attachments.py. */
const NOTE = /^<attachment name="([^"]*)" type="([^"]*)" size="([^"]*)" path="([^"]*)">\n([\s\S]*)\n<\/attachment>$/;
const FULL = "Full contents:\n";

export type AttachmentNote = {
  name: string;
  type: string;
  size: string;
  /** Where it is in the sandbox; empty when saving it failed. */
  path: string;
  /** The whole file, when it was small enough to travel in the note. */
  content?: string;
};

export function parseNote(text: string): AttachmentNote | null {
  const m = NOTE.exec(text);
  if (!m) return null;
  const body = m[5].replaceAll("<\\/attachment>", "</attachment>");
  const at = body.indexOf(FULL);
  return { name: m[1], type: m[2], size: m[3], path: m[4], ...(at >= 0 ? { content: body.slice(at + FULL.length) } : {}) };
}

/** Every note in a user message's content. */
export function notesIn(content: unknown): AttachmentNote[] {
  if (!Array.isArray(content)) return [];
  return (content as Part[]).flatMap((p) => (p.type === "text" && p.text ? (parseNote(p.text) ?? []) : []));
}

const isNote = (p: Part) => p.type === "text" && typeof p.text === "string" && parseNote(p.text) !== null;

/**
 * A chip's link target. The file lives in the sandbox, which the browser can't
 * reach, so the chip is a label: globals.css switches its link off.
 */
export const SANDBOX_FILE_URL = "about:blank#sandbox-file";

/**
 * Display-only: each note becomes a file chip — dropped for an image, whose
 * thumbnail is already there. Untouched messages keep their identity, which
 * CopilotChat's memoisation relies on.
 */
export function withAttachmentChips<M extends Message>(messages: M[]): M[] {
  return messages.map((m) => {
    if (m.role !== "user" || !Array.isArray(m.content)) return m;
    const parts = m.content as Part[];
    if (!parts.some(isNote)) return m;
    const hasImage = parts.some((p) => p.type === "image");
    const shown = parts.flatMap((p): Part[] => {
      const note = p.type === "text" && p.text ? parseNote(p.text) : null;
      if (!note) return [p];
      if (note.type.startsWith("image/") && hasImage) return [];
      return [{ type: "document", source: { type: "url", value: SANDBOX_FILE_URL, mimeType: note.type }, metadata: { filename: note.name } }];
    });
    return { ...m, content: shown } as M;
  });
}

/** What the user typed, without the notes. */
export function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Part[])
    .filter((p) => p.type === "text" && !isNote(p))
    .map((p) => p.text ?? "")
    .join("\n");
}

/** The same message with its typed text replaced and its files kept. */
export function withUserText(content: unknown, text: string): string | Part[] {
  if (!Array.isArray(content)) return text;
  const files = (content as Part[]).filter((p) => p.type !== "text" || isNote(p));
  return files.length ? [...(text.trim() ? [{ type: "text", text }] : []), ...files] : text;
}

/**
 * AG-UI parts → LangChain blocks, for a rewind that sends a user message to
 * LangGraph directly (the adapter's own converter isn't exported). Covers what
 * a user message holds here: text, notes, images, and raw files not yet saved.
 */
export function toLangChainContent(content: string | Part[]): string | Record<string, unknown>[] {
  if (typeof content === "string") return content;
  return content.flatMap((p): Record<string, unknown>[] => {
    if (p.type === "text") return [{ type: "text", text: p.text ?? "" }];
    const src = p.source;
    if (src?.type !== "data" || !src.value) return [];
    const mime = src.mimeType ?? "application/octet-stream";
    if (p.type === "image") return [{ type: "image_url", image_url: { url: `data:${mime};base64,${src.value}` } }];
    const filename = (p.metadata as { filename?: string } | undefined)?.filename;
    return [{ type: "file", source_type: "base64", data: src.value, mime_type: mime, ...(filename ? { metadata: { filename } } : {}) }];
  });
}
