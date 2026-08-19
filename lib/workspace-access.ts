import { NextResponse } from "next/server";
import { requireAuth, type AppSession } from "./auth";
import {
  bootstrapDefaultWorkspace,
  getActiveWorkspaceTenant,
  getWorkspaceClient,
  getWorkspaceMatter,
  getWorkspaceMatterMember,
  getWorkspaceMembership,
  listWorkspaceTenantsForUser
} from "./workspace-store";
import { canAdminWorkspace, canWriteWorkspace, normalizeWorkspaceId, type WorkspaceScope } from "./workspace";

type ScopeOptions = {
  write?: boolean;
  admin?: boolean;
  requireClient?: boolean;
  requireMatter?: boolean;
};

type WorkspaceAccessResult =
  | { session: AppSession; scope: WorkspaceScope }
  | { response: NextResponse };

function requestedId(request: Request, name: "tenantId" | "clientId" | "matterId") {
  const url = new URL(request.url);
  const header = request.headers.get(`x-aaj-${name.replace("Id", "-id").toLowerCase()}`);
  return header || url.searchParams.get(name) || "";
}

export async function resolveWorkspaceScope(request: Request, session: AppSession): Promise<WorkspaceScope | null> {
  await bootstrapDefaultWorkspace({ id: session.sub, username: session.username, role: session.role });
  const requestedTenant = normalizeWorkspaceId(requestedId(request, "tenantId"), "");
  const memberships = requestedTenant
    ? []
    : await listWorkspaceTenantsForUser(session.sub);
  const tenantId = requestedTenant || memberships[0]?.tenant.id || "";
  if (!tenantId || !(await getActiveWorkspaceTenant(tenantId))) return null;
  const membership = requestedTenant
    ? await getWorkspaceMembership(tenantId, session.sub)
    : memberships.find((item) => item.tenant.id === tenantId)?.membership || await getWorkspaceMembership(tenantId, session.sub);
  if (!membership) return null;

  const clientId = normalizeWorkspaceId(requestedId(request, "clientId"), "");
  const matterId = normalizeWorkspaceId(requestedId(request, "matterId"), "");
  if (clientId && !(await getWorkspaceClient(tenantId, clientId))) return null;
  let matterRole: WorkspaceScope["matterRole"];
  if (matterId) {
    const matter = await getWorkspaceMatter(tenantId, matterId);
    if (!matter || (clientId && matter.clientId !== clientId)) return null;
    if (!canAdminWorkspace(membership.role)) {
      const member = await getWorkspaceMatterMember(tenantId, matterId, session.sub);
      if (!member) return null;
      matterRole = member.role;
    }
  }
  return { tenantId, clientId: clientId || undefined, matterId: matterId || undefined, userId: session.sub, username: session.username, role: session.role, membershipRole: membership.role, matterRole };
}

export async function requireWorkspaceScope(request: Request, options: ScopeOptions = {}): Promise<WorkspaceAccessResult> {
  const auth = requireAuth(request);
  if ("response" in auth && auth.response) return { response: auth.response };
  try {
    const scope = await resolveWorkspaceScope(request, auth.session);
    if (!scope) return { response: NextResponse.json({ error: "Workspace access denied." }, { status: 403 }) };
    if (options.requireClient && !scope.clientId) return { response: NextResponse.json({ error: "clientId is required." }, { status: 400 }) };
    if (options.requireMatter && !scope.matterId) return { response: NextResponse.json({ error: "matterId is required." }, { status: 400 }) };
    if (options.admin && !canAdminWorkspace(scope.membershipRole)) return { response: NextResponse.json({ error: "Workspace administrator access required." }, { status: 403 }) };
    if (options.write && !canWriteWorkspace(scope.membershipRole, scope.matterRole)) return { response: NextResponse.json({ error: "Workspace is read-only for this user." }, { status: 403 }) };
    return { session: auth.session, scope };
  } catch (error) {
    return { response: NextResponse.json({ error: error instanceof Error ? error.message : "Workspace access could not be verified." }, { status: 400 }) };
  }
}
