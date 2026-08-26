import { createHash, randomUUID } from "node:crypto";
import { readLocalJson, updateLocalJson } from "./local-json-store";

export type EnterpriseJobType = "search_reindex" | "lightrag_export" | "lightrag_ingest" | "retention_scan" | "backup" | "alert_sync";
export type EnterpriseJobStatus = "queued" | "running" | "succeeded" | "failed" | "dead_letter" | "blocked";

export type EnterpriseJob = {
  id: string;
  tenantId: string;
  type: EnterpriseJobType;
  status: EnterpriseJobStatus;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  result?: Record<string, unknown>;
  errorCode?: string;
};

type EnterpriseQueueState = { version: 1; jobs: EnterpriseJob[] };
const FILE = "enterprise-jobs.json";
const emptyState = (): EnterpriseQueueState => ({ version: 1, jobs: [] });
const SECRET_KEY = /(secret|password|token|authorization|cookie|api.?key|credential)/i;

function validatePayload(value: Record<string, unknown>) {
  const serialized = JSON.stringify(value);
  if (serialized.length > 32_000) throw new Error("Enterprise job payload exceeds 32 KB.");
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    for (const [key, nested] of Object.entries(item as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) throw new Error("Secrets are not allowed in durable job payloads.");
      visit(nested);
    }
  };
  visit(value);
}

function defaultIdempotency(tenantId: string, type: EnterpriseJobType, payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify({ tenantId, type, payload })).digest("hex");
}

export async function enqueueEnterpriseJob(input: {
  tenantId: string;
  type: EnterpriseJobType;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  maxAttempts?: number;
  availableAt?: string;
}) {
  const tenantId = String(input.tenantId || "").trim();
  if (!tenantId) throw new Error("tenantId is required for an enterprise job.");
  const payload = input.payload || {};
  validatePayload(payload);
  const idempotencyKey = String(input.idempotencyKey || defaultIdempotency(tenantId, input.type, payload)).slice(0, 180);
  const state = await updateLocalJson(FILE, emptyState(), (state) => {
    const existing = state.jobs.find((job) => job.tenantId === tenantId && job.idempotencyKey === idempotencyKey && !["failed", "dead_letter"].includes(job.status));
    if (existing) return state;
    const now = new Date().toISOString();
    const job: EnterpriseJob = {
      id: randomUUID(), tenantId, type: input.type, status: "queued", payload, idempotencyKey,
      attempts: 0, maxAttempts: Math.min(10, Math.max(1, input.maxAttempts || 3)), createdAt: now, updatedAt: now,
      availableAt: input.availableAt || now
    };
    return { ...state, jobs: [...state.jobs, job] };
  });
  const selected = state.jobs.find((job) => job.tenantId === tenantId && job.idempotencyKey === idempotencyKey && !["failed", "dead_letter"].includes(job.status));
  if (!selected) throw new Error("Enterprise job could not be persisted.");
  return selected;
}

export async function claimEnterpriseJob(workerId: string, acceptedTypes?: EnterpriseJobType[], leaseSeconds = 60) {
  let claimedId = "";
  const now = Date.now();
  await updateLocalJson(FILE, emptyState(), (state) => {
    const jobs = state.jobs.map((job) => {
      const expired = job.status === "running" && Date.parse(job.leaseExpiresAt || "") <= now;
      const ready = (job.status === "queued" || expired) && Date.parse(job.availableAt) <= now && (!acceptedTypes?.length || acceptedTypes.includes(job.type));
      if (claimedId || !ready) return job;
      const next = { ...job, status: "running" as const, attempts: job.attempts + 1, leaseOwner: workerId, leaseExpiresAt: new Date(now + leaseSeconds * 1_000).toISOString(), updatedAt: new Date(now).toISOString() };
      claimedId = next.id;
      return next;
    });
    return { ...state, jobs };
  });
  if (!claimedId) return null;
  const state = await readLocalJson(FILE, emptyState());
  return state.jobs.find((job) => job.id === claimedId) || null;
}

export async function finishEnterpriseJob(jobId: string, workerId: string, result: Record<string, unknown> = {}) {
  validatePayload(result);
  const state = await updateLocalJson(FILE, emptyState(), (state) => ({ ...state, jobs: state.jobs.map((job) => {
    if (job.id !== jobId) return job;
    if (job.status !== "running" || job.leaseOwner !== workerId) throw new Error("Job lease is not owned by this worker.");
    return { ...job, status: "succeeded" as const, result, updatedAt: new Date().toISOString(), leaseOwner: undefined, leaseExpiresAt: undefined };
  }) }));
  const finished = state.jobs.find((job) => job.id === jobId && job.status === "succeeded") || null;
  if (!finished) throw new Error("Enterprise job not found.");
  return finished;
}

export async function failEnterpriseJob(jobId: string, workerId: string, errorCode: string, retryDelaySeconds = 30) {
  const state = await updateLocalJson(FILE, emptyState(), (state) => ({ ...state, jobs: state.jobs.map((job) => {
    if (job.id !== jobId) return job;
    if (job.status !== "running" || job.leaseOwner !== workerId) throw new Error("Job lease is not owned by this worker.");
    const terminal = job.attempts >= job.maxAttempts;
    return {
      ...job, status: (terminal ? "dead_letter" : "queued") as EnterpriseJobStatus, errorCode: String(errorCode || "job_failed").slice(0, 100),
      availableAt: new Date(Date.now() + Math.max(0, retryDelaySeconds) * 1_000).toISOString(), updatedAt: new Date().toISOString(),
      leaseOwner: undefined, leaseExpiresAt: undefined
    };
  }) }));
  const failed = state.jobs.find((job) => job.id === jobId && (job.status === "queued" || job.status === "dead_letter")) || null;
  if (!failed) throw new Error("Enterprise job not found.");
  return failed;
}

export async function listEnterpriseJobs(tenantId: string, limit = 100) {
  const state = await readLocalJson(FILE, emptyState());
  return state.jobs.filter((job) => job.tenantId === tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.min(500, Math.max(1, limit)));
}

export async function enterpriseQueueStats(tenantId: string) {
  const jobs = await listEnterpriseJobs(tenantId, 500);
  return Object.fromEntries(["queued", "running", "succeeded", "failed", "dead_letter", "blocked"].map((status) => [status, jobs.filter((job) => job.status === status).length]));
}
