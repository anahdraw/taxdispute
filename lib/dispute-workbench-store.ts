import { readLocalJson, updateLocalJson } from "./local-json-store";
import {
  DISPUTE_WORKBENCH_SCHEMA_VERSION,
  createApproval,
  createEvidenceItem,
  createPrecedentSelection,
  createWorkflowTask,
  emptyWorkflow,
  generateGroundedDraft,
  impactFromAlert,
  calculateTax,
  type ApprovalRequest,
  type CalculationResult,
  type DisputeWorkbenchSnapshot,
  type DraftRecord,
  type EvidenceMatrixItem,
  type MatterScope,
  type MatterWorkflow,
  type PrecedentSelection,
  type RegulatoryImpact,
  type WorkbenchAuditEvent
} from "./dispute-workbench";
import { comparableDecisions } from "./mock-data";
import type { WatchAlert } from "./watchlist";

type WorkbenchState = {
  version: 1;
  evidence: EvidenceMatrixItem[];
  precedents: PrecedentSelection[];
  calculations: CalculationResult[];
  drafts: DraftRecord[];
  impacts: RegulatoryImpact[];
  workflows: MatterWorkflow[];
  audit: WorkbenchAuditEvent[];
};

const FILE = "dispute-workbench.json";
const EMPTY: WorkbenchState = { version: 1, evidence: [], precedents: [], calculations: [], drafts: [], impacts: [], workflows: [], audit: [] };
const clean = (value: unknown, max = 5_000) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function belongs(record: { tenantId: string; clientId: string; matterId: string }, scope: MatterScope) {
  return record.tenantId === scope.tenantId && record.clientId === scope.clientId && record.matterId === scope.matterId;
}

function audit(scope: MatterScope, action: string, entityType: string, entityId: string, summary: string, now = new Date().toISOString()): WorkbenchAuditEvent {
  return { id: `audit-${crypto.randomUUID()}`, tenantId: scope.tenantId, clientId: scope.clientId, matterId: scope.matterId, createdBy: scope.userId, createdAt: now, updatedAt: now, action, entityType, entityId, summary: clean(summary, 1_000) };
}

function scoped(state: WorkbenchState, scope: MatterScope): DisputeWorkbenchSnapshot {
  const workflow = state.workflows.find((item) => belongs(item, scope)) || emptyWorkflow(scope);
  return {
    schemaVersion: DISPUTE_WORKBENCH_SCHEMA_VERSION,
    scope: { tenantId: scope.tenantId, clientId: scope.clientId, matterId: scope.matterId },
    evidence: state.evidence.filter((item) => belongs(item, scope)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    precedents: state.precedents.filter((item) => belongs(item, scope)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    calculations: state.calculations.filter((item) => belongs(item, scope)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    drafts: state.drafts.filter((item) => belongs(item, scope)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    impacts: state.impacts.filter((item) => belongs(item, scope)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    workflow,
    audit: state.audit.filter((item) => belongs(item, scope)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 250)
  };
}

export async function getDisputeWorkbench(scope: MatterScope) {
  return scoped(await readLocalJson(FILE, EMPTY), scope);
}

async function mutate(scope: MatterScope, update: (state: WorkbenchState, current: DisputeWorkbenchSnapshot, now: string) => WorkbenchState | Promise<WorkbenchState>) {
  const state = await updateLocalJson(FILE, EMPTY, async (current) => update(current, scoped(current, scope), new Date().toISOString()));
  return scoped(state, scope);
}

export async function createWorkbenchEvidence(scope: MatterScope, raw: Record<string, unknown>) {
  return mutate(scope, (state, _current, now) => { const record = createEvidenceItem(raw, scope, now); return { ...state, evidence: [...state.evidence, record], audit: [...state.audit, audit(scope, "create", "evidence", record.id, record.issue, now)].slice(-20_000) }; });
}

export async function updateWorkbenchEvidence(scope: MatterScope, raw: Record<string, unknown>) {
  const targetId = clean(raw.id, 180); let changed = false;
  const snapshot = await mutate(scope, (state, _current, now) => ({ ...state, evidence: state.evidence.map((record) => {
    if (record.id !== targetId || !belongs(record, scope)) return record; changed = true;
    const next = createEvidenceItem({ ...record, ...raw }, scope, record.createdAt);
    return { ...next, id: record.id, createdBy: record.createdBy, createdAt: record.createdAt, updatedAt: now };
  }), audit: changed ? [...state.audit, audit(scope, "update", "evidence", targetId, "Evidence matrix diperbarui.", now)].slice(-20_000) : state.audit }));
  if (!changed) throw new Error("Item evidence matrix tidak ditemukan."); return snapshot;
}

export async function deleteWorkbenchEntity(scope: MatterScope, entity: string, targetId: string) {
  let changed = false;
  const key = ({ evidence: "evidence", precedent: "precedents", calculation: "calculations", draft: "drafts", impact: "impacts" } as const)[entity as "evidence"];
  if (!key) throw new Error("Jenis artefak tidak dapat dihapus.");
  const snapshot = await mutate(scope, (state, _current, now) => {
    const list = state[key] as Array<{ id: string; tenantId: string; clientId: string; matterId: string }>;
    const filtered = list.filter((item) => { const match = item.id === targetId && belongs(item, scope); if (match) changed = true; return !match; });
    return { ...state, [key]: filtered, audit: changed ? [...state.audit, audit(scope, "delete", entity, targetId, "Artefak dihapus.", now)].slice(-20_000) : state.audit } as WorkbenchState;
  });
  if (!changed) throw new Error("Artefak tidak ditemukan."); return snapshot;
}

export async function selectWorkbenchPrecedent(scope: MatterScope, raw: Record<string, unknown>) {
  const decision = comparableDecisions.find((item) => item.id === clean(raw.decisionId, 180)); if (!decision) throw new Error("Putusan pembanding tidak ditemukan.");
  return mutate(scope, (state, current, now) => {
    const existing = current.precedents.find((item) => item.decisionId === decision.id);
    const record = createPrecedentSelection(raw, scope, decision, now);
    if (existing) { record.id = existing.id; record.createdAt = existing.createdAt; record.createdBy = existing.createdBy; }
    const precedents = state.precedents.filter((item) => item.id !== record.id).concat(record);
    return { ...state, precedents, audit: [...state.audit, audit(scope, existing ? "update" : "select", "precedent", record.id, decision.number, now)].slice(-20_000) };
  });
}

export async function runWorkbenchCalculation(scope: MatterScope, raw: Record<string, unknown>) {
  return mutate(scope, (state, _current, now) => { const record = calculateTax(raw, scope, now); return { ...state, calculations: [...state.calculations, record], audit: [...state.audit, audit(scope, "calculate", "calculation", record.id, `${record.name}: ${record.result}`, now)].slice(-20_000) }; });
}

export async function reviewWorkbenchCalculation(scope: MatterScope, id: string, reviewed: boolean) {
  let changed = false; return mutate(scope, (state, _current, now) => ({ ...state, calculations: state.calculations.map((item) => item.id === id && belongs(item, scope) ? (changed = true, { ...item, status: reviewed ? "reviewed" as const : "scenario" as const, updatedAt: now }) : item), audit: changed ? [...state.audit, audit(scope, "review", "calculation", id, reviewed ? "Kalkulasi ditandai reviewed." : "Status review kalkulasi dibuka kembali.", now)].slice(-20_000) : state.audit }));
}

export async function generateWorkbenchDraft(scope: MatterScope, raw: Record<string, unknown>) {
  return mutate(scope, (state, current, now) => { const record = generateGroundedDraft(raw, scope, current, now); const prior = current.drafts.find((item) => item.kind === record.kind && item.title === record.title); if (prior) record.version = Math.max(...current.drafts.filter((item) => item.kind === record.kind && item.title === record.title).map((item) => item.version)) + 1; return { ...state, drafts: [...state.drafts, record], audit: [...state.audit, audit(scope, "generate", "draft", record.id, `${record.title} v${record.version}`, now)].slice(-20_000) }; });
}

export async function syncWorkbenchImpacts(scope: MatterScope, alerts: WatchAlert[]) {
  return mutate(scope, (state, current, now) => {
    const existing = new Set(current.impacts.map((item) => item.sourceAlertId).filter(Boolean));
    const additions = alerts.filter((item) => !existing.has(item.id)).map((item) => impactFromAlert(item, scope, current, now));
    return { ...state, impacts: [...state.impacts, ...additions], audit: additions.length ? [...state.audit, audit(scope, "sync", "impact", additions[0].id, `${additions.length} dampak regulasi baru dibuat dari watchlist.`, now)].slice(-20_000) : state.audit };
  });
}

export async function updateWorkbenchImpact(scope: MatterScope, raw: Record<string, unknown>) {
  const targetId = clean(raw.id, 180); let changed = false;
  const allowedStatus = ["new", "assessing", "actioned", "not_applicable"] as const;
  return mutate(scope, (state, _current, now) => ({ ...state, impacts: state.impacts.map((item) => {
    if (item.id !== targetId || !belongs(item, scope)) return item; changed = true;
    return { ...item, status: allowedStatus.includes(raw.status as typeof allowedStatus[number]) ? raw.status as typeof allowedStatus[number] : item.status, owner: clean(raw.owner, 180) || item.owner, summary: clean(raw.summary, 5_000) || item.summary, updatedAt: now };
  }), audit: changed ? [...state.audit, audit(scope, "update", "impact", targetId, "Impact assessment diperbarui.", now)].slice(-20_000) : state.audit }));
}

function ensureWorkflow(state: WorkbenchState, scope: MatterScope, now: string) {
  const current = state.workflows.find((item) => belongs(item, scope)); if (current) return current;
  return emptyWorkflow(scope, now);
}

export async function updateWorkbenchWorkflow(scope: MatterScope, raw: Record<string, unknown>) {
  return mutate(scope, (state, _current, now) => {
    const workflow = ensureWorkflow(state, scope, now); const phases = ["intake", "audit", "objection", "appeal", "hearing", "judicial_review", "closed"];
    const risk = ["low", "medium", "high", "critical"].includes(String(raw.risk)) ? raw.risk as MatterWorkflow["risk"] : workflow.risk;
    const nextDeadline = clean(raw.nextDeadline, 30); const next = { ...workflow, phase: phases.includes(String(raw.phase)) ? raw.phase as MatterWorkflow["phase"] : workflow.phase, risk, nextDeadline: Number.isFinite(Date.parse(nextDeadline)) ? new Date(nextDeadline).toISOString() : workflow.nextDeadline, updatedAt: now };
    return { ...state, workflows: state.workflows.filter((item) => item.id !== workflow.id).concat(next), audit: [...state.audit, audit(scope, "update", "workflow", workflow.id, `Tahap ${next.phase}; risiko ${next.risk}.`, now)].slice(-20_000) };
  });
}

export async function addWorkbenchTask(scope: MatterScope, raw: Record<string, unknown>) {
  return mutate(scope, (state, _current, now) => { const workflow = ensureWorkflow(state, scope, now); const task = createWorkflowTask(raw, now); const next = { ...workflow, tasks: [...workflow.tasks, task], updatedAt: now }; return { ...state, workflows: state.workflows.filter((item) => item.id !== workflow.id).concat(next), audit: [...state.audit, audit(scope, "create", "task", task.id, task.title, now)].slice(-20_000) }; });
}

export async function updateWorkbenchTask(scope: MatterScope, raw: Record<string, unknown>) {
  const targetId = clean(raw.id, 180); return mutate(scope, (state, _current, now) => { const workflow = ensureWorkflow(state, scope, now); const statuses = ["todo", "doing", "blocked", "done"]; const next = { ...workflow, tasks: workflow.tasks.map((item) => item.id === targetId ? { ...item, title: clean(raw.title, 500) || item.title, assignee: clean(raw.assignee, 180) || item.assignee, status: statuses.includes(String(raw.status)) ? raw.status as typeof item.status : item.status, updatedAt: now } : item), updatedAt: now }; return { ...state, workflows: state.workflows.filter((item) => item.id !== workflow.id).concat(next), audit: [...state.audit, audit(scope, "update", "task", targetId, "Tugas workflow diperbarui.", now)].slice(-20_000) }; });
}

export async function requestWorkbenchApproval(scope: MatterScope, raw: Record<string, unknown>) {
  return mutate(scope, (state, current, now) => {
    const workflow = ensureWorkflow(state, scope, now); const approval = createApproval(raw, scope.userId, now);
    const exists = approval.artifactType === "draft" ? current.drafts.some((item) => item.id === approval.artifactId) : approval.artifactType === "calculation" ? current.calculations.some((item) => item.id === approval.artifactId) : approval.artifactType === "evidence" ? current.evidence.some((item) => item.id === approval.artifactId) : current.impacts.some((item) => item.id === approval.artifactId);
    if (!exists) throw new Error("Artefak approval tidak ditemukan pada matter ini.");
    if (approval.artifactType === "draft") {
      const draft = current.drafts.find((item) => item.id === approval.artifactId);
      const linkedEvidence = current.evidence.filter((item) => draft?.evidenceIds.includes(item.id));
      if (!draft?.evidenceIds.length || !linkedEvidence.some((item) => item.status !== "missing" && item.rules.length > 0)) throw new Error("Draf belum memiliki evidence dan dasar hukum yang cukup untuk diajukan approval.");
    }
    if (approval.artifactType === "calculation" && !current.calculations.find((item) => item.id === approval.artifactId)?.legalBasis.length) throw new Error("Kalkulasi belum memiliki dasar hukum untuk diajukan review.");
    const next = { ...workflow, approvals: [...workflow.approvals, approval], updatedAt: now };
    const drafts = approval.artifactType === "draft" ? state.drafts.map((item) => item.id === approval.artifactId && belongs(item, scope) ? { ...item, status: "in_review" as const, approvalId: approval.id, updatedAt: now } : item) : state.drafts;
    return { ...state, drafts, workflows: state.workflows.filter((item) => item.id !== workflow.id).concat(next), audit: [...state.audit, audit(scope, "request", "approval", approval.id, approval.title, now)].slice(-20_000) };
  });
}

export async function decideWorkbenchApproval(scope: MatterScope, raw: Record<string, unknown>, canApprove: boolean) {
  if (!canApprove) throw new Error("Hanya lead atau administrator workspace yang dapat memutus approval.");
  const targetId = clean(raw.id, 180); const decision: "rejected" | "approved" = raw.decision === "rejected" ? "rejected" : "approved"; let approval: ApprovalRequest | undefined;
  return mutate(scope, (state, _current, now) => {
    const workflow = ensureWorkflow(state, scope, now);
    const approvals: ApprovalRequest[] = workflow.approvals.map((item) => { if (item.id !== targetId || item.status !== "pending") return item; approval = item; return { ...item, status: decision, decidedBy: scope.userId, decidedAt: now, comment: clean(raw.comment, 3_000) }; });
    if (!approval) throw new Error("Approval pending tidak ditemukan.");
    const drafts = approval.artifactType === "draft" ? state.drafts.map((item) => item.id === approval?.artifactId && belongs(item, scope) ? { ...item, status: decision, updatedAt: now } : item) : state.drafts;
    const calculations = approval.artifactType === "calculation" && decision === "approved" ? state.calculations.map((item) => item.id === approval?.artifactId && belongs(item, scope) ? { ...item, status: "reviewed" as const, updatedAt: now } : item) : state.calculations;
    const next = { ...workflow, approvals, updatedAt: now };
    return { ...state, drafts, calculations, workflows: state.workflows.filter((item) => item.id !== workflow.id).concat(next), audit: [...state.audit, audit(scope, "decide", "approval", targetId, `${decision}: ${clean(raw.comment, 300)}`, now)].slice(-20_000) };
  });
}
