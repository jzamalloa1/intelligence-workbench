import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Per-user conversation history, in a local SQLite file.
 *
 * Why the web app keeps its own copy instead of reading the agent server's
 * threads: under `mda dev`, LangGraph's thread persistence lives inside
 * `agent/.mda/build/`, and both `mda dev` and `mda build` empty that directory
 * before compiling — so every agent restart erases local history
 * (docs/ARCHITECTURE.md §4d). A deployed MDA agent has durable threads; this
 * store is what makes history survive on a laptop.
 *
 * Each row is an index entry (owner, title, timestamps) plus the latest
 * snapshot of the conversation (AG-UI messages + agent state), refreshed after
 * every run. The owner column is also what the web route checks before letting
 * anyone run or reopen a thread.
 */

export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadSnapshot {
  messages: unknown[];
  state: Record<string, unknown>;
}

const DB_PATH = process.env.WORKBENCH_HISTORY_DB ?? path.join(process.cwd(), ".data", "workbench.sqlite");
const MAX_TITLE = 80;

// One connection per server process, surviving Next's dev hot reloads.
const globalForDb = globalThis as unknown as { __workbenchHistory?: DatabaseSync };

function db(): DatabaseSync {
  if (!globalForDb.__workbenchHistory) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const conn = new DatabaseSync(DB_PATH);
    conn.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS threads (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        title      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        messages   TEXT,
        state      TEXT
      );
      CREATE INDEX IF NOT EXISTS threads_by_user ON threads (user_id, updated_at DESC);
    `);
    globalForDb.__workbenchHistory = conn;
  }
  return globalForDb.__workbenchHistory;
}

export function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return "New conversation";
  return oneLine.length <= MAX_TITLE ? oneLine : `${oneLine.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}

export function ownerOf(threadId: string): string | undefined {
  const row = db().prepare("SELECT user_id FROM threads WHERE id = ?").get(threadId) as
    | { user_id: string }
    | undefined;
  return row?.user_id;
}

/** Registers a thread on its first run, or bumps its timestamp on later ones. */
export function touchThread(threadId: string, userId: string, title: string) {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO threads (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .run(threadId, userId, titleFrom(title), now, now);
}

export function saveSnapshot(threadId: string, snapshot: ThreadSnapshot) {
  db()
    .prepare("UPDATE threads SET messages = ?, state = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(snapshot.messages), JSON.stringify(snapshot.state), Date.now(), threadId);
}

export function getSnapshot(threadId: string): ThreadSnapshot | undefined {
  const row = db().prepare("SELECT messages, state FROM threads WHERE id = ?").get(threadId) as
    | { messages: string | null; state: string | null }
    | undefined;
  if (!row?.messages) return undefined;
  return { messages: JSON.parse(row.messages), state: row.state ? JSON.parse(row.state) : {} };
}

export function listThreads(userId: string, limit = 100): ThreadSummary[] {
  const rows = db()
    .prepare(
      `SELECT id, title, created_at, updated_at FROM threads
       WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(userId, limit) as { id: string; title: string; created_at: number; updated_at: number }[];
  return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
}

export function renameThread(threadId: string, title: string) {
  db().prepare("UPDATE threads SET title = ? WHERE id = ?").run(titleFrom(title), threadId);
}

export function deleteThreadRecord(threadId: string) {
  db().prepare("DELETE FROM threads WHERE id = ?").run(threadId);
}
