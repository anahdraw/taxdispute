import fs from "node:fs";
import path from "node:path";
import {
  calculateTax,
  createApproval,
  createEvidenceItem,
  createPrecedentSelection,
  createWorkflowTask,
  generateGroundedDraft,
  impactFromAlert,
  navigatePrecedents,
  type MatterScope
} from "../lib/dispute-workbench";
import { comparableDecisions } from "../lib/mock-data";

const scope: MatterScope = { tenantId: "benchmark-tenant", clientId: "benchmark-client", matterId: "benchmark-matter", userId: "benchmark-user" };
const outputPath = path.resolve(process.argv[2] || "tests/evaluation/results/wave4-differentiation.json");
const close = (left: number, right: number) => Math.abs(left - right) < .01;

const calculationCases = [
  ...Array.from({ length: 12 }, (_, index) => { const amount = (index + 1) * 7_500_000; const result = calculateTax({ kind: "vat_other_value", amount, rate: 12, factorNumerator: 11, factorDenominator: 12 }, scope); return { id: `vat-${index + 1}`, expected: amount * .11, actual: result.result, hasSteps: result.steps.length === 3, hasWarning: result.assumptions.some((item) => /skenario matematis/i.test(item)), passed: close(result.result, amount * .11) && result.steps.length === 3 && result.fingerprint.length === 64 }; }),
  ...Array.from({ length: 12 }, (_, index) => { const net = (index + 2) * 4_900_000; const rate = index % 2 ? 2 : 10; const expected = net / (1 - rate / 100) - net; const result = calculateTax({ kind: "gross_up", amount: net, rate }, scope); return { id: `gross-up-${index + 1}`, expected, actual: result.result, hasSteps: result.steps.length === 2, hasWarning: result.assumptions.some((item) => /skenario matematis/i.test(item)), passed: close(result.result, expected) && result.steps.length === 2 }; })
];

const precedentCases = comparableDecisions.map((decision) => {
  const query = [decision.taxType, decision.issue, decision.reasoning, ...decision.matchPoints].join(" ");
  const navigator = navigatePrecedents(query, [], 7); const rank = navigator.results.findIndex((item) => item.decision.id === decision.id) + 1;
  return { id: decision.id, rank, passed: rank > 0 && rank <= 3, hasExplanation: navigator.results.every((item) => item.whySimilar.length > 20 && item.differences.length > 20), predictionWarning: /bukan prediksi kemenangan/i.test(navigator.warning) };
});

const evidenceCases = Array.from({ length: 10 }, (_, index) => {
  const verified = index % 2 === 0; const record = createEvidenceItem({ issue: `Isu ${index + 1}`, assertion: `Proposisi pembuktian ${index + 1}`, status: verified ? "verified" : "missing", gap: verified ? "" : "Dokumen pihak ketiga belum tersedia", evidence: verified ? [{ label: `Bukti ${index + 1}`, resourceId: `file-${index + 1}`, locator: `hal. ${index + 1}`, sourceHash: String(index).padStart(64, "a") }] : [], rules: [{ citation: `Aturan ${index + 1}`, locator: `Pasal ${index + 1}` }] }, scope);
  return { id: record.id, status: record.status, explicitGap: verified ? !record.gap : Boolean(record.gap), sourceReady: verified ? record.evidence[0].sourceHash.length === 64 : record.evidence.length === 0, passed: Boolean(record.issue && record.assertion && record.rules.length) && (verified ? record.evidence[0].sourceHash.length === 64 : Boolean(record.gap)) };
});

const draftCases = Array.from({ length: 8 }, (_, index) => {
  const evidence = createEvidenceItem({ issue: `Isu draf ${index + 1}`, assertion: `Fakta material ${index + 1}`, status: index % 2 ? "missing" : "verified", gap: index % 2 ? "Bukti belum lengkap" : "", evidence: index % 2 ? [] : [{ label: "Dokumen", resourceId: "file", locator: "hal. 1", sourceHash: "a".repeat(64) }], rules: [{ citation: `UU Benchmark Pasal ${index + 1}`, locator: `Pasal ${index + 1}` }] }, scope);
  const precedent = createPrecedentSelection({ treatment: index % 2 ? "distinguish" : "support", similarity: 75, note: "Bandingkan rantai bukti." }, scope, comparableDecisions[index % comparableDecisions.length]);
  const calculation = calculateTax({ kind: "vat_full", amount: 1_000_000 * (index + 1), rate: 12 }, scope);
  const draft = generateGroundedDraft({ kind: index % 2 ? "appeal" : "legal_memo", title: `Draf ${index + 1}` }, scope, { evidence: [evidence], precedents: [precedent], calculations: [calculation] });
  const passed = draft.content.includes(`UU Benchmark Pasal ${index + 1}`) && draft.content.includes(precedent.number) && draft.content.includes(calculation.name) && (index % 2 === 0 || draft.content.includes("Bukti belum lengkap"));
  return { id: draft.id, sourceFingerprint: draft.sourceFingerprint, evidenceCount: draft.evidenceIds.length, passed };
});

const impactCases = Array.from({ length: 4 }, (_, index) => {
  const citation = `PMK Dampak ${index + 1}`; const evidence = createEvidenceItem({ issue: `Dampak ${index + 1}`, assertion: citation, rules: [{ citation }] }, scope); const draft = generateGroundedDraft({ title: `Memo ${citation}` }, scope, { evidence: [evidence], precedents: [], calculations: [] }); const calculation = calculateTax({ name: `Kalkulasi ${citation}`, kind: "vat_full", amount: 1_000_000, rate: 12, legalBasis: citation }, scope);
  const impact = impactFromAlert({ id: `alert-${index}`, watchId: `watch-${index}`, tenantId: scope.tenantId, ownerUserId: scope.userId, clientId: scope.clientId, matterId: scope.matterId, type: "status_changed", severity: index === 0 ? "critical" : "warning", title: `Perubahan ${citation}`, message: `Status ${citation} berubah`, resourceId: `source-${index}`, citation, fingerprint: `${index}`, createdAt: new Date().toISOString() }, scope, { evidence: [evidence], drafts: [draft], calculations: [calculation] });
  return { id: impact.id, linkedArtifacts: impact.affectedEvidenceIds.length + impact.affectedDraftIds.length + impact.affectedCalculationIds.length, hasCriticalDueDate: impact.severity !== "critical" || Boolean(impact.dueAt), passed: impact.affectedEvidenceIds.length === 1 && impact.affectedDraftIds.length === 1 && impact.affectedCalculationIds.length === 1 && (impact.severity !== "critical" || Boolean(impact.dueAt)) };
});

const workflowCases = Array.from({ length: 5 }, (_, index) => {
  const task = createWorkflowTask({ title: `Tugas ${index + 1}`, assignee: `pegawai-${index + 1}`, dueAt: `2026-09-${String(index + 10).padStart(2, "0")}` });
  const approval = createApproval({ artifactType: index % 2 ? "calculation" : "draft", artifactId: `artifact-${index + 1}`, title: `Approval ${index + 1}` }, scope.userId);
  return { id: task.id, taskValid: task.status === "todo" && Boolean(task.dueAt), approvalValid: approval.status === "pending" && approval.requestedBy === scope.userId, passed: task.status === "todo" && Boolean(task.dueAt) && approval.status === "pending" };
});

const ratio = (cases: Array<{ passed: boolean }>) => cases.filter((item) => item.passed).length / cases.length;
const summary = { totalCases: calculationCases.length + precedentCases.length + evidenceCases.length + draftCases.length + impactCases.length + workflowCases.length, calculationCases: calculationCases.length, calculationExactRate: ratio(calculationCases), precedentCases: precedentCases.length, precedentHitAt3: ratio(precedentCases), evidenceCases: evidenceCases.length, evidenceContractRate: ratio(evidenceCases), draftCases: draftCases.length, draftGroundingRate: ratio(draftCases), impactCases: impactCases.length, impactLinkingRate: ratio(impactCases), workflowCases: workflowCases.length, workflowContractRate: ratio(workflowCases) };
const quality = { calculationsExplainSteps: calculationCases.every((item) => item.hasSteps), calculationsWarnScenario: calculationCases.every((item) => item.hasWarning), precedentExplainsDifferences: precedentCases.every((item) => item.hasExplanation), precedentNeverClaimsPrediction: precedentCases.every((item) => item.predictionWarning), draftingHasSourceFingerprint: draftCases.every((item) => item.sourceFingerprint.length === 64), criticalImpactHasDeadline: impactCases.every((item) => item.hasCriticalDueDate) };
const gates = { benchmarkSize: summary.totalCases >= 50, calculationAccuracy: summary.calculationExactRate === 1, precedentRetrieval: summary.precedentHitAt3 >= .85, evidenceContract: summary.evidenceContractRate === 1, draftGrounding: summary.draftGroundingRate === 1, impactLinking: summary.impactLinkingRate === 1, workflowContract: summary.workflowContractRate === 1, explainability: Object.values(quality).every(Boolean) };
const output = { schemaVersion: "aa-jurist-wave4-differentiation-v1", generatedAt: new Date().toISOString(), summary, quality, gates, implementationPassed: Object.values(gates).every(Boolean), limitations: ["Precedent benchmark memakai corpus comparator lokal; perlu diperluas ke seluruh putusan citation-ready.", "Calculation engine menghitung skenario terkontrol dan tidak menentukan sendiri klasifikasi objek atau fasilitas.", "Draft tetap memerlukan review manusia dan approval sebelum digunakan.", "Impact monitor bergantung pada watchlist dan graph yang sudah diverifikasi."], cases: { calculations: calculationCases, precedents: precedentCases, evidence: evidenceCases, drafts: draftCases, impacts: impactCases, workflows: workflowCases } };
fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: path.relative(process.cwd(), outputPath), summary, quality, gates, implementationPassed: output.implementationPassed }, null, 2)}\n`);
if (!output.implementationPassed) process.exitCode = 1;
