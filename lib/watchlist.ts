import { createHash, randomUUID } from "node:crypto";
import type { Regulation } from "./mock-data";
import { canonicalRegulationKey } from "./regulation-knowledge";
import type { ResearchWorkspaceScope } from "./research-workspace";

export type WatchFrequency = "daily" | "weekly";
export type WatchRule = {
  id: string;
  tenantId: string;
  ownerUserId: string;
  clientId?: string;
  matterId?: string;
  name: string;
  resourceId?: string;
  citation?: string;
  topic?: string;
  keywords: string[];
  frequency: WatchFrequency;
  enabled: boolean;
  lastFingerprint: string;
  lastSummary: Record<string, string>;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type WatchAlert = {
  id: string;
  watchId: string;
  tenantId: string;
  ownerUserId: string;
  clientId?: string;
  matterId?: string;
  type: "source_changed" | "status_changed" | "relation_changed" | "new_match";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  resourceId: string;
  citation: string;
  fingerprint: string;
  createdAt: string;
  acknowledgedAt?: string;
};

export type WatchlistSnapshot = { rules: WatchRule[]; alerts: WatchAlert[]; unread: number };

function text(value: unknown, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function keywords(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 80).toLowerCase()).filter(Boolean))].slice(0, 20);
}

export function watchBelongsToScope(record: Pick<WatchRule | WatchAlert, "tenantId" | "ownerUserId" | "clientId" | "matterId">, scope: ResearchWorkspaceScope) {
  return record.tenantId === scope.tenantId
    && record.ownerUserId === scope.userId
    && (!scope.clientId || record.clientId === scope.clientId)
    && (!scope.matterId || record.matterId === scope.matterId);
}

function baseScope(scope: ResearchWorkspaceScope) {
  return { tenantId: scope.tenantId, ownerUserId: scope.userId, ...(scope.clientId ? { clientId: scope.clientId } : {}), ...(scope.matterId ? { matterId: scope.matterId } : {}) };
}

export function createWatchRule(raw: Record<string, unknown>, scope: ResearchWorkspaceScope, now = new Date().toISOString()): WatchRule {
  const name = text(raw.name, 180);
  const resourceId = text(raw.resourceId, 500) || undefined;
  const citation = text(raw.citation, 500) || undefined;
  const topic = text(raw.topic, 80).toLowerCase() || undefined;
  const cleanKeywords = keywords(raw.keywords);
  if (!name) throw new Error("Nama watchlist wajib diisi.");
  if (!resourceId && !citation && !topic && !cleanKeywords.length) throw new Error("Pilih sumber, sitasi, topik, atau kata kunci yang akan dipantau.");
  return {
    id: `watch-${randomUUID()}`,
    ...baseScope(scope),
    name,
    resourceId,
    citation,
    topic,
    keywords: cleanKeywords,
    frequency: raw.frequency === "weekly" ? "weekly" : "daily",
    enabled: raw.enabled !== false,
    lastFingerprint: "",
    lastSummary: {},
    createdAt: now,
    updatedAt: now
  };
}

function normalized(value: unknown) { return text(value, 20_000).toLowerCase(); }

export function matchingWatchRecords(rule: WatchRule, records: Regulation[]) {
  return records.filter((record) => {
    const canonical = record.canonicalKey || canonicalRegulationKey(record);
    const haystack = normalized([record.citation, record.title, record.focus, record.content, record.extraction?.summary, record.extraction?.keywords?.join(" ")].filter(Boolean).join(" "));
    if (rule.resourceId && canonical !== rule.resourceId && record.id !== rule.resourceId) return false;
    if (rule.citation && !haystack.includes(normalized(rule.citation))) return false;
    if (rule.topic && String(record.topic || "general") !== rule.topic) return false;
    if (rule.keywords.length && !rule.keywords.some((keyword) => haystack.includes(normalized(keyword)))) return false;
    return true;
  });
}

export function watchState(rule: WatchRule, records: Regulation[]) {
  const matches = matchingWatchRecords(rule, records).map((record) => ({
    id: record.canonicalKey || canonicalRegulationKey(record),
    citation: record.citation,
    hash: record.fileHash || "",
    status: record.extraction?.legalStatus || "unknown",
    effectiveDate: record.extraction?.effectiveDate || "",
    updatedAt: record.updatedAt || record.extractedAt || "",
    relationCount: (record.relations?.length || 0) + (record.extraction?.relations?.length || 0)
  })).sort((a, b) => a.id.localeCompare(b.id));
  const fingerprint = createHash("sha256").update(JSON.stringify(matches)).digest("hex");
  const first = matches[0];
  return {
    fingerprint,
    summary: {
      matchCount: String(matches.length),
      status: first?.status || "none",
      sourceHash: first?.hash || "",
      effectiveDate: first?.effectiveDate || "",
      relationCount: String(matches.reduce((sum, item) => sum + item.relationCount, 0))
    },
    matches
  };
}

export function alertsForChange(rule: WatchRule, next: ReturnType<typeof watchState>, now = new Date().toISOString()): WatchAlert[] {
  if (!rule.lastFingerprint || rule.lastFingerprint === next.fingerprint) return [];
  const alerts: WatchAlert[] = [];
  const first = next.matches[0];
  const resourceId = first?.id || rule.resourceId || "watch-query";
  const citation = first?.citation || rule.citation || rule.name;
  const add = (type: WatchAlert["type"], severity: WatchAlert["severity"], message: string) => alerts.push({
    id: `alert-${randomUUID()}`, watchId: rule.id, ...baseScope({ tenantId: rule.tenantId, userId: rule.ownerUserId, clientId: rule.clientId, matterId: rule.matterId }),
    type, severity, title: rule.name, message, resourceId, citation, fingerprint: next.fingerprint, createdAt: now
  });
  if (rule.lastSummary.matchCount !== next.summary.matchCount) add("new_match", "info", `Jumlah sumber yang cocok berubah dari ${rule.lastSummary.matchCount || 0} menjadi ${next.summary.matchCount}.`);
  if (rule.lastSummary.status !== next.summary.status) add("status_changed", next.summary.status === "revoked" ? "critical" : "warning", `Status hukum berubah dari ${rule.lastSummary.status || "unknown"} menjadi ${next.summary.status}.`);
  if (rule.lastSummary.relationCount !== next.summary.relationCount) add("relation_changed", "warning", `Jumlah relasi hukum berubah dari ${rule.lastSummary.relationCount || 0} menjadi ${next.summary.relationCount}.`);
  if (rule.lastSummary.sourceHash !== next.summary.sourceHash || rule.lastSummary.effectiveDate !== next.summary.effectiveDate) add("source_changed", "warning", "Hash sumber atau tanggal berlaku berubah; lakukan review versi dan provenance.");
  if (!alerts.length) add("source_changed", "info", "Metadata sumber yang dipantau berubah.");
  return alerts;
}
