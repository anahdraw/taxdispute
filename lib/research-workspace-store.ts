import { getPool } from "./db";
import { readLocalJson, updateLocalJson } from "./local-json-store";
import { workspaceUsesDatabase } from "./workspace-store";
import {
  emptyResearchWorkspaceSnapshot,
  recordBelongsToScope,
  savedItemDedupeKey,
  type ResearchFolder,
  type ResearchHighlight,
  type ResearchHistoryEntry,
  type ResearchWorkspaceEntity,
  type ResearchWorkspaceRecord,
  type ResearchWorkspaceScope,
  type ResearchWorkspaceSnapshot,
  type SavedResearchItem
} from "./research-workspace";

const LOCAL_RESEARCH_FILE = "research.json";

type LocalResearchState = Omit<ResearchWorkspaceSnapshot, "scope">;

function emptyLocalResearchState(): LocalResearchState {
  const empty = emptyResearchWorkspaceSnapshot({ tenantId: "", userId: "" });
  const { scope: _scope, ...state } = empty;
  return state;
}

export async function ensureResearchWorkspaceSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS research_folders (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      client_id TEXT,
      matter_id TEXT,
      name TEXT NOT NULL,
      parent_folder_id TEXT,
      color TEXT NOT NULL DEFAULT '#00a7e1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS research_saved_items (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      client_id TEXT,
      matter_id TEXT,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL DEFAULT '',
      dedupe_key TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      folder_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS research_highlights (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      client_id TEXT,
      matter_id TEXT,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      quote TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#fff3a3',
      folder_id TEXT,
      anchor JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS research_history (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      client_id TEXT,
      matter_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      query TEXT NOT NULL DEFAULT '',
      response_excerpt TEXT NOT NULL DEFAULT '',
      session_id TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS research_folders_scope_idx
      ON research_folders (tenant_id, owner_user_id, matter_id, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS research_saved_items_dedupe_idx
      ON research_saved_items (tenant_id, owner_user_id, (COALESCE(client_id, '')), (COALESCE(matter_id, '')), dedupe_key);
    CREATE INDEX IF NOT EXISTS research_saved_items_scope_idx
      ON research_saved_items (tenant_id, owner_user_id, matter_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS research_highlights_scope_idx
      ON research_highlights (tenant_id, owner_user_id, matter_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS research_history_scope_idx
      ON research_history (tenant_id, owner_user_id, matter_id, created_at DESC);
  `);
}

function normalizedScopeRows(scope: ResearchWorkspaceScope) {
  return [scope.tenantId, scope.userId, scope.clientId || null, scope.matterId || null];
}

function scopeWhere(scope: ResearchWorkspaceScope, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const values: unknown[] = [scope.tenantId, scope.userId];
  let sql = `${prefix}tenant_id = $1 AND ${prefix}owner_user_id = $2`;
  if (scope.clientId) { values.push(scope.clientId); sql += ` AND ${prefix}client_id = $${values.length}`; }
  if (scope.matterId) { values.push(scope.matterId); sql += ` AND ${prefix}matter_id = $${values.length}`; }
  return { sql, values };
}

function commonFromRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    ownerUserId: String(row.owner_user_id),
    ...(row.client_id ? { clientId: String(row.client_id) } : {}),
    ...(row.matter_id ? { matterId: String(row.matter_id) } : {}),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

function folderFromRow(row: Record<string, unknown>): ResearchFolder {
  return { ...commonFromRow(row), name: String(row.name), parentFolderId: row.parent_folder_id ? String(row.parent_folder_id) : undefined, color: String(row.color) };
}

function savedItemFromRow(row: Record<string, unknown>): SavedResearchItem {
  return {
    ...commonFromRow(row), resourceType: row.resource_type as SavedResearchItem["resourceType"], resourceId: String(row.resource_id || ""),
    dedupeKey: String(row.dedupe_key), title: String(row.title), url: String(row.url || ""), excerpt: String(row.excerpt || ""),
    note: String(row.note || ""), tags: Array.isArray(row.tags) ? row.tags.map(String) : [], folderId: row.folder_id ? String(row.folder_id) : undefined,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {}
  };
}

function highlightFromRow(row: Record<string, unknown>): ResearchHighlight {
  return {
    ...commonFromRow(row), resourceType: row.resource_type as ResearchHighlight["resourceType"], resourceId: String(row.resource_id || ""),
    title: String(row.title), url: String(row.url || ""), quote: String(row.quote), note: String(row.note || ""), color: String(row.color),
    folderId: row.folder_id ? String(row.folder_id) : undefined,
    anchor: row.anchor && typeof row.anchor === "object" ? row.anchor as ResearchHighlight["anchor"] : {}
  };
}

function historyFromRow(row: Record<string, unknown>): ResearchHistoryEntry {
  return {
    ...commonFromRow(row), action: row.action as ResearchHistoryEntry["action"], resourceType: row.resource_type as ResearchHistoryEntry["resourceType"],
    resourceId: String(row.resource_id || ""), title: String(row.title), url: String(row.url || ""), query: String(row.query || ""),
    responseExcerpt: String(row.response_excerpt || ""), sessionId: String(row.session_id || ""),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {}
  };
}

function sortRecords<T extends { updatedAt: string }>(records: T[]) {
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function exactRecordScope(record: ResearchWorkspaceRecord): ResearchWorkspaceScope {
  return {
    tenantId: record.tenantId,
    userId: record.ownerUserId,
    clientId: record.clientId,
    matterId: record.matterId
  };
}

function belongsToExactScope(record: ResearchWorkspaceRecord, scope: ResearchWorkspaceScope) {
  return record.tenantId === scope.tenantId
    && record.ownerUserId === scope.userId
    && (record.clientId || "") === (scope.clientId || "")
    && (record.matterId || "") === (scope.matterId || "");
}

async function assertFolderReference(entity: ResearchWorkspaceEntity, record: ResearchWorkspaceRecord) {
  const folderId = entity === "folder"
    ? (record as ResearchFolder).parentFolderId
    : entity === "saved-item"
      ? (record as SavedResearchItem).folderId
      : entity === "highlight"
        ? (record as ResearchHighlight).folderId
        : undefined;
  if (!folderId) return;

  if (entity === "folder" && folderId === record.id) {
    throw new Error("Folder cannot be its own parent.");
  }

  const scope = exactRecordScope(record);
  const snapshot = await listResearchWorkspace(scope);
  const folders = new Map(snapshot.folders
    .filter((folder) => belongsToExactScope(folder, scope))
    .map((folder) => [folder.id, folder]));
  const referenced = folders.get(folderId);
  if (!referenced) throw new Error("Folder is not available in the current workspace scope.");

  if (entity !== "folder") return;
  const visited = new Set<string>();
  let cursor: ResearchFolder | undefined = referenced;
  while (cursor) {
    if (cursor.id === record.id) throw new Error("Folder hierarchy cannot contain a cycle.");
    if (visited.has(cursor.id)) throw new Error("Folder hierarchy contains an existing cycle.");
    visited.add(cursor.id);
    cursor = cursor.parentFolderId ? folders.get(cursor.parentFolderId) : undefined;
  }
}

export async function listResearchWorkspace(scope: ResearchWorkspaceScope): Promise<ResearchWorkspaceSnapshot> {
  if (!workspaceUsesDatabase()) {
    const state = await readLocalJson(LOCAL_RESEARCH_FILE, emptyLocalResearchState());
    return {
      schemaVersion: 1, scope,
      folders: sortRecords(state.folders.filter((item) => recordBelongsToScope(item, scope))),
      savedItems: sortRecords(state.savedItems.filter((item) => recordBelongsToScope(item, scope))),
      highlights: sortRecords(state.highlights.filter((item) => recordBelongsToScope(item, scope))),
      history: sortRecords(state.history.filter((item) => recordBelongsToScope(item, scope))).slice(0, 250)
    };
  }
  await ensureResearchWorkspaceSchema();
  const where = scopeWhere(scope);
  const pool = getPool();
  const [folders, saved, highlights, history] = await Promise.all([
    pool.query(`SELECT * FROM research_folders WHERE ${where.sql} ORDER BY updated_at DESC`, where.values),
    pool.query(`SELECT * FROM research_saved_items WHERE ${where.sql} ORDER BY updated_at DESC`, where.values),
    pool.query(`SELECT * FROM research_highlights WHERE ${where.sql} ORDER BY updated_at DESC`, where.values),
    pool.query(`SELECT * FROM research_history WHERE ${where.sql} ORDER BY created_at DESC LIMIT 250`, where.values)
  ]);
  return {
    schemaVersion: 1, scope,
    folders: folders.rows.map(folderFromRow), savedItems: saved.rows.map(savedItemFromRow),
    highlights: highlights.rows.map(highlightFromRow), history: history.rows.map(historyFromRow)
  };
}

export async function getResearchWorkspaceRecord(entity: ResearchWorkspaceEntity, id: string, scope: ResearchWorkspaceScope) {
  const snapshot = await listResearchWorkspace(scope);
  const collection = entity === "folder" ? snapshot.folders : entity === "saved-item" ? snapshot.savedItems : entity === "highlight" ? snapshot.highlights : snapshot.history;
  return collection.find((record) => record.id === id) || null;
}

export async function saveResearchWorkspaceRecord(entity: ResearchWorkspaceEntity, record: ResearchWorkspaceRecord) {
  await assertFolderReference(entity, record);
  if (!workspaceUsesDatabase()) {
    let persisted = record;
    await updateLocalJson(LOCAL_RESEARCH_FILE, emptyLocalResearchState(), (state) => {
      if (entity === "folder") {
        const current = state.folders.findIndex((item) => item.id === record.id);
        const folders = [...state.folders]; if (current >= 0) folders[current] = record as ResearchFolder; else folders.push(record as ResearchFolder);
        persisted = current >= 0 ? folders[current] : record;
        return { ...state, folders };
      }
      if (entity === "saved-item") {
        const item = record as SavedResearchItem;
        const current = state.savedItems.findIndex((entry) => entry.id === item.id || (
          entry.tenantId === item.tenantId && entry.ownerUserId === item.ownerUserId
          && (entry.clientId || "") === (item.clientId || "")
          && (entry.matterId || "") === (item.matterId || "")
          && entry.dedupeKey === item.dedupeKey
        ));
        const savedItems = [...state.savedItems]; if (current >= 0) savedItems[current] = { ...item, id: savedItems[current].id, createdAt: savedItems[current].createdAt }; else savedItems.push(item);
        persisted = current >= 0 ? savedItems[current] : item;
        return { ...state, savedItems };
      }
      if (entity === "highlight") {
        const current = state.highlights.findIndex((item) => item.id === record.id);
        const highlights = [...state.highlights]; if (current >= 0) highlights[current] = record as ResearchHighlight; else highlights.push(record as ResearchHighlight);
        persisted = current >= 0 ? highlights[current] : record;
        return { ...state, highlights };
      }
      const historyRecord = record as ResearchHistoryEntry;
      const sameOwner = [...state.history, historyRecord]
        .filter((item) => item.tenantId === historyRecord.tenantId && item.ownerUserId === historyRecord.ownerUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5_000);
      const history = [
        ...state.history.filter((item) => item.tenantId !== historyRecord.tenantId || item.ownerUserId !== historyRecord.ownerUserId),
        ...sameOwner
      ];
      persisted = record;
      return { ...state, history };
    });
    return persisted;
  }
  await ensureResearchWorkspaceSchema();
  const pool = getPool();
  const scope = normalizedScopeRows({ tenantId: record.tenantId, userId: record.ownerUserId, clientId: record.clientId, matterId: record.matterId });
  if (entity === "folder") {
    const item = record as ResearchFolder;
    await pool.query(`INSERT INTO research_folders (id,tenant_id,owner_user_id,client_id,matter_id,name,parent_folder_id,color,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,parent_folder_id=EXCLUDED.parent_folder_id,color=EXCLUDED.color,updated_at=EXCLUDED.updated_at
      WHERE research_folders.tenant_id=EXCLUDED.tenant_id AND research_folders.owner_user_id=EXCLUDED.owner_user_id`, [item.id,...scope,item.name,item.parentFolderId || null,item.color,item.createdAt,item.updatedAt]);
  } else if (entity === "saved-item") {
    const item = record as SavedResearchItem;
    const result = await pool.query(`INSERT INTO research_saved_items (id,tenant_id,owner_user_id,client_id,matter_id,resource_type,resource_id,dedupe_key,title,url,excerpt,note,tags,folder_id,metadata,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb,$16,$17)
      ON CONFLICT (tenant_id,owner_user_id,(COALESCE(client_id,'')),(COALESCE(matter_id,'')),dedupe_key) DO UPDATE SET title=EXCLUDED.title,url=EXCLUDED.url,excerpt=EXCLUDED.excerpt,note=EXCLUDED.note,tags=EXCLUDED.tags,folder_id=EXCLUDED.folder_id,metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at RETURNING *`,
    [item.id,...scope,item.resourceType,item.resourceId,savedItemDedupeKey(item.resourceType,item.resourceId,item.url),item.title,item.url,item.excerpt,item.note,JSON.stringify(item.tags),item.folderId || null,JSON.stringify(item.metadata),item.createdAt,item.updatedAt]);
    return savedItemFromRow(result.rows[0]);
  } else if (entity === "highlight") {
    const item = record as ResearchHighlight;
    await pool.query(`INSERT INTO research_highlights (id,tenant_id,owner_user_id,client_id,matter_id,resource_type,resource_id,title,url,quote,note,color,folder_id,anchor,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,url=EXCLUDED.url,quote=EXCLUDED.quote,note=EXCLUDED.note,color=EXCLUDED.color,folder_id=EXCLUDED.folder_id,anchor=EXCLUDED.anchor,updated_at=EXCLUDED.updated_at
      WHERE research_highlights.tenant_id=EXCLUDED.tenant_id AND research_highlights.owner_user_id=EXCLUDED.owner_user_id`, [item.id,...scope,item.resourceType,item.resourceId,item.title,item.url,item.quote,item.note,item.color,item.folderId || null,JSON.stringify(item.anchor),item.createdAt,item.updatedAt]);
  } else {
    const item = record as ResearchHistoryEntry;
    await pool.query(`INSERT INTO research_history (id,tenant_id,owner_user_id,client_id,matter_id,action,resource_type,resource_id,title,url,query,response_excerpt,session_id,metadata,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16) ON CONFLICT (id) DO NOTHING`, [item.id,...scope,item.action,item.resourceType,item.resourceId,item.title,item.url,item.query,item.responseExcerpt,item.sessionId,JSON.stringify(item.metadata),item.createdAt,item.updatedAt]);
  }
  return record;
}

export async function deleteResearchWorkspaceRecord(entity: ResearchWorkspaceEntity, id: string, scope: ResearchWorkspaceScope) {
  if (!workspaceUsesDatabase()) {
    let removed = false;
    await updateLocalJson(LOCAL_RESEARCH_FILE, emptyLocalResearchState(), (state) => {
      const remove = <T extends { id: string; tenantId: string; ownerUserId: string; createdAt: string; updatedAt: string; clientId?: string; matterId?: string }>(records: T[]) => records.filter((item) => {
        const match = item.id === id && recordBelongsToScope(item, scope); if (match) removed = true; return !match;
      });
      if (entity === "folder") return { ...state, folders: remove(state.folders), savedItems: state.savedItems.map((item) => item.folderId === id && recordBelongsToScope(item, scope) ? { ...item, folderId: undefined } : item), highlights: state.highlights.map((item) => item.folderId === id && recordBelongsToScope(item, scope) ? { ...item, folderId: undefined } : item) };
      if (entity === "saved-item") return { ...state, savedItems: remove(state.savedItems) };
      if (entity === "highlight") return { ...state, highlights: remove(state.highlights) };
      return { ...state, history: remove(state.history) };
    });
    return removed;
  }
  await ensureResearchWorkspaceSchema();
  const table = entity === "folder" ? "research_folders" : entity === "saved-item" ? "research_saved_items" : entity === "highlight" ? "research_highlights" : "research_history";
  const where = scopeWhere(scope);
  const parameters = [...where.values, id];
  const idParameter = `$${parameters.length}`;
  if (entity !== "folder") {
    const result = await getPool().query(`DELETE FROM ${table} WHERE id = ${idParameter} AND ${where.sql}`, parameters);
    return (result.rowCount || 0) > 0;
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE research_folders SET parent_folder_id = NULL, updated_at = NOW() WHERE parent_folder_id = ${idParameter} AND ${where.sql}`, parameters);
    await client.query(`UPDATE research_saved_items SET folder_id = NULL, updated_at = NOW() WHERE folder_id = ${idParameter} AND ${where.sql}`, parameters);
    await client.query(`UPDATE research_highlights SET folder_id = NULL, updated_at = NOW() WHERE folder_id = ${idParameter} AND ${where.sql}`, parameters);
    const result = await client.query(`DELETE FROM research_folders WHERE id = ${idParameter} AND ${where.sql} RETURNING id`, parameters);
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
