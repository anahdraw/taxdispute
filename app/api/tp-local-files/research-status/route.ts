import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import { hasTavilyKey } from "@/lib/tavily";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireFeature(request, "tpLocalFile");
  if ("response" in auth) return auth.response;
  return NextResponse.json({
    configured: hasTavilyKey(),
    provider: "Tavily",
    privacyMode: "explicit-opt-in-anonymous-descriptors"
  });
}
