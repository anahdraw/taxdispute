import {
  tpGenerationReadiness,
  tpProjectCompleteness,
  type TpProjectState
} from "./tp-local-file";

/**
 * Domain contracts for a controlled, evidence-first TP Local File workflow.
 *
 * This module intentionally contains no model, database, route, or UI code. It
 * defines what every worker must receive and return, and provides a deterministic
 * planner that an API/job runner can call before dispatching any agent.
 */

export const TP_WORKFLOW_VERSION = "tp-agent-workflow-v1" as const;

export type TpWorkflowStageId =
  | "intake"
  | "extraction"
  | "gap_analysis"
  | "research"
  | "verification"
  | "drafting"
  | "assembly"
  | "qa"
  | "human_approval";

export type TpAgentRoleId =
  | "intake_coordinator"
  | "document_extractor"
  | "gap_analyst"
  | "research_analyst"
  | "evidence_verifier"
  | "local_file_drafter"
  | "document_assembler"
  | "quality_assurer"
  | "human_approver";

export type TpWorkflowActor = "ai" | "deterministic_service" | "human";

export type TpAgentDefinition = {
  role: TpAgentRoleId;
  stage: TpWorkflowStageId;
  actor: TpWorkflowActor;
  name: string;
  objective: string;
  requiredInputs: string[];
  requiredOutputs: string[];
  guardrails: string[];
  mayUseExternalResearch: boolean;
  requiresHumanApproval: boolean;
};

/** Ordered definitions are also the canonical workflow sequence. */
export const tpAgentDefinitions: readonly TpAgentDefinition[] = [
  {
    role: "intake_coordinator",
    stage: "intake",
    actor: "ai",
    name: "TP Intake Coordinator",
    objective: "Inventory uploaded files, identify the taxpayer and fiscal period, classify confidentiality, and propose extraction scopes.",
    requiredInputs: ["uploaded document metadata or manually entered project facts"],
    requiredOutputs: ["document inventory", "scope recommendation", "intake issues"],
    guardrails: [
      "Never expose storage URLs or document content outside the authorized matter.",
      "Do not infer a taxpayer identity or fiscal period when the source is ambiguous.",
      "Treat every uploaded document as confidential by default."
    ],
    mayUseExternalResearch: false,
    requiresHumanApproval: false
  },
  {
    role: "document_extractor",
    stage: "extraction",
    actor: "ai",
    name: "TP Evidence Extractor",
    objective: "Atomize document content into structured facts while retaining exact source provenance.",
    requiredInputs: ["authorized document bytes", "requested extraction scopes"],
    requiredOutputs: ["facts", "evidence locators", "coverage", "conflicts"],
    guardrails: [
      "Every extracted fact must cite a document and a page, sheet, cell, or section locator.",
      "Never overwrite a manual value or a conflicting extracted fact silently.",
      "Use null or an issue when a value is not present; never complete it from general knowledge."
    ],
    mayUseExternalResearch: false,
    requiresHumanApproval: false
  },
  {
    role: "gap_analyst",
    stage: "gap_analysis",
    actor: "deterministic_service",
    name: "TP Gap Analyst",
    objective: "Map available facts to Local File requirements and produce a prioritized request list.",
    requiredInputs: ["normalized project state", "extraction coverage", "evidence register"],
    requiredOutputs: ["requirement matrix", "blocking gaps", "document request list"],
    guardrails: [
      "Apply rule-based requirements before generative commentary.",
      "Distinguish missing, not applicable, unverified, and advisor-decision items.",
      "A completeness score cannot override a mandatory blocker."
    ],
    mayUseExternalResearch: false,
    requiresHumanApproval: false
  },
  {
    role: "research_analyst",
    stage: "research",
    actor: "ai",
    name: "TP Research Analyst",
    objective: "Find official rules, industry evidence, and preliminary comparable candidates for identified gaps.",
    requiredInputs: ["sanitized research brief", "gap list", "transaction characterization"],
    requiredOutputs: ["research trail", "source candidates", "research limitations"],
    guardrails: [
      "Send only sanitized, approved descriptors to external services.",
      "Prefer official primary sources for law and exchange or company filings for entity facts.",
      "Web discovery alone cannot establish a final comparable or financial ratio."
    ],
    mayUseExternalResearch: true,
    requiresHumanApproval: false
  },
  {
    role: "evidence_verifier",
    stage: "verification",
    actor: "ai",
    name: "TP Evidence Verifier",
    objective: "Test each material fact and research claim against its cited source and flag contradictions.",
    requiredInputs: ["facts", "evidence register", "research sources", "calculation inputs"],
    requiredOutputs: ["claim verification results", "conflicts", "verified evidence set"],
    guardrails: [
      "A source URL alone is not verification; the cited excerpt and locator must support the exact claim.",
      "Numeric conclusions must be recomputed deterministically from cited inputs.",
      "Do not resolve contradictory sources without an explicit recorded rationale."
    ],
    mayUseExternalResearch: false,
    requiresHumanApproval: false
  },
  {
    role: "local_file_drafter",
    stage: "drafting",
    actor: "ai",
    name: "TP Local File Drafter",
    objective: "Draft Local File sections using only verified facts, approved assumptions, and located legal sources.",
    requiredInputs: ["verified evidence set", "advisor decisions", "section requirements"],
    requiredOutputs: ["section drafts", "claim-to-evidence links", "open drafting issues"],
    guardrails: [
      "Every material legal, factual, and numeric claim must reference evidence.",
      "Never turn an assumption, discovery-only source, or preliminary comparable into a fact.",
      "Preserve unresolved matters as visible drafting issues."
    ],
    mayUseExternalResearch: false,
    requiresHumanApproval: false
  },
  {
    role: "document_assembler",
    stage: "assembly",
    actor: "deterministic_service",
    name: "TP Document Assembler",
    objective: "Assemble approved section drafts, tables, citations, appendices, and version metadata into one working draft.",
    requiredInputs: ["section drafts", "tables", "evidence appendix", "template version"],
    requiredOutputs: ["versioned working draft", "assembly manifest", "unresolved-issue appendix"],
    guardrails: [
      "Assembly may format but must not change the meaning of approved content.",
      "A draft with unresolved blockers must be watermarked as a working draft.",
      "Record the exact input and template versions used."
    ],
    mayUseExternalResearch: false,
    requiresHumanApproval: false
  },
  {
    role: "quality_assurer",
    stage: "qa",
    actor: "ai",
    name: "TP Quality Assurance Reviewer",
    objective: "Run completeness, consistency, citation, arithmetic, language, and rendering checks on the assembled draft.",
    requiredInputs: ["assembled draft", "assembly manifest", "evidence register", "requirement matrix"],
    requiredOutputs: ["QA report", "blocking issues", "release recommendation"],
    guardrails: [
      "QA must fail closed when a critical source, calculation, or required section is unsupported.",
      "Do not approve professional judgments or waive regulatory requirements.",
      "Re-run affected checks whenever an input or section changes."
    ],
    mayUseExternalResearch: false,
    requiresHumanApproval: false
  },
  {
    role: "human_approver",
    stage: "human_approval",
    actor: "human",
    name: "TP Reviewer / Partner",
    objective: "Approve professional judgments and authorize an immutable final Local File version.",
    requiredInputs: ["QA-passed draft", "open issues", "decision log", "evidence appendix"],
    requiredOutputs: ["signed approval decision", "approved version identifier", "review notes"],
    guardrails: [
      "Approval must identify the reviewer, timestamp, reviewed version, and any accepted limitation.",
      "Any material change after approval creates a new version and invalidates the prior approval.",
      "AI agents cannot impersonate or substitute for the human approver."
    ],
    mayUseExternalResearch: false,
    requiresHumanApproval: true
  }
] as const;

export type TpEvidenceSourceType =
  | "uploaded_document"
  | "manual_input"
  | "official_regulation"
  | "public_filing"
  | "commercial_database"
  | "web_discovery"
  | "calculation";

export type TpEvidenceLocator = {
  page?: number;
  sheet?: string;
  cell?: string;
  section?: string;
  paragraph?: number;
  table?: string;
};

export type TpEvidenceRecord = {
  id: string;
  sourceType: TpEvidenceSourceType;
  sourceId: string;
  title: string;
  url?: string;
  sourceHash?: string;
  locator?: TpEvidenceLocator;
  excerpt?: string;
  fieldPaths: string[];
  confidentiality: "client_confidential" | "restricted" | "public";
  verificationStatus: "unverified" | "verified" | "rejected" | "conflicted";
  collectedBy: TpAgentRoleId | "human_user";
  collectedAt: string;
  verifiedBy?: TpAgentRoleId | "human_user";
  verifiedAt?: string;
};

export type TpFactRecord = {
  id: string;
  fieldPath: string;
  value: unknown;
  evidenceIds: string[];
  confidence: number;
  origin: "extracted" | "manual" | "calculated" | "researched";
  reviewStatus: "unreviewed" | "verified" | "rejected" | "conflicted";
};

export type TpClaimRecord = {
  id: string;
  sectionId: string;
  text: string;
  kind: "factual" | "legal" | "numeric" | "professional_judgment" | "assumption";
  evidenceIds: string[];
  verificationStatus: "unverified" | "verified" | "rejected" | "requires_human";
};

export type TpIssueSeverity = "info" | "warning" | "blocking";
export type TpIssueCategory =
  | "privacy"
  | "missing_input"
  | "conflict"
  | "source_quality"
  | "unsupported_claim"
  | "calculation"
  | "regulatory"
  | "professional_judgment"
  | "workflow";

export type TpWorkflowIssue = {
  id: string;
  code: string;
  stage: TpWorkflowStageId;
  category: TpIssueCategory;
  severity: TpIssueSeverity;
  title: string;
  description: string;
  fieldPath?: string;
  evidenceIds: string[];
  owner: TpAgentRoleId;
  status: "open" | "resolved" | "accepted_by_human";
  resolution?: string;
};

export type TpStageResultBase<TStage extends TpWorkflowStageId> = {
  workflowVersion: typeof TP_WORKFLOW_VERSION;
  stage: TStage;
  runId: string;
  inputVersion: string;
  createdAt: string;
  issues: TpWorkflowIssue[];
};

export type TpIntakeResult = TpStageResultBase<"intake"> & {
  documentIds: string[];
  recommendedScopes: string[];
  confidentialityConfirmed: boolean;
};

export type TpExtractionResult = TpStageResultBase<"extraction"> & {
  facts: TpFactRecord[];
  evidence: TpEvidenceRecord[];
  coveredScopes: string[];
};

export type TpGapAnalysisResult = TpStageResultBase<"gap_analysis"> & {
  requirementStatuses: Array<{ requirementId: string; status: "ready" | "partial" | "missing" | "not_applicable" }>;
  requestedDocuments: string[];
};

export type TpResearchResult = TpStageResultBase<"research"> & {
  researchBriefHash: string;
  outboundQueries: string[];
  evidence: TpEvidenceRecord[];
  limitations: string[];
};

export type TpVerificationResult = TpStageResultBase<"verification"> & {
  verifiedFactIds: string[];
  verifiedClaimIds: string[];
  /** Exact, page/sheet-located evidence records the verifier inspected and accepted. */
  verifiedEvidenceIds: string[];
  rejectedEvidenceIds: string[];
  calculationChecks: Array<{ id: string; passed: boolean; message: string }>;
};

export type TpDraftingResult = TpStageResultBase<"drafting"> & {
  sections: Array<{ id: string; title: string; content: string; claimIds: string[] }>;
  claims: TpClaimRecord[];
};

export type TpAssemblyResult = TpStageResultBase<"assembly"> & {
  documentVersion: string;
  templateVersion: string;
  sectionIds: string[];
  artifactId: string;
  workingDraft: true;
};

export type TpQaResult = TpStageResultBase<"qa"> & {
  checks: Array<{ id: string; passed: boolean; message: string }>;
  releaseRecommendation: "fail" | "human_review";
};

export type TpHumanApprovalResult = TpStageResultBase<"human_approval"> & {
  decision: "approved" | "changes_requested" | "rejected";
  reviewerId: string;
  reviewedDocumentVersion: string;
  approvedArtifactId?: string;
  notes: string;
};

export type TpStageResult =
  | TpIntakeResult
  | TpExtractionResult
  | TpGapAnalysisResult
  | TpResearchResult
  | TpVerificationResult
  | TpDraftingResult
  | TpAssemblyResult
  | TpQaResult
  | TpHumanApprovalResult;

export type TpGateId =
  | "intake_source_available"
  | "minimum_extraction"
  | "gap_assessment_recorded"
  | "research_privacy_approved"
  | "material_evidence_verified"
  | "draft_inputs_approved"
  | "draft_assembled"
  | "qa_passed"
  | "human_final_approval";

export type TpGateEvaluation = {
  id: TpGateId;
  stage: TpWorkflowStageId;
  passed: boolean;
  blocking: boolean;
  reasons: string[];
};

export type TpWorkflowContext = {
  /** Uploaded files that the current actor is authorized to access. */
  documentCount?: number;
  /** Successfully extracted documents; partial extraction still proceeds to gap analysis. */
  extractedDocumentCount?: number;
  externalResearchAllowed?: boolean;
  externalResearchApprovedBy?: string;
  evidence?: TpEvidenceRecord[];
  issues?: TpWorkflowIssue[];
  completedStages?: TpWorkflowStageId[];
  qaPassed?: boolean;
  approvedDocumentVersion?: string;
  currentDocumentVersion?: string;
};

export type TpPlannedStageStatus = "completed" | "ready" | "blocked" | "needs_attention" | "human_action";

export type TpPlannedStage = {
  stage: TpWorkflowStageId;
  role: TpAgentRoleId;
  actor: TpWorkflowActor;
  status: TpPlannedStageStatus;
  gate: TpGateEvaluation;
  dependsOn: TpWorkflowStageId[];
  reasons: string[];
  recommendedActions: string[];
};

export type TpWorkflowPlan = {
  version: typeof TP_WORKFLOW_VERSION;
  completeness: number;
  blockers: TpWorkflowIssue[];
  gates: TpGateEvaluation[];
  stages: TpPlannedStage[];
  nextStages: TpWorkflowStageId[];
  canFinalize: boolean;
};

const stageDependencies: Record<TpWorkflowStageId, TpWorkflowStageId[]> = {
  intake: [],
  extraction: ["intake"],
  gap_analysis: ["extraction"],
  research: ["gap_analysis"],
  verification: ["research"],
  drafting: ["verification"],
  assembly: ["drafting"],
  qa: ["assembly"],
  human_approval: ["qa"]
};

function nonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(nonEmpty);
  return typeof value === "string" ? Boolean(value.trim()) : value !== null && value !== undefined;
}

function issue(
  code: string,
  stage: TpWorkflowStageId,
  category: TpIssueCategory,
  severity: TpIssueSeverity,
  title: string,
  description: string,
  fieldPath?: string
): TpWorkflowIssue {
  const role = tpAgentDefinitions.find((agent) => agent.stage === stage)?.role ?? "quality_assurer";
  return {
    id: `${stage}:${code}${fieldPath ? `:${fieldPath}` : ""}`,
    code,
    stage,
    category,
    severity,
    title,
    description,
    fieldPath,
    evidenceIds: [],
    owner: role,
    status: "open"
  };
}

/**
 * Produces stable, state-derived issues. Persisted workflow issues can be added
 * through TpWorkflowContext and are deduplicated by id by the planner.
 */
export function deriveTpWorkflowIssues(state: TpProjectState, context: TpWorkflowContext = {}): TpWorkflowIssue[] {
  const issues: TpWorkflowIssue[] = [];
  if (!nonEmpty(state.companyName)) {
    issues.push(issue("MISSING_COMPANY_NAME", "intake", "missing_input", "blocking", "Company name is missing", "Identify the taxpayer from an uploaded source or manual input.", "companyName"));
  }
  if (!nonEmpty(state.fiscalYear)) {
    issues.push(issue("MISSING_FISCAL_YEAR", "intake", "missing_input", "blocking", "Fiscal year is missing", "Confirm the covered fiscal year before applying documentation requirements.", "fiscalYear"));
  }
  const hasSource = (context.documentCount ?? 0) > 0
    || Object.values(state.fieldSources).some((ids) => ids.length > 0)
    || (context.evidence ?? []).some((entry) => entry.sourceType === "manual_input" || entry.sourceType === "uploaded_document");
  if (!hasSource) {
    issues.push(issue("NO_SOURCE_DOCUMENT", "intake", "missing_input", "blocking", "No source document is registered", "Upload at least one financial statement or supporting document, or record manual evidence with provenance."));
  }

  if (!nonEmpty(state.financialData.revenue) && !nonEmpty(state.financialData.operatingProfit) && !nonEmpty(state.financialData.netIncome)) {
    issues.push(issue("MISSING_CURRENT_FINANCIALS", "extraction", "missing_input", "blocking", "Current-year financials are missing", "Extract or enter current-year financial statement figures.", "financialData"));
  }
  if (!nonEmpty(state.affiliatedTransactions) && !nonEmpty(state.transactionDetails)) {
    issues.push(issue("MISSING_CONTROLLED_TRANSACTIONS", "gap_analysis", "missing_input", "blocking", "Controlled transactions are not identified", "Provide the related-party ledger, agreements, or a manual transaction register.", "affiliatedTransactions"));
  }
  if (!nonEmpty(state.businessActivities)) {
    issues.push(issue("MISSING_BUSINESS_DESCRIPTION", "research", "missing_input", "blocking", "Business activities are missing", "A business description is required to create a non-identifying research brief.", "businessActivities"));
  }
  if (!nonEmpty(state.selectedMethod) || !nonEmpty(state.selectedPli) || !nonEmpty(state.testedParty)) {
    issues.push(issue("MISSING_METHOD_DECISION", "drafting", "professional_judgment", "blocking", "Method, PLI, or tested party is incomplete", "A TP advisor must select and justify the method, PLI, and tested party.", "selectedMethod"));
  }
  if (!nonEmpty(state.comparableCompanies) || !nonEmpty(state.searchCriteriaResults) || !nonEmpty(state.rejectionMatrix)) {
    issues.push(issue("INCOMPLETE_BENCHMARK_SUPPORT", "verification", "source_quality", "blocking", "Benchmark support is incomplete", "Record the search trail, acceptance/rejection screening, and comparable data before relying on a range."));
  }
  if (state.analysis.externalComparableCandidates.some((candidate) => candidate.screeningStatus !== "exclude")) {
    issues.push(issue("PRELIMINARY_EXTERNAL_COMPARABLES", "verification", "source_quality", "blocking", "External comparable candidates remain preliminary", "Verify identity, business activity, independence, and financial screening before use."));
  }
  if (!nonEmpty(state.analysis.executiveSummary) || !nonEmpty(state.analysis.functionalAnalysis) || !nonEmpty(state.analysis.conclusion)) {
    issues.push(issue("INCOMPLETE_DRAFT_SECTIONS", "drafting", "workflow", "blocking", "Core Local File sections are incomplete", "Draft the executive summary, functional analysis, and supported conclusion."));
  }

  return dedupeIssues([...issues, ...(context.issues ?? [])]).filter((entry) => entry.status === "open");
}

function dedupeIssues(issues: TpWorkflowIssue[]): TpWorkflowIssue[] {
  const byId = new Map<string, TpWorkflowIssue>();
  for (const entry of issues) byId.set(entry.id, entry);
  return Array.from(byId.values());
}

function hasVerifiedLocatedEvidence(evidence: TpEvidenceRecord[]): boolean {
  return evidence.some((entry) =>
    entry.verificationStatus === "verified"
    && entry.fieldPaths.length > 0
    && Boolean(entry.excerpt?.trim())
    && Boolean(entry.locator && Object.values(entry.locator).some(nonEmpty))
  );
}

export function evaluateTpWorkflowGates(state: TpProjectState, context: TpWorkflowContext = {}): TpGateEvaluation[] {
  const completed = new Set(context.completedStages ?? []);
  const issues = deriveTpWorkflowIssues(state, context);
  const stageHasOpenBlocker = (stage: TpWorkflowStageId) => issues.some((entry) => entry.stage === stage && entry.severity === "blocking");
  const hasManualOrDocumentData = (context.documentCount ?? 0) > 0
    || Object.values(state.fieldSources).some((ids) => ids.length > 0)
    || (context.evidence ?? []).some((entry) => entry.sourceType === "manual_input" || entry.sourceType === "uploaded_document");
  const hasMinimumExtraction = nonEmpty(state.companyName)
    && nonEmpty(state.fiscalYear)
    && (nonEmpty(state.financialData) || nonEmpty(state.affiliatedTransactions) || nonEmpty(state.businessActivities));
  const privacyApproved = context.externalResearchAllowed !== true || Boolean(context.externalResearchApprovedBy?.trim());
  const verifiedLocatedEvidence = hasVerifiedLocatedEvidence(context.evidence ?? []);
  const readiness = tpGenerationReadiness(state);
  const currentVersionApproved = Boolean(
    context.approvedDocumentVersion
    && context.currentDocumentVersion
    && context.approvedDocumentVersion === context.currentDocumentVersion
  );

  return [
    {
      id: "intake_source_available",
      stage: "intake",
      passed: hasManualOrDocumentData && !stageHasOpenBlocker("intake"),
      blocking: true,
      reasons: hasManualOrDocumentData ? [] : ["No authorized source document or manual evidence is registered."]
    },
    {
      id: "minimum_extraction",
      stage: "extraction",
      passed: hasMinimumExtraction && !stageHasOpenBlocker("extraction"),
      blocking: true,
      reasons: hasMinimumExtraction ? [] : ["Company, fiscal-year, and at least one substantive data area are required."]
    },
    {
      id: "gap_assessment_recorded",
      stage: "gap_analysis",
      passed: completed.has("gap_analysis"),
      blocking: true,
      reasons: completed.has("gap_analysis") ? [] : ["A requirement and missing-document assessment has not been recorded."]
    },
    {
      id: "research_privacy_approved",
      stage: "research",
      passed: completed.has("research") && privacyApproved,
      blocking: true,
      reasons: [
        ...(completed.has("research") ? [] : ["Research results have not been recorded."]),
        ...(privacyApproved ? [] : ["External research requires recorded human approval of the sanitized brief."])
      ]
    },
    {
      id: "material_evidence_verified",
      stage: "verification",
      passed: completed.has("verification") && verifiedLocatedEvidence && !stageHasOpenBlocker("verification"),
      blocking: true,
      reasons: [
        ...(completed.has("verification") ? [] : ["Verification has not been completed."]),
        ...(verifiedLocatedEvidence ? [] : ["No verified evidence has both an excerpt and a precise locator."]),
        ...(stageHasOpenBlocker("verification") ? ["Verification has unresolved blocking issues."] : [])
      ]
    },
    {
      id: "draft_inputs_approved",
      stage: "drafting",
      passed: completed.has("drafting") && readiness.blockers.length === 0 && !stageHasOpenBlocker("drafting"),
      blocking: true,
      reasons: [
        ...(completed.has("drafting") ? [] : ["Drafting has not been completed."]),
        ...(readiness.blockers.length ? [`${readiness.blockers.length} Local File readiness requirement(s) remain open.`] : []),
        ...(stageHasOpenBlocker("drafting") ? ["Drafting has unresolved blocking issues."] : [])
      ]
    },
    {
      id: "draft_assembled",
      stage: "assembly",
      passed: completed.has("assembly"),
      blocking: true,
      reasons: completed.has("assembly") ? [] : ["A versioned working draft has not been assembled."]
    },
    {
      id: "qa_passed",
      stage: "qa",
      passed: completed.has("qa") && context.qaPassed === true && !stageHasOpenBlocker("qa"),
      blocking: true,
      reasons: [
        ...(completed.has("qa") && context.qaPassed === true ? [] : ["QA has not passed for the current draft."]),
        ...(stageHasOpenBlocker("qa") ? ["QA has unresolved blocking issues."] : [])
      ]
    },
    {
      id: "human_final_approval",
      stage: "human_approval",
      passed: completed.has("human_approval") && currentVersionApproved,
      blocking: true,
      reasons: currentVersionApproved ? [] : ["The current document version has not been approved by a human reviewer."]
    }
  ];
}

function inferredCompletedStages(state: TpProjectState, context: TpWorkflowContext): Set<TpWorkflowStageId> {
  const completed = new Set(context.completedStages ?? []);
  const hasSource = (context.documentCount ?? 0) > 0
    || Object.values(state.fieldSources).some((ids) => ids.length > 0)
    || (context.evidence ?? []).some((entry) => entry.sourceType === "manual_input" || entry.sourceType === "uploaded_document");
  if (hasSource && nonEmpty(state.companyName) && nonEmpty(state.fiscalYear)) completed.add("intake");
  if (
    completed.has("intake")
    && nonEmpty(state.financialData)
    && (context.extractedDocumentCount ?? 0) > 0
  ) completed.add("extraction");
  return completed;
}

function actionsFor(stage: TpWorkflowStageId, issues: TpWorkflowIssue[], context: TpWorkflowContext): string[] {
  const relevant = issues.filter((entry) => entry.stage === stage && entry.status === "open");
  if (relevant.length) return relevant.map((entry) => entry.description);
  switch (stage) {
    case "intake": return ["Upload a financial statement and any related-party agreements or enter sourced facts manually."];
    case "extraction": return ["Extract structured facts with page-level evidence and preserve conflicts."];
    case "gap_analysis": return ["Generate the requirement matrix and prioritized missing-document request."];
    case "research": return context.externalResearchAllowed
      ? ["Approve the sanitized brief, then run official-law, industry, and comparable discovery searches."]
      : ["Perform manual research or explicitly opt in to sanitized external research."];
    case "verification": return ["Verify material claims, locators, comparable attributes, and calculations."];
    case "drafting": return ["Record advisor decisions and draft only from verified evidence."];
    case "assembly": return ["Assemble a versioned, watermarked working draft and evidence appendix."];
    case "qa": return ["Run completeness, citation, consistency, arithmetic, and rendering QA."];
    case "human_approval": return ["Have an authorized reviewer approve the exact QA-passed version."];
  }
}

/**
 * Deterministically plans the next TP workers. It does not call a model and it
 * never infers that research, verification, drafting, QA, or approval occurred
 * merely because prose is present in TpProjectState.
 */
export function planTpAgentWorkflow(state: TpProjectState, context: TpWorkflowContext = {}): TpWorkflowPlan {
  const inferredCompleted = inferredCompletedStages(state, context);
  const effectiveContext = { ...context, completedStages: Array.from(inferredCompleted) };
  const issues = deriveTpWorkflowIssues(state, effectiveContext);
  const gates = evaluateTpWorkflowGates(state, effectiveContext);
  const completed = new Set(effectiveContext.completedStages ?? []);
  const accepted = new Set(
    gates
      .filter((gate) => gate.passed && completed.has(gate.stage))
      .map((gate) => gate.stage)
  );

  const stages = tpAgentDefinitions.map<TpPlannedStage>((agent) => {
    const dependencies = stageDependencies[agent.stage];
    const dependenciesComplete = dependencies.every((stage) => accepted.has(stage));
    const gate = gates.find((entry) => entry.stage === agent.stage)!;
    let status: TpPlannedStageStatus;
    if (completed.has(agent.stage) && gate.passed) {
      status = "completed";
    } else if (completed.has(agent.stage) && agent.actor === "human") {
      status = "human_action";
    } else if (completed.has(agent.stage)) {
      status = "needs_attention";
    } else if (!dependenciesComplete) {
      status = "blocked";
    } else if (agent.actor === "human") {
      status = "human_action";
    } else {
      status = "ready";
    }
    return {
      stage: agent.stage,
      role: agent.role,
      actor: agent.actor,
      status,
      gate,
      dependsOn: dependencies,
      reasons: status === "blocked"
        ? [`Waiting for accepted gate(s): ${dependencies.filter((stage) => !accepted.has(stage)).join(", ")}.`]
        : gate.reasons,
      recommendedActions: status === "completed" ? [] : actionsFor(agent.stage, issues, effectiveContext)
    };
  });

  return {
    version: TP_WORKFLOW_VERSION,
    completeness: tpProjectCompleteness(state),
    blockers: issues.filter((entry) => entry.severity === "blocking"),
    gates,
    stages,
    nextStages: stages
      .filter((stage) => stage.status === "ready" || stage.status === "needs_attention" || stage.status === "human_action")
      .map((stage) => stage.stage),
    canFinalize: gates.every((gate) => gate.passed)
  };
}
