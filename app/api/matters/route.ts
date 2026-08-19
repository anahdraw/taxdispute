import { NextResponse } from "next/server";
import { requireWorkspaceScope } from "@/lib/workspace-access";
import { createWorkspaceMatter, getWorkspaceClient, listWorkspaceMatters } from "@/lib/workspace-store";
import { canAdminWorkspace, createWorkspaceId, normalizeWorkspaceId, type WorkspaceMatter, type WorkspaceMatterMember } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await requireWorkspaceScope(request);
  if ("response" in access) return access.response;
  const records = await listWorkspaceMatters(access.scope.tenantId, access.scope.userId, canAdminWorkspace(access.scope.membershipRole), access.scope.clientId);
  return NextResponse.json({ records, scope: access.scope });
}
export async function POST(request: Request) {
  const access = await requireWorkspaceScope(request, { write: true });
  if ("response" in access) return access.response;
  try {
    const body = await request.json().catch(() => ({}));
    const clientId = normalizeWorkspaceId(body.clientId || access.scope.clientId, "");
    const name = String(body.name || "").trim().slice(0, 180);
    if (!clientId || !name) return NextResponse.json({ error: "clientId and matter name are required." }, { status: 400 });
    if (!(await getWorkspaceClient(access.scope.tenantId, clientId))) return NextResponse.json({ error: "Client not found in workspace." }, { status: 404 });
    const now = new Date().toISOString();
    const record: WorkspaceMatter = { id: createWorkspaceId("matter"), tenantId: access.scope.tenantId, clientId, name, matterNumber: String(body.matterNumber || "").trim().slice(0,100), description: String(body.description || "").trim().slice(0,2000), status: "open", createdBy: access.scope.userId, createdAt: now, updatedAt: now };
    const member: WorkspaceMatterMember = { tenantId: access.scope.tenantId, matterId: record.id, userId: access.scope.userId, role: "lead", createdAt: now, updatedAt: now };
    await createWorkspaceMatter(record, member);
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create matter." }, { status: 400 });
  }
}
