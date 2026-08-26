import { createHash, randomUUID } from "crypto";
import { getPool, hasDatabase } from "./db";
import {
  TP_WORKFLOW_VERSION,
  tpAgentDefinitions,
  type TpAgentRoleId,
  type TpHumanApprovalResult,
  type TpWorkflowStageId
} from "./tp-agent-workflow";

/**
 * Durable Postgres queue for TP workflow stages.
 *
 * The optional store arguments are deliberately narrow. Production callers use
 * the shared application pool, while unit tests can exercise the SQL contract
 * without a configured database.
 */

export type TpAgentRunStatus =
  | "queued"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "failed"
  | "cancelled";

export type TpAgentRun = {
  id: string;
  projectId: string;
  agentRole: TpAgentRoleId;
  stage: TpWorkflowStageId;
  workflowVersion: string;
  agentVersion: string;
  status: TpAgentRunStatus;
  idempotencyKey: string;
  dependencyRunIds: string[];
  inputHash: string;
  input: unknown;
  output: unknown;
  priority: number;
  attempt: number;
  maxAttempts: number;
  runAfter: string;
  leaseOwner: string;
  leaseUntil: string;
  lastError: TpAgentRunError | null;
  cancelledBy: string;
  cancelReason: string;
  queuedAt: string;
  startedAt: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type TpAgentRunError = {
  message: string;
  code?: string;
  retryable?: boolean;
  details?: unknown;
};

export type EnqueueTpAgentRunInput = {
  projectId: string;
  agentRole: TpAgentRoleId;
  stage?: TpWorkflowStageId;
  workflowVersion?: string;
  agentVersion?: string;
  dependencyRunIds?: string[];
  input?: unknown;
  inputHash?: string;
  idempotencyKey?: string;
  priority?: number;
  maxAttempts?: number;
  runAfter?: string | Date;
};

export type ListTpAgentRunsInput = {
  projectId?: string;
  statuses?: TpAgentRunStatus[];
  limit?: number;
};

export type ClaimTpAgentRunInput = {
  workerId: string;
  projectId?: string;
  leaseSeconds?: number;
};

export type FailTpAgentRunInput = {
  runId: string;
  workerId: string;
  error: TpAgentRunError | Error | string;
  retryable?: boolean;
  retryDelaySeconds?: number;
};

export type CancelTpAgentRunInput = {
  runId: string;
  cancelledBy: string;
  reason?: string;
};

export type CancelTpAgentProjectRunsInput = {
  projectId: string;
  cancelledBy: string;
  reason?: string;
};

export type RecordTpHumanApprovalInput = {
  projectId: string;
  inputHash: string;
  dependencyRunId: string;
  reviewerId: string;
  documentVersion: string;
  artifactId: string;
  decision: "approved" | "changes_requested" | "rejected";
  notes?: string;
};

type QueryResultLike = {
  rows: Array<Record<string, unknown>>;
  rowCount?: number | null;
};

export type TpAgentQueueQueryable = {
  query(sql: string, values?: unknown[]): Promise<QueryResultLike>;
};

export type TpAgentQueueClient = TpAgentQueueQueryable & {
  release(): void;
};

export type TpAgentQueueStore = TpAgentQueueQueryable & {
  connect(): Promise<TpAgentQueueClient>;
};

const runStatuses: readonly TpAgentRunStatus[] = [
  "queued",
  "running",
  "retry_wait",
  "succeeded",
  "failed",
  "cancelled"
];

function queueStore(store?: TpAgentQueueStore) {
  if (store) return store;
  if (!hasDatabase()) throw new Error("DATABASE_URL or POSTGRES_URL is required for the TP agent queue.");
  return getPool() as unknown as TpAgentQueueStore;
}

function cleanIdentifier(value: unknown, label: string, max = 240) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized.slice(0, max);
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function tpAgentInputHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function agentStage(role: TpAgentRoleId) {
  const definition = tpAgentDefinitions.find((candidate) => candidate.role === role);
  if (!definition) throw new Error(`Unsupported TP agent role: ${role}`);
  return definition.stage;
}

function iso(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean)));
}

function jsonValue(value: unknown, fallback: unknown = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeRunError(value: unknown): TpAgentRunError | null {
  const parsed = jsonValue(value);
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const message = String(record.message || "").trim();
  if (!message) return null;
  return {
    message,
    code: record.code ? String(record.code) : undefined,
    retryable: typeof record.retryable === "boolean" ? record.retryable : undefined,
    details: record.details
  };
}

function runFromRow(row: Record<string, unknown>): TpAgentRun {
  const role = String(row.agent_role || "") as TpAgentRoleId;
  const stage = String(row.stage || "") as TpWorkflowStageId;
  const statusValue = String(row.status || "queued") as TpAgentRunStatus;
  return {
    id: String(row.id || ""),
    projectId: String(row.project_id || ""),
    agentRole: role,
    stage,
    workflowVersion: String(row.workflow_version || TP_WORKFLOW_VERSION),
    agentVersion: String(row.agent_version || "v1"),
    status: runStatuses.includes(statusValue) ? statusValue : "failed",
    idempotencyKey: String(row.idempotency_key || ""),
    dependencyRunIds: stringArray(jsonValue(row.dependency_run_ids, [])),
    inputHash: String(row.input_hash || ""),
    input: jsonValue(row.input_payload),
    output: jsonValue(row.output_payload),
    priority: Number(row.priority || 0),
    attempt: Number(row.attempt || 0),
    maxAttempts: Number(row.max_attempts || 1),
    runAfter: iso(row.run_after),
    leaseOwner: String(row.lease_owner || ""),
    leaseUntil: iso(row.lease_until),
    lastError: normalizeRunError(row.last_error),
    cancelledBy: String(row.cancelled_by || ""),
    cancelReason: String(row.cancel_reason || ""),
    queuedAt: iso(row.queued_at),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

export async function ensureTpAgentQueueSchema(store?: TpAgentQueueStore) {
  const db = queueStore(store);
  await db.query(`
    CREATE TABLE IF NOT EXISTS tp_agent_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_role TEXT NOT NULL,
      stage TEXT NOT NULL,
      workflow_version TEXT NOT NULL,
      agent_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      idempotency_key TEXT NOT NULL,
      dependency_run_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      input_hash TEXT NOT NULL,
      input_payload JSONB NOT NULL DEFAULT 'null'::jsonb,
      output_payload JSONB,
      priority INTEGER NOT NULL DEFAULT 0,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lease_owner TEXT,
      lease_until TIMESTAMPTZ,
      last_error JSONB,
      cancelled_by TEXT,
      cancel_reason TEXT,
      queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT tp_agent_runs_project_idempotency_unique UNIQUE (project_id, idempotency_key),
      CONSTRAINT tp_agent_runs_status_check CHECK (status IN ('queued','running','retry_wait','succeeded','failed','cancelled')),
      CONSTRAINT tp_agent_runs_attempt_check CHECK (attempt >= 0 AND max_attempts >= 1)
    );
    CREATE INDEX IF NOT EXISTS tp_agent_runs_project_created_idx
      ON tp_agent_runs (project_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS tp_agent_runs_project_idempotency_idx
      ON tp_agent_runs (project_id, idempotency_key);
    CREATE INDEX IF NOT EXISTS tp_agent_runs_ready_idx
      ON tp_agent_runs (status, run_after, priority DESC, queued_at)
      WHERE status IN ('queued','retry_wait','running');
  `);
}

export async function enqueueTpAgentRun(input: EnqueueTpAgentRunInput, store?: TpAgentQueueStore) {
  const db = queueStore(store);
  await ensureTpAgentQueueSchema(db);
  const projectId = cleanIdentifier(input.projectId, "projectId");
  const canonicalStage = agentStage(input.agentRole);
  if (input.stage && input.stage !== canonicalStage) {
    throw new Error(`Agent role ${input.agentRole} belongs to stage ${canonicalStage}, not ${input.stage}.`);
  }
  const workflowVersion = cleanIdentifier(input.workflowVersion || TP_WORKFLOW_VERSION, "workflowVersion", 120);
  const agentVersion = cleanIdentifier(input.agentVersion || "v1", "agentVersion", 120);
  const dependencyRunIds = stringArray(input.dependencyRunIds).sort();
  const inputPayload = input.input ?? null;
  const inputHash = cleanIdentifier(input.inputHash || tpAgentInputHash(inputPayload), "inputHash", 128);
  const naturalKey = `${projectId}:${input.agentRole}:${canonicalStage}:${workflowVersion}:${agentVersion}:${inputHash}:${dependencyRunIds.join(",")}`;
  const idempotencyKey = cleanIdentifier(input.idempotencyKey || tpAgentInputHash(naturalKey), "idempotencyKey", 240);
  const runAfter = input.runAfter ? new Date(input.runAfter) : new Date();
  if (Number.isNaN(runAfter.getTime())) throw new Error("runAfter must be a valid date.");

  const result = await db.query(
    `INSERT INTO tp_agent_runs (
       id, project_id, agent_role, stage, workflow_version, agent_version,
       status, idempotency_key, dependency_run_ids, input_hash, input_payload,
       priority, max_attempts, run_after, queued_at, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'queued',$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,NOW(),NOW(),NOW()
     )
     ON CONFLICT (project_id, idempotency_key) DO UPDATE
       SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING *`,
    [
      `tp-run-${randomUUID()}`,
      projectId,
      input.agentRole,
      canonicalStage,
      workflowVersion,
      agentVersion,
      idempotencyKey,
      JSON.stringify(dependencyRunIds),
      inputHash,
      JSON.stringify(inputPayload),
      clampInteger(input.priority, 0, -1000, 1000),
      clampInteger(input.maxAttempts, 3, 1, 10),
      runAfter.toISOString()
    ]
  );
  if (!result.rows[0]) throw new Error("TP agent run could not be enqueued.");
  return runFromRow(result.rows[0]);
}

export async function listTpAgentRuns(filters: ListTpAgentRunsInput = {}, store?: TpAgentQueueStore) {
  const db = queueStore(store);
  await ensureTpAgentQueueSchema(db);
  const values: unknown[] = [];
  const where: string[] = [];
  if (filters.projectId) {
    values.push(cleanIdentifier(filters.projectId, "projectId"));
    where.push(`project_id = $${values.length}`);
  }
  const statuses = Array.from(new Set((filters.statuses || []).filter((status) => runStatuses.includes(status))));
  if (statuses.length) {
    values.push(statuses);
    where.push(`status = ANY($${values.length}::text[])`);
  }
  values.push(clampInteger(filters.limit, 100, 1, 500));
  const result = await db.query(
    `SELECT * FROM tp_agent_runs
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return result.rows.map(runFromRow);
}

export async function claimNextTpAgentRun(input: ClaimTpAgentRunInput, store?: TpAgentQueueStore) {
  const db = queueStore(store);
  await ensureTpAgentQueueSchema(db);
  const workerId = cleanIdentifier(input.workerId, "workerId", 180);
  const leaseSeconds = clampInteger(input.leaseSeconds, 300, 30, 1800);
  const projectId = input.projectId ? cleanIdentifier(input.projectId, "projectId") : "";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `WITH RECURSIVE expired AS (
         UPDATE tp_agent_runs
         SET status = 'failed',
             last_error = jsonb_build_object(
               'message', 'Worker lease expired after the final permitted attempt.',
               'code', 'LEASE_EXPIRED',
               'retryable', false
             ),
             lease_owner = NULL,
             lease_until = NULL,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE status = 'running'
           AND lease_until < NOW()
           AND attempt >= max_attempts
         RETURNING id, project_id
       ), descendants(id, project_id) AS (
         SELECT child.id, child.project_id
         FROM tp_agent_runs child
         JOIN expired root
           ON child.project_id = root.project_id
          AND child.dependency_run_ids ? root.id
         WHERE child.status IN ('queued','retry_wait','running')
         UNION
         SELECT child.id, child.project_id
         FROM tp_agent_runs child
         JOIN descendants parent
           ON child.project_id = parent.project_id
          AND child.dependency_run_ids ? parent.id
         WHERE child.status IN ('queued','retry_wait','running')
       )
       UPDATE tp_agent_runs child
       SET status = 'cancelled',
           cancelled_by = 'system',
           cancel_reason = 'Upstream TP agent lease expired permanently.',
           lease_owner = NULL,
           lease_until = NULL,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE child.id IN (SELECT id FROM descendants)`
    );
    const result = await client.query(
      `WITH candidate AS (
         SELECT run.id
         FROM tp_agent_runs run
         WHERE (
           run.status IN ('queued','retry_wait')
           OR (run.status = 'running' AND run.lease_until < NOW())
         )
           AND run.attempt < run.max_attempts
           AND run.run_after <= NOW()
           AND ($1::text = '' OR run.project_id = $1)
           AND NOT EXISTS (
             SELECT 1
             FROM jsonb_array_elements_text(run.dependency_run_ids) dependency(run_id)
             LEFT JOIN tp_agent_runs prerequisite
               ON prerequisite.id = dependency.run_id
              AND prerequisite.project_id = run.project_id
             WHERE prerequisite.id IS NULL OR prerequisite.status <> 'succeeded'
           )
         ORDER BY run.priority DESC, run.run_after ASC, run.queued_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE tp_agent_runs run
       SET status = 'running',
           attempt = run.attempt + 1,
           lease_owner = $2,
           lease_until = NOW() + ($3 * INTERVAL '1 second'),
           started_at = COALESCE(run.started_at, NOW()),
           completed_at = NULL,
           updated_at = NOW()
       FROM candidate
       WHERE run.id = candidate.id
       RETURNING run.*`,
      [projectId, workerId, leaseSeconds]
    );
    await client.query("COMMIT");
    return result.rows[0] ? runFromRow(result.rows[0]) : null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function markTpAgentRunSucceeded(runId: string, workerId: string, output: unknown, store?: TpAgentQueueStore) {
  const db = queueStore(store);
  const result = await db.query(
    `UPDATE tp_agent_runs
     SET status = 'succeeded',
         output_payload = $3::jsonb,
         last_error = NULL,
         lease_owner = NULL,
         lease_until = NULL,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND status = 'running'
       AND lease_owner = $2
       AND lease_until >= NOW()
     RETURNING *`,
    [cleanIdentifier(runId, "runId"), cleanIdentifier(workerId, "workerId", 180), JSON.stringify(output ?? null)]
  );
  if (!result.rows[0]) throw new Error("TP agent run success was rejected because the run is not actively leased by this worker.");
  return runFromRow(result.rows[0]);
}

function errorPayload(error: FailTpAgentRunInput["error"], retryable: boolean) {
  if (error instanceof Error) return { message: error.message, code: error.name || "ERROR", retryable };
  if (typeof error === "string") return { message: error, retryable };
  return {
    message: String(error.message || "TP agent run failed."),
    code: error.code,
    retryable,
    details: error.details
  };
}

export async function markTpAgentRunFailed(input: FailTpAgentRunInput, store?: TpAgentQueueStore) {
  const db = queueStore(store);
  const retryable = input.retryable !== false;
  const baseDelay = clampInteger(input.retryDelaySeconds, 30, 0, 3600);
  const result = await db.query(
    `WITH RECURSIVE failed_run AS (
       UPDATE tp_agent_runs
     SET status = CASE
           WHEN $3::boolean AND attempt < max_attempts THEN 'retry_wait'
           ELSE 'failed'
         END,
         last_error = $4::jsonb,
         run_after = CASE
           WHEN $3::boolean AND attempt < max_attempts
             THEN NOW() + (LEAST(86400, $5 * POWER(2, GREATEST(attempt - 1, 0))) * INTERVAL '1 second')
           ELSE run_after
         END,
         lease_owner = NULL,
         lease_until = NULL,
         completed_at = CASE
           WHEN $3::boolean AND attempt < max_attempts THEN NULL
           ELSE NOW()
         END,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'running'
       AND lease_owner = $2
       AND lease_until >= NOW()
     RETURNING *
     ), descendants(id, project_id) AS (
       SELECT child.id, child.project_id
       FROM tp_agent_runs child
       JOIN failed_run root
         ON root.status = 'failed'
        AND child.project_id = root.project_id
        AND child.dependency_run_ids ? root.id
       WHERE child.status IN ('queued','retry_wait','running')
       UNION
       SELECT child.id, child.project_id
       FROM tp_agent_runs child
       JOIN descendants parent
         ON child.project_id = parent.project_id
        AND child.dependency_run_ids ? parent.id
       WHERE child.status IN ('queued','retry_wait','running')
     ), cancelled_descendants AS (
       UPDATE tp_agent_runs child
       SET status = 'cancelled',
           cancelled_by = 'system',
           cancel_reason = 'Upstream TP agent run failed.',
           lease_owner = NULL,
           lease_until = NULL,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE child.id IN (SELECT id FROM descendants)
       RETURNING child.id
     )
     SELECT * FROM failed_run`,
    [
      cleanIdentifier(input.runId, "runId"),
      cleanIdentifier(input.workerId, "workerId", 180),
      retryable,
      JSON.stringify(errorPayload(input.error, retryable)),
      baseDelay
    ]
  );
  if (!result.rows[0]) throw new Error("TP agent run failure was rejected because the run is not actively leased by this worker.");
  return runFromRow(result.rows[0]);
}

export async function cancelTpAgentRun(input: CancelTpAgentRunInput, store?: TpAgentQueueStore) {
  const db = queueStore(store);
  const result = await db.query(
    `WITH RECURSIVE cancelled_root AS (
       UPDATE tp_agent_runs
     SET status = 'cancelled',
         cancelled_by = $2,
         cancel_reason = $3,
         lease_owner = NULL,
         lease_until = NULL,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND status IN ('queued','retry_wait','running')
     RETURNING *
     ), descendants(id, project_id) AS (
       SELECT child.id, child.project_id
       FROM tp_agent_runs child
       JOIN cancelled_root root
         ON child.project_id = root.project_id
        AND child.dependency_run_ids ? root.id
       WHERE child.status IN ('queued','retry_wait','running')
       UNION
       SELECT child.id, child.project_id
       FROM tp_agent_runs child
       JOIN descendants parent
         ON child.project_id = parent.project_id
        AND child.dependency_run_ids ? parent.id
       WHERE child.status IN ('queued','retry_wait','running')
     ), cancelled_descendants AS (
       UPDATE tp_agent_runs child
       SET status = 'cancelled',
           cancelled_by = $2,
           cancel_reason = 'Upstream TP agent run was cancelled.',
           lease_owner = NULL,
           lease_until = NULL,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE child.id IN (SELECT id FROM descendants)
       RETURNING child.id
     )
     SELECT * FROM cancelled_root`,
    [
      cleanIdentifier(input.runId, "runId"),
      cleanIdentifier(input.cancelledBy, "cancelledBy", 180),
      String(input.reason || "Cancelled by request.").trim().slice(0, 2000)
    ]
  );
  return result.rows[0] ? runFromRow(result.rows[0]) : null;
}

export async function cancelTpAgentRunsForProject(input: CancelTpAgentProjectRunsInput, store?: TpAgentQueueStore) {
  const db = queueStore(store);
  await ensureTpAgentQueueSchema(db);
  const result = await db.query(
    `UPDATE tp_agent_runs
     SET status = 'cancelled',
         cancelled_by = $2,
         cancel_reason = $3,
         lease_owner = NULL,
         lease_until = NULL,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE project_id = $1
       AND status IN ('queued','retry_wait','running')
     RETURNING *`,
    [
      cleanIdentifier(input.projectId, "projectId"),
      cleanIdentifier(input.cancelledBy, "cancelledBy", 180),
      String(input.reason || "TP project was deleted.").trim().slice(0, 2000)
    ]
  );
  return result.rows.map(runFromRow);
}

/** Records a human decision for one exact QA-passed version; no AI worker can call this stage. */
export async function recordTpHumanApproval(input: RecordTpHumanApprovalInput, store?: TpAgentQueueStore) {
  const db = queueStore(store);
  await ensureTpAgentQueueSchema(db);
  const projectId = cleanIdentifier(input.projectId, "projectId");
  const inputHash = cleanIdentifier(input.inputHash, "inputHash", 128);
  const reviewerId = cleanIdentifier(input.reviewerId, "reviewerId", 180);
  const documentVersion = cleanIdentifier(input.documentVersion, "documentVersion", 240);
  const dependencyRunId = cleanIdentifier(input.dependencyRunId, "dependencyRunId");
  const decision = input.decision;
  const createdAt = new Date().toISOString();
  const resultPayload: TpHumanApprovalResult = {
    workflowVersion: TP_WORKFLOW_VERSION,
    stage: "human_approval",
    runId: `human-approval-${tpAgentInputHash({ projectId, inputHash, documentVersion, reviewerId, decision }).slice(0, 20)}`,
    inputVersion: inputHash,
    createdAt,
    issues: decision === "approved" ? [] : [{
      id: `approval-${decision}-${documentVersion}`,
      stage: "human_approval",
      code: decision === "rejected" ? "HUMAN_REJECTED" : "HUMAN_CHANGES_REQUESTED",
      severity: "blocking",
      category: "professional_judgment",
      title: decision === "rejected" ? "Reviewer rejected this draft version" : "Reviewer requested changes",
      description: String(input.notes || "A new draft version is required.").trim().slice(0, 2_000),
      evidenceIds: [],
      owner: "human_approver",
      status: "open"
    }],
    decision,
    reviewerId,
    reviewedDocumentVersion: documentVersion,
    approvedArtifactId: decision === "approved" ? cleanIdentifier(input.artifactId, "artifactId", 240) : undefined,
    notes: String(input.notes || "").trim().slice(0, 4_000)
  };
  const idempotencyKey = `human-approval:${tpAgentInputHash({ inputHash, documentVersion, reviewerId, decision })}`;
  const result = await db.query(
    `INSERT INTO tp_agent_runs (
       id, project_id, agent_role, stage, workflow_version, agent_version,
       status, idempotency_key, dependency_run_ids, input_hash, input_payload,
       output_payload, priority, attempt, max_attempts, run_after,
       queued_at, started_at, completed_at, created_at, updated_at
     ) SELECT
       $1,$2,'human_approver','human_approval',$3,'human-v1',
       'succeeded',$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,0,1,1,NOW(),
       NOW(),NOW(),NOW(),NOW(),NOW()
     FROM tp_agent_runs qa
     WHERE qa.id = $9
       AND qa.project_id = $2
       AND qa.stage = 'qa'
       AND qa.status = 'succeeded'
       AND qa.input_hash = $6
     ON CONFLICT (project_id, idempotency_key) DO UPDATE
       SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING *`,
    [
      resultPayload.runId,
      projectId,
      TP_WORKFLOW_VERSION,
      idempotencyKey,
      JSON.stringify([dependencyRunId]),
      inputHash,
      JSON.stringify({ reviewerId, documentVersion, artifactId: input.artifactId, decision }),
      JSON.stringify({ result: resultPayload }),
      dependencyRunId
    ]
  );
  if (!result.rows[0]) throw new Error("The human approval decision could not be recorded.");
  return runFromRow(result.rows[0]);
}
