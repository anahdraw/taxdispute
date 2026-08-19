import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createResearchWorkspaceRecord,
  savedItemDedupeKey,
  updateResearchWorkspaceRecord,
  type ResearchWorkspaceScope
} from "../lib/research-workspace";
import {
  deleteResearchWorkspaceRecord,
  listResearchWorkspace,
  saveResearchWorkspaceRecord
} from "../lib/research-workspace-store";

test("saved items are normalized and deterministically deduplicated", () => {
  const scope = { tenantId: "tenant-a", userId: "user-a", matterId: "matter-a" };
  const item = createResearchWorkspaceRecord("saved-item", {
    resourceType: "regulation",
    resourceId: "uu-8-1983",
    title: "  UU PPN  ",
    url: "javascript:alert(1)",
    tags: ["PPN", "PPN", "Pajak Masukan"]
  }, scope, "2026-08-13T00:00:00.000Z");
  assert.equal("dedupeKey" in item && item.dedupeKey, savedItemDedupeKey("regulation", "uu-8-1983", ""));
  assert.equal("url" in item && item.url, "");
  assert.deepEqual("tags" in item && item.tags, ["PPN", "Pajak Masukan"]);
});

test("history records cannot be edited", () => {
  const scope = { tenantId: "tenant-a", userId: "user-a" };
  const record = createResearchWorkspaceRecord("history", { action: "search", query: "Pasal 9 UU PPN" }, scope);
  assert.throws(() => updateResearchWorkspaceRecord("history", record, { title: "changed" }), /immutable/);
});

test("local store persists atomically and isolates tenant, user, and matter", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aaj-research-test-"));
  const beforeRoot = process.env.TDP_LOCAL_WORKSPACE_ROOT;
  const beforeStore = process.env.TDP_WORKSPACE_STORE;
  process.env.TDP_LOCAL_WORKSPACE_ROOT = root;
  process.env.TDP_WORKSPACE_STORE = "local";
  try {
    const scope: ResearchWorkspaceScope = { tenantId: "tenant-a", userId: "user-a", clientId: "client-a", matterId: "matter-a" };
    const otherMatter: ResearchWorkspaceScope = { ...scope, matterId: "matter-b" };
    const saved = createResearchWorkspaceRecord("saved-item", { resourceType: "decision", resourceId: "put-1", title: "Putusan satu", url: "/decisions/put-1" }, scope);
    const highlight = createResearchWorkspaceRecord("highlight", { resourceType: "decision", resourceId: "put-1", title: "Putusan satu", quote: "Pertimbangan penting", anchor: { page: 8, paragraph: 4 } }, scope);
    await saveResearchWorkspaceRecord("saved-item", saved);
    await saveResearchWorkspaceRecord("highlight", highlight);
    const duplicate = createResearchWorkspaceRecord("saved-item", { resourceType: "decision", resourceId: "put-1", title: "Putusan satu diperbarui", url: "/decisions/put-1" }, scope);
    const persistedDuplicate = await saveResearchWorkspaceRecord("saved-item", duplicate);
    assert.equal(persistedDuplicate.id, saved.id);

    const snapshot = await listResearchWorkspace(scope);
    assert.equal(snapshot.savedItems.length, 1);
    assert.equal(snapshot.savedItems[0].title, "Putusan satu diperbarui");
    assert.equal(snapshot.highlights[0].anchor.page, 8);
    assert.equal((await listResearchWorkspace(otherMatter)).savedItems.length, 0);
    assert.equal((await listResearchWorkspace({ ...scope, tenantId: "tenant-b" })).savedItems.length, 0);

    const raw = JSON.parse(await readFile(path.join(root, "research.json"), "utf8"));
    assert.equal(raw.savedItems[0].ownerUserId, "user-a");
    assert.equal(await deleteResearchWorkspaceRecord("saved-item", saved.id, { ...scope, userId: "user-b" }), false);
    assert.equal(await deleteResearchWorkspaceRecord("saved-item", saved.id, scope), true);
  } finally {
    if (beforeRoot === undefined) delete process.env.TDP_LOCAL_WORKSPACE_ROOT; else process.env.TDP_LOCAL_WORKSPACE_ROOT = beforeRoot;
    if (beforeStore === undefined) delete process.env.TDP_WORKSPACE_STORE; else process.env.TDP_WORKSPACE_STORE = beforeStore;
    await rm(root, { recursive: true, force: true });
  }
});

test("dedupe and folder references remain inside the exact client and matter scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aaj-research-scope-test-"));
  const beforeRoot = process.env.TDP_LOCAL_WORKSPACE_ROOT;
  const beforeStore = process.env.TDP_WORKSPACE_STORE;
  process.env.TDP_LOCAL_WORKSPACE_ROOT = root;
  process.env.TDP_WORKSPACE_STORE = "local";
  try {
    const clientA: ResearchWorkspaceScope = { tenantId: "tenant-a", userId: "user-a", clientId: "client-a" };
    const clientB: ResearchWorkspaceScope = { tenantId: "tenant-a", userId: "user-a", clientId: "client-b" };
    const savedA = createResearchWorkspaceRecord("saved-item", { resourceType: "regulation", resourceId: "uu-8", title: "UU PPN" }, clientA);
    const savedB = createResearchWorkspaceRecord("saved-item", { resourceType: "regulation", resourceId: "uu-8", title: "UU PPN client B" }, clientB);
    const persistedA = await saveResearchWorkspaceRecord("saved-item", savedA);
    const persistedB = await saveResearchWorkspaceRecord("saved-item", savedB);
    assert.notEqual(persistedA.id, persistedB.id);
    assert.equal((await listResearchWorkspace(clientA)).savedItems[0].title, "UU PPN");
    assert.equal((await listResearchWorkspace(clientB)).savedItems[0].title, "UU PPN client B");

    const matterA = { ...clientA, matterId: "matter-a" };
    const matterB = { ...clientA, matterId: "matter-b" };
    const rootFolder = createResearchWorkspaceRecord("folder", { name: "Berkas utama" }, matterA);
    const foreignFolder = createResearchWorkspaceRecord("folder", { name: "Matter lain" }, matterB);
    await saveResearchWorkspaceRecord("folder", rootFolder);
    await saveResearchWorkspaceRecord("folder", foreignFolder);

    const wronglyScoped = createResearchWorkspaceRecord("saved-item", {
      resourceType: "decision",
      resourceId: "put-1",
      title: "Putusan satu",
      folderId: foreignFolder.id
    }, matterA);
    await assert.rejects(
      () => saveResearchWorkspaceRecord("saved-item", wronglyScoped),
      /Folder is not available in the current workspace scope/
    );

    const selfParent = updateResearchWorkspaceRecord("folder", rootFolder, { parentFolderId: rootFolder.id });
    await assert.rejects(
      () => saveResearchWorkspaceRecord("folder", selfParent),
      /cannot be its own parent/
    );

    const childFolder = createResearchWorkspaceRecord("folder", { name: "Anak", parentFolderId: rootFolder.id }, matterA);
    await saveResearchWorkspaceRecord("folder", childFolder);
    const cyclicRoot = updateResearchWorkspaceRecord("folder", rootFolder, { parentFolderId: childFolder.id });
    await assert.rejects(
      () => saveResearchWorkspaceRecord("folder", cyclicRoot),
      /cannot contain a cycle/
    );
  } finally {
    if (beforeRoot === undefined) delete process.env.TDP_LOCAL_WORKSPACE_ROOT; else process.env.TDP_LOCAL_WORKSPACE_ROOT = beforeRoot;
    if (beforeStore === undefined) delete process.env.TDP_WORKSPACE_STORE; else process.env.TDP_WORKSPACE_STORE = beforeStore;
    await rm(root, { recursive: true, force: true });
  }
});
