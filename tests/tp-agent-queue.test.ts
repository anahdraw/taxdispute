import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelTpAgentRun,
  cancelTpAgentRunsForProject,
  claimNextTpAgentRun,
  enqueueTpAgentRun,
  markTpAgentRunFailed,
  markTpAgentRunSucceeded,
  recordTpHumanApproval,
  tpAgentInputHash,
  type TpAgentQueueClient,
  type TpAgentQueueStore
} from "../lib/tp-agent-queue";

function row(overrides: Record<string, unknown> = {}) {
  const now = "2026-08-21T00:00:00.000Z";
  return {
    id: "tp-run-1",
    project_id: "tp-project-1",
    agent_role: "intake_coordinator",
    stage: "intake",
    workflow_version: "tp-agent-workflow-v1",
    agent_version: "v1",
    status: "queued",
    idempotency_key: "idem-1",
    dependency_run_ids: [],
    input_hash: "a".repeat(64),
    input_payload: { documentIds: ["doc-1"] },
    output_payload: null,
    priority: 0,
    attempt: 0,
    max_attempts: 3,
    run_after: now,
    lease_owner: null,
    lease_until: null,
    last_error: null,
    cancelled_by: null,
    cancel_reason: null,
    queued_at: now,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

class ScriptedStore implements TpAgentQueueStore, TpAgentQueueClient {
  calls: Array<{ sql: string; values: unknown[] }> = [];
  responses: Array<Array<Record<string, unknown>>> = [];
  released = 0;

  async query(sql: string, values: unknown[] = []) {
    this.calls.push({ sql, values });
    if (/CREATE TABLE IF NOT EXISTS tp_agent_runs/.test(sql)) return { rows: [], rowCount: 0 };
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
    const rows = this.responses.shift() || [];
    return { rows, rowCount: rows.length };
  }

  async connect() { return this; }
  release() { this.released += 1; }
}

test("input hashing is stable across object key order", () => {
  assert.equal(tpAgentInputHash({ b: 2, a: 1 }), tpAgentInputHash({ a: 1, b: 2 }));
  assert.notEqual(tpAgentInputHash({ a: 1 }), tpAgentInputHash({ a: 2 }));
});

test("enqueue validates role/stage and uses a database idempotency conflict", async () => {
  const store = new ScriptedStore();
  store.responses.push([row()]);
  const run = await enqueueTpAgentRun({
    projectId: "tp-project-1",
    agentRole: "intake_coordinator",
    stage: "intake",
    input: { documentIds: ["doc-1"] }
  }, store);

  assert.equal(run.id, "tp-run-1");
  const insert = store.calls.find((call) => call.sql.includes("INSERT INTO tp_agent_runs"));
  assert.ok(insert?.sql.includes("ON CONFLICT (project_id, idempotency_key)"));
  await assert.rejects(
    enqueueTpAgentRun({ projectId: "tp-project-1", agentRole: "intake_coordinator", stage: "qa" }, store),
    /belongs to stage intake/
  );
});

test("claim uses a transaction, dependency gate, SKIP LOCKED, and lease", async () => {
  const store = new ScriptedStore();
  store.responses.push([]); // expired final-attempt cleanup
  store.responses.push([row({
    status: "running",
    attempt: 1,
    lease_owner: "worker-1",
    lease_until: "2026-08-21T00:05:00.000Z",
    started_at: "2026-08-21T00:00:00.000Z"
  })]);

  const claimed = await claimNextTpAgentRun({ workerId: "worker-1", leaseSeconds: 300 }, store);
  assert.equal(claimed?.status, "running");
  assert.equal(claimed?.attempt, 1);
  const claim = store.calls.find((call) => call.sql.includes("FOR UPDATE SKIP LOCKED"));
  assert.ok(claim);
  assert.ok(claim?.sql.includes("prerequisite.status <> 'succeeded'"));
  assert.ok(claim?.sql.includes("prerequisite.project_id = run.project_id"));
  assert.deepEqual(claim?.values, ["", "worker-1", 300]);
  assert.equal(store.calls.some((call) => call.sql === "COMMIT"), true);
  assert.equal(store.released, 1);
});

test("success requires ownership of an active lease", async () => {
  const store = new ScriptedStore();
  store.responses.push([row({ status: "succeeded", output_payload: { ok: true }, completed_at: "2026-08-21T00:02:00.000Z" })]);
  const completed = await markTpAgentRunSucceeded("tp-run-1", "worker-1", { ok: true }, store);
  assert.equal(completed.status, "succeeded");
  assert.ok(store.calls[0]?.sql.includes("lease_owner = $2"));
  assert.ok(store.calls[0]?.sql.includes("lease_until >= NOW()"));

  const staleStore = new ScriptedStore();
  await assert.rejects(markTpAgentRunSucceeded("tp-run-1", "stale-worker", {}, staleStore), /not actively leased/);
});

test("failure supports exponential retry and terminal failure", async () => {
  const retryStore = new ScriptedStore();
  retryStore.responses.push([row({
    status: "retry_wait",
    attempt: 1,
    lease_owner: null,
    lease_until: null,
    last_error: { message: "temporary", retryable: true }
  })]);
  const retry = await markTpAgentRunFailed({
    runId: "tp-run-1",
    workerId: "worker-1",
    error: "temporary",
    retryDelaySeconds: 20
  }, retryStore);
  assert.equal(retry.status, "retry_wait");
  assert.ok(retryStore.calls[0]?.sql.includes("POWER(2"));

  const terminalStore = new ScriptedStore();
  terminalStore.responses.push([row({ status: "failed", attempt: 1, completed_at: "2026-08-21T00:02:00.000Z" })]);
  const failed = await markTpAgentRunFailed({
    runId: "tp-run-1",
    workerId: "worker-1",
    error: new Error("invalid output"),
    retryable: false
  }, terminalStore);
  assert.equal(failed.status, "failed");
  assert.ok(terminalStore.calls[0]?.sql.includes("descendants"));
});

test("cancel only targets unfinished runs and is idempotent for terminal runs", async () => {
  const store = new ScriptedStore();
  store.responses.push([row({ status: "cancelled", cancelled_by: "reviewer-1", cancel_reason: "Scope changed" })]);
  const cancelled = await cancelTpAgentRun({ runId: "tp-run-1", cancelledBy: "reviewer-1", reason: "Scope changed" }, store);
  assert.equal(cancelled?.status, "cancelled");
  assert.ok(store.calls[0]?.sql.includes("status IN ('queued','retry_wait','running')"));
  assert.ok(store.calls[0]?.sql.includes("cancelled_descendants"));

  const terminalStore = new ScriptedStore();
  assert.equal(await cancelTpAgentRun({ runId: "tp-run-1", cancelledBy: "reviewer-1" }, terminalStore), null);
});

test("project cancellation and human approval are durable, scoped queue records", async () => {
  const cancelStore = new ScriptedStore();
  cancelStore.responses.push([row({ status: "cancelled" })]);
  const cancelled = await cancelTpAgentRunsForProject({ projectId: "tp-project-1", cancelledBy: "reviewer-1" }, cancelStore);
  assert.equal(cancelled.length, 1);
  const cancelCall = cancelStore.calls.find((call) => call.sql.includes("WHERE project_id = $1"));
  assert.deepEqual(cancelCall?.values.slice(0, 2), ["tp-project-1", "reviewer-1"]);

  const approvalStore = new ScriptedStore();
  approvalStore.responses.push([row({
    agent_role: "human_approver",
    stage: "human_approval",
    status: "succeeded",
    input_hash: "b".repeat(64),
    output_payload: { result: { decision: "approved", reviewedDocumentVersion: "draft-v1" } }
  })]);
  const approval = await recordTpHumanApproval({
    projectId: "tp-project-1",
    inputHash: "b".repeat(64),
    dependencyRunId: "qa-run-1",
    reviewerId: "reviewer-1",
    documentVersion: "draft-v1",
    artifactId: "artifact-v1",
    decision: "approved",
    notes: "Reviewed."
  }, approvalStore);
  assert.equal(approval.stage, "human_approval");
  const approvalCall = approvalStore.calls.find((call) => call.sql.includes("'human_approver','human_approval'"));
  assert.ok(approvalCall?.sql.includes("ON CONFLICT (project_id, idempotency_key)"));
});
