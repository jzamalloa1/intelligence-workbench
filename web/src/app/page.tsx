"use client";

import { useMemo } from "react";
import {
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { Panel } from "@/components/Panel";
import { PlanBoard } from "@/components/PlanBoard";
import { ToolCard } from "@/components/ToolCard";
import { Workspace } from "@/components/Workspace";
import { deriveFromMessages, readTodos } from "@/lib/workbench";
import { INSPECTOR_ENABLED } from "@/lib/config";

export default function Page() {
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
  const { files, activity } = useMemo(
    () => deriveFromMessages(messages),
    [messages],
  );

  return (
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

        {/* Workspace gets its own column once there's room for it. */}
        <div className="hidden min-h-0 xl:grid">
          <Workspace files={files} />
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

      {/*
        With the Inspector enabled CopilotKit mounts a launcher fixed at the
        top-right, which overlaps anything we put there. Reserve space for it
        rather than fight its z-index.
      */}
      <span
        className={`flex items-center gap-1.5 text-[11.5px] text-wb-muted ${
          INSPECTOR_ENABLED ? "mr-14" : ""
        }`}
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
    </header>
  );
}
