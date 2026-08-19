import { getPool, hasDatabase } from "./db";
import { readLocalJson, updateLocalJson } from "./local-json-store";
import {
  defaultWorkspaceTenantId,
  defaultWorkspaceTenantName,
  emptyLocalWorkspaceState,
  workspaceSlug,
  type LocalWorkspaceState,
  type WorkspaceClient,
  type WorkspaceMatter,
  type WorkspaceMatterMember,
  type WorkspaceMembership,
  type WorkspaceTenant
} from "./workspace";

const LOCAL_WORKSPACE_FILE = "workspace.json";

export function workspaceUsesDatabase() {
  const configured = String(process.env.TDP_WORKSPACE_STORE || "").trim().toLowerCase();
  if (configured === "local") return false;
  if (configured === "database") return hasDatabase();
  return process.env.NODE_ENV === "production" && hasDatabase();
}

export function defaultTenantAutoEnrollmentEnabled() {
  const configured = String(process.env.TDP_DEFAULT_TENANT_AUTO_ENROLL || "").trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;

  const store = String(process.env.TDP_WORKSPACE_STORE || "").trim().toLowerCase();
  return process.env.NODE_ENV !== "production" && store !== "database" && !workspaceUsesDatabase();
}

export async function ensureWorkspaceSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS workspace_memberships (
      tenant_id TEXT NOT NULL REFERENCES workspace_tenants(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS workspace_clients (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES workspace_tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      tax_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS workspace_matters (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES workspace_tenants(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES workspace_clients(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      matter_number TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS workspace_matter_members (
      tenant_id TEXT NOT NULL REFERENCES workspace_tenants(id) ON DELETE CASCADE,
      matter_id TEXT NOT NULL REFERENCES workspace_matters(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (matter_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS workspace_memberships_user_idx
      ON workspace_memberships (user_id, tenant_id);
    CREATE INDEX IF NOT EXISTS workspace_clients_tenant_idx
      ON workspace_clients (tenant_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS workspace_matters_tenant_client_idx
      ON workspace_matters (tenant_id, client_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS workspace_matter_members_user_idx
      ON workspace_matter_members (tenant_id, user_id, matter_id);
  `);
}

function tenantFromRow(row: Record<string, unknown>): WorkspaceTenant {
  return {
    id: String(row.id), name: String(row.name), slug: String(row.slug),
    status: row.status === "archived" ? "archived" : "active",
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

function membershipFromRow(row: Record<string, unknown>): WorkspaceMembership {
  const role = String(row.role);
  return {
    tenantId: String(row.tenant_id), userId: String(row.user_id), username: String(row.username || ""),
    role: role === "owner" || role === "admin" || role === "viewer" ? role : "member",
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

function clientFromRow(row: Record<string, unknown>): WorkspaceClient {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), name: String(row.name), code: String(row.code || ""),
    taxId: String(row.tax_id || ""), status: row.status === "inactive" ? "inactive" : "active",
    createdBy: String(row.created_by), createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

function matterFromRow(row: Record<string, unknown>): WorkspaceMatter {
  const status = String(row.status);
  return {
    id: String(row.id), tenantId: String(row.tenant_id), clientId: String(row.client_id), name: String(row.name),
    matterNumber: String(row.matter_number || ""), description: String(row.description || ""),
    status: status === "on-hold" || status === "closed" || status === "archived" ? status : "open",
    createdBy: String(row.created_by), createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

function matterMemberFromRow(row: Record<string, unknown>): WorkspaceMatterMember {
  const role = String(row.role);
  return {
    tenantId: String(row.tenant_id), matterId: String(row.matter_id), userId: String(row.user_id),
    role: role === "lead" || role === "editor" ? role : "viewer",
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

export async function bootstrapDefaultWorkspace(user: { id: string; username: string; role: "admin" | "user" }) {
  if (!defaultTenantAutoEnrollmentEnabled()) return null;
  const tenantId = defaultWorkspaceTenantId();
  const now = new Date().toISOString();
  if (workspaceUsesDatabase()) {
    await ensureWorkspaceSchema();
    const pool = getPool();
    await pool.query(
      `INSERT INTO workspace_tenants (id, name, slug, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', $4, $4) ON CONFLICT (id) DO NOTHING`,
      [tenantId, defaultWorkspaceTenantName(), workspaceSlug(defaultWorkspaceTenantName(), "default"), now]
    );
    const tenant = await getWorkspaceTenant(tenantId);
    if (!tenant || tenant.status !== "active") return null;
    await pool.query(
      `INSERT INTO workspace_memberships (tenant_id, user_id, username, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET username = EXCLUDED.username`,
      [tenantId, user.id, user.username, user.role === "admin" ? "owner" : "member", now]
    );
    return tenantId;
  }
  let active = true;
  await updateLocalJson(LOCAL_WORKSPACE_FILE, emptyLocalWorkspaceState(), (state) => {
    const next: LocalWorkspaceState = { ...emptyLocalWorkspaceState(), ...state };
    const tenant = next.tenants.find((item) => item.id === tenantId);
    if (!tenant) {
      next.tenants.push({ id: tenantId, name: defaultWorkspaceTenantName(), slug: workspaceSlug(defaultWorkspaceTenantName()), status: "active", createdAt: now, updatedAt: now });
    }
    if (tenant?.status === "archived") {
      active = false;
      return next;
    }
    const existing = next.memberships.find((item) => item.tenantId === tenantId && item.userId === user.id);
    if (existing) existing.username = user.username;
    else next.memberships.push({ tenantId, userId: user.id, username: user.username, role: user.role === "admin" ? "owner" : "member", createdAt: now, updatedAt: now });
    return next;
  });
  return active ? tenantId : null;
}

export async function getWorkspaceTenant(tenantId: string): Promise<WorkspaceTenant | null> {
  if (workspaceUsesDatabase()) {
    await ensureWorkspaceSchema();
    const result = await getPool().query(`SELECT * FROM workspace_tenants WHERE id = $1 LIMIT 1`, [tenantId]);
    return result.rows[0] ? tenantFromRow(result.rows[0]) : null;
  }
  const state = await readLocalJson(LOCAL_WORKSPACE_FILE, emptyLocalWorkspaceState());
  return state.tenants.find((item) => item.id === tenantId) || null;
}

export async function getActiveWorkspaceTenant(tenantId: string) {
  const tenant = await getWorkspaceTenant(tenantId);
  return tenant?.status === "active" ? tenant : null;
}

export async function listWorkspaceTenantsForUser(userId: string) {
  if (workspaceUsesDatabase()) {
    await ensureWorkspaceSchema();
    const result = await getPool().query(
      `SELECT t.*, m.role AS membership_role, m.username AS membership_username,
              m.created_at AS membership_created_at, m.updated_at AS membership_updated_at
       FROM workspace_tenants t
       JOIN workspace_memberships m ON m.tenant_id = t.id WHERE m.user_id = $1 AND t.status = 'active'
       ORDER BY t.name ASC`, [userId]
    );
    return result.rows.map((row) => ({ tenant: tenantFromRow(row), membership: membershipFromRow({
      tenant_id: row.id, user_id: userId, username: row.membership_username, role: row.membership_role,
      created_at: row.membership_created_at, updated_at: row.membership_updated_at
    }) }));
  }
  const state = await readLocalJson(LOCAL_WORKSPACE_FILE, emptyLocalWorkspaceState());
  return state.memberships.filter((m) => m.userId === userId).map((membership) => ({
    tenant: state.tenants.find((t) => t.id === membership.tenantId), membership
  })).filter((item): item is { tenant: WorkspaceTenant; membership: WorkspaceMembership } => Boolean(item.tenant && item.tenant.status === "active"));
}

export async function getWorkspaceMembership(tenantId: string, userId: string) {
  if (workspaceUsesDatabase()) {
    await ensureWorkspaceSchema();
    const result = await getPool().query(`SELECT * FROM workspace_memberships WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`, [tenantId, userId]);
    return result.rows[0] ? membershipFromRow(result.rows[0]) : null;
  }
  const state = await readLocalJson(LOCAL_WORKSPACE_FILE, emptyLocalWorkspaceState());
  return state.memberships.find((item) => item.tenantId === tenantId && item.userId === userId) || null;
}

export async function createWorkspaceTenant(tenant: WorkspaceTenant, membership: WorkspaceMembership) {
  if (workspaceUsesDatabase()) {
    await ensureWorkspaceSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO workspace_tenants (id,name,slug,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6)`, [tenant.id, tenant.name, tenant.slug, tenant.status, tenant.createdAt, tenant.updatedAt]);
      await client.query(`INSERT INTO workspace_memberships (tenant_id,user_id,username,role,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6)`, [membership.tenantId, membership.userId, membership.username, membership.role, membership.createdAt, membership.updatedAt]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return;
  }
  await updateLocalJson(LOCAL_WORKSPACE_FILE, emptyLocalWorkspaceState(), (state) => {
    if (state.tenants.some((item) => item.id === tenant.id || item.slug === tenant.slug)) throw new Error("Workspace already exists.");
    return { ...state, tenants: [...state.tenants, tenant], memberships: [...state.memberships, membership] };
  });
}

export async function listWorkspaceClients(tenantId: string) {
  if (workspaceUsesDatabase()) {
    await ensureWorkspaceSchema();
    const result = await getPool().query(`SELECT * FROM workspace_clients WHERE tenant_id = $1 ORDER BY updated_at DESC`, [tenantId]);
    return result.rows.map(clientFromRow);
  }
  return (await readLocalJson(LOCAL_WORKSPACE_FILE, emptyLocalWorkspaceState())).clients.filter((item) => item.tenantId === tenantId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getWorkspaceClient(tenantId: string, clientId: string) {
  return (await listWorkspaceClients(tenantId)).find((item) => item.id === clientId) || null;
}

export async function upsertWorkspaceClient(record: WorkspaceClient) {
  if (workspaceUsesDatabase()) {
    await ensureWorkspaceSchema();
    await getPool().query(`INSERT INTO workspace_clients (id,tenant_id,name,code,tax_id,status,created_by,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,code=EXCLUDED.code,tax_id=EXCLUDED.tax_id,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at
      WHERE workspace_clients.tenant_id = EXCLUDED.tenant_id`, [record.id,record.tenantId,record.name,record.code,record.taxId,record.status,record.createdBy,record.createdAt,record.updatedAt]);
    return;
  }
  await updateLocalJson(LOCAL_WORKSPACE_FILE, emptyLocalWorkspaceState(), (state) => {
    const found = state.clients.findIndex((item) => item.id === record.id);
    if (found >= 0 && state.clients[found].tenantId !== record.tenantId) throw new Error("Client tenant mismatch.");
    const clients = [...state.clients]; if (found >= 0) clients[found] = record; else clients.push(record);
    return { ...state, clients };
  });
}

export async function listWorkspaceMatters(tenantId: string, userId: string, elevated: boolean, clientId?: string) {
  if (workspaceUsesDatabase()) {
    await ensureWorkspaceSchema();
    const values: unknown[] = [tenantId];
    let where = `m.tenant_id = $1`;
    if (clientId) { values.push(clientId); where += ` AND m.client_id = $${values.length}`; }
    if (!elevated) { values.push(userId); where += ` AND EXISTS (SELECT 1 FROM workspace_matter_members mm WHERE mm.matter_id=m.id AND mm.user_id=$${values.length})`; }
    const result = await getPool().query(`SELECT m.* FROM workspace_matters m WHERE ${where} ORDER BY m.updated_at DESC`, values);
    return result.rows.map(matterFromRow);
  }
  const state = await readLocalJson(LOCAL_WORKSPACE_FILE, emptyLocalWorkspaceState());
  const allowed = elevated ? null : new Set(state.matterMembers.filter((item) => item.tenantId === tenantId && item.userId === userId).map((item) => item.matterId));
  return state.matters.filter((item) => item.tenantId === tenantId && (!clientId || item.clientId === clientId) && (!allowed || allowed.has(item.id))).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getWorkspaceMatter(tenantId: string, matterId: string) {
  if (workspaceUsesDatabase()) {
    await ensureWorkspaceSchema();
    const result = await getPool().query(`SELECT * FROM workspace_matters WHERE tenant_id=$1 AND id=$2 LIMIT 1`, [tenantId,matterId]);
    return result.rows[0] ? matterFromRow(result.rows[0]) : null;
  }
  return (await readLocalJson(LOCAL_WORKSPACE_FILE, emptyLocalWorkspaceState())).matters.find((item) => item.tenantId === tenantId && item.id === matterId) || null;
}

export async function getWorkspaceMatterMember(tenantId: string, matterId: string, userId: string) {
  if (workspaceUsesDatabase()) {
    await ensureWorkspaceSchema();
    const result = await getPool().query(`SELECT * FROM workspace_matter_members WHERE tenant_id=$1 AND matter_id=$2 AND user_id=$3 LIMIT 1`, [tenantId,matterId,userId]);
    return result.rows[0] ? matterMemberFromRow(result.rows[0]) : null;
  }
  return (await readLocalJson(LOCAL_WORKSPACE_FILE, emptyLocalWorkspaceState())).matterMembers.find((item) => item.tenantId === tenantId && item.matterId === matterId && item.userId === userId) || null;
}

export async function createWorkspaceMatter(record: WorkspaceMatter, member: WorkspaceMatterMember) {
  if (workspaceUsesDatabase()) {
    await ensureWorkspaceSchema(); const client = await getPool().connect();
    try { await client.query("BEGIN");
      await client.query(`INSERT INTO workspace_matters (id,tenant_id,client_id,name,matter_number,description,status,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [record.id,record.tenantId,record.clientId,record.name,record.matterNumber,record.description,record.status,record.createdBy,record.createdAt,record.updatedAt]);
      await client.query(`INSERT INTO workspace_matter_members (tenant_id,matter_id,user_id,role,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6)`, [member.tenantId,member.matterId,member.userId,member.role,member.createdAt,member.updatedAt]);
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return;
  }
  await updateLocalJson(LOCAL_WORKSPACE_FILE, emptyLocalWorkspaceState(), (state) => {
    if (!state.clients.some((item) => item.id === record.clientId && item.tenantId === record.tenantId)) throw new Error("Client not found in workspace.");
    if (state.matters.some((item) => item.id === record.id)) throw new Error("Matter already exists.");
    return { ...state, matters: [...state.matters,record], matterMembers: [...state.matterMembers,member] };
  });
}
