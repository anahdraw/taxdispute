import assert from "node:assert/strict";
import test from "node:test";
import { emptyTpProjectState } from "../lib/tp-local-file";
import {
  evaluateTpWorkflowGates,
  planTpAgentWorkflow,
  tpAgentDefinitions,
  type TpEvidenceRecord,
  type TpWorkflowStageId
} from "../lib/tp-agent-workflow";

function financialStatementState() {
  const state = emptyTpProjectState();
  state.companyName = "PT Contoh Industri";
  state.fiscalYear = "2025";
  state.businessActivities = "Manufacturing and distribution of industrial components";
  state.financialData = {
    revenue: "100000000000",
    costOfGoodsSold: "70000000000",
    grossProfit: "30000000000",
    operatingExpenses: "20000000000",
    operatingProfit: "10000000000",
    netIncome: "8000000000"
  };
  state.fieldSources = {
    companyName: ["doc-financial-1"],
    fiscalYear: ["doc-financial-1"],
    "financialData.revenue": ["doc-financial-1"]
  };
  return state;
}

function verifiedEvidence(): TpEvidenceRecord {
  return {
    id: "evidence-1",
    sourceType: "uploaded_document",
    sourceId: "doc-financial-1",
    title: "Audited financial statements 2025",
    sourceHash: "a".repeat(64),
    locator: { page: 42, table: "Related party balances" },
    excerpt: "Revenue from related party transactions amounted to ...",
    fieldPaths: ["affiliatedTransactions.0.value"],
    confidentiality: "client_confidential",
    verificationStatus: "verified",
    collectedBy: "document_extractor",
    collectedAt: "2026-08-21T00:00:00.000Z",
    verifiedBy: "evidence_verifier",
    verifiedAt: "2026-08-21T00:05:00.000Z"
  };
}

test("agent definitions cover the complete controlled workflow in order", () => {
  assert.deepEqual(
    tpAgentDefinitions.map((agent) => agent.stage),
    ["intake", "extraction", "gap_analysis", "research", "verification", "drafting", "assembly", "qa", "human_approval"]
  );
  assert.equal(new Set(tpAgentDefinitions.map((agent) => agent.role)).size, tpAgentDefinitions.length);
  assert.equal(tpAgentDefinitions.at(-1)?.actor, "human");
  assert.equal(tpAgentDefinitions.at(-1)?.requiresHumanApproval, true);
});

test("an empty project starts at intake and cannot skip downstream stages", () => {
  const plan = planTpAgentWorkflow(emptyTpProjectState());
  assert.deepEqual(plan.nextStages, ["intake"]);
  assert.equal(plan.canFinalize, false);
  assert.ok(plan.blockers.some((entry) => entry.code === "NO_SOURCE_DOCUMENT"));
  assert.equal(plan.stages.find((stage) => stage.stage === "extraction")?.status, "blocked");
});

test("a financial statement advances to gap analysis but exposes missing TP inputs", () => {
  const state = financialStatementState();
  const plan = planTpAgentWorkflow(state, { documentCount: 1, extractedDocumentCount: 1 });

  assert.equal(plan.stages.find((stage) => stage.stage === "intake")?.status, "completed");
  assert.equal(plan.stages.find((stage) => stage.stage === "extraction")?.status, "completed");
  assert.equal(plan.stages.find((stage) => stage.stage === "gap_analysis")?.status, "ready");
  assert.ok(plan.blockers.some((entry) => entry.code === "MISSING_CONTROLLED_TRANSACTIONS"));
  assert.ok(plan.blockers.some((entry) => entry.code === "MISSING_METHOD_DECISION"));
  assert.equal(plan.canFinalize, false);
});

test("external research opt-in requires a named human approval", () => {
  const state = financialStatementState();
  state.affiliatedTransactions = [{
    counterparty: "Related Party A",
    country: "Singapore",
    affiliationType: "common control",
    transactionType: "purchase of goods",
    value: "25000000000",
    currency: "IDR",
    note: ""
  }];
  const gates = evaluateTpWorkflowGates(state, {
    documentCount: 1,
    extractedDocumentCount: 1,
    completedStages: ["intake", "extraction", "gap_analysis", "research"],
    externalResearchAllowed: true
  });
  const researchGate = gates.find((gate) => gate.id === "research_privacy_approved");
  assert.equal(researchGate?.passed, false);
  assert.ok(researchGate?.reasons.some((reason) => reason.includes("human approval")));

  const approvedGates = evaluateTpWorkflowGates(state, {
    documentCount: 1,
    extractedDocumentCount: 1,
    completedStages: ["intake", "extraction", "gap_analysis", "research"],
    externalResearchAllowed: true,
    externalResearchApprovedBy: "reviewer-1"
  });
  assert.equal(approvedGates.find((gate) => gate.id === "research_privacy_approved")?.passed, true);
});

test("verification requires evidence with an excerpt and precise locator", () => {
  const state = financialStatementState();
  const stages: TpWorkflowStageId[] = ["intake", "extraction", "gap_analysis", "research", "verification"];
  const base = {
    documentCount: 1,
    extractedDocumentCount: 1,
    completedStages: stages,
    externalResearchAllowed: false
  };
  const withoutLocator = { ...verifiedEvidence(), locator: undefined };

  assert.equal(
    evaluateTpWorkflowGates(state, { ...base, evidence: [withoutLocator] })
      .find((gate) => gate.id === "material_evidence_verified")?.passed,
    false
  );
  assert.ok(
    evaluateTpWorkflowGates(state, { ...base, evidence: [verifiedEvidence()] })
      .find((gate) => gate.id === "material_evidence_verified")?.reasons
      .some((reason) => reason.includes("blocking issues")),
    "benchmark gaps remain blocking even when one evidence item is verified"
  );
});

test("completion flags alone never bypass readiness, QA, or exact-version human approval", () => {
  const state = financialStatementState();
  const allStages: TpWorkflowStageId[] = tpAgentDefinitions.map((agent) => agent.stage);
  const plan = planTpAgentWorkflow(state, {
    documentCount: 1,
    extractedDocumentCount: 1,
    completedStages: allStages,
    evidence: [verifiedEvidence()],
    qaPassed: true,
    currentDocumentVersion: "draft-v2",
    approvedDocumentVersion: "draft-v1"
  });

  assert.equal(plan.canFinalize, false);
  assert.equal(plan.gates.find((gate) => gate.id === "draft_inputs_approved")?.passed, false);
  assert.equal(plan.gates.find((gate) => gate.id === "human_final_approval")?.passed, false);
  assert.equal(plan.stages.find((stage) => stage.stage === "verification")?.status, "needs_attention");
  assert.equal(plan.stages.find((stage) => stage.stage === "drafting")?.status, "needs_attention");
});

test("a completed stage with a failed gate cannot unlock downstream work", () => {
  const state = financialStatementState();
  const plan = planTpAgentWorkflow(state, {
    documentCount: 1,
    extractedDocumentCount: 1,
    completedStages: ["intake", "extraction", "gap_analysis", "research", "verification"],
    externalResearchAllowed: false,
    evidence: []
  });

  assert.equal(plan.stages.find((stage) => stage.stage === "verification")?.status, "needs_attention");
  assert.equal(plan.stages.find((stage) => stage.stage === "drafting")?.status, "blocked");
  assert.ok(plan.nextStages.includes("verification"));
  assert.ok(!plan.nextStages.includes("drafting"));
});
