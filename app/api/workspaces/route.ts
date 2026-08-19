import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { bootstrapDefaultWorkspace, createWorkspaceTenant, listWorkspaceTenantsForUser, workspaceUsesDatabase } from "@/lib/workspace-store";
import { createWorkspaceId, workspaceSlug, type WorkspaceMembership, type WorkspaceTenant } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
  await bootstrapDefaultWorkspace({ id: auth.session.sub, username: auth.session.username, role: auth.session.role });
  return NextResponse.json({ records: await listWorkspaceTenantsForUser(auth.session.sub), store: workspaceUsesDatabase() ? "database" : "local" });
}
export async function POST(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 180);
    if (!name) return NextResponse.json({ error: "Workspace name is required." }, { status: 400 });
    const now = new Date().toISOString();
    const tenant: WorkspaceTenant = { id: createWorkspaceId("tenant"), name, slug: `${workspaceSlug(name)}-${randomUUID().slice(0, 8)}`, status: "active", createdAt: now, updatedAt: now };
    const membership: WorkspaceMembership = { tenantId: tenant.id, userId: auth.session.sub, username: auth.session.username, role: "owner", createdAt: now, updatedAt: now };
    await createWorkspaceTenant(tenant, membership);
    return NextResponse.json({ tenant, membership }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create workspace." }, { status: 400 });
  }
}
