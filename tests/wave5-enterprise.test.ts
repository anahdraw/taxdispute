import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPersistentHybridIndex, persistentIndexFreshness, readPersistentHybridIndex, searchPersistentHybridIndex, writePersistentHybridIndex } from "../lib/persistent-hybrid-index";
import type { SearchDocument } from "../lib/search-contracts";
import { claimEnterpriseJob, enqueueEnterpriseJob, failEnterpriseJob, finishEnterpriseJob, listEnterpriseJobs } from "../lib/enterprise-job-queue";
import { buildFullCorpusLightRagManifest, compareLightRagIndex } from "../lib/full-corpus-lightrag";
import { retentionDisposition, enterpriseIdentityReadiness } from "../lib/enterprise-governance";
import { enterpriseUsageSummary, recordEnterpriseMetric } from "../lib/enterprise-observability";
import { objectStorageReadiness } from "../lib/enterprise-object-storage";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-wave5-"));
process.env.TDP_LOCAL_WORKSPACE_ROOT = path.join(temp, "workspace");
process.env.TDP_PERSISTENT_SEARCH_ROOT = path.join(temp, "index");

const documents: SearchDocument[] = [
  { id: "public-ppn", corpus: "regulation", title: "PPN", citation: "PMK 131/2024", body: "Perhitungan PPN memakai DPP nilai lain sebelas per dua belas.", visibility: "public", status: "verified" },
  { id: "tenant-a", corpus: "decision", title: "Sengketa A", body: "koreksi pajak masukan faktur", visibility: "tenant", tenantId: "tenant-a", status: "review_required" },
  { id: "tenant-b", corpus: "decision", title: "Sengketa B", body: "rahasia pajak masukan", visibility: "tenant", tenantId: "tenant-b", status: "review_required" }
];

test("persistent hybrid index is durable, fresh, searchable, and tenant isolated", async () => {
  const index = buildPersistentHybridIndex(documents, "tenant-a");
  assert.equal(index.documentCount, 2);
  await writePersistentHybridIndex(index);
  const loaded = await readPersistentHybridIndex("tenant-a");
  assert.ok(loaded);
  assert.equal(persistentIndexFreshness(loaded!, documents).fresh, true);
  const result = searchPersistentHybridIndex(loaded!, { query: "pajak masukan faktur", tenantId: "tenant-a" });
  assert.equal(result.hits[0]?.id, "tenant-a");
  assert.equal(result.hits.some((hit) => hit.id === "tenant-b"), false);
  assert.equal(result.diagnostics.persistentIndex, true);
});

test("persistent index detects corpus drift", () => {
  const index = buildPersistentHybridIndex(documents, "tenant-a");
  const changed = documents.map((item) => item.id === "public-ppn" ? { ...item, body: `${item.body} berubah` } : item);
  assert.equal(persistentIndexFreshness(index, changed).fresh, false);
});

test("legacy citation subcodes are exact-ranked instead of collapsed", () => {
  const legacy: SearchDocument[] = [
    { id: "wrong", corpus: "regulation", title: "SE lain", citation: "SE-1/PJ.143/2000", body: "surat edaran", visibility: "public", status: "review_required", metadata: { canonicalKey: "se-1-pj-143-2000" } },
    { id: "right", corpus: "regulation", title: "SE target", citation: "SE-1/PJ.8/2000", body: "surat edaran", visibility: "public", status: "review_required", metadata: { canonicalKey: "se-1-pj-8-2000" } }
  ];
  const index = buildPersistentHybridIndex(legacy, "tenant-a");
  const result = searchPersistentHybridIndex(index, { query: "SE-1/PJ.8/2000", tenantId: "tenant-a" });
  assert.equal(result.hits[0]?.id, "right");
});

test("durable queue deduplicates, leases, retries, and dead-letters without secrets", async () => {
  const first = await enqueueEnterpriseJob({ tenantId: "tenant-a", type: "backup", payload: { reason: "test" }, idempotencyKey: "same", maxAttempts: 2 });
  const duplicate = await enqueueEnterpriseJob({ tenantId: "tenant-a", type: "backup", payload: { reason: "test" }, idempotencyKey: "same" });
  assert.equal(first.id, duplicate.id);
  const claimed1 = await claimEnterpriseJob("worker-1", ["backup"]); assert.equal(claimed1?.id, first.id);
  await failEnterpriseJob(first.id, "worker-1", "temporary", 0);
  const claimed2 = await claimEnterpriseJob("worker-2", ["backup"]); assert.equal(claimed2?.attempts, 2);
  const terminal = await failEnterpriseJob(first.id, "worker-2", "again", 0); assert.equal(terminal.status, "dead_letter");
  await assert.rejects(() => enqueueEnterpriseJob({ tenantId: "tenant-a", type: "backup", payload: { apiToken: "must-not-persist" } }), /Secrets are not allowed/);
});

test("queue completion requires the lease owner", async () => {
  const job = await enqueueEnterpriseJob({ tenantId: "tenant-a", type: "alert_sync", payload: { source: "local" }, idempotencyKey: "complete-one" });
  await claimEnterpriseJob("worker-ok", ["alert_sync"]);
  await assert.rejects(() => finishEnterpriseJob(job.id, "worker-wrong"), /lease/);
  const done = await finishEnterpriseJob(job.id, "worker-ok", { count: 2 }); assert.equal(done.status, "succeeded");
  assert.ok((await listEnterpriseJobs("tenant-a")).length >= 2);
});

test("full-corpus manifest requires exact count and hash before activation", () => {
  const manifest = buildFullCorpusLightRagManifest([
    { id: "one", canonicalKey: "pmk-1-2026", title: "PMK", citation: "PMK 1/2026", focus: "uji", relevance: 90, fileHash: "a".repeat(64), extraction: { schemaVersion: "regulation-extraction-v1", summary: "Ringkas", scope: [], keyProvisions: [{ article: "Pasal 1", page: 1, text: "Isi" }], legalStatus: "active", relations: [], keywords: [], verificationNotes: [], extractedAt: "2026-01-01", model: "test", sourcePdfUrl: "" } }
  ]);
  assert.equal(manifest.documentCount, 1); assert.equal(manifest.citationReadyCount, 1);
  assert.equal(compareLightRagIndex(manifest, { documentsProcessed: 1, corpusHash: "wrong" }).ready, false);
  assert.equal(compareLightRagIndex(manifest, { documentsProcessed: 1, corpusHash: manifest.corpusHash }).ready, true);
});

test("retention remains dry-run and legal hold wins", () => {
  process.env.TDP_RETENTION_ENABLED = "true"; process.env.TDP_RETENTION_DESTRUCTIVE_SWEEP = "true"; process.env.TDP_RETENTION_CHAT_DAYS = "1";
  assert.equal(retentionDisposition("2020-01-01", "chat", false).action, "eligible_for_reviewed_deletion");
  assert.equal(retentionDisposition("2020-01-01", "chat", true).action, "retain");
});

test("observability stores metadata-only cost estimates and enforces configurable policy", async () => {
  process.env.TDP_AI_INPUT_USD_PER_MILLION = "2"; process.env.TDP_AI_OUTPUT_USD_PER_MILLION = "8"; process.env.TDP_MONTHLY_AI_BUDGET_USD = "1";
  await recordEnterpriseMetric({ tenantId: "tenant-cost", operation: "regulation_chat", provider: "openai", model: "configured", ok: true, latencyMs: 100, inputTokensEstimate: 1_000, outputTokensEstimate: 500 });
  const usage = await enterpriseUsageSummary("tenant-cost");
  assert.equal(usage.requests, 1); assert.equal(usage.estimatedCostUsd, .006); assert.equal(JSON.stringify(usage).includes("prompt"), false);
});

test("identity and object storage readiness never overclaim production", () => {
  delete process.env.TDP_OIDC_ISSUER; delete process.env.TDP_OIDC_CLIENT_ID; delete process.env.TDP_OIDC_CLIENT_SECRET;
  assert.equal(enterpriseIdentityReadiness().status, "gap");
  assert.equal(objectStorageReadiness({ TDP_OBJECT_STORAGE: "s3_compatible", TDP_S3_ENDPOINT: "https://s3.local", TDP_S3_BUCKET: "bucket", TDP_S3_REGION: "id" }).status, "gap");
});
