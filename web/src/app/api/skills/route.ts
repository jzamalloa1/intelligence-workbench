import fs from "node:fs/promises";
import path from "node:path";
import { json } from "@/lib/server/session";

/**
 * The skills the agent can load — name and description from each
 * `agent/skills/<name>/SKILL.md` frontmatter, the same text deepagents lists in
 * the agent's system prompt. Read from the repo, so it works wherever the web
 * app runs next to the agent project (local dev); elsewhere it returns an empty
 * list and the Skills strip shows only the skills a conversation actually used.
 */
const SKILLS_DIR = process.env.SKILLS_DIR ?? path.join(process.cwd(), "..", "agent", "skills");

function frontmatter(text: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

export async function GET() {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const skills = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          const fm = frontmatter(await fs.readFile(path.join(SKILLS_DIR, e.name, "SKILL.md"), "utf8"));
          return { name: fm.name ?? e.name, description: fm.description ?? "" };
        }),
    );
    return json({ skills: skills.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch {
    return json({ skills: [] });
  }
}
