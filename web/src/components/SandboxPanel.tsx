"use client";

import type { Activity, Chart } from "@/lib/workbench";
import { useWorkbenchUI } from "@/lib/workbench-ui";
import { ArtifactCanvas } from "./ArtifactCanvas";
import { ConsolePanel } from "./ConsolePanel";
import { Panel, Pill } from "./Panel";

/**
 * One panel, two tabs — Console (sandbox `execute` output) and Charts
 * (Artifact Canvas). Tabbed rather than two stacked panels: both are
 * sandbox-adjacent output that's usually sparse, and stacking a third and
 * fourth panel into an already-narrow column crowds out the Workspace panel
 * next to it.
 *
 * The selected tab lives in WorkbenchUIContext, not local state, so the agent
 * can switch it through the `focus_panel` frontend tool.
 */
export function SandboxPanel({ activity, charts }: { activity: Activity[]; charts: Chart[] }) {
  const { sandboxTab: tab, setSandboxTab: setTab } = useWorkbenchUI();
  const commandCount = activity.filter((a) => a.tool === "execute").length;

  return (
    <Panel
      title="Sandbox"
      badge={
        <div className="flex items-center gap-2">
          <TabButton active={tab === "console"} onClick={() => setTab("console")}>
            Console
          </TabButton>
          <TabButton active={tab === "charts"} onClick={() => setTab("charts")}>
            Charts
          </TabButton>
          {tab === "console" && commandCount > 0 ? <Pill>{commandCount}</Pill> : null}
          {tab === "charts" && charts.length > 0 ? <Pill>{charts.length}</Pill> : null}
        </div>
      }
    >
      {tab === "console" ? (
        <ConsolePanel activity={activity} />
      ) : (
        <ArtifactCanvas charts={charts} />
      )}
    </Panel>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
        active ? "bg-wb-accent-soft text-wb-accent" : "text-wb-faint hover:text-wb-muted"
      }`}
    >
      {children}
    </button>
  );
}
