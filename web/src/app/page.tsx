"use client";

import { CopilotChat, useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import { EmptyState, Panel, Pill } from "@/components/Panel";

/**
 * Milestone 3: the shell. Chat is wired end to end to the Managed Deep Agent;
 * the side panels are structural and will be filled with live agent state in
 * Milestone 4 (plan board, file explorer, subagent timeline).
 */
export default function Page() {
  // `updates` opts this component into re-renders. Without it the hook does not
  // subscribe, and neither the counter nor the running indicator ever moves.
  const { agent } = useAgent({
    agentId: "workbench",
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
  });

  const running = agent?.isRunning ?? false;
  // Message count is a cheap, honest liveness signal until the real panels land.
  const messageCount = agent?.messages?.length ?? 0;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Header running={running} />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Conversation */}
        <Panel
          title="Conversation"
          badge={
            messageCount > 0 ? <Pill>{messageCount} messages</Pill> : undefined
          }
          className="min-h-0"
        >
          <div className="h-full">
            <CopilotChat agentId="workbench" />
          </div>
        </Panel>

        {/* Right rail — placeholders until Milestone 4 */}
        <div className="hidden min-h-0 grid-rows-2 gap-3 lg:grid">
          <Panel title="Plan" badge={<Pill>write_todos</Pill>}>
            <EmptyState>
              The agent&rsquo;s plan will render here as it calls{" "}
              <code className="text-wb-muted">write_todos</code>.
            </EmptyState>
          </Panel>

          <Panel title="Workspace" badge={<Pill>virtual FS</Pill>}>
            <EmptyState>
              Files the agent writes to <code className="text-wb-muted">/research/</code>{" "}
              and <code className="text-wb-muted">/reports/</code> will appear here.
            </EmptyState>
          </Panel>
        </div>
      </main>
    </div>
  );
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

      <div className="flex items-center gap-2">
        <span
          className="flex items-center gap-1.5 text-[11.5px] text-wb-muted"
          aria-live="polite"
        >
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
