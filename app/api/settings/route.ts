import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getRuntimeAdminSettings } from "@/lib/server-settings";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
  const settings = await getRuntimeAdminSettings();
  return NextResponse.json({ plans: settings.plans, updatedAt: settings.updatedAt });
}
