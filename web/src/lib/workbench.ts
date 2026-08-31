import type { Message } from "@ag-ui/core";

/**
 * Derives everything the side panels render from the agent's messages and state.
 *
 * Two different sources, for a reason worth knowing:
 *
 *   todos  — read from agent STATE. TodoListMiddleware contributes a `todos`
 *            field, so it arrives as structured data.
 *   files  — derived from streamed TOOL CALLS, not state. With a sandbox
 *            attached, the filesystem lives in the remote VM and never appears
 *            in LangGraph state (verified: state keys are only memory_contents,
 *            messages, thread_model_call_count, todos). Reading tool calls also
 *            keeps this working if the sandbox is later removed.
 *
 * All of it is pure derivation — no side effects during render, so there is no
 * duplicate-event bookkeeping to get wrong.
 */

export type TodoStatus = "pending" | "in_progress" | "completed";
export interface Todo {
  content: string;
  status: TodoStatus;
}

export interface WorkspaceFile {
  path: string;
  content?: string;
  /** Number of write/edit operations seen against this path. */
  revisions: number;
  lastTool: string;
}

export interface Activity {
  id: string;
  tool: string;
  /** Short human-readable summary of the call's arguments. */
  label: string;
  status: "running" | "done";
  /** Result text, once the matching tool message arrives. */
  result?: string;
}

/** Tool calls that represent real work worth showing on the timeline. */
const ACTIVITY_TOOLS = new Set([
  "task",
  "research",
  "execute",
  "grep",
  "glob",
  "ls",
  "read_file",
]);
const FILE_WRITE_TOOLS = new Set(["write_file", "edit_file"]);

/** Tool arguments stream in as partial JSON — never let a parse failure throw. */
function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function summarize(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "task":
      return str(args.description) ?? str(args.subagent_type) ?? "subagent";
    case "research":
      return str(args.query) ?? "search";
    case "execute":
      return str(args.command) ?? "command";
    case "read_file":
      return str(args.file_path) ?? "file";
    case "grep":
      return str(args.pattern) ?? "pattern";
    case "glob":
      return str(args.pattern) ?? "glob";
    default:
      return tool;
  }
}

export interface Derived {
  files: WorkspaceFile[];
  activity: Activity[];
}

export function deriveFromMessages(messages: readonly Message[]): Derived {
  const files = new Map<string, WorkspaceFile>();
  const activity: Activity[] = [];
  // toolCallId -> index in `activity`, so results can be attached on arrival.
  const pending = new Map<string, number>();

  for (const msg of messages) {
    const m = msg as Message & {
      toolCalls?: {
        id: string;
        function?: { name?: string; arguments?: string };
      }[];
      toolCallId?: string;
      content?: unknown;
    };

    if (m.role === "assistant" && Array.isArray(m.toolCalls)) {
      for (const call of m.toolCalls) {
        const tool = call.function?.name;
        if (!tool) continue;
        const args = parseArgs(call.function?.arguments);

        if (FILE_WRITE_TOOLS.has(tool)) {
          const path = str(args.file_path);
          if (path) {
            const prev = files.get(path);
            files.set(path, {
              path,
              // edit_file sends a patch, not the whole file — only write_file
              // carries content we can display verbatim.
              content:
                tool === "write_file" ? str(args.content) ?? prev?.content : prev?.content,
              revisions: (prev?.revisions ?? 0) + 1,
              lastTool: tool,
            });
          }
        }

        if (ACTIVITY_TOOLS.has(tool)) {
          pending.set(call.id, activity.length);
          activity.push({
            id: call.id,
            tool,
            label: summarize(tool, args),
            status: "running",
          });
        }
      }
    }

    if (m.role === "tool" && m.toolCallId) {
      const idx = pending.get(m.toolCallId);
      if (idx !== undefined) {
        const text =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
        activity[idx] = { ...activity[idx], status: "done", result: text };
      }
    }
  }

  return { files: [...files.values()], activity };
}

export function readTodos(state: unknown): Todo[] {
  const todos = (state as { todos?: unknown } | undefined)?.todos;
  if (!Array.isArray(todos)) return [];
  return todos.flatMap((t) => {
    const content = str((t as Record<string, unknown>)?.content);
    if (!content) return [];
    const raw = str((t as Record<string, unknown>)?.status);
    const status: TodoStatus =
      raw === "completed" || raw === "in_progress" ? raw : "pending";
    return [{ content, status }];
  });
}
