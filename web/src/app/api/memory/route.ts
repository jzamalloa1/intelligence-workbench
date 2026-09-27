import fs from "node:fs/promises";
import path from "node:path";
import { currentUser, json } from "@/lib/server/session";

/**
 * The agent's durable memory, as it stands now.
 *
 * Under `mda dev` it lives in the local Context Hub stand-in,
 * `agent/.mda/__contexthub__/memories/agent/` — outside `.mda/build/`, so
 * compiles don't erase it. A deployed agent keeps it in LangSmith Context Hub,
 * which this route doesn't reach: it then answers `available: false` and the
 * panel shows only what the open conversation changed.
 *
 * Read-only, and the same for every user — agent memory is deployment-wide.
 */
const MEMORY_DIR =
  process.env.AGENT_MEMORY_DIR ?? path.join(process.cwd(), "..", "agent", ".mda", "__contexthub__", "memories", "agent");
const MAX_BYTES = 200_000;

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : Promise.resolve([path.join(dir, e.name)]))),
  );
  return nested.flat();
}

export async function GET() {
  if (!(await currentUser())) return json({ error: "Not signed in" }, 401);
  try {
    const files = await Promise.all(
      (await walk(MEMORY_DIR)).map(async (file) => {
        const stat = await fs.stat(file);
        const content = stat.size > MAX_BYTES ? "(file too large to show)" : await fs.readFile(file, "utf8");
        return {
          path: `/memories/agent/${path.relative(MEMORY_DIR, file).split(path.sep).join("/")}`,
          content,
          updatedAt: stat.mtimeMs,
        };
      }),
    );
    return json({ available: true, files: files.sort((a, b) => a.path.localeCompare(b.path)) });
  } catch {
    return json({ available: false, files: [] });
  }
}
