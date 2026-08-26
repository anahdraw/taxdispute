import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  calculateTax,
  createEvidenceItem,
  createPrecedentSelection,
  generateGroundedDraft,
  impactFromAlert,
  navigatePrecedents,
  type MatterScope
} from "../lib/dispute-workbench";
import { comparableDecisions } from "../lib/mock-data";
import {
  createWorkbenchEvidence,
  decideWorkbenchApproval,
  generateWorkbenchDraft,
  getDisputeWorkbench,
  requestWorkbenchApproval
} from "../lib/dispute-workbench-store";

const scope: MatterScope = { tenantId: "tenant-a", clientId: "client-a", matterId: "matter-a", userId: "user-a" };

test("explainable VAT and gross-up calculations expose reproducible steps", () => {
  const vat = calculateTax({ kind: "vat_other_value", amount: 100_000_000, rate: 12, factorNumerator: 11, factorDenominator: 12, legalBasis: "PMK 131 Tahun 2024" }, scope, "2026-08-21T00:00:00.000Z");
  assert.equal(Math.round(vat.result), 11_000_000);
  assert.equal(Math.round(vat.steps[0].value), 91_666_667);
  assert.equal(Math.round(vat.steps[2].value), 111_000_000);
  assert.equal(vat.fingerprint.length, 64);
  assert.match(vat.assumptions.at(-1) || "", /skenario matematis/i);
  const gross = calculateTax({ kind: "gross_up", amount: 98_000_000, rate: 2 }, scope);
  assert.equal(Math.round(gross.result), 2_000_000);
});

test("evidence cannot be marked verified without immutable provenance and locators", () => {
  assert.throws(() => createEvidenceItem({ issue: "Pajak Masukan", assertion: "Transaksi terjadi.", status: "verified", evidence: [{ label: "Faktur", resourceId: "file" }], rules: [{ citation: "UU PPN" }] }, scope), /SHA-256 dan locator/);
  const verified = createEvidenceItem({ issue: "Pajak Masukan", assertion: "Transaksi terjadi.", status: "verified", evidence: [{ label: "Faktur", resourceId: "file", locator: "hal. 1", sourceHash: "a".repeat(64) }], rules: [{ citation: "UU PPN", locator: "Pasal 9" }] }, scope);
  assert.equal(verified.status, "verified");
});

test("drafting studio carries evidence, citation, hash, precedent, calculation, and open gap", () => {
  const evidence = createEvidenceItem({ issue: "Pajak Masukan", assertion: "Transaksi nyata dan terkait kegiatan usaha.", status: "collected", gap: "Konfirmasi lawan transaksi belum ada", evidence: [{ label: "Faktur A", resourceId: "file-a", locator: "hal. 4", sourceHash: "a".repeat(64) }], rules: [{ citation: "UU PPN Pasal 9", locator: "Pasal 9 ayat (8)" }] }, scope);
  const calculation = calculateTax({ kind: "vat_full", amount: 100_000_000, rate: 12 }, scope);
  const precedent = createPrecedentSelection({ treatment: "support", similarity: 80, note: "Rantai bukti sebanding." }, scope, comparableDecisions[1]);
  const draft = generateGroundedDraft({ kind: "appeal", title: "Konsep Banding Pajak Masukan" }, scope, { evidence: [evidence], precedents: [precedent], calculations: [calculation] });
  assert.match(draft.content, /UU PPN Pasal 9/);
  assert.match(draft.content, /SHA-256/);
  assert.match(draft.content, /Konfirmasi lawan transaksi belum ada/);
  assert.match(draft.content, new RegExp(comparableDecisions[1].number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(draft.sourceFingerprint.length, 64);
});

test("precedent navigator explains distinctions and does not claim outcome prediction", () => {
  const navigator = navigatePrecedents("sengketa Pajak Masukan dengan faktur, pembayaran, rekonsiliasi SPT dan konfirmasi lawan transaksi", [], 5);
  assert.equal(navigator.results.length, 5);
  assert.ok(navigator.results[0].similarity > 0);
  assert.match(navigator.warning, /bukan prediksi kemenangan/i);
  assert.ok(navigator.results.every((item) => item.differences.length > 20 && item.whySimilar.length > 20));
});

test("regulatory impact maps a watch alert to affected matter artifacts", () => {
  const evidence = createEvidenceItem({ issue: "Pajak Masukan", assertion: "Faktur mendukung pengkreditan.", rules: [{ citation: "PMK Faktur Pajak" }] }, scope);
  const draft = generateGroundedDraft({ title: "Memo Faktur Pajak" }, scope, { evidence: [evidence], precedents: [], calculations: [] });
  const calculation = calculateTax({ name: "PPN Faktur Pajak", kind: "vat_full", amount: 10_000_000, rate: 12, legalBasis: "PMK Faktur Pajak" }, scope);
  const impact = impactFromAlert({ id: "alert-a", watchId: "watch-a", tenantId: scope.tenantId, ownerUserId: scope.userId, clientId: scope.clientId, matterId: scope.matterId, type: "status_changed", severity: "critical", title: "Perubahan Faktur Pajak", message: "Status PMK Faktur Pajak berubah.", resourceId: "pmk-faktur", citation: "PMK Faktur Pajak", fingerprint: "x", createdAt: new Date().toISOString() }, scope, { evidence: [evidence], drafts: [draft], calculations: [calculation] });
  assert.deepEqual(impact.affectedEvidenceIds, [evidence.id]);
  assert.deepEqual(impact.affectedDraftIds, [draft.id]);
  assert.deepEqual(impact.affectedCalculationIds, [calculation.id]);
  assert.ok(impact.dueAt);
});

test("matter store isolates tenants and approval requires an authorized decision", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-wave4-store-")); process.env.TDP_LOCAL_WORKSPACE_ROOT = root;
  try {
    const scopeB: MatterScope = { tenantId: "tenant-b", clientId: "client-b", matterId: "matter-b", userId: "user-b" };
    await createWorkbenchEvidence(scope, { issue: "Isu A", assertion: "Proposisi A", status: "collected", rules: [{ citation: "UU A", locator: "Pasal 1" }] });
    await createWorkbenchEvidence(scopeB, { issue: "Isu B", assertion: "Proposisi B" });
    assert.deepEqual((await getDisputeWorkbench(scope)).evidence.map((item) => item.issue), ["Isu A"]);
    assert.deepEqual((await getDisputeWorkbench(scopeB)).evidence.map((item) => item.issue), ["Isu B"]);
    const ungrounded = await generateWorkbenchDraft(scopeB, { kind: "legal_memo", title: "Memo tanpa grounding" });
    await assert.rejects(() => requestWorkbenchApproval(scopeB, { artifactType: "draft", artifactId: ungrounded.drafts[0].id }), /belum memiliki evidence dan dasar hukum/);
    let snapshot = await generateWorkbenchDraft(scope, { kind: "legal_memo", title: "Memo A" }); const draft = snapshot.drafts[0];
    snapshot = await requestWorkbenchApproval(scope, { artifactType: "draft", artifactId: draft.id, title: "Review Memo A" }); const approval = snapshot.workflow.approvals[0];
    await assert.rejects(() => decideWorkbenchApproval(scope, { id: approval.id, decision: "approved" }, false), /lead atau administrator/);
    snapshot = await decideWorkbenchApproval(scope, { id: approval.id, decision: "approved", comment: "Reviewed" }, true);
    assert.equal(snapshot.workflow.approvals[0].status, "approved");
    assert.equal(snapshot.drafts.find((item) => item.id === draft.id)?.status, "approved");
    assert.ok(snapshot.audit.length >= 4);
  } finally { fs.rmSync(root, { recursive: true, force: true }); delete process.env.TDP_LOCAL_WORKSPACE_ROOT; }
});
