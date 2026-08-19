import { randomUUID } from "crypto";

export const RESEARCH_WORKSPACE_SCHEMA_VERSION = 1 as const;

export type ResearchResourceType = "decision" | "regulation" | "report" | "chat" | "external";
export type ResearchHistoryAction = "view" | "search" | "chat" | "save" | "highlight" | "export";
export type ResearchWorkspaceEntity = "folder" | "saved-item" | "highlight" | "history";

export type ResearchWorkspaceScope = {
  tenantId: string;
  userId: string;
  clientId?: string;
  matterId?: string;
};

type ScopedRecord = {
  id: string;
  tenantId: string;
  ownerUserId: string;
  clientId?: string;
  matterId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ResearchFolder = ScopedRecord & {
  name: string;
  parentFolderId?: string;
  color: string;
};

export type SavedResearchItem = ScopedRecord & {
  resourceType: ResearchResourceType;
  resourceId: string;
  dedupeKey: string;
  title: string;
  url: string;
  excerpt: string;
  note: string;
  tags: string[];
  folderId?: string;
  metadata: Record<string, unknown>;
};

export type ResearchHighlightAnchor = {
  page?: number;
  paragraph?: number;
  startOffset?: number;
  endOffset?: number;
  prefix?: string;
  suffix?: string;
};

export type ResearchHighlight = ScopedRecord & {
  resourceType: ResearchResourceType;
  resourceId: string;
  title: string;
  url: string;
  quote: string;
  note: string;
  color: string;
  folderId?: string;
  anchor: ResearchHighlightAnchor;
};

export type ResearchHistoryEntry = ScopedRecord & {
  action: ResearchHistoryAction;
  resourceType: ResearchResourceType;
  resourceId: string;
  title: string;
  url: string;
  query: string;
  responseExcerpt: string;
  sessionId: string;
  metadata: Record<string, unknown>;
};

export type ResearchWorkspaceSnapshot = {
  schemaVersion: typeof RESEARCH_WORKSPACE_SCHEMA_VERSION;
  scope: ResearchWorkspaceScope;
  folders: ResearchFolder[];
  savedItems: SavedResearchItem[];
  highlights: ResearchHighlight[];
  history: ResearchHistoryEntry[];
};

export type ResearchWorkspaceRecord = ResearchFolder | SavedResearchItem | ResearchHighlight | ResearchHistoryEntry;

const RESOURCE_TYPES = new Set<ResearchResourceType>(["decision", "regulation", "report", "chat", "external"]);
const HISTORY_ACTIONS = new Set<ResearchHistoryAction>(["view", "search", "chat", "save", "highlight", "export"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function cleanText(value: unknown, maxLength: number) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function cleanOptionalId(value: unknown) {
  const normalized = cleanText(value, 180);
  return normalized || undefined;
}

function cleanResourceType(value: unknown): ResearchResourceType {
  const normalized = cleanText(value, 24) as ResearchResourceType;
  return RESOURCE_TYPES.has(normalized) ? normalized : "external";
}

function cleanHistoryAction(value: unknown): ResearchHistoryAction {
  const normalized = cleanText(value, 24) as ResearchHistoryAction;
  return HISTORY_ACTIONS.has(normalized) ? normalized : "view";
}

function cleanUrl(value: unknown) {
  const url = cleanText(value, 2_048);
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function cleanColor(value: unknown, fallback: string) {
  const color = cleanText(value, 7);
  return HEX_COLOR.test(color) ? color.toLowerCase() : fallback;
}

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const tag of value) {
    const normalized = cleanText(tag, 50);
    if (normalized) unique.add(normalized);
    if (unique.size >= 20) break;
  }
  return [...unique];
}

function cleanMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const json = JSON.stringify(value);
    if (json.length > 16_000) return {};
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function cleanNonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function baseRecord(scope: ResearchWorkspaceScope, now: string, idPrefix: string): ScopedRecord {
  return {
    id: `${idPrefix}-${randomUUID()}`,
    tenantId: scope.tenantId,
    ownerUserId: scope.userId,
    ...(scope.clientId ? { clientId: scope.clientId } : {}),
    ...(scope.matterId ? { matterId: scope.matterId } : {}),
    createdAt: now,
    updatedAt: now
  };
}

export function savedItemDedupeKey(resourceType: ResearchResourceType, resourceId: string, url: string) {
  return `${resourceType}:${resourceId || url || "untitled"}`.toLowerCase().slice(0, 2_300);
}

export function createResearchWorkspaceRecord(
  entity: ResearchWorkspaceEntity,
  raw: Record<string, unknown>,
  scope: ResearchWorkspaceScope,
  now = new Date().toISOString()
): ResearchWorkspaceRecord {
  if (entity === "folder") {
    const name = cleanText(raw.name, 180);
    if (!name) throw new Error("Folder name is required.");
    return {
      ...baseRecord(scope, now, "folder"),
      name,
      parentFolderId: cleanOptionalId(raw.parentFolderId),
      color: cleanColor(raw.color, "#00a7e1")
    } satisfies ResearchFolder;
  }

  const resourceType = cleanResourceType(raw.resourceType);
  const resourceId = cleanText(raw.resourceId, 500);
  const title = cleanText(raw.title, 500);
  const url = cleanUrl(raw.url);

  if (entity === "saved-item") {
    if (!title) throw new Error("Saved item title is required.");
    if (!resourceId && !url) throw new Error("A resource id or safe URL is required.");
    return {
      ...baseRecord(scope, now, "saved"),
      resourceType,
      resourceId,
      dedupeKey: savedItemDedupeKey(resourceType, resourceId, url),
      title,
      url,
      excerpt: cleanText(raw.excerpt, 12_000),
      note: cleanText(raw.note, 8_000),
      tags: cleanTags(raw.tags),
      folderId: cleanOptionalId(raw.folderId),
      metadata: cleanMetadata(raw.metadata)
    } satisfies SavedResearchItem;
  }

  if (entity === "highlight") {
    const quote = cleanText(raw.quote, 20_000);
    if (!quote) throw new Error("Highlight quote is required.");
    if (!resourceId && !url) throw new Error("A resource id or safe URL is required.");
    const anchor = cleanMetadata(raw.anchor);
    return {
      ...baseRecord(scope, now, "highlight"),
      resourceType,
      resourceId,
      title: title || "Untitled source",
      url,
      quote,
      note: cleanText(raw.note, 8_000),
      color: cleanColor(raw.color, "#fff3a3"),
      folderId: cleanOptionalId(raw.folderId),
      anchor: {
        page: cleanNonNegativeInteger(anchor.page),
        paragraph: cleanNonNegativeInteger(anchor.paragraph),
        startOffset: cleanNonNegativeInteger(anchor.startOffset),
        endOffset: cleanNonNegativeInteger(anchor.endOffset),
        prefix: cleanText(anchor.prefix, 300) || undefined,
        suffix: cleanText(anchor.suffix, 300) || undefined
      }
    } satisfies ResearchHighlight;
  }

  if (entity === "history") {
    const query = cleanText(raw.query, 4_000);
    if (!title && !query) throw new Error("History title or query is required.");
    return {
      ...baseRecord(scope, now, "history"),
      action: cleanHistoryAction(raw.action),
      resourceType,
      resourceId,
      title: title || query.slice(0, 160),
      url,
      query,
      responseExcerpt: cleanText(raw.responseExcerpt, 12_000),
      sessionId: cleanText(raw.sessionId, 180),
      metadata: cleanMetadata(raw.metadata)
    } satisfies ResearchHistoryEntry;
  }

  throw new Error("Unsupported research workspace entity.");
}

export function updateResearchWorkspaceRecord<T extends ResearchWorkspaceRecord>(
  entity: ResearchWorkspaceEntity,
  current: T,
  raw: Record<string, unknown>,
  now = new Date().toISOString()
): T {
  if (entity === "history") throw new Error("History entries are immutable.");
  const scope: ResearchWorkspaceScope = {
    tenantId: current.tenantId,
    userId: current.ownerUserId,
    clientId: current.clientId,
    matterId: current.matterId
  };
  const rebuilt = createResearchWorkspaceRecord(entity, { ...current, ...raw }, scope, current.createdAt) as T;
  return { ...rebuilt, id: current.id, createdAt: current.createdAt, updatedAt: now };
}

export function emptyResearchWorkspaceSnapshot(scope: ResearchWorkspaceScope): ResearchWorkspaceSnapshot {
  return {
    schemaVersion: RESEARCH_WORKSPACE_SCHEMA_VERSION,
    scope,
    folders: [],
    savedItems: [],
    highlights: [],
    history: []
  };
}

export function recordBelongsToScope(record: ScopedRecord, scope: ResearchWorkspaceScope) {
  if (record.tenantId !== scope.tenantId || record.ownerUserId !== scope.userId) return false;
  if (scope.clientId && record.clientId !== scope.clientId) return false;
  if (scope.matterId && record.matterId !== scope.matterId) return false;
  return true;
}
