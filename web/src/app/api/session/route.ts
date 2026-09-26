import { cookies } from "next/headers";
import { currentUser, json } from "@/lib/server/session";
import { DEMO_USERS, findUser, USER_COOKIE } from "@/lib/users";

/** Who is signed in, plus the roster the sign-in screen offers. */
export async function GET() {
  return json({ user: (await currentUser()) ?? null, users: DEMO_USERS });
}

/** Demo sign-in: `{ userId }` → cookie. No password — see lib/users.ts. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { userId?: string };
  const user = findUser(body.userId);
  if (!user) return json({ error: "Unknown user" }, 400);
  (await cookies()).set(USER_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return json({ user });
}

/** Sign out. */
export async function DELETE() {
  (await cookies()).delete(USER_COOKIE);
  return json({ user: null });
}
