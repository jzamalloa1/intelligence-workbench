import type { Message } from "@ag-ui/core";
import { createContext, useContext } from "react";
import { summarizeTool, toolResultText } from "./workbench";

/**
 * One delegation (`task` call) and the work its subagent did — what the chat
 * draws as a research lane.
 *
 * SubagentTracker (server) tags every subagent tool call with the id of the
 * `task` call that started it, so the lanes are a pure function of the message
 * list and survive reloads. A run whose namespace couldn't be matched to a
 * task is tagged with the namespace instead; those are paired with the first
 * lane that has no work yet, in order of appearance.
 */

export interface LaneStep {
  id: string;
  tool: string;
  label: string;
  done: boolean;
}

export type LaneStatus = "starting" | "working" | "done";

export interface ResearchLane {
  taskId: string;
  /** Position among all lanes in the conversation — picks its colour. */
  index: number;
  description: string;
  subagentType: string;
  status: LaneStatus;
  steps: LaneStep[];
  searches: number;
  /** Pages read in full with `fetch_url`. */
  pages: number;
  files: string[];
  /** The subagent's final answer, once the task has returned. */
  result?: string;
}

type ToolCallLike = { id: string; function?: { name?: string; arguments?: string } };
type MessageLike = Message & {
  toolCalls?: ToolCallLike[];
  toolCallId?: string;
  content?: unknown;
  subagentRunId?: string | null;
};

export const SUBAGENT_ID_PREFIX = "subagent:";

function args(json: string | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(json ?? "");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isSubagent(m: MessageLike): boolean {
  return typeof m.subagentRunId === "string" || m.id.startsWith(SUBAGENT_ID_PREFIX);
}

export function deriveLanes(messages: readonly Message[]): Map<string, ResearchLane> {
  const list = messages as MessageLike[];
  const results = new Map<string, string>();
  for (const m of list) if (m.role === "tool" && m.toolCallId) results.set(m.toolCallId, toolResultText(m.content));

  const lanes = new Map<string, ResearchLane>();
  for (const m of list) {
    if (m.role !== "assistant" || isSubagent(m)) continue;
    for (const c of m.toolCalls ?? []) {
      if (c.function?.name !== "task") continue;
      const a = args(c.function.arguments);
      lanes.set(c.id, {
        taskId: c.id,
        index: lanes.size,
        description: typeof a.description === "string" ? a.description : "",
        subagentType: typeof a.subagent_type === "string" ? a.subagent_type : "researcher",
        status: results.has(c.id) ? "done" : "starting",
        steps: [],
        searches: 0,
        pages: 0,
        files: [],
        result: results.get(c.id),
      });
    }
  }

  const orphans = new Map<string, string>(); // unmatched run id → lane it was paired with
  for (const m of list) {
    if (m.role !== "assistant" || !isSubagent(m) || typeof m.subagentRunId !== "string") continue;
    let lane = lanes.get(m.subagentRunId);
    if (!lane) {
      const paired = orphans.get(m.subagentRunId);
      lane = paired
        ? lanes.get(paired)
        : [...lanes.values()].find((l) => l.steps.length === 0 && ![...orphans.values()].includes(l.taskId));
      if (!lane) continue;
      orphans.set(m.subagentRunId, lane.taskId);
    }
    for (const c of m.toolCalls ?? []) {
      const tool = c.function?.name ?? "tool";
      const a = args(c.function?.arguments);
      lane.steps.push({ id: c.id, tool, label: summarizeTool(tool, a), done: results.has(c.id) });
      if (tool === "research") lane.searches += 1;
      if (tool === "fetch_url") lane.pages += 1;
      if ((tool === "write_file" || tool === "edit_file") && typeof a.file_path === "string" && !lane.files.includes(a.file_path)) {
        lane.files.push(a.file_path);
      }
    }
  }

  for (const lane of lanes.values()) {
    if (lane.status !== "done" && lane.steps.length > 0) lane.status = "working";
  }
  return lanes;
}

/**
 * The chat shows the lead's conversation; subagent tool calls and their
 * results live in the lanes and side panels instead. Used as CopilotChat's
 * `transformMessages` — tool cards still find their results in the full list.
 */
export function withoutSubagentRows(messages: Message[]): Message[] {
  const list = messages as MessageLike[];
  const subCalls = new Set(list.filter(isSubagent).flatMap((m) => (m.toolCalls ?? []).map((c) => c.id)));
  return list.filter((m) => !isSubagent(m) && !(m.role === "tool" && m.toolCallId && subCalls.has(m.toolCallId)));
}

/** `task` call ids in an assistant message, in order. */
export function taskCallIds(message: Message): string[] {
  const m = message as MessageLike;
  return m.role === "assistant" ? (m.toolCalls ?? []).filter((c) => c.function?.name === "task").map((c) => c.id) : [];
}

export const LanesContext = createContext<Map<string, ResearchLane>>(new Map());

export function useLanes(): Map<string, ResearchLane> {
  return useContext(LanesContext);
}
