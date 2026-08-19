import { randomUUID } from "crypto";

export type WorkspaceTenantStatus = "active" | "archived";
export type WorkspaceMembershipRole = "owner" | "admin" | "member" | "viewer";
export type WorkspaceMatterRole = "lead" | "editor" | "viewer";
export type WorkspaceClientStatus = "active" | "inactive";
export type WorkspaceMatterStatus = "open" | "on-hold" | "closed" | "archived";

export type WorkspaceTenant = {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceTenantStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMembership = {
  tenantId: string;
  userId: string;
  username: string;
  role: WorkspaceMembershipRole;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceClient = {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  taxId: string;
  status: WorkspaceClientStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMatter = {
  id: string;
  tenantId: string;
  clientId: string;
  name: string;
  matterNumber: string;
  description: string;
  status: WorkspaceMatterStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMatterMember = {
  tenantId: string;
  matterId: string;
  userId: string;
  role: WorkspaceMatterRole;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceScope = {
  tenantId: string;
  clientId?: string;
  matterId?: string;
  userId: string;
  username: string;
  role: "admin" | "user";
  membershipRole: WorkspaceMembershipRole;
  matterRole?: WorkspaceMatterRole;
};

export type LocalWorkspaceState = {
  version: 1;
  tenants: WorkspaceTenant[];
  memberships: WorkspaceMembership[];
  clients: WorkspaceClient[];
  matters: WorkspaceMatter[];
  matterMembers: WorkspaceMatterMember[];
};

const SAFE_WORKSPACE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export function defaultWorkspaceTenantId() {
  return normalizeWorkspaceId(process.env.TDP_DEFAULT_TENANT_ID || "tenant-default", "tenant-default");
}

export function defaultWorkspaceTenantName() {
  return String(process.env.TDP_DEFAULT_TENANT_NAME || "AA Jurist Local Workspace").trim().slice(0, 180);
}

export function workspaceSlug(value: unknown, fallback = "workspace") {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return normalized || fallback;
}

export function normalizeWorkspaceId(value: unknown, fallback = "") {
  const id = String(value || "").trim();
  if (!id) return fallback;
  if (!SAFE_WORKSPACE_ID.test(id) || id === "." || id === "..") {
    throw new Error("Invalid workspace identifier.");
  }
  return id;
}

export function createWorkspaceId(prefix: "tenant" | "client" | "matter") {
  return `${prefix}-${randomUUID()}`;
}

export function emptyLocalWorkspaceState(): LocalWorkspaceState {
  return {
    version: 1,
    tenants: [],
    memberships: [],
    clients: [],
    matters: [],
    matterMembers: []
  };
}

export function canWriteWorkspace(role: WorkspaceMembershipRole, matterRole?: WorkspaceMatterRole) {
  if (role === "owner" || role === "admin") return true;
  if (role === "viewer") return false;
  return !matterRole || matterRole === "lead" || matterRole === "editor";
}

export function canAdminWorkspace(role: WorkspaceMembershipRole) {
  return role === "owner" || role === "admin";
}
