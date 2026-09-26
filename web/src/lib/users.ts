/**
 * Demo sign-in. There are no passwords: picking a user sets a cookie, and the
 * server trusts it. That is enough to show per-user history and ownership
 * checks, and nothing more — real identity arrives with `identity.py` in
 * Milestone 8 (MDA 0.8 supports Supabase logins via `auth.supabase(...)`).
 */

export interface DemoUser {
  id: string;
  name: string;
  role: string;
}

export const DEMO_USERS: DemoUser[] = [
  { id: "alex", name: "Alex Rivera", role: "Research lead" },
  { id: "sam", name: "Sam Patel", role: "Analyst" },
  { id: "jordan", name: "Jordan Kim", role: "Product manager" },
];

/** httpOnly cookie holding the signed-in user id. Only the server reads it. */
export const USER_COOKIE = "wb_user";

/**
 * Header the web route stamps on every agent request, overwriting anything the
 * browser sent — the agent side (thread metadata, the history runner) reads the
 * user from here, never from the request body.
 */
export const USER_HEADER = "x-workbench-user";

export function findUser(id: string | undefined | null): DemoUser | undefined {
  return DEMO_USERS.find((u) => u.id === id);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
