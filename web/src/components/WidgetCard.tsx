"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { OpenGenerativeUIActivityRenderer } from "@copilotkit/react-core/v2";
import { ExpandButton, FullScreenView } from "@/components/FullScreenView";

/**
 * A `render_widget` call: Open Generative UI, a page the agent wrote, run by
 * CopilotKit's renderer in a `@jetbrains/websandbox` iframe. Drawn from the
 * tool call, so it comes back with the conversation.
 *
 * Model-written code is contained, not trusted:
 * - the iframe is `sandbox="allow-scripts"` only (websandbox's default), so it
 *   has an opaque origin and no access to the app, its cookies or storage;
 * - the page is wrapped in a document whose <head> is ours and comes first: a
 *   Content-Security-Policy there blocks fetch, XHR, WebSockets, external
 *   scripts, styles, fonts and images before any of the widget's code runs;
 * - a CSP can't stop a frame from navigating itself, so a widget whose frame
 *   loads a second document is closed. (The request that navigation made has
 *   already left; this stops the page, it can't recall the URL.)
 */

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** The tokens a widget may use, read from the page so it matches the current theme. */
const TOKENS = ["--wb-panel", "--wb-panel-alt", "--wb-text", "--wb-muted", "--wb-border", "--wb-accent", "--wb-good", "--wb-warn"];

function secured(html: string): string {
  const root = getComputedStyle(document.documentElement);
  const vars = TOKENS.map((t) => `${t}:${root.getPropertyValue(t).trim()};`).join("");
  const dark = document.documentElement.classList.contains("dark");
  const head =
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<style>:root{color-scheme:${dark ? "dark" : "light"};${vars}}` +
    `html,body{margin:0;background:transparent;color:var(--wb-text);` +
    `font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}</style>`;
  // The widget's own document goes inside our <body>: its <html>/<head> tags are
  // then ignored by the parser while their styles and scripts still apply, and
  // nothing it writes can come before the policy.
  const body = html.replace(/^\s*<!doctype[^>]*>/i, "");
  return `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;
}

type Args = { title?: string; html?: string; initial_height?: number };

function parseError(result: unknown): string | undefined {
  if (typeof result !== "string") return (result as { error?: string } | undefined)?.error;
  try {
    return (JSON.parse(result) as { error?: string }).error;
  } catch {
    return undefined;
  }
}

export function WidgetCard({ parameters, status, result }: { parameters: Partial<Args>; status: string; result?: unknown }) {
  const title = parameters.title || "Widget";
  if (status !== "complete") {
    return (
      <div className="my-2 flex items-center gap-2 rounded-xl border border-wb-border bg-wb-panel-alt px-3 py-2.5 text-[12px] text-wb-muted" data-testid="widget-building">
        <span className="size-1.5 animate-pulse rounded-full bg-wb-accent" aria-hidden />
        Writing {parameters.title ? <span className="font-medium text-wb-text">{parameters.title}</span> : "a widget"}…
      </div>
    );
  }
  const error = parseError(result);
  if (error || !parameters.html) {
    return (
      <div className="my-1 rounded-lg border border-dashed border-wb-border-strong px-3 py-2 text-[11.5px] text-wb-faint" data-testid="widget-rejected">
        Widget sent back to the agent: {error ?? "no HTML"}
      </div>
    );
  }
  return <WidgetFrame title={title} html={parameters.html} height={parameters.initial_height} />;
}

/** The card in the chat, with a full-screen view (a second, fresh copy of the widget). */
function WidgetFrame({ title, html, height }: { title: string; html: string; height?: number }) {
  const [full, setFull] = useState(false);
  return (
    <>
      <Widget title={title} html={html} height={height} onExpand={() => setFull(true)} />
      {full ? (
        <FullScreenView title={title} label="Interactive · sandboxed" onClose={() => setFull(false)}>
          <Widget title={title} html={html} height={Math.max(height ?? 360, 480)} />
        </FullScreenView>
      ) : null}
    </>
  );
}

function Widget({ title, html, height, onExpand }: { title: string; html: string; height?: number; onExpand?: () => void }) {
  const [closed, setClosed] = useState(false);
  const frameBox = useRef<HTMLDivElement>(null);
  const content = useMemo(
    () => ({ html: [secured(html)], htmlComplete: true, cssComplete: true, generating: false, initialHeight: height ?? 360 }),
    [html, height],
  );

  // The tripwire: websandbox loads one document; any further load is the
  // widget navigating itself somewhere.
  useEffect(() => {
    const box = frameBox.current;
    if (!box || closed) return;
    let loads = 0;
    const watch = (frame: HTMLIFrameElement) => {
      if (frame.dataset.wbWatched) return;
      frame.dataset.wbWatched = "1";
      frame.addEventListener("load", () => {
        loads += 1;
        if (loads > 1) setClosed(true);
      });
    };
    box.querySelectorAll("iframe").forEach(watch);
    const observer = new MutationObserver(() => box.querySelectorAll("iframe").forEach(watch));
    observer.observe(box, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [closed, content]);

  return (
    <section className="my-2 overflow-hidden rounded-xl border border-wb-border bg-wb-panel" aria-label={title} data-testid="widget">
      <header className="flex items-center justify-between gap-2 border-b border-wb-border bg-wb-panel-alt px-3 py-2">
        <h3 className="min-w-0 truncate text-[13px] font-semibold text-wb-text">{title}</h3>
        <span className="flex shrink-0 items-center gap-2">
          <span
            className="text-[10.5px] font-medium uppercase tracking-wide text-wb-faint"
            title="Written by the agent. It runs in a sandbox with no network access and no access to this app."
          >
            Interactive · sandboxed
          </span>
          {onExpand ? <ExpandButton onClick={onExpand} what="widget" /> : null}
        </span>
      </header>
      {closed ? (
        <p className="px-3 py-3 text-[12px] text-wb-muted" role="status" data-testid="widget-closed">
          This widget tried to leave its sandbox and was closed.
        </p>
      ) : (
        <div ref={frameBox} className="p-1">
          <OpenGenerativeUIActivityRenderer activityType="open-generative-ui" content={content} message={undefined} agent={undefined} />
        </div>
      )}
    </section>
  );
}
