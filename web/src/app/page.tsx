"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CopilotChat,
  messageGroup,
  messageRow,
  useAgent,
  UseAgentUpdate,
  useFrontendTool,
  useInterrupt,
  useRenderTool,
  type MessageRow,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { ApprovalCard, ApprovalStack, parseHITLRequest } from "@/components/ApprovalCard";
import { Panel } from "@/components/Panel";
import { PlanBoard } from "@/components/PlanBoard";
import { SandboxPanel } from "@/components/SandboxPanel";
import { ToolCard } from "@/components/ToolCard";
import { DelegationGroup, ResearchBanner, TaskLaneCard } from "@/components/ResearchLanes";
import { EditBar, useMessageActions, useWorkbenchSuggestions, WelcomeHero } from "@/components/ChatExtras";
import { ReasoningCard } from "@/components/ReasoningCard";
import { deriveLanes, LanesContext, taskCallIds, withoutSubagentRows } from "@/lib/lanes";
import { Workspace } from "@/components/Workspace";
import { chartSlug, deriveFromMessages, readTodos, type Chart } from "@/lib/workbench";
import { INSPECTOR_ENABLED } from "@/lib/config";
import { useRunnerMode } from "@/lib/runner-mode";
import {
  ChartLibraryContext,
  WorkbenchUIContext,
  useWorkbenchUI,
  type PanelView,
  type SandboxTab,
} from "@/lib/workbench-ui";
import { ChartDialog } from "@/components/charts/ChartDialog";
import { HistorySidebar } from "@/components/HistorySidebar";
import { UsageMeters } from "@/components/UsageMeters";
import { readUsage, summarize, type UsageSummary } from "@/lib/pricing";
import { Avatar } from "@/components/SessionGate";
import { useSession } from "@/lib/session-client";
import { PROVIDERS, type Provider } from "@/lib/users";

/**
 * Holds the UI state the agent is allowed to drive, above everything that
 * reads it — the panels consume it through context, and the `focus_panel`
 * frontend tool writes to it.
 */
export default function Page() {
  // Keyed by conversation: switching threads starts every panel's UI state
  // (open file, expanded chart, tab) fresh rather than carrying it across.
  const { threadId } = useSession();
  // The sidebar choice outlives the conversation: picking one from history
  // must not snap a pinned sidebar shut. null = automatic (shows from 2xl).
  const [sidebarPref, setSidebarPref] = useState<boolean | null>(null);
  return <ConversationView key={threadId} sidebarPref={sidebarPref} setSidebarPref={setSidebarPref} />;
}

type SidebarPrefProps = { sidebarPref: boolean | null; setSidebarPref: (open: boolean) => void };

function ConversationView(sidebar: SidebarPrefProps) {
  const [sandboxTab, setSandboxTab] = useState<SandboxTab>("console");
  const [view, setView] = useState<PanelView>("chat");
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [expandedChartId, setExpandedChartId] = useState<string | null>(null);

  const ui = useMemo(
    () => ({
      sandboxTab,
      setSandboxTab,
      view,
      setView,
      openFilePath,
      setOpenFilePath,
      expandedChartId,
      setExpandedChartId,
    }),
    [sandboxTab, view, openFilePath, expandedChartId],
  );

  return (
    <WorkbenchUIContext.Provider value={ui}>
      <Workbench {...sidebar} />
    </WorkbenchUIContext.Provider>
  );
}

function Workbench({ sidebarPref, setSidebarPref }: SidebarPrefProps) {
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

  // Override CopilotKit's built-in wildcard tool renderer. Its default shows a
  // bare row per tool call that says nothing about what the agent did; this
  // renders the tool, its target, and an expandable result instead. Subagent
  // tool calls never reach it: the chat drops them (`withoutSubagentRows`) and
  // each delegation renders as a research lane instead.
  useRenderTool({ name: "*", render: (p) => <ToolCard {...p} /> });
  useRenderTool({
    name: "task",
    parameters: z.object({ description: z.string().optional(), subagent_type: z.string().optional() }),
    render: (p) => <TaskLaneCard toolCallId={p.toolCallId} args={p.parameters} status={p.status} />,
  });
  const lanes = useMemo(() => deriveLanes(messages), [messages]);
  const running = agent?.isRunning ?? false;

  const todos = useMemo(() => readTodos(agent?.state), [agent?.state]);
  const usage = useMemo(() => summarize(readUsage(agent?.state)), [agent?.state]);
  const { files, activity, charts, skills, memoryEdits } = useMemo(
    () => deriveFromMessages(messages),
    [messages],
  );

  const { sandboxTab, view } = useWorkbenchUI();
  // Automatic (null) shows the history sidebar from 2xl, where the other
  // panels leave room for it; the toggle pins it open or closed.
  const wide = useMediaQuery("(min-width: 1536px)");
  const sidebarOpen = sidebarPref ?? wide;
  useApprovals();
  useFocusPanelTool(charts);
  useHistoryRefresh(running);
  useWorkbenchSuggestions({ charts, files, lanes, running });
  const actions = useMessageActions(agent);
  const showWelcome = useSettled(messages.length === 0 && !running, 400);
  const { onRegenerate, onEditMessage } = actions;
  const messageView = useMemo(
    () => ({
      ...MESSAGE_VIEW,
      assistantMessage: { onRegenerate },
      userMessage: { onEditMessage },
      reasoningMessage: ReasoningCard,
    }),
    [onRegenerate, onEditMessage],
  );

  return (
    <ChartLibraryContext.Provider value={charts}>
      <LanesContext.Provider value={lanes}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <Header
          running={running}
          usage={usage}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarPref(!sidebarOpen)}
        />
        <ViewSwitch />

        <main className={`grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 max-xl:pt-0 ${GRID[sidebarPref === null ? "auto" : sidebarPref ? "open" : "closed"]}`}>
          {sidebarPref !== false ? (
            <div className={`hidden min-h-0 ${sidebarPref ? "lg:grid" : "2xl:grid"}`}>
              <HistorySidebar />
            </div>
          ) : null}

          {/* Below lg the sidebar is one of the switchable views. */}
          {view === "history" ? (
            <div className="grid min-h-0 lg:hidden">
              <HistorySidebar />
            </div>
          ) : null}

          <Panel title="Conversation" className={`min-h-0 ${view === "chat" ? "" : "max-lg:hidden"}`}>
            <div className="flex h-full flex-col">
              <ResearchBanner />
              {actions.editing ? (
                <EditBar
                  editing={actions.editing}
                  onChange={(text) => actions.setEditing((e) => (e ? { ...e, text } : e))}
                  onCancel={() => actions.setEditing(null)}
                  onSubmit={() => {
                    actions.rewind(actions.editing!.id, actions.editing!.text);
                    actions.setEditing(null);
                  }}
                />
              ) : null}
              <div className="relative min-h-0 flex-1">
                <CopilotChat agentId="workbench" messageView={messageView} input={CHAT_INPUT} />
                {showWelcome ? (
                  // Centred with margins, not align-items, so a hero taller than
                  // the space scrolls from its top instead of clipping it.
                  <div className="absolute inset-x-0 top-0 bottom-28 flex overflow-y-auto bg-wb-panel px-6 py-6">
                    <div className="m-auto">
                      <WelcomeHero onPick={actions.send} />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </Panel>

          {/* Plan + activity: the agent's reasoning made visible. */}
          <div
            className={`min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 xl:grid ${
              view === "plan" ? "grid" : "hidden"
            } ${view === "workspace" ? "lg:hidden" : "lg:grid"}`}
          >
            <PlanBoard todos={todos} skills={skills} />
            <ActivityTimeline activity={activity} />
          </div>

          {/* Workspace + Sandbox get their own column once there's room for it.
              The split follows what's on show: charts get the larger share. */}
          <div
            className={`min-h-0 gap-3 transition-[grid-template-rows] duration-300 ease-out xl:grid ${
              view === "workspace" ? "grid" : "hidden"
            } ${
              sandboxTab === "charts" && charts.length > 0
                ? "grid-rows-[minmax(0,0.7fr)_minmax(0,1.3fr)]"
                : "grid-rows-[minmax(0,1fr)_minmax(0,1fr)]"
            }`}
          >
            <Workspace files={files} memoryEdits={memoryEdits} />
            <SandboxPanel activity={activity} charts={charts} />
          </div>
        </main>
        <ChartDialog />
      </div>
      </LanesContext.Provider>
    </ChartLibraryContext.Provider>
  );
}

/**
 * Grid columns per breakpoint. Below `lg`: one panel group at a time. `lg`:
 * conversation plus one side column. `xl`: both side columns. `2xl`: room for
 * the history sidebar too — which is where "auto" starts showing it.
 */
const GRID = {
  auto: "lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_360px_300px] 2xl:grid-cols-[232px_minmax(0,1fr)_400px_320px]",
  open: "lg:grid-cols-[232px_minmax(0,1fr)_340px] xl:grid-cols-[232px_minmax(0,1fr)_360px_300px] 2xl:grid-cols-[232px_minmax(0,1fr)_400px_320px]",
  closed: "lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_360px_300px] 2xl:grid-cols-[minmax(0,1fr)_400px_320px]",
} as const;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const onChange = () => setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

const VIEWS: { id: PanelView; label: string; className?: string }[] = [
  { id: "chat", label: "Chat", className: "lg:hidden" },
  { id: "history", label: "History", className: "lg:hidden" },
  { id: "plan", label: "Plan" },
  { id: "workspace", label: "Workspace" },
];

/** Picks the panel group on screen when there isn't room for all of them. */
function ViewSwitch() {
  const { view, setView } = useWorkbenchUI();
  // From lg the conversation is always visible, so "chat" (and "history",
  // which has its own sidebar there) means the plan column.
  const current = (v: PanelView) => v === view || (v === "plan" && (view === "chat" || view === "history"));
  return (
    <nav aria-label="Panels" className="flex shrink-0 justify-center px-3 pt-3 pb-2.5 xl:hidden">
      <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-wb-border bg-wb-panel p-0.5 text-[11.5px]">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={v.id === view}
            onClick={() => setView(v.id)}
            className={`shrink-0 rounded-full px-3 py-1 transition-colors ${v.className ?? ""} ${
              v.id === view
                ? "bg-wb-accent-soft text-wb-accent"
                : current(v.id)
                  ? "text-wb-muted lg:bg-wb-accent-soft lg:text-wb-accent"
                  : "text-wb-muted hover:text-wb-text"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

/**
 * A message that delegates to several subagents at once is framed as one
 * "parallel research" group; everything else renders on its own. Module-level
 * and stable, as CopilotChat memoizes on these functions.
 */
function groupDelegations(messages: Parameters<typeof withoutSubagentRows>[0]): MessageRow[] {
  return messages.map((m) =>
    taskCallIds(m).length > 1
      ? messageGroup({ key: m.id, messages: [m], wrapper: DelegationGroup })
      : messageRow(m),
  );
}

const MESSAGE_VIEW = { transformMessages: withoutSubagentRows, groupMessages: groupDelegations };

/**
 * The input's "+" opens a menu of attachments and tools. We configure neither
 * (the agent doesn't take files yet), so it would open an empty menu.
 */
const CHAT_INPUT = { addMenuButton: () => null };

/**
 * `value`, but only once it has held for `ms`. A reopened conversation is empty
 * for a moment while its messages load; without this the welcome screen would
 * flash over it.
 */
function useSettled(value: boolean, ms: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!value) {
      setSettled(false);
      return;
    }
    const t = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value && settled;
}

/**
 * Keeps the history sidebar current: a run starting registers a new
 * conversation (so it appears immediately, titled by its first message), and a
 * run ending moves it to the top.
 */
function useHistoryRefresh(running: boolean) {
  const { refreshHistory } = useSession();
  const previous = useRef(running);
  useEffect(() => {
    if (previous.current !== running) refreshHistory();
    previous.current = running;
  }, [running, refreshHistory]);
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
    render: ({ event, interrupts, resolve }) => {
      // Standard path: every open approval, each with its id.
      const items = interrupts.flatMap((i) => {
        const request = parseHITLRequest(i);
        return request ? [{ id: i.id, request }] : [];
      });
      if (items.length > 1) {
        return <ApprovalStack items={items} onDecide={(id, decisions) => void resolve({ decisions }, id)} />;
      }
      if (items.length === 1) {
        const [only] = items;
        return <ApprovalCard request={only.request} onDecide={(decisions) => void resolve({ decisions }, only.id)} />;
      }
      // Legacy on_interrupt (a reopened conversation replaying a pending approval).
      const request = parseHITLRequest(event?.value);
      if (!request) return <></>;
      return <ApprovalCard request={request} onDecide={(decisions) => void resolve({ decisions })} />;
    },
  });
}

/**
 * A frontend tool: it runs in the browser, not in the agent process, so the
 * agent can move the interface as part of answering rather than describing
 * where to look ("the chart is in the canvas" → it just opens the canvas).
 */
function useFocusPanelTool(charts: Chart[]) {
  const { setSandboxTab, setOpenFilePath, setExpandedChartId, setView } = useWorkbenchUI();

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
      // On a narrow screen the panel may be hidden behind the view switch.
      if (panel || file_path) setView("workspace");
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

function Header({
  running,
  usage,
  sidebarOpen,
  onToggleSidebar,
}: {
  running: boolean;
  usage: UsageSummary;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-wb-border bg-wb-panel px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "Hide history" : "Show history"}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? "Hide history" : "Show history"}
          className="hidden rounded-md p-1 text-wb-muted transition-colors hover:bg-wb-panel-alt hover:text-wb-text lg:block"
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
            <rect x="2" y="3" width="12" height="10" rx="2" />
            <path d="M6 3v10" />
          </svg>
        </button>
        <div className="flex items-baseline gap-2.5">
          <h1 className="whitespace-nowrap text-[13px] font-semibold tracking-tight">
            Intelligence Workbench
          </h1>
          <span className="hidden whitespace-nowrap text-[11.5px] text-wb-faint xl:inline">
            Managed Deep Agents &middot; CopilotKit
          </span>
        </div>
      </div>

      <div
        className={`flex items-center gap-3 ${INSPECTOR_ENABLED ? "mr-14" : ""}`}
      >
        <div className="hidden md:block">
          <UsageMeters summary={usage} />
        </div>
        <ProviderToggle />
        <div className="hidden sm:block">
          <RunnerToggle />
        </div>

        <span className="hidden items-center gap-1.5 text-[11.5px] text-wb-muted sm:flex" aria-live="polite">
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${
              running ? "animate-pulse bg-wb-warn" : "bg-wb-good"
            }`}
          />
          {running ? "Working" : "Idle"}
        </span>

        <UserMenu />
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

const PROVIDER_LABEL: Record<Provider, { name: string; models: string }> = {
  anthropic: { name: "Anthropic", models: "Claude Opus 5.5 lead · Sonnet 5.5 researchers" },
  openai: { name: "OpenAI", models: "GPT-5.6 Terra lead and researchers" },
};

/**
 * Which model provider the open conversation runs on. A conversation keeps the
 * provider it started with (the server enforces it), so picking the other one
 * starts a new conversation — ask the same question on both and compare them
 * side by side in history, with the Cost meter on each.
 */
function ProviderToggle() {
  const { provider, newThread } = useSession();
  return (
    <div
      role="radiogroup"
      aria-label="Model provider"
      className="flex items-center gap-0.5 rounded-full border border-wb-border bg-wb-panel-alt p-0.5 text-[11px]"
    >
      {PROVIDERS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={provider === p}
          onClick={() => p !== provider && newThread(p)}
          title={
            p === provider
              ? `This conversation runs on ${PROVIDER_LABEL[p].name}: ${PROVIDER_LABEL[p].models}.`
              : `Start a new conversation on ${PROVIDER_LABEL[p].name} (${PROVIDER_LABEL[p].models}).`
          }
          className={`rounded-full px-2.5 py-1 transition-colors ${
            provider === p ? "bg-wb-accent-soft text-wb-accent" : "text-wb-muted hover:text-wb-text"
          }`}
        >
          {PROVIDER_LABEL[p].name}
        </button>
      ))}
    </div>
  );
}

/** Who is signed in, and the way out. */
function UserMenu() {
  const { user, signOut } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2 transition-colors hover:bg-wb-panel-alt"
      >
        <Avatar name={user.name} size="sm" />
        <span className="hidden whitespace-nowrap text-[11.5px] text-wb-muted xl:inline">{user.name}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-52 rounded-xl border border-wb-border bg-wb-panel p-1.5"
          style={{ boxShadow: "var(--wb-shadow)" }}
        >
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] text-wb-faint">
            Signed in as <span className="text-wb-text">{user.name}</span> · {user.role}
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-wb-text transition-colors hover:bg-wb-panel-alt"
          >
            Switch user
          </button>
        </div>
      ) : null}
    </div>
  );
}
