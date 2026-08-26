import { createHash, randomUUID } from "node:crypto";
import { outcomeLabels, type ComparableDecision, type OutcomeKey } from "./mock-data";
import { searchSimilarCases, type SimilarCaseResult } from "./case-search";
import type { WatchAlert } from "./watchlist";

export const DISPUTE_WORKBENCH_SCHEMA_VERSION = 1 as const;

export type MatterScope = {
  tenantId: string;
  clientId: string;
  matterId: string;
  userId: string;
};

type MatterRecord = {
  id: string;
  tenantId: string;
  clientId: string;
  matterId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceStatus = "missing" | "collected" | "verified" | "contradicted";
export type EvidenceMatrixItem = MatterRecord & {
  issue: string;
  assertion: string;
  burden: "taxpayer" | "authority" | "shared";
  priority: "low" | "medium" | "high" | "critical";
  status: EvidenceStatus;
  evidence: Array<{ label: string; resourceId: string; url: string; locator: string; sourceHash: string }>;
  rules: Array<{ citation: string; resourceId: string; locator: string }>;
  gap: string;
  owner: string;
  notes: string;
};

export type PrecedentTreatment = "support" | "distinguish" | "risk";
export type PrecedentSelection = MatterRecord & {
  decisionId: string;
  number: string;
  treatment: PrecedentTreatment;
  note: string;
  similarity: number;
};

export type CalculationKind = "vat_other_value" | "vat_full" | "withholding" | "gross_up";
export type CalculationResult = MatterRecord & {
  name: string;
  kind: CalculationKind;
  asOf: string;
  inputs: Record<string, number>;
  steps: Array<{ label: string; formula: string; value: number }>;
  result: number;
  legalBasis: string[];
  assumptions: string[];
  status: "scenario" | "reviewed";
  fingerprint: string;
};

export type DraftKind = "objection" | "appeal" | "legal_memo" | "response" | "judicial_review";
export type DraftRecord = MatterRecord & {
  title: string;
  kind: DraftKind;
  version: number;
  status: "draft" | "in_review" | "approved" | "rejected";
  content: string;
  evidenceIds: string[];
  precedentIds: string[];
  calculationIds: string[];
  sourceFingerprint: string;
  approvalId?: string;
};

export type RegulatoryImpact = MatterRecord & {
  sourceAlertId?: string;
  sourceId: string;
  citation: string;
  title: string;
  summary: string;
  severity: "info" | "warning" | "critical";
  status: "new" | "assessing" | "actioned" | "not_applicable";
  affectedEvidenceIds: string[];
  affectedDraftIds: string[];
  affectedCalculationIds: string[];
  owner: string;
  dueAt?: string;
};

export type WorkflowPhase = "intake" | "audit" | "objection" | "appeal" | "hearing" | "judicial_review" | "closed";
export type WorkflowTask = {
  id: string;
  title: string;
  description: string;
  assignee: string;
  dueAt?: string;
  status: "todo" | "doing" | "blocked" | "done";
  artifactType?: "evidence" | "draft" | "calculation" | "impact";
  artifactId?: string;
  createdAt: string;
  updatedAt: string;
};
export type ApprovalRequest = {
  id: string;
  artifactType: "draft" | "calculation" | "evidence" | "impact";
  artifactId: string;
  title: string;
  requestedBy: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
  decidedAt?: string;
  comment?: string;
};
export type MatterWorkflow = MatterRecord & {
  phase: WorkflowPhase;
  risk: "low" | "medium" | "high" | "critical";
  nextDeadline?: string;
  tasks: WorkflowTask[];
  approvals: ApprovalRequest[];
};

export type WorkbenchAuditEvent = MatterRecord & {
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
};

export type DisputeWorkbenchSnapshot = {
  schemaVersion: typeof DISPUTE_WORKBENCH_SCHEMA_VERSION;
  scope: Omit<MatterScope, "userId">;
  evidence: EvidenceMatrixItem[];
  precedents: PrecedentSelection[];
  calculations: CalculationResult[];
  drafts: DraftRecord[];
  impacts: RegulatoryImpact[];
  workflow: MatterWorkflow;
  audit: WorkbenchAuditEvent[];
};

const text = (value: unknown, max = 5_000) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const multiline = (value: unknown, max = 50_000) => String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
const safeUrl = (value: unknown) => { const raw = text(value, 2_048); if (!raw) return ""; if (raw.startsWith("/") && !raw.startsWith("//")) return raw; try { const url = new URL(raw); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; } catch { return ""; } };
const finite = (value: unknown, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const id = (prefix: string) => `${prefix}-${randomUUID()}`;
const base = (scope: MatterScope, now = new Date().toISOString()): MatterRecord => ({ id: "", tenantId: scope.tenantId, clientId: scope.clientId, matterId: scope.matterId, createdBy: scope.userId, createdAt: now, updatedAt: now });

export function createEvidenceItem(raw: Record<string, unknown>, scope: MatterScope, now = new Date().toISOString()): EvidenceMatrixItem {
  const issue = text(raw.issue, 300); const assertion = text(raw.assertion, 2_000);
  if (!issue || !assertion) throw new Error("Isu dan proposisi yang harus dibuktikan wajib diisi.");
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.slice(0, 30).map((item) => { const value = item && typeof item === "object" ? item as Record<string, unknown> : {}; return { label: text(value.label, 300), resourceId: text(value.resourceId, 500), url: safeUrl(value.url), locator: text(value.locator, 300), sourceHash: /^[a-f0-9]{64}$/i.test(text(value.sourceHash, 64)) ? text(value.sourceHash, 64).toLowerCase() : "" }; }).filter((item) => item.label || item.resourceId) : [];
  const rules = Array.isArray(raw.rules) ? raw.rules.slice(0, 30).map((item) => { const value = item && typeof item === "object" ? item as Record<string, unknown> : {}; return { citation: text(value.citation, 500), resourceId: text(value.resourceId, 500), locator: text(value.locator, 300) }; }).filter((item) => item.citation) : [];
  const status: EvidenceStatus = raw.status === "collected" || raw.status === "verified" || raw.status === "contradicted" ? raw.status : "missing";
  if (status === "verified" && (!evidence.length || !rules.length || evidence.some((item) => !item.sourceHash || !item.locator) || rules.some((item) => !item.locator))) {
    throw new Error("Status verified memerlukan bukti dengan SHA-256 dan locator serta dasar hukum dengan locator.");
  }
  return { ...base(scope, now), id: id("evidence"), issue, assertion, burden: raw.burden === "authority" || raw.burden === "shared" ? raw.burden : "taxpayer", priority: raw.priority === "critical" || raw.priority === "high" || raw.priority === "low" ? raw.priority : "medium", status, evidence, rules, gap: text(raw.gap, 2_000), owner: text(raw.owner, 180), notes: multiline(raw.notes, 10_000) };
}

export type ExplainableCalculationInput = { name?: unknown; kind?: unknown; asOf?: unknown; amount?: unknown; rate?: unknown; factorNumerator?: unknown; factorDenominator?: unknown; legalBasis?: unknown; assumptions?: unknown };

export function calculateTax(raw: ExplainableCalculationInput, scope: MatterScope, now = new Date().toISOString()): CalculationResult {
  const kind: CalculationKind = raw.kind === "vat_full" || raw.kind === "withholding" || raw.kind === "gross_up" ? raw.kind : "vat_other_value";
  const amount = finite(raw.amount); const rate = finite(raw.rate, kind.startsWith("vat") ? 12 : 2);
  const factorNumerator = finite(raw.factorNumerator, 11); const factorDenominator = finite(raw.factorDenominator, 12);
  if (amount < 0 || rate < 0 || rate >= 100 || factorNumerator < 0 || factorDenominator <= 0) throw new Error("Input kalkulasi tidak valid.");
  const steps: CalculationResult["steps"] = [];
  let result = 0;
  if (kind === "vat_other_value") {
    const adjustedBase = amount * factorNumerator / factorDenominator;
    steps.push({ label: "DPP nilai lain", formula: `${factorNumerator}/${factorDenominator} × ${amount}`, value: adjustedBase });
    result = adjustedBase * rate / 100;
    steps.push({ label: "PPN terutang", formula: `${rate}% × ${adjustedBase}`, value: result });
    steps.push({ label: "Total termasuk PPN", formula: `${amount} + ${result}`, value: amount + result });
  } else if (kind === "vat_full" || kind === "withholding") {
    result = amount * rate / 100;
    steps.push({ label: kind === "vat_full" ? "PPN terutang" : "Pajak dipotong", formula: `${rate}% × ${amount}`, value: result });
    steps.push({ label: kind === "vat_full" ? "Total termasuk PPN" : "Jumlah neto", formula: kind === "vat_full" ? `${amount} + ${result}` : `${amount} - ${result}`, value: kind === "vat_full" ? amount + result : amount - result });
  } else {
    const gross = amount / (1 - rate / 100);
    result = gross - amount;
    steps.push({ label: "Jumlah bruto hasil gross-up", formula: `${amount} ÷ (1 - ${rate}%)`, value: gross });
    steps.push({ label: "Pajak ditanggung pemberi penghasilan", formula: `${gross} - ${amount}`, value: result });
  }
  const legalBasis = Array.isArray(raw.legalBasis) ? raw.legalBasis.map((item) => text(item, 500)).filter(Boolean).slice(0, 20) : text(raw.legalBasis, 500) ? [text(raw.legalBasis, 500)] : [];
  const assumptions = Array.isArray(raw.assumptions) ? raw.assumptions.map((item) => text(item, 1_000)).filter(Boolean).slice(0, 20) : text(raw.assumptions, 2_000).split("\n").map((item) => item.trim()).filter(Boolean);
  const inputs = { amount, rate, ...(kind === "vat_other_value" ? { factorNumerator, factorDenominator } : {}) };
  const fingerprint = createHash("sha256").update(JSON.stringify({ kind, inputs, legalBasis, asOf: text(raw.asOf, 10) })).digest("hex");
  return { ...base(scope, now), id: id("calc"), name: text(raw.name, 300) || "Skenario kalkulasi pajak", kind, asOf: /^\d{4}-\d{2}-\d{2}$/.test(text(raw.asOf, 10)) ? text(raw.asOf, 10) : now.slice(0, 10), inputs, steps, result, legalBasis, assumptions: [...assumptions, "Hasil merupakan skenario matematis; klasifikasi objek, fasilitas, masa pajak, dan ketentuan transisi harus divalidasi."], status: "scenario", fingerprint };
}

export type PrecedentNavigatorResult = SimilarCaseResult & { outcomeLabel: string; treatment?: PrecedentTreatment; selected: boolean };
export function navigatePrecedents(query: string, selected: PrecedentSelection[] = [], limit = 10): { results: PrecedentNavigatorResult[]; outcomeDistribution: Array<{ outcome: OutcomeKey; count: number; share: number }>; warning: string } {
  const results = searchSimilarCases(text(query, 10_000), "id", limit).map((result) => { const selection = selected.find((item) => item.decisionId === result.decision.id); return { ...result, outcomeLabel: outcomeLabels[result.decision.outcome].id, treatment: selection?.treatment, selected: Boolean(selection) }; });
  const counts = new Map<OutcomeKey, number>(); results.forEach((item) => counts.set(item.decision.outcome, (counts.get(item.decision.outcome) || 0) + 1));
  const outcomeDistribution = [...counts].map(([outcome, count]) => ({ outcome, count, share: results.length ? count / results.length : 0 }));
  return { results, outcomeDistribution, warning: "Kemiripan adalah alat navigasi riset, bukan prediksi kemenangan. Baca fakta, bukti, masa pajak, dan pertimbangan putusan asli." };
}

function bullets(values: string[], empty: string) { return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`; }
export function generateGroundedDraft(raw: Record<string, unknown>, scope: MatterScope, context: { evidence: EvidenceMatrixItem[]; precedents: PrecedentSelection[]; calculations: CalculationResult[] }, now = new Date().toISOString()): DraftRecord {
  const kind: DraftKind = raw.kind === "objection" || raw.kind === "appeal" || raw.kind === "response" || raw.kind === "judicial_review" ? raw.kind : "legal_memo";
  const title = text(raw.title, 500) || ({ objection: "Konsep Surat Keberatan", appeal: "Konsep Surat Banding", legal_memo: "Memorandum Analisis Pajak", response: "Konsep Tanggapan", judicial_review: "Konsep Peninjauan Kembali" } as Record<DraftKind, string>)[kind];
  const evidence = context.evidence.filter((item) => !Array.isArray(raw.evidenceIds) || (raw.evidenceIds as unknown[]).map(String).includes(item.id));
  const precedents = context.precedents.filter((item) => !Array.isArray(raw.precedentIds) || (raw.precedentIds as unknown[]).map(String).includes(item.id));
  const calculations = context.calculations.filter((item) => !Array.isArray(raw.calculationIds) || (raw.calculationIds as unknown[]).map(String).includes(item.id));
  const sourceFingerprint = createHash("sha256").update(JSON.stringify({ evidence: evidence.map((item) => [item.id, item.updatedAt]), precedents: precedents.map((item) => [item.id, item.updatedAt]), calculations: calculations.map((item) => item.fingerprint) })).digest("hex");
  const content = `# ${title}\n\n**Status:** Draf kerja — wajib direview dan dilengkapi identitas, tanggal, petitum, serta dokumen resmi.\n**Tanggal basis analisis:** ${now.slice(0, 10)}\n\n## Ringkasan posisi\n${multiline(raw.summary, 5_000) || "Jelaskan koreksi yang disengketakan, posisi Wajib Pajak, dan hasil yang dimohonkan."}\n\n## Isu dan matriks pembuktian\n${bullets(evidence.map((item) => `${item.issue}: ${item.assertion} — status ${item.status}; beban ${item.burden}.${item.gap ? ` Gap: ${item.gap}` : ""}`), "Belum ada item evidence matrix yang dipilih.")}\n\n## Dasar hukum\n${bullets([...new Set(evidence.flatMap((item) => item.rules.map((rule) => `${rule.citation}${rule.locator ? ` (${rule.locator})` : ""}`)))], "Belum ada sumber hukum terhubung; draf tidak boleh diajukan sebelum bagian ini dilengkapi.")}\n\n## Bukti\n${bullets(evidence.flatMap((item) => item.evidence.map((proof) => `${proof.label}${proof.locator ? ` — ${proof.locator}` : ""}${proof.sourceHash ? ` [SHA-256 ${proof.sourceHash}]` : ""}`)), "Belum ada bukti terhubung.")}\n\n## Preseden dan pembeda\n${bullets(precedents.map((item) => `${item.number} — ${item.treatment}: ${item.note || "catatan analitis belum diisi"}`), "Belum ada preseden yang dipilih.")}\n\n## Kalkulasi\n${bullets(calculations.map((item) => `${item.name}: Rp${Math.round(item.result).toLocaleString("id-ID")} (${item.kind}; per ${item.asOf})`), "Belum ada skenario kalkulasi terhubung.")}\n\n## Analisis\n${multiline(raw.analysis, 12_000) || "Susun penerapan unsur hukum terhadap fakta dan bukti. Pisahkan fakta yang terverifikasi, inferensi, dan asumsi."}\n\n## Risiko dan hal yang harus diselesaikan\n${bullets(evidence.filter((item) => item.status !== "verified").map((item) => `${item.issue}: ${item.status}${item.gap ? ` — ${item.gap}` : ""}`), "Tidak ada gap evidence terbuka pada pilihan saat ini.")}\n\n## Kesimpulan dan permohonan\n${multiline(raw.conclusion, 5_000) || "Rumuskan kesimpulan serta permohonan secara spesifik setelah review senior."}`;
  return { ...base(scope, now), id: id("draft"), title, kind, version: 1, status: "draft", content, evidenceIds: evidence.map((item) => item.id), precedentIds: precedents.map((item) => item.id), calculationIds: calculations.map((item) => item.id), sourceFingerprint };
}

function words(value: string) { return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((item) => item.length > 3)); }
function overlaps(left: string, right: string) { const a = words(left); const b = words(right); return [...a].some((word) => b.has(word)); }
export function impactFromAlert(alert: WatchAlert, scope: MatterScope, context: { evidence: EvidenceMatrixItem[]; drafts: DraftRecord[]; calculations: CalculationResult[] }, now = new Date().toISOString()): RegulatoryImpact {
  const haystack = `${alert.title} ${alert.message} ${alert.citation}`;
  return { ...base(scope, now), id: id("impact"), sourceAlertId: alert.id, sourceId: alert.resourceId, citation: alert.citation, title: alert.title, summary: alert.message, severity: alert.severity, status: "new", affectedEvidenceIds: context.evidence.filter((item) => overlaps(haystack, `${item.issue} ${item.assertion} ${item.rules.map((rule) => rule.citation).join(" ")}`)).map((item) => item.id), affectedDraftIds: context.drafts.filter((item) => overlaps(haystack, item.content)).map((item) => item.id), affectedCalculationIds: context.calculations.filter((item) => overlaps(haystack, `${item.name} ${item.legalBasis.join(" ")}`)).map((item) => item.id), owner: "", ...(alert.severity === "critical" ? { dueAt: new Date(Date.parse(now) + 3 * 86_400_000).toISOString() } : {}) };
}

export function emptyWorkflow(scope: MatterScope, now = new Date().toISOString()): MatterWorkflow { return { ...base(scope, now), id: `workflow-${scope.matterId}`, phase: "intake", risk: "medium", tasks: [], approvals: [] }; }
export function createWorkflowTask(raw: Record<string, unknown>, now = new Date().toISOString()): WorkflowTask { const title = text(raw.title, 500); if (!title) throw new Error("Judul tugas wajib diisi."); const dueAt = text(raw.dueAt, 30); return { id: id("task"), title, description: text(raw.description, 3_000), assignee: text(raw.assignee, 180), ...(Number.isFinite(Date.parse(dueAt)) ? { dueAt: new Date(dueAt).toISOString() } : {}), status: "todo", artifactType: raw.artifactType === "evidence" || raw.artifactType === "draft" || raw.artifactType === "calculation" || raw.artifactType === "impact" ? raw.artifactType : undefined, artifactId: text(raw.artifactId, 180) || undefined, createdAt: now, updatedAt: now }; }
export function createApproval(raw: Record<string, unknown>, userId: string, now = new Date().toISOString()): ApprovalRequest { const artifactType = raw.artifactType === "calculation" || raw.artifactType === "evidence" || raw.artifactType === "impact" ? raw.artifactType : "draft"; const artifactId = text(raw.artifactId, 180); if (!artifactId) throw new Error("Artefak approval wajib dipilih."); return { id: id("approval"), artifactType, artifactId, title: text(raw.title, 500) || `Review ${artifactType}`, requestedBy: userId, requestedAt: now, status: "pending" }; }

export function createPrecedentSelection(raw: Record<string, unknown>, scope: MatterScope, decision: ComparableDecision, now = new Date().toISOString()): PrecedentSelection { const treatment: PrecedentTreatment = raw.treatment === "distinguish" || raw.treatment === "risk" ? raw.treatment : "support"; return { ...base(scope, now), id: id("precedent"), decisionId: decision.id, number: decision.number, treatment, note: text(raw.note, 4_000), similarity: Math.max(0, Math.min(100, finite(raw.similarity))) }; }
