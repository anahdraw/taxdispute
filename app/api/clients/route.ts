import { NextResponse } from "next/server";
import { requireWorkspaceScope } from "@/lib/workspace-access";
import { listWorkspaceClients, upsertWorkspaceClient } from "@/lib/workspace-store";
import { createWorkspaceId, type WorkspaceClient } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await requireWorkspaceScope(request);
  if ("response" in access) return access.response;
  return NextResponse.json({ records: await listWorkspaceClients(access.scope.tenantId), scope: access.scope });
}
export async function POST(request: Request) {
  const access = await requireWorkspaceScope(request, { write: true });
  if ("response" in access) return access.response;
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 180);
    if (!name) return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    const now = new Date().toISOString();
    const record: WorkspaceClient = {
      id: createWorkspaceId("client"), tenantId: access.scope.tenantId, name,
      code: String(body.code || "").trim().slice(0, 80), taxId: String(body.taxId || "").trim().slice(0, 80),
      status: "active", createdBy: access.scope.userId, createdAt: now, updatedAt: now
    };
    await upsertWorkspaceClient(record);
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create client." }, { status: 400 });
  }
}
