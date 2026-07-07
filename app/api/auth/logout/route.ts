import { NextResponse } from "next/server";
import { clearSessionCookie, sessionFromRequest } from "@/lib/auth";
import { hasDatabase, insertActivityLog } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (session && hasDatabase()) {
    await insertActivityLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: new Date().toISOString(),
      actor: session.name,
      role: session.role,
      action: "Logout",
      target: "Authentication",
      status: "success",
      detail: `${session.name} signed out.`
    }).catch(() => undefined);
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response, request);
  return response;
}
