import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTpResearchAgentPrompt,
  normalizeTpDraftingAgentOutput,
  normalizeTpResearchAgentOutput,
  normalizeTpVerificationAgentOutput,
  runTpAgentRuntime
} from "../lib/tp-agent-runtime";
import {
  emptyTpProjectState,
  type TpLocalFileProject
} from "../lib/tp-local-file";
import type { TpEvidenceRecord, TpFactRecord } from "../lib/tp-agent-workflow";

const NOW = "2026-08-21T06:00:00.000Z";

function projectFixture(): TpLocalFileProject {
  const state = emptyTpProjectState();
  state.companyName = "PT Contoh Manufaktur";
  state.fiscalYear = "2025";
  state.businessActivities = "Manufacture and distribution of automotive replacement components";
  state.financialData = {
    revenue: "100000000000",
    costOfGoodsSold: "70000000000",
    grossProfit: "30000000000",
    operatingExpenses: "20000000000",
    operatingProfit: "10000000000",
    netIncome: "8000000000"
  };
  state.fieldSources = {
    companyName: ["doc-financial"],
    fiscalYear: ["doc-financial"],
    businessActivities: ["doc-profile"],
    financialData: ["doc-financial"]
  };
  return {
    id: "project-1",
    ownerUsername: "advisor",
    name: "TP 2025",
    status: "draft",
    state,
    documents: [
      {
        id: "doc-financial",
        filename: "financial-statements-2025.pdf",
        kind: "financial_statement",
        url: "private://financial-statements-2025.pdf",
        downloadUrl: "/api/private-documents/doc-financial",
        size: 1000,
        status: "extracted",
        extractionMessage: "Extracted",
        uploadedAt: NOW,
        extractedAt: NOW,
        detectedScopes: ["identity", "financial_current"],
        coverage: [
          { scope: "identity", status: "partial", note: "Name and year found" },
          { scope: "financial_current", status: "found", note: "Income statement found" }
        ]
      },
      {
        id: "doc-profile",
        filename: "company-profile.pdf",
        kind: "company_profile",
        url: "private://company-profile.pdf",
        downloadUrl: "/api/private-documents/doc-profile",
        size: 500,
        status: "extracted",
        extractionMessage: "Extracted",
        uploadedAt: NOW,
        extractedAt: NOW,
        detectedScopes: ["business_operations"]
      }
    ],
    createdAt: NOW,
    updatedAt: NOW
  };
}

function verifiedFinancialEvidence(): TpEvidenceRecord {
  return {
    id: "evidence-revenue",
    sourceType: "uploaded_document",
    sourceId: "doc-financial",
    title: "Audited financial statements 2025",
    sourceHash: "a".repeat(64),
    locator: { page: 12, table: "Statement of profit or loss" },
    excerpt: "Revenue 100,000,000,000",
    fieldPaths: ["financialData.revenue"],
    confidentiality: "client_confidential",
    verificationStatus: "verified",
    collectedBy: "document_extractor",
    collectedAt: NOW,
    verifiedBy: "evidence_verifier",
    verifiedAt: NOW
  };
}

test("runtime deterministically inventories, atomizes, assesses, assembles, and fails closed", () => {
  const result = runTpAgentRuntime(projectFixture(), { now: NOW });

  assert.equal(result.stages.intake.inventory.length, 2);
  assert.ok(result.stages.intake.recommendedScopes.includes("financial_current"));
  assert.ok(result.stages.extraction.populatedFieldCount > 5);
  assert.ok(result.stages.extraction.facts.some((fact) => fact.fieldPath === "financialData.revenue"));
  assert.ok(result.stages.gapAnalysis.criticalRequirementIds.includes("controlled-transactions"));
  assert.ok(result.stages.gapAnalysis.requestedDocuments.some((item) => item.includes("transaksi afiliasi")));
  assert.equal(result.stages.assembly.workingDraft, true);
  assert.equal(result.stages.qa.releaseRecommendation, "fail");
  assert.ok(result.stages.qa.checks.some((check) => check.id === "gross-profit-arithmetic" && check.passed));
  assert.equal(result.legacyUpdate.status, "extracted");
  assert.equal(result.workflowPlan.canFinalize, false);
});

test("runtime output is stable when project and clock are unchanged", () => {
  const first = runTpAgentRuntime(projectFixture(), { now: NOW });
  const second = runTpAgentRuntime(projectFixture(), { now: NOW });
  assert.equal(first.runId, second.runId);
  assert.equal(first.stages.assembly.documentVersion, second.stages.assembly.documentVersion);
  assert.deepEqual(first.stages.qa.checks, second.stages.qa.checks);
});

test("manual-only project enters the same evidence workflow without uploaded documents", () => {
  const project = projectFixture();
  project.documents = [];
  project.state.fieldSources = {
    companyName: ["manual-evidence-profile"],
    fiscalYear: ["manual-evidence-profile"],
    businessActivities: ["manual-evidence-profile"],
    financialData: ["manual-evidence-profile"]
  };
  project.state.manualEvidence = [{
    id: "manual-evidence-profile",
    title: "Management questionnaire and finance working paper",
    sourceKind: "management_interview",
    reference: "Finance Manager",
    locator: "TP questionnaire Q1-Q4; working paper WP-01",
    excerpt: "Management confirmed the entity, fiscal year, business activities, and current-year financial figures.",
    fieldPaths: ["companyName", "fiscalYear", "businessActivities", "financialData"],
    createdAt: NOW
  }];

  const result = runTpAgentRuntime(project, { now: NOW });
  const evidence = result.stages.extraction.evidence.find((entry) => entry.id === "manual-evidence-profile");
  const companyFact = result.stages.extraction.facts.find((fact) => fact.fieldPath === "companyName");

  assert.equal(result.stages.intake.inventory.length, 0);
  assert.equal(evidence?.sourceType, "manual_input");
  assert.equal(evidence?.locator?.section, "TP questionnaire Q1-Q4; working paper WP-01");
  assert.ok(companyFact?.evidenceIds.includes("manual-evidence-profile"));
  assert.equal(result.stages.extraction.facts.some((fact) => fact.fieldPath.startsWith("manualEvidence")), false);
  assert.equal(result.workflowPlan.stages.find((stage) => stage.stage === "intake")?.status, "completed");
  assert.equal(result.workflowPlan.stages.find((stage) => stage.stage === "extraction")?.status, "completed");
  assert.equal(result.stages.qa.releaseRecommendation, "fail", "manual evidence remains unverified until review");
});

test("document-level extraction evidence is promoted into the runtime register with its locator", () => {
  const project = projectFixture();
  project.documents[0]!.evidence = [{
    id: "doc-financial-evidence-1",
    fieldPaths: ["financialData.revenue"],
    page: 12,
    table: "Statement of profit or loss",
    excerpt: "Revenue 100,000,000,000",
    confidence: 0.96
  }, {
    id: "doc-financial-evidence-company-name",
    fieldPaths: ["companyName"],
    page: 1,
    section: "Cover",
    excerpt: "PT Contoh Manufaktur",
    confidence: 0.99
  }];
  const result = runTpAgentRuntime(project, { now: NOW });
  const evidence = result.stages.extraction.evidence.find((entry) => entry.id === "doc-financial-evidence-1");
  assert.equal(evidence?.locator?.page, 12);
  assert.equal(evidence?.excerpt, "Revenue 100,000,000,000");
  const revenueFact = result.stages.extraction.facts.find((fact) => fact.fieldPath === "financialData.revenue");
  assert.ok(revenueFact?.evidenceIds.includes("doc-financial-evidence-1"));
  assert.equal(revenueFact?.evidenceIds.includes("doc-financial-evidence-company-name"), false);
});

test("external research prompt contains only anonymized descriptors", () => {
  const project = projectFixture();
  project.state.companyName = "PT Secret Alpha Indonesia";
  project.state.companyShortName = "SecretAlpha";
  project.state.parentCompany = "Hidden Nexus Holdings";
  project.state.brandName = "ConfidentialPrime";
  project.state.testedParty = "PT Secret Alpha Indonesia";
  project.state.selectedMethod = "TNMM for SecretAlpha";
  project.state.selectedPli = "Operating margin of Secret Alpha";

  const prompt = JSON.stringify(buildTpResearchAgentPrompt(project.state)).toLowerCase();
  for (const secret of ["secret", "alpha", "hidden", "nexus", "confidentialprime"]) {
    assert.equal(prompt.includes(secret), false, `research prompt leaked ${secret}`);
  }
  assert.match(prompt, /automotive/);
});

test("research normalization rejects a comparable name unsupported by its source", () => {
  const project = projectFixture();
  const query = JSON.parse(buildTpResearchAgentPrompt(project.state).input).approvedQueries
    .find((entry: { sourceType: string }) => entry.sourceType === "comparable_candidate")?.query || "";
  const normalized = normalizeTpResearchAgentOutput({
    status: "completed",
    summary: "Preliminary discovery",
    sources: [{
      title: "Example Automotive Components Limited annual report",
      url: "https://example.com/annual-report",
      sourceType: "comparable_candidate",
      query,
      snippet: "Example Automotive Components Limited manufactures replacement components.",
      qualityTier: "exchange_or_filing",
      score: 0.9
    }],
    candidates: [
      { name: "Example Automotive Components Limited", sourceUrl: "https://example.com/annual-report" },
      { name: "Invented Comparable Plc", sourceUrl: "https://example.com/annual-report" }
    ]
  }, project.state, NOW);

  assert.equal(normalized.candidates[0]?.screeningStatus, "needs_financial_screening");
  assert.equal(normalized.candidates[1]?.screeningStatus, "exclude");
  assert.equal(normalized.status, "partial");
});

test("research normalization accepts only connector-returned URLs and preserves canonical metadata", () => {
  const project = projectFixture();
  const canonical = {
    title: "Authoritative exchange filing",
    url: "https://exchange.example/filing-1",
    domain: "exchange.example",
    sourceType: "comparable_candidate" as const,
    query: "",
    snippet: "Listed Components Limited manufactures automotive components.",
    score: 0.96,
    qualityTier: "exchange_or_filing" as const,
    qualityReason: "Exchange filing returned by the approved search connector.",
    publishedDate: "2026-01-01",
    retrievedAt: NOW
  };
  const normalized = normalizeTpResearchAgentOutput({
    status: "completed",
    sources: [
      { ...canonical, title: "Model changed this title", snippet: "Model changed this snippet" },
      { ...canonical, title: "Invented source", url: "https://invented.example/not-retrieved" }
    ],
    candidates: [{ name: "Listed Components Limited", sourceUrl: canonical.url }]
  }, project.state, NOW, [canonical]);

  assert.equal(normalized.sources.length, 1);
  assert.equal(normalized.sources[0]?.title, canonical.title);
  assert.equal(normalized.sources[0]?.snippet, canonical.snippet);
  assert.equal(normalized.candidates[0]?.screeningStatus, "needs_financial_screening");
});

test("verification cannot approve an arbitrary fact or unlocated evidence", () => {
  const located = verifiedFinancialEvidence();
  const unlocated = { ...located, id: "unlocated", locator: undefined, verificationStatus: "verified" as const };
  const facts: TpFactRecord[] = [{
    id: "fact-revenue",
    fieldPath: "financialData.revenue",
    value: "100000000000",
    evidenceIds: [located.id],
    confidence: 1,
    origin: "extracted",
    reviewStatus: "verified"
  }];
  const result = normalizeTpVerificationAgentOutput({
    verifiedFactIds: ["fact-revenue", "invented-fact"],
    verifiedEvidenceIds: [located.id, unlocated.id]
  }, [located, unlocated], facts, "input-v1", NOW);

  assert.deepEqual(result.verifiedFactIds, ["fact-revenue"]);
  assert.deepEqual(result.verifiedEvidenceIds, [located.id]);
  assert.ok(result.rejectedEvidenceIds.includes("unlocated"));
  assert.ok(result.issues.some((entry) => entry.code === "UNLOCATED_EVIDENCE_REJECTED"));
});

test("draft normalization applies only supported sections after fact verification", () => {
  const evidence = verifiedFinancialEvidence();
  const raw = {
    claims: [{
      id: "claim-revenue",
      sectionId: "executive_summary",
      text: "Pendapatan tahun berjalan adalah Rp100 miliar.",
      kind: "numeric",
      evidenceIds: [evidence.id]
    }],
    sections: [{
      id: "executive_summary",
      title: "Ringkasan Eksekutif",
      content: "Pendapatan tahun berjalan adalah Rp100 miliar. [evidence-revenue]",
      claimIds: ["claim-revenue"]
    }]
  };
  assert.equal(normalizeTpDraftingAgentOutput(raw, [evidence], []).sections.length, 0);
  const accepted = normalizeTpDraftingAgentOutput(raw, [evidence], ["fact-revenue"]);
  assert.equal(accepted.sections.length, 1);
  assert.equal(accepted.sections[0]?.content, raw.claims[0].text);
  assert.equal(accepted.claims[0]?.verificationStatus, "verified");

  const project = projectFixture();
  const baseRun = runTpAgentRuntime(project, { evidence: [evidence], now: NOW });
  const revenueFact = baseRun.stages.extraction.facts.find((fact) => fact.fieldPath === "financialData.revenue");
  assert.ok(revenueFact);
  const result = runTpAgentRuntime(project, {
    evidence: [evidence],
    verificationOutput: {
      verifiedFactIds: [revenueFact.id],
      verifiedEvidenceIds: [evidence.id]
    },
    draftingOutput: raw,
    now: NOW
  });
  assert.match(result.legacyUpdate.state.analysis.executiveSummary, /Rp100 miliar/);
  assert.equal(result.normalizedAgentOutputs.drafting?.sections.length, 1);
});
