import { NextResponse } from "next/server";
import { hasDatabase, insertActivityLog, listActivityLogs } from "@/lib/db";
import type { ActivityLog } from "@/lib/admin";

export const runtime = "nodejs";

function makeLog(body: Partial<ActivityLog>): ActivityLog {
  return {
    id: body.id || `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: body.createdAt || new Date().toISOString(),
    actor: String(body.actor || "System"),
    role: body.role === "admin" ? "admin" : body.role === "user" ? "user" : "guest",
    action: String(body.action || "activity"),
    target: String(body.target || ""),
    status: body.status === "error" ? "error" : body.status === "warning" ? "warning" : "success",
    detail: String(body.detail || "")
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 200);
  if (!hasDatabase()) return NextResponse.json({ records: [], warning: "Database is not configured." });
  const records = await listActivityLogs(limit).catch(() => []);
  return NextResponse.json({ records });
}

export async function POST(request: Request) {
  try {
    const log = makeLog((await request.json()) as Partial<ActivityLog>);
    if (hasDatabase()) {
      await insertActivityLog(log);
      const records = await listActivityLogs(200);
      return NextResponse.json({ ok: true, log, records });
    }
    return NextResponse.json({ ok: true, log, records: [], warning: "Database is not configured." });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not write activity log." },
      { status: 500 }
    );
  }
}
