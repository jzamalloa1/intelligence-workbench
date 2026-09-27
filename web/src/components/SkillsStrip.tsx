"use client";

import { useEffect, useState } from "react";
import type { SkillUse } from "@/lib/workbench";

interface SkillInfo {
  name: string;
  description: string;
}

// The roster is static per deployment — fetch it once per page load.
let rosterPromise: Promise<SkillInfo[]> | null = null;
function loadRoster(): Promise<SkillInfo[]> {
  rosterPromise ??= fetch("/api/skills")
    .then((r) => (r.ok ? r.json() : { skills: [] }))
    .then((d: { skills: SkillInfo[] }) => d.skills)
    .catch(() => []);
  return rosterPromise;
}

const pretty = (name: string) => name.replace(/-/g, " ");

/**
 * Skills are progressive disclosure: the agent always sees each skill's name
 * and one-line description, and reads the full SKILL.md only when a task
 * matches. This strip shows both halves — every available skill, and which
 * ones the agent actually loaded in this conversation (a `read_file` on
 * `/skills/<name>/…`).
 */
export function SkillsStrip({ used }: { used: SkillUse[] }) {
  const [roster, setRoster] = useState<SkillInfo[]>([]);
  useEffect(() => {
    void loadRoster().then(setRoster);
  }, []);

  const usedNames = new Set(used.map((u) => u.name));
  // Anything used but not in the roster (e.g. no repo access) still shows.
  const all = [
    ...roster,
    ...used.filter((u) => !roster.some((r) => r.name === u.name)).map((u) => ({ name: u.name, description: "" })),
  ];
  if (all.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-wb-border px-3 py-2">
      <span className="mr-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-wb-faint">Skills</span>
      {all.map((s) => {
        const active = usedNames.has(s.name);
        return (
          <span
            key={s.name}
            title={`${active ? "Loaded in this conversation. " : "Available — loaded when a task matches. "}${s.description}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] capitalize ${
              active
                ? "border-transparent bg-wb-accent-soft font-medium text-wb-accent"
                : "border-wb-border text-wb-faint"
            }`}
          >
            {active ? (
              <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
                <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
            {pretty(s.name)}
            <span className="sr-only">{active ? " (loaded)" : " (available)"}</span>
          </span>
        );
      })}
    </div>
  );
}
