import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getRuntimeAdminSettings, saveRuntimeAdminSettings } from "@/lib/server-settings";
import { insertActivityLog } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ settings: await getRuntimeAdminSettings() });
}

export async function PUT(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  try {
    const body = await request.json();
    const settings = await saveRuntimeAdminSettings(body.settings || body);
    await insertActivityLog({
      id: `settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actor: auth.session.username,
      role: auth.session.role,
      action: "Update application settings",
      target: "Access plans and prompts",
      status: "success",
      detail: `Runtime settings updated at ${settings.updatedAt}.`,
      createdAt: new Date().toISOString()
    }).catch(() => undefined);
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid settings payload." }, { status: 400 });
  }
}
