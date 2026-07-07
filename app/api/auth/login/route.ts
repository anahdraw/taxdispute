import { NextResponse } from "next/server";
import { createSessionToken, publicUser, setSessionCookie } from "@/lib/auth";
import { normalizeUsername, seedUsers } from "@/lib/admin";
import { hasDatabase, insertActivityLog, listManagedUsers, markManagedUserLogin } from "@/lib/db";
import type { ActivityLog, UserRole } from "@/lib/admin";

export const runtime = "nodejs";

function loginLog(username: string, role: UserRole | "guest", status: ActivityLog["status"], detail: string): ActivityLog {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    actor: username || "Guest",
    role,
    action: "Login",
    target: "Authentication",
    status,
    detail
  };
}

async function writeLoginLog(log: ActivityLog) {
  if (!hasDatabase()) return;
  await insertActivityLog(log).catch(() => undefined);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: string; password?: string; role?: UserRole };
    const username = normalizeUsername(String(body.username || ""));
    const password = String(body.password || "");
    const role = body.role === "admin" ? "admin" : "user";
    const users = hasDatabase() ? await listManagedUsers() : seedUsers;
    const user = users.find((item) => normalizeUsername(item.username) === username && item.role === role);

    if (!user || user.status !== "active" || user.password !== password) {
      await writeLoginLog(loginLog(username, role, "warning", "Invalid username, password, or role."));
      return NextResponse.json({ error: "Invalid username, password, or role." }, { status: 401 });
    }

    if (hasDatabase()) {
      await markManagedUserLogin(user.username).catch(() => undefined);
    }

    const sessionUser = { ...user, lastLoginAt: new Date().toISOString() };
    const token = createSessionToken(sessionUser);
    const response = NextResponse.json({
      ok: true,
      session: {
        role: sessionUser.role,
        name: sessionUser.name,
        username: sessionUser.username
      },
      user: publicUser(sessionUser)
    });
    setSessionCookie(response, token, request);
    await writeLoginLog(loginLog(sessionUser.name, sessionUser.role, "success", `${sessionUser.name} signed in as ${sessionUser.role}.`));
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not sign in." },
      { status: 500 }
    );
  }
}
