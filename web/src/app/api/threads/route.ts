import { listThreads } from "@/lib/server/history-store";
import { currentUser, json } from "@/lib/server/session";

/** The signed-in user's conversations, newest first. Never anyone else's. */
export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  return json({ threads: listThreads(user.id) });
}
