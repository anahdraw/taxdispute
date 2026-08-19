import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertPrivateObjectAccess,
  deletePrivateObject,
  listPrivateObjects,
  readPrivateObject,
  registerPrivateObject,
  writePrivateObject
} from "../lib/private-storage";
import {
  bootstrapDefaultWorkspace,
  createWorkspaceMatter,
  createWorkspaceTenant,
  defaultTenantAutoEnrollmentEnabled,
  getActiveWorkspaceTenant,
  getWorkspaceTenant,
  listWorkspaceMatters,
  listWorkspaceTenantsForUser,
  upsertWorkspaceClient,
  workspaceUsesDatabase
} from "../lib/workspace-store";
import { type WorkspaceMatter, type WorkspaceMatterMember, type WorkspaceMembership, type WorkspaceScope, type WorkspaceTenant } from "../lib/workspace";

test("local workspace persists tenant, client, matter, and membership isolation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aaj-tenant-test-"));
  const previousRoot = process.env.TDP_LOCAL_WORKSPACE_ROOT;
  const previousStore = process.env.TDP_WORKSPACE_STORE;
  const previousAutoEnroll = process.env.TDP_DEFAULT_TENANT_AUTO_ENROLL;
  process.env.TDP_LOCAL_WORKSPACE_ROOT = root;
  process.env.TDP_WORKSPACE_STORE = "local";
  process.env.TDP_DEFAULT_TENANT_AUTO_ENROLL = "true";
  try {
    assert.equal(workspaceUsesDatabase(), false);
    const tenantId = await bootstrapDefaultWorkspace({ id: "user-a", username: "advisor-a", role: "user" });
    assert.ok(tenantId);
    await bootstrapDefaultWorkspace({ id: "user-b", username: "advisor-b", role: "user" });
    const tenants = await listWorkspaceTenantsForUser("user-a");
    assert.equal(tenants[0].tenant.id, tenantId);
    assert.equal(tenants[0].membership.role, "member");

    const now = "2026-08-13T00:00:00.000Z";
    await upsertWorkspaceClient({ id: "client-a", tenantId, name: "PT Example", code: "EX", taxId: "01", status: "active", createdBy: "user-a", createdAt: now, updatedAt: now });
    const matter: WorkspaceMatter = { id: "matter-a", tenantId, clientId: "client-a", name: "VAT appeal", matterNumber: "MAT-01", description: "", status: "open", createdBy: "user-a", createdAt: now, updatedAt: now };
    const member: WorkspaceMatterMember = { tenantId, matterId: matter.id, userId: "user-a", role: "lead", createdAt: now, updatedAt: now };
    await createWorkspaceMatter(matter, member);
    assert.equal((await listWorkspaceMatters(tenantId, "user-a", false)).length, 1);
    assert.equal((await listWorkspaceMatters(tenantId, "user-b", false)).length, 0);

    const persisted = JSON.parse(await readFile(path.join(root, "workspace.json"), "utf8"));
    assert.equal(persisted.clients[0].id, "client-a");
    assert.equal(persisted.matters[0].id, "matter-a");
  } finally {
    if (previousRoot === undefined) delete process.env.TDP_LOCAL_WORKSPACE_ROOT; else process.env.TDP_LOCAL_WORKSPACE_ROOT = previousRoot;
    if (previousStore === undefined) delete process.env.TDP_WORKSPACE_STORE; else process.env.TDP_WORKSPACE_STORE = previousStore;
    if (previousAutoEnroll === undefined) delete process.env.TDP_DEFAULT_TENANT_AUTO_ENROLL; else process.env.TDP_DEFAULT_TENANT_AUTO_ENROLL = previousAutoEnroll;
    await rm(root, { recursive: true, force: true });
  }
});

test("default-tenant auto-enrollment is safe by default and remains explicitly configurable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aaj-enrollment-test-"));
  const previousRoot = process.env.TDP_LOCAL_WORKSPACE_ROOT;
  const previousStore = process.env.TDP_WORKSPACE_STORE;
  const previousAutoEnroll = process.env.TDP_DEFAULT_TENANT_AUTO_ENROLL;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.TDP_LOCAL_WORKSPACE_ROOT = root;
  try {
    process.env.TDP_WORKSPACE_STORE = "local";
    process.env.NODE_ENV = "development";
    delete process.env.TDP_DEFAULT_TENANT_AUTO_ENROLL;
    assert.equal(defaultTenantAutoEnrollmentEnabled(), true);

    process.env.NODE_ENV = "production";
    assert.equal(defaultTenantAutoEnrollmentEnabled(), false);
    assert.equal(await bootstrapDefaultWorkspace({ id: "production-user", username: "production", role: "user" }), null);
    assert.deepEqual(await listWorkspaceTenantsForUser("production-user"), []);

    process.env.NODE_ENV = "development";
    process.env.TDP_WORKSPACE_STORE = "database";
    assert.equal(defaultTenantAutoEnrollmentEnabled(), false);

    process.env.NODE_ENV = "production";
    process.env.TDP_WORKSPACE_STORE = "local";
    process.env.TDP_DEFAULT_TENANT_AUTO_ENROLL = "true";
    assert.equal(defaultTenantAutoEnrollmentEnabled(), true);
    const tenantId = await bootstrapDefaultWorkspace({ id: "explicit-user", username: "explicit", role: "user" });
    assert.ok(tenantId);
  } finally {
    if (previousRoot === undefined) delete process.env.TDP_LOCAL_WORKSPACE_ROOT; else process.env.TDP_LOCAL_WORKSPACE_ROOT = previousRoot;
    if (previousStore === undefined) delete process.env.TDP_WORKSPACE_STORE; else process.env.TDP_WORKSPACE_STORE = previousStore;
    if (previousAutoEnroll === undefined) delete process.env.TDP_DEFAULT_TENANT_AUTO_ENROLL; else process.env.TDP_DEFAULT_TENANT_AUTO_ENROLL = previousAutoEnroll;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    await rm(root, { recursive: true, force: true });
  }
});

test("active-tenant lookup rejects archived and nonexistent tenants", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aaj-active-tenant-test-"));
  const previousRoot = process.env.TDP_LOCAL_WORKSPACE_ROOT;
  const previousStore = process.env.TDP_WORKSPACE_STORE;
  process.env.TDP_LOCAL_WORKSPACE_ROOT = root;
  process.env.TDP_WORKSPACE_STORE = "local";
  try {
    const now = "2026-08-13T00:00:00.000Z";
    const tenant: WorkspaceTenant = { id: "tenant-archived", name: "Archived", slug: "archived", status: "archived", createdAt: now, updatedAt: now };
    const membership: WorkspaceMembership = { tenantId: tenant.id, userId: "user-a", username: "advisor-a", role: "owner", createdAt: now, updatedAt: now };
    await createWorkspaceTenant(tenant, membership);
    assert.equal((await getWorkspaceTenant(tenant.id))?.status, "archived");
    assert.equal(await getActiveWorkspaceTenant(tenant.id), null);
    assert.equal(await getActiveWorkspaceTenant("tenant-does-not-exist"), null);
    assert.deepEqual(await listWorkspaceTenantsForUser("user-a"), []);
  } finally {
    if (previousRoot === undefined) delete process.env.TDP_LOCAL_WORKSPACE_ROOT; else process.env.TDP_LOCAL_WORKSPACE_ROOT = previousRoot;
    if (previousStore === undefined) delete process.env.TDP_WORKSPACE_STORE; else process.env.TDP_WORKSPACE_STORE = previousStore;
    await rm(root, { recursive: true, force: true });
  }
});

test("private storage is durable and rejects traversal or another user scope", async () => {
  const metadataRoot = await mkdtemp(path.join(os.tmpdir(), "aaj-private-meta-"));
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "aaj-private-files-"));
  const oldMetadataRoot = process.env.TDP_LOCAL_WORKSPACE_ROOT;
  const oldStorageRoot = process.env.TDP_PRIVATE_STORAGE_ROOT;
  process.env.TDP_LOCAL_WORKSPACE_ROOT = metadataRoot;
  process.env.TDP_PRIVATE_STORAGE_ROOT = storageRoot;
  const scope: WorkspaceScope = { tenantId: "tenant-a", clientId: "client-a", matterId: "matter-a", userId: "user-a", username: "advisor-a", role: "user", membershipRole: "member", matterRole: "lead" };
  try {
    const stored = await writePrivateObject(scope, "file-a", "evidence.pdf", new Uint8Array([37, 80, 68, 70]));
    await registerPrivateObject({ id: "file-a", key: stored.key, filename: "evidence.pdf", contentType: "application/pdf", size: stored.size, tenantId: scope.tenantId, clientId: scope.clientId, matterId: scope.matterId, ownerUserId: scope.userId, createdAt: new Date().toISOString() });
    assert.deepEqual([...await readPrivateObject(scope, stored.key)], [37, 80, 68, 70]);
    assert.equal((await listPrivateObjects(scope)).length, 1);
    assert.throws(() => assertPrivateObjectAccess({ ...scope, userId: "user-b" }, stored.key), /denied/);
    assert.throws(() => assertPrivateObjectAccess(scope, "../../etc/passwd"), /denied|Invalid/);
    await deletePrivateObject(scope, stored.key);
  } finally {
    if (oldMetadataRoot === undefined) delete process.env.TDP_LOCAL_WORKSPACE_ROOT; else process.env.TDP_LOCAL_WORKSPACE_ROOT = oldMetadataRoot;
    if (oldStorageRoot === undefined) delete process.env.TDP_PRIVATE_STORAGE_ROOT; else process.env.TDP_PRIVATE_STORAGE_ROOT = oldStorageRoot;
    await rm(metadataRoot, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  }
});
