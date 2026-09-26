import { deleteThreadRecord, ownerOf, renameThread } from "@/lib/server/history-store";
import { deleteLangGraphThread } from "@/lib/server/langgraph";
import { currentUser, json } from "@/lib/server/session";

type Params = { params: Promise<{ id: string }> };

async function authorize(params: Params["params"]) {
  const user = await currentUser();
  if (!user) return { error: json({ error: "Not signed in" }, 401) };
  const { id } = await params;
  // 404 rather than 403 for someone else's thread: don't confirm it exists.
  if (ownerOf(id) !== user.id) return { error: json({ error: "Not found" }, 404) };
  return { id };
}

/** Rename: `{ title }`. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await authorize(params);
  if ("error" in auth) return auth.error;
  const { title } = (await request.json().catch(() => ({}))) as { title?: string };
  if (!title?.trim()) return json({ error: "Title required" }, 400);
  renameThread(auth.id, title);
  return json({ ok: true });
}

/** Delete the conversation — the history record and the agent server's thread. */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await authorize(params);
  if ("error" in auth) return auth.error;
  deleteThreadRecord(auth.id);
  await deleteLangGraphThread(auth.id);
  return json({ ok: true });
}
