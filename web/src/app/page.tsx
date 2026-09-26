"use client";

import { useMemo, useState } from "react";
import {
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useFrontendTool,
  useInterrupt,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { ApprovalCard, parseHITLRequest } from "@/components/ApprovalCard";
import { Panel } from "@/components/Panel";
import { PlanBoard } from "@/components/PlanBoard";
import { SandboxPanel } from "@/components/SandboxPanel";
import { ToolCard } from "@/components/ToolCard";
import { Workspace } from "@/components/Workspace";
import { chartSlug, deriveFromMessages, readTodos, type Chart } from "@/lib/workbench";
import { INSPECTOR_ENABLED } from "@/lib/config";
import { useRunnerMode } from "@/lib/runner-mode";
import {
  ChartLibraryContext,
  WorkbenchUIContext,
  useWorkbenchUI,
  type SandboxTab,
} from "@/lib/workbench-ui";
import { ChartDialog } from "@/components/charts/ChartDialog";

/**
 * Holds the UI state the agent is allowed to drive, above everything that
 * reads it — the panels consume it through context, and the `focus_panel`
 * frontend tool writes to it.
 */
export default function Page() {
  const [sandboxTab, setSandboxTab] = useState<SandboxTab>("console");
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [expandedChartId, setExpandedChartId] = useState<string | null>(null);

  const ui = useMemo(
    () => ({
      sandboxTab,
      setSandboxTab,
      openFilePath,
      setOpenFilePath,
      expandedChartId,
      setExpandedChartId,
    }),
    [sandboxTab, openFilePath, expandedChartId],
  );

  return (
    <WorkbenchUIContext.Provider value={ui}>
      <Workbench />
    </WorkbenchUIContext.Provider>
  );
}

function Workbench() {
  // Override CopilotKit's built-in wildcard tool renderer. Its default shows a
  // bare row per tool call that says nothing about what the agent did; this
  // renders the tool, its target, and an expandable result instead.
  useRenderTool({ name: "*", render: (p) => <ToolCard {...p} /> });

  // Without `updates` the hook does not subscribe and nothing here ever moves.
  // State drives the plan; messages drive files and activity.
  const { agent } = useAgent({
    agentId: "workbench",
    updates: [
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnStateChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
  });

  const messages = agent?.messages ?? [];
  const running = agent?.isRunning ?? false;

  const todos = useMemo(() => readTodos(agent?.state), [agent?.state]);
  const { files, activity, charts } = useMemo(
    () => deriveFromMessages(messages),
    [messages],
  );

  const { sandboxTab } = useWorkbenchUI();
  useApprovals();
  useFocusPanelTool(charts);

  return (
    <ChartLibraryContext.Provider value={charts}>
    <div className="flex h-dvh flex-col overflow-hidden">
      <Header running={running} />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_400px_320px]">
        <Panel title="Conversation" className="min-h-0">
          <div className="h-full">
            <CopilotChat agentId="workbench" />
          </div>
        </Panel>

        {/* Plan + activity: the agent's reasoning made visible. */}
        <div className="hidden min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 lg:grid">
          <PlanBoard todos={todos} />
          <ActivityTimeline activity={activity} />
        </div>

        {/* Workspace + Sandbox get their own column once there's room for it.
            The split follows what's on show: charts get the larger share. */}
        <div
          className={`hidden min-h-0 gap-3 transition-[grid-template-rows] duration-300 ease-out xl:grid ${
            sandboxTab === "charts" && charts.length > 0
              ? "grid-rows-[minmax(0,0.7fr)_minmax(0,1.3fr)]"
              : "grid-rows-[minmax(0,1fr)_minmax(0,1fr)]"
          }`}
        >
          <Workspace files={files} />
          <SandboxPanel activity={activity} charts={charts} />
        </div>
      </main>
      <ChartDialog />
    </div>
    </ChartLibraryContext.Provider>
  );
}

/**
 * Renders the approval card for `interrupt_on` pauses, inline in the chat.
 *
 * `useInterrupt` — not `useHumanInTheLoop`. The two look interchangeable and
 * are not: `useHumanInTheLoop` registers a *frontend tool* whose handler is the
 * human, while `interrupt_on` uses LangGraph's interrupt mechanism, which
 * `@ag-ui/langgraph` surfaces as the `on_interrupt` custom event —
 * `INTERRUPT_EVENT_NAME` in @copilotkit/react-core is literally `"on_interrupt"`.
 * `useInterrupt` is the hook that listens for it.
 */
function useApprovals() {
  useInterrupt({
    // Only handle payloads we recognise, so a future interrupt of another
    // shape falls through to whatever else is registered rather than
    // rendering a broken card.
    enabled: (event) => parseHITLRequest(event?.value) !== null,
    render: ({ event, resolve }) => {
      const request = parseHITLRequest(event?.value);
      if (!request) return <></>;
      return (
        <ApprovalCard request={request} onDecide={(decisions) => void resolve({ decisions })} />
      );
    },
  });
}

/**
 * A frontend tool: it runs in the browser, not in the agent process, so the
 * agent can move the interface as part of answering rather than describing
 * where to look ("the chart is in the canvas" → it just opens the canvas).
 */
function useFocusPanelTool(charts: Chart[]) {
  const { setSandboxTab, setOpenFilePath, setExpandedChartId } = useWorkbenchUI();

  useFrontendTool({
    name: "focus_panel",
    description:
      "Bring part of the workbench UI to the user's attention: switch the Sandbox " +
      "panel between its Console and Charts tabs, and/or open a file you have " +
      "written in the Workspace viewer. Call this when you have just produced " +
      "something the user should look at. Pass chart_id (the id render_chart " +
      "returned) to open that chart full screen.",
    parameters: z.object({
      panel: z
        .enum(["console", "charts"])
        .optional()
        .describe("Which Sandbox tab to show. Use 'charts' right after render_chart."),
      file_path: z
        .string()
        .optional()
        .describe("Absolute path of a file you wrote, e.g. /reports/summary.md, to open."),
      chart_id: z
        .string()
        .optional()
        .describe("A chart_id returned by render_chart, to open that chart full screen."),
    }),
    handler: async ({ panel, file_path, chart_id }) => {
      if (panel) setSandboxTab(panel);
      if (file_path) setOpenFilePath(file_path);
      let chartNote: string | undefined;
      if (chart_id) {
        const slug = chartSlug(chart_id);
        const chart = [...charts].reverse().find((c) => c.chartId === slug);
        if (chart) {
          setExpandedChartId(chart.id);
          chartNote = `opened chart ${slug} full screen`;
        } else {
          chartNote = `no chart with id ${slug} in this conversation`;
        }
      }
      // The return value goes back to the model as the tool result.
      const did = [panel && `showed the ${panel} tab`, file_path && `opened ${file_path}`, chartNote]
        .filter(Boolean)
        .join(" and ");
      return did ? `Done — ${did}.` : "Nothing to focus; pass panel, file_path or chart_id.";
    },
  });
}

function Header({ running }: { running: boolean }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-wb-border bg-wb-panel px-4 py-2.5">
      <div className="flex items-baseline gap-2.5">
        <h1 className="text-[13px] font-semibold tracking-tight">
          Intelligence Workbench
        </h1>
        <span className="hidden text-[11.5px] text-wb-faint sm:inline">
          Managed Deep Agents &middot; CopilotKit
        </span>
      </div>

      <div
        className={`flex items-center gap-3 ${INSPECTOR_ENABLED ? "mr-14" : ""}`}
      >
        <RunnerToggle />

        <span className="flex items-center gap-1.5 text-[11.5px] text-wb-muted" aria-live="polite">
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${
              running ? "animate-pulse bg-wb-warn" : "bg-wb-good"
            }`}
          />
          {running ? "Working" : "Idle"}
        </span>
      </div>
    </header>
  );
}

/**
 * Switches which backend runner the agent runs against — see route.ts. "Cloud"
 * gets durable threads and the Inspector; "Local" is immune to the Intelligence
 * gateway's fixed 60s reconnect ceiling, which is what a long multi-subagent
 * research run can hit (docs/ARCHITECTURE.md §4d). Hidden when no
 * INTELLIGENCE_API_KEY is configured, since there is then only one mode.
 */
function RunnerToggle() {
  const { mode, setMode, intelligenceAvailable } = useRunnerMode();
  if (!intelligenceAvailable) return null;

  return (
    <div
      role="radiogroup"
      aria-label="Runner"
      className="flex items-center gap-0.5 rounded-full border border-wb-border bg-wb-panel-alt p-0.5 text-[11px]"
    >
      {(["cloud", "local"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={mode === option}
          onClick={() => setMode(option)}
          title={
            option === "cloud"
              ? "Threads drawer + Inspector. May fail on a long, heavy run. Switching starts a new conversation."
              : "No persistence, no Inspector. Immune to the cloud reconnect ceiling. Switching starts a new conversation."
          }
          className={`rounded-full px-2.5 py-1 capitalize transition-colors ${
            mode === option
              ? "bg-wb-accent-soft text-wb-accent"
              : "text-wb-muted hover:text-wb-text"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
