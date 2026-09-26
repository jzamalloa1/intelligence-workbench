"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SessionContext } from "@/lib/session-client";
import { initials, type DemoUser } from "@/lib/users";
import { AgentProvider } from "./AgentProvider";

type Status =
  | { kind: "loading" }
  | { kind: "signed-out"; users: DemoUser[] }
  | { kind: "signed-in"; user: DemoUser };

/** `?t=<id>` keeps the open conversation across reloads, like a chat app's URL. */
function threadFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("t");
}

function writeThreadToUrl(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("t", id);
  window.history.replaceState(null, "", url);
}

/**
 * Demo sign-in, then the app. Owns the open conversation's id, which it hands
 * to <CopilotKit threadId> — switching conversations is just changing it.
 */
export function SessionGate({
  intelligenceAvailable,
  children,
}: {
  intelligenceAvailable: boolean;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [threadId, setThreadId] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session")
      .then((r) => r.json())
      .then((data: { user: DemoUser | null; users: DemoUser[] }) => {
        if (cancelled) return;
        setStatus(data.user ? { kind: "signed-in", user: data.user } : { kind: "signed-out", users: data.users });
        setThreadId(threadFromUrl() ?? crypto.randomUUID());
      })
      .catch(() => !cancelled && setStatus({ kind: "signed-out", users: [] }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (threadId && status.kind === "signed-in") writeThreadToUrl(threadId);
  }, [threadId, status.kind]);

  const signIn = useCallback(async (userId: string) => {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const data = (await res.json()) as { user?: DemoUser };
    if (data.user) {
      setThreadId(crypto.randomUUID());
      setStatus({ kind: "signed-in", user: data.user });
    }
  }, []);

  const signOut = useCallback(async () => {
    const res = await fetch("/api/session", { method: "DELETE" }).then(() => fetch("/api/session"));
    const data = (await res.json()) as { users: DemoUser[] };
    const url = new URL(window.location.href);
    url.searchParams.delete("t");
    window.history.replaceState(null, "", url);
    setStatus({ kind: "signed-out", users: data.users });
  }, []);

  const value = useMemo(
    () =>
      status.kind === "signed-in" && threadId
        ? {
            user: status.user,
            signOut,
            threadId,
            openThread: (id: string) => setThreadId(id),
            newThread: () => setThreadId(crypto.randomUUID()),
            historyVersion,
            refreshHistory: () => setHistoryVersion((v) => v + 1),
          }
        : null,
    [status, threadId, historyVersion, signOut],
  );

  if (status.kind === "loading") return <Splash />;
  if (status.kind === "signed-out") return <SignIn users={status.users} onPick={signIn} />;
  if (!value) return <Splash />;

  return (
    <SessionContext.Provider value={value}>
      <AgentProvider
        intelligenceAvailable={intelligenceAvailable}
        userId={value.user.id}
        threadId={value.threadId}
      >
        {children}
      </AgentProvider>
    </SessionContext.Provider>
  );
}

function Splash() {
  return <div className="h-dvh bg-wb-bg" aria-busy="true" />;
}

function SignIn({ users, onPick }: { users: DemoUser[]; onPick: (id: string) => Promise<void> }) {
  const [pending, setPending] = useState<string | null>(null);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-wb-bg px-4 py-10">
      <div
        className="w-full max-w-sm rounded-2xl border border-wb-border bg-wb-panel p-6"
        style={{ boxShadow: "var(--wb-shadow)" }}
      >
        <h1 className="text-[15px] font-semibold text-wb-text">Intelligence Workbench</h1>
        <p className="mt-1 text-[12.5px] text-wb-muted">Choose who you are to continue.</p>

        <ul className="mt-5 flex flex-col gap-1.5">
          {users.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                disabled={pending !== null}
                onClick={async () => {
                  setPending(u.id);
                  await onPick(u.id);
                  setPending(null);
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-wb-border px-3 py-2.5 text-left transition-colors hover:border-wb-border-strong hover:bg-wb-panel-alt disabled:opacity-60"
              >
                <Avatar name={u.name} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-wb-text">{u.name}</span>
                  <span className="block text-[11.5px] text-wb-faint">{u.role}</span>
                </span>
                {pending === u.id ? <span className="text-[11px] text-wb-faint">Signing in…</span> : null}
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-5 text-[11px] leading-relaxed text-wb-faint">
          Demo sign-in — no password. Each person sees only their own conversations and files.
          Real accounts arrive with deployment.
        </p>
      </div>
    </main>
  );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-wb-accent-soft font-semibold text-wb-accent ${
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-[11.5px]"
      }`}
    >
      {initials(name)}
    </span>
  );
}
