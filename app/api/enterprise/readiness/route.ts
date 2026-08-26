import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { resolveWorkspaceScope } from "@/lib/workspace-access";
import { getEnterpriseReadiness } from "@/lib/enterprise-readiness";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = requireAuth(request, ["admin"]); if ("response" in auth) return auth.response;
  const scope = await resolveWorkspaceScope(request, auth.session); if (!scope) return NextResponse.json({ error: "Workspace scope is required." }, { status: 403 });
  return NextResponse.json(await getEnterpriseReadiness(scope.tenantId), { headers: { "Cache-Control": "private, no-store" } });
}
