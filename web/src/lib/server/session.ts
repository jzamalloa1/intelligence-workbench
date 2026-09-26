import "server-only";

import { cookies } from "next/headers";
import { findUser, USER_COOKIE, type DemoUser } from "../users";
import { ownerOf } from "./history-store";

/** The signed-in demo user, from the httpOnly cookie — or undefined. */
export async function currentUser(): Promise<DemoUser | undefined> {
  const store = await cookies();
  return findUser(store.get(USER_COOKIE)?.value);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Whether `userId` may touch `threadId`. A thread nobody has registered yet is
 * allowed — that is how a new conversation starts; its first run claims it.
 */
export function mayAccess(threadId: string, userId: string): boolean {
  const owner = ownerOf(threadId);
  return owner === undefined || owner === userId;
}
