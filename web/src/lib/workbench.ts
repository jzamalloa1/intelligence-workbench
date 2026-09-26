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

export interface ChartSeries {
  name: string;
  values: number[];
  /** "" when the model didn't say. Series are faceted by unit, never co-scaled. */
  unit: string;
}

export interface Chart {
  /** The tool call id — unique per render_chart call. */
  id: string;
  /** The id a report embeds (```chart <chartId>```). Not unique: a re-render replaces. */
  chartId: string;
  title: string;
  chartType: "bar" | "line";
  categories: string[];
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
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
const CHART_TOOL = "render_chart";
const MAX_CHART_SERIES = 6;
const MAX_CHART_ID_LENGTH = 48;

/**
 * Mirrors `chart_slug` in agent/tools/charts.py exactly — the agent is told the
 * id it returns, and the frontend must derive the same one from the same
 * arguments for a report's chart block to resolve. Change both or neither.
 */
export function chartSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_CHART_ID_LENGTH)
    .replace(/^-+|-+$/g, "");
  return slug || "chart";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

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

/**
 * One-line description of what a tool call is doing.
 *
 * Returns "" rather than a placeholder when arguments have not streamed in yet,
 * so callers can render nothing instead of a meaningless "search" / "command"
 * label that later never updates.
 */
export function summarizeTool(
  tool: string,
  args: Record<string, unknown>,
): string {
  switch (tool) {
    case "task":
      return str(args.description) ?? str(args.subagent_type) ?? "";
    case "research":
      return str(args.query) ?? "";
    case "execute":
      return str(args.command) ?? "";
    case "read_file":
    case "write_file":
    case "edit_file":
      return str(args.file_path) ?? "";
    case "grep":
    case "glob":
      return str(args.pattern) ?? "";
    case "write_todos": {
      const todos = args.todos;
      return Array.isArray(todos) ? `${todos.length} steps` : "";
    }
    case "render_chart":
      return str(args.title) ?? "";
    default:
      return "";
  }
}

/**
 * Builds a Chart from a `render_chart` call's raw, model-generated arguments —
 * not the backend's validated response. Args stream in incomplete while the
 * model is still generating, and the model can send a malformed shape (a
 * length mismatch `render_chart` itself would reject) that still needs to
 * render *something* rather than crash the panel. Returns undefined until the
 * shape is usable; degrades a bad series rather than dropping the whole chart.
 */
function parseChart(id: string, args: Record<string, unknown>): Chart | undefined {
  const title = str(args.title);
  const chartType =
    args.chart_type === "line" ? "line" : args.chart_type === "bar" ? "bar" : undefined;
  const categories = Array.isArray(args.categories)
    ? args.categories.filter((c): c is string => typeof c === "string")
    : undefined;
  const rawSeries = Array.isArray(args.series) ? args.series : undefined;

  if (!title || !chartType || !categories || categories.length < 2 || !rawSeries?.length) {
    return undefined;
  }

  const series: ChartSeries[] = rawSeries.slice(0, MAX_CHART_SERIES).flatMap((s) => {
    const rec = s as Record<string, unknown>;
    const name = str(rec.name);
    const values = Array.isArray(rec.values) ? rec.values : undefined;
    if (!name || !values) return [];
    // Align to the category count rather than reject on mismatch — one bad
    // series is more useful shown than the whole chart withheld.
    return [{ name, values: categories.map((_, i) => num(values[i])), unit: str(rec.unit) ?? "" }];
  });

  if (series.length === 0) return undefined;

  return {
    id,
    chartId: chartSlug(str(args.chart_id) || title),
    title,
    chartType,
    categories,
    series,
    xLabel: str(args.x_label),
    yLabel: str(args.y_label),
  };
}

export interface Derived {
  files: WorkspaceFile[];
  activity: Activity[];
  charts: Chart[];
}

export function deriveFromMessages(messages: readonly Message[]): Derived {
  const files = new Map<string, WorkspaceFile>();
  const activity: Activity[] = [];
  const charts = new Map<string, Chart>();
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

        if (tool === CHART_TOOL) {
          const chart = parseChart(call.id, args);
          if (chart) charts.set(call.id, chart);
        }

        if (ACTIVITY_TOOLS.has(tool)) {
          pending.set(call.id, activity.length);
          activity.push({
            id: call.id,
            tool,
            label: summarizeTool(tool, args) || tool,
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

  return { files: [...files.values()], activity, charts: [...charts.values()] };
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
