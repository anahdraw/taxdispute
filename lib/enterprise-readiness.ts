import fs from "node:fs";
import path from "node:path";
import { enterpriseIdentityReadiness, retentionPolicyFromEnv, type EnterpriseReadinessStatus } from "./enterprise-governance";
import { objectStorageReadiness } from "./enterprise-object-storage";
import { persistentSearchModeFromEnv, readPersistentHybridIndex } from "./persistent-hybrid-index";
import { enterpriseQueueStats } from "./enterprise-job-queue";
import { enterpriseCostPolicy, enterpriseUsageSummary } from "./enterprise-observability";
import { compareLightRagIndex, type FullCorpusLightRagManifest } from "./full-corpus-lightrag";

export type EnterpriseCapability = { key: string; label: string; status: EnterpriseReadinessStatus; evidence: string; nextGap?: string };

function readJson<T>(candidate: string): T | null {
  try { return JSON.parse(fs.readFileSync(path.resolve(candidate), "utf8")) as T; } catch { return null; }
}

function backupEvidence() {
  const marker = readJson<{ createdAt?: string; verifiedAt?: string; fileCount?: number }>(process.env.TDP_BACKUP_STATUS_FILE || "outputs/enterprise-backups/latest-status.json");
  return marker ? { status: "ready_local" as const, evidence: `Backup lokal terakhir ${marker.createdAt || "unknown"}; ${marker.fileCount || 0} file; verifikasi ${marker.verifiedAt || "belum"}.` } : { status: "gap" as const, evidence: "Belum ada backup lokal terverifikasi." };
}

export async function getEnterpriseReadiness(tenantId: string) {
  const persistentMode = persistentSearchModeFromEnv();
  const persistent = await readPersistentHybridIndex(tenantId).catch(() => null);
  const fullManifest = readJson<FullCorpusLightRagManifest>(process.env.TDP_LIGHTRAG_FULL_MANIFEST || "outputs/lightrag/full-corpus-manifest.json");
  const activeManifest = readJson<{ documentsProcessed?: number; corpusHash?: string }>(process.env.TDP_LIGHTRAG_ACTIVE_MANIFEST || "outputs/lightrag/active-index.json");
  const lightRag = fullManifest ? compareLightRagIndex(fullManifest, activeManifest) : null;
  const queue = await enterpriseQueueStats(tenantId);
  const usage = await enterpriseUsageSummary(tenantId);
  const storage = objectStorageReadiness();
  const identity = enterpriseIdentityReadiness();
  const retention = retentionPolicyFromEnv();
  const backup = backupEvidence();
  const budget = enterpriseCostPolicy();
  const capabilities: EnterpriseCapability[] = [
    { key: "persistent_search", label: "Persistent hybrid search", status: persistent ? "ready_local" : persistentMode === "required" ? "gap" : "partial", evidence: persistent ? `${persistent.documentCount} dokumen; hash ${persistent.corpusHash.slice(0, 12)}; vector ${persistent.embeddingDimensions ? "tersedia" : "belum"}.` : "Indeks lokal belum dibangun; endpoint masih dapat fallback ke in-memory.", nextGap: "Backend distributed FTS/vector, replication, and zero-downtime reindex." },
    { key: "full_lightrag", label: "Full-corpus LightRAG", status: lightRag?.ready ? "ready_local" : fullManifest ? "partial" : "gap", evidence: fullManifest ? `Manifest ${fullManifest.documentCount} dokumen; active index: ${lightRag?.status || "unknown"}.` : "Manifest full-corpus belum tersedia.", nextGap: lightRag?.ready ? "Production graph/vector stores and load testing." : lightRag?.reason || "Generate manifest, index it, then activate only after count/hash match." },
    { key: "queue", label: "Queue", status: "ready_local", evidence: `Durable local queue aktif; queued ${queue.queued || 0}, running ${queue.running || 0}, dead-letter ${queue.dead_letter || 0}.`, nextGap: "Distributed broker/database queue with worker autoscaling and HA." },
    { key: "object_storage", label: "Object storage", status: storage.status, evidence: storage.note, nextGap: storage.status === "ready_production" ? undefined : "Private object versioning, KMS, lifecycle, replication, and restore evidence." },
    { key: "observability", label: "Observability & cost", status: "ready_local", evidence: `${usage.requests} event bulan ini; estimasi USD ${usage.estimatedCostUsd}; budget ${budget.monthlyBudgetUsd || "belum ditetapkan"}.`, nextGap: "Central OTEL/APM, alert routing, immutable audit sink, and provider invoice reconciliation." },
    { key: "sso_mfa", label: "SSO / MFA", status: identity.status, evidence: identity.note, nextGap: "Implement verified OIDC callback, PKCE/state/nonce, SCIM/JIT mapping, MFA claims, and break-glass procedure." },
    { key: "retention", label: "Retention", status: retention.enabled ? "partial" : "gap", evidence: retention.enabled ? `Policy aktif; destructive sweep ${retention.destructiveSweepEnabled ? "aktif" : "dry-run/manual"}; legal hold ${retention.legalHoldMode}.` : "Policy defaults tersedia tetapi belum diaktifkan.", nextGap: "Approved schedules per data class, legal-hold registry, deletion approvals, and evidence." },
    { key: "backup", label: "Backup", status: backup.status, evidence: backup.evidence, nextGap: "Encrypted offsite/cross-region copies and database PITR evidence." },
    { key: "dr", label: "Disaster recovery", status: backup.status === "ready_local" ? "partial" : "gap", evidence: backup.status === "ready_local" ? "Hash verification/restore rehearsal lokal tersedia; failover produksi belum diuji." : "Belum ada backup terverifikasi sebagai dasar DR.", nextGap: "Define RPO/RTO, alternate region/account, runbook, and scheduled restore/failover exercise." }
  ];
  return { generatedAt: new Date().toISOString(), tenantId, capabilities, usage, queue, storage, identity, retention, lightRagManifest: fullManifest ? { documentCount: fullManifest.documentCount, corpusHash: fullManifest.corpusHash, citationReadyCount: fullManifest.citationReadyCount, graphRelationCount: fullManifest.graphRelationCount } : null };
}
