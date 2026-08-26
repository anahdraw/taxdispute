import { createHash } from "crypto";
import {
  buildTpResearchQueries,
  type TpExternalResearchBundle
} from "./tavily";
import {
  tpGenerationReadiness,
  tpProjectCompleteness,
  tpProjectStatusAfterAnalysis,
  type TpExternalComparableCandidate,
  type TpExternalResearchSource,
  type TpLocalFileProject,
  type TpProjectState,
  type TpProjectStatus
} from "./tp-local-file";
import {
  TP_WORKFLOW_VERSION,
  deriveTpWorkflowIssues,
  planTpAgentWorkflow,
  tpAgentDefinitions,
  type TpAssemblyResult,
  type TpClaimRecord,
  type TpEvidenceRecord,
  type TpExtractionResult,
  type TpFactRecord,
  type TpGapAnalysisResult,
  type TpIntakeResult,
  type TpQaResult,
  type TpVerificationResult,
  type TpWorkflowIssue,
  type TpWorkflowPlan,
  type TpWorkflowStageId
} from "./tp-agent-workflow";

/**
 * Stateless runner for the first production-shaped TP workflow.
 *
 * The runner never talks to the database or a model. It performs the safe,
 * deterministic work locally and emits narrowly scoped prompts that a queue
 * worker may send to an approved model or use as a manual work instruction.
 */
export const TP_AGENT_RUNTIME_VERSION = "tp-agent-runtime-v1" as const;

export type TpAgentPrompt = {
  stage: "research" | "verification" | "drafting";
  role: "research_analyst" | "evidence_verifier" | "local_file_drafter";
  system: string;
  input: string;
  outputSchema: Record<string, unknown>;
  containsClientConfidentialData: boolean;
  externalUseAllowed: boolean;
};

export type TpRuntimeResearchOutput = {
  status: TpExternalResearchBundle["status"];
  summary: string;
  sources: TpExternalResearchSource[];
  candidates: TpExternalComparableCandidate[];
  warnings: string[];
};

export type TpRuntimeDraftSectionId =
  | "executive_summary"
  | "industry_analysis"
  | "business_characterization"
  | "functional_analysis"
  | "method_selection"
  | "pli_selection"
  | "comparability_analysis"
  | "conclusion";

export type TpRuntimeDraftingOutput = {
  sections: Array<{ id: TpRuntimeDraftSectionId; title: string; content: string; claimIds: string[] }>;
  claims: TpClaimRecord[];
  issues: TpWorkflowIssue[];
};

export type TpRuntimeDocumentInventoryItem = {
  id: string;
  filename: string;
  kind: string;
  status: string;
  scopes: string[];
  coverage: { found: number; partial: number; notFound: number };
};

export type TpRuntimeIntakeResult = TpIntakeResult & {
  inventory: TpRuntimeDocumentInventoryItem[];
};

export type TpRuntimeExtractionResult = TpExtractionResult & {
  populatedFieldCount: number;
  sourcedFieldCount: number;
  verifiedFieldCount: number;
  documentSummaries: Array<{
    documentId: string;
    filename: string;
    status: string;
    detectedScopes: string[];
    coverage: string[];
  }>;
};

export type TpRuntimeGapResult = TpGapAnalysisResult & {
  completeness: number;
  criticalRequirementIds: string[];
};

export type TpRuntimeAssemblySection = {
  id: string;
  title: string;
  content: string;
  status: "populated" | "partial" | "missing";
  claimIds: string[];
};

export type TpRuntimeAssemblyResult = TpAssemblyResult & {
  sections: TpRuntimeAssemblySection[];
  inputHash: string;
  unresolvedIssueIds: string[];
};

export type TpRuntimeQaResult = TpQaResult & {
  blockerCount: number;
  warningCount: number;
};

export type TpAgentRuntimeOptions = {
  now?: string | Date;
  /** Page/sheet-located evidence supplied by extraction or a human user. */
  evidence?: TpEvidenceRecord[];
  /** Optional result returned by the research worker. It is normalized again before use. */
  researchOutput?: unknown;
  /** Sources actually returned by the approved search connector/manual register. Model-added URLs are rejected. */
  canonicalResearchSources?: TpExternalResearchSource[];
  /** Optional result returned by the evidence-verification worker. */
  verificationOutput?: unknown;
  /** Optional result returned by the drafting worker. */
  draftingOutput?: unknown;
  externalResearchAllowed?: boolean;
  externalResearchApprovedBy?: string;
};

export type TpLegacyProjectUpdate = {
  state: TpProjectState;
  status: TpProjectStatus;
  updatedAt: string;
};

export type TpAgentRuntimeResult = {
  runtimeVersion: typeof TP_AGENT_RUNTIME_VERSION;
  workflowVersion: typeof TP_WORKFLOW_VERSION;
  runId: string;
  inputVersion: string;
  createdAt: string;
  stages: {
    intake: TpRuntimeIntakeResult;
    extraction: TpRuntimeExtractionResult;
    gapAnalysis: TpRuntimeGapResult;
    assembly: TpRuntimeAssemblyResult;
    qa: TpRuntimeQaResult;
  };
  agentWork: {
    research: TpAgentPrompt;
    verification: TpAgentPrompt;
    drafting: TpAgentPrompt;
  };
  normalizedAgentOutputs: {
    research?: TpRuntimeResearchOutput;
    verification?: TpVerificationResult;
    drafting?: TpRuntimeDraftingOutput;
  };
  workflowPlan: TpWorkflowPlan;
  legacyUpdate: TpLegacyProjectUpdate;
};

const draftSectionMap: Record<TpRuntimeDraftSectionId, keyof TpProjectState["analysis"]> = {
  executive_summary: "executiveSummary",
  industry_analysis: "industryAnalysis",
  business_characterization: "businessCharacterization",
  functional_analysis: "functionalAnalysis",
  method_selection: "methodSelectionJustification",
  pli_selection: "pliSelectionRationale",
  comparability_analysis: "comparabilityAnalysis",
  conclusion: "conclusion"
};

const draftSectionTitles: Record<TpRuntimeDraftSectionId, string> = {
  executive_summary: "Ringkasan Eksekutif",
  industry_analysis: "Analisis Industri",
  business_characterization: "Karakterisasi Usaha",
  functional_analysis: "Analisis Fungsi, Aset, dan Risiko",
  method_selection: "Pemilihan Metode",
  pli_selection: "Pemilihan Profit Level Indicator",
  comparability_analysis: "Analisis Kesebandingan",
  conclusion: "Kesimpulan"
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function hash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function clean(value: unknown, limit = 12_000) {
  return String(value ?? "").replace(/\\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, limit);
}

function stringArray(value: unknown, limit = 100) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => clean(entry, 1_000)).filter(Boolean))).slice(0, limit);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(nonEmpty);
  return typeof value === "string" ? Boolean(value.trim()) : value !== null && value !== undefined;
}

function validUrl(value: unknown) {
  try {
    const url = new URL(clean(value, 2_000));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function timestamp(value?: string | Date) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("TpAgentRuntimeOptions.now must be a valid date.");
  return date.toISOString();
}

function issue(
  stage: TpWorkflowStageId,
  code: string,
  severity: TpWorkflowIssue["severity"],
  category: TpWorkflowIssue["category"],
  title: string,
  description: string,
  fieldPath?: string
): TpWorkflowIssue {
  const role = tpAgentDefinitions.find((entry) => entry.stage === stage)?.role ?? "quality_assurer";
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

function dedupeIssues(entries: TpWorkflowIssue[]) {
  return Array.from(new Map(entries.map((entry) => [entry.id, entry])).values());
}

function isLocated(evidence: TpEvidenceRecord) {
  return Boolean(
    clean(evidence.excerpt)
    && evidence.locator
    && Object.values(evidence.locator).some(nonEmpty)
  );
}

function normalizedEvidence(value: TpEvidenceRecord[], now: string) {
  const allowedSourceTypes = new Set<TpEvidenceRecord["sourceType"]>([
    "uploaded_document", "manual_input", "official_regulation", "public_filing",
    "commercial_database", "web_discovery", "calculation"
  ]);
  const allowedConfidentiality = new Set<TpEvidenceRecord["confidentiality"]>(["client_confidential", "restricted", "public"]);
  return value.flatMap<TpEvidenceRecord>((entry, index) => {
    const sourceType = allowedSourceTypes.has(entry.sourceType) ? entry.sourceType : undefined;
    const sourceId = clean(entry.sourceId, 240);
    const title = clean(entry.title, 500);
    if (!sourceType || !sourceId || !title) return [];
    const verified = entry.verificationStatus === "verified" && isLocated(entry) && Boolean(clean(entry.verifiedBy));
    const normalized: TpEvidenceRecord = {
      id: clean(entry.id, 240) || `evidence-${hash({ sourceType, sourceId, index }).slice(0, 16)}`,
      sourceType,
      sourceId,
      title,
      url: validUrl(entry.url) || undefined,
      sourceHash: /^[a-f0-9]{64}$/i.test(clean(entry.sourceHash)) ? clean(entry.sourceHash).toLowerCase() : undefined,
      locator: entry.locator && typeof entry.locator === "object" ? structuredClone(entry.locator) : undefined,
      excerpt: clean(entry.excerpt, 4_000) || undefined,
      fieldPaths: stringArray(entry.fieldPaths, 200),
      confidentiality: allowedConfidentiality.has(entry.confidentiality) ? entry.confidentiality : "client_confidential",
      verificationStatus: verified ? "verified" :
        entry.verificationStatus === "rejected" || entry.verificationStatus === "conflicted" ? entry.verificationStatus : "unverified",
      collectedBy: entry.collectedBy,
      collectedAt: clean(entry.collectedAt) || now,
      verifiedBy: verified ? entry.verifiedBy : undefined,
      verifiedAt: verified ? clean(entry.verifiedAt) || now : undefined
    };
    return [normalized];
  });
}

function sourceIdsForPath(state: TpProjectState, path: string) {
  const parts = path.split(".");
  for (let length = parts.length; length > 0; length -= 1) {
    const candidate = parts.slice(0, length).join(".");
    const ids = state.fieldSources[candidate];
    if (ids?.length) return ids;
  }
  return [];
}

function flattenFacts(value: unknown, path = "", output: Array<{ path: string; value: unknown }> = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenFacts(entry, `${path}.${index}`, output));
    return output;
  }
  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      if (!path && (key === "fieldSources" || key === "mergeConflicts" || key === "manualEvidence" || key === "analysis")) return;
      flattenFacts(entry, path ? `${path}.${key}` : key, output);
    });
    return output;
  }
  if (path && nonEmpty(value)) output.push({ path, value });
  return output;
}

function createDocumentEvidence(project: TpLocalFileProject, fields: Array<{ path: string; value: unknown }>, now: string) {
  return project.documents.flatMap<TpEvidenceRecord>((document) => {
    const extractedEvidence = document.evidence || [];
    if (extractedEvidence.length) {
      return extractedEvidence.map((entry) => ({
        id: entry.id || `document-evidence-${hash({ documentId: document.id, entry }).slice(0, 16)}`,
        sourceType: "uploaded_document",
        sourceId: document.id,
        title: document.filename,
        fieldPaths: entry.fieldPaths,
        locator: {
          ...(entry.page ? { page: entry.page } : {}),
          ...(entry.section ? { section: entry.section } : {}),
          ...(entry.table ? { table: entry.table } : {})
        },
        excerpt: entry.excerpt,
        confidentiality: "client_confidential",
        verificationStatus: "unverified",
        collectedBy: "document_extractor",
        collectedAt: document.extractedAt || document.uploadedAt || now
      }));
    }
    return [{
      id: `document-evidence-${hash(document.id).slice(0, 16)}`,
      sourceType: "uploaded_document",
      sourceId: document.id,
      title: document.filename,
      fieldPaths: fields.filter((field) => sourceIdsForPath(project.state, field.path).includes(document.id)).map((field) => field.path),
      confidentiality: "client_confidential",
      verificationStatus: "unverified",
      collectedBy: "document_extractor",
      collectedAt: document.extractedAt || document.uploadedAt || now
    }];
  });
}

function createManualEvidence(project: TpLocalFileProject, now: string): TpEvidenceRecord[] {
  return project.state.manualEvidence.map((entry): TpEvidenceRecord => ({
    id: entry.id,
    sourceType: entry.sourceKind === "manual_calculation" ? "calculation" : "manual_input",
    sourceId: entry.reference || entry.id,
    title: entry.title,
    sourceHash: hash({
      sourceKind: entry.sourceKind,
      reference: entry.reference,
      locator: entry.locator,
      excerpt: entry.excerpt,
      fieldPaths: entry.fieldPaths
    }),
    locator: entry.locator ? { section: entry.locator } : undefined,
    excerpt: entry.excerpt || undefined,
    fieldPaths: entry.fieldPaths,
    confidentiality: "client_confidential",
    verificationStatus: "unverified",
    collectedBy: "human_user",
    collectedAt: entry.createdAt || now
  }));
}

function createExtraction(project: TpLocalFileProject, suppliedEvidence: TpEvidenceRecord[], base: Omit<TpExtractionResult, "facts" | "evidence" | "coveredScopes">): TpRuntimeExtractionResult {
  const fields = flattenFacts(project.state);
  const now = base.createdAt;
  const documentEvidence = createDocumentEvidence(project, fields, now);
  const evidenceById = new Map<string, TpEvidenceRecord>();
  [...documentEvidence, ...suppliedEvidence].forEach((entry) => evidenceById.set(entry.id, entry));
  const evidence = Array.from(evidenceById.values());
  const evidenceForField = (path: string) => evidence.filter((entry) =>
    entry.fieldPaths.includes(path)
    || entry.fieldPaths.some((candidate) => path.startsWith(`${candidate}.`))
  );
  const facts = fields.map<TpFactRecord>((field) => {
    const supporting = evidenceForField(field.path);
    const verified = supporting.some((entry) => entry.verificationStatus === "verified" && isLocated(entry));
    const extracted = supporting.some((entry) => entry.sourceType === "uploaded_document");
    return {
      id: `fact-${hash({ path: field.path, value: field.value }).slice(0, 20)}`,
      fieldPath: field.path,
      value: field.value,
      evidenceIds: supporting.map((entry) => entry.id),
      confidence: verified ? 1 : extracted ? 0.75 : 0.5,
      origin: extracted ? "extracted" : "manual",
      reviewStatus: verified ? "verified" : "unreviewed"
    };
  });
  const scopes = Array.from(new Set(project.documents.flatMap((document) => document.detectedScopes || document.requestedScopes || [])));
  const unsourced = facts.filter((fact) => fact.evidenceIds.length === 0);
  const issues = [...base.issues];
  if (unsourced.length) {
    issues.push(issue(
      "extraction",
      "UNSOURCED_FIELDS",
      "warning",
      "unsupported_claim",
      `${unsourced.length} populated field(s) have no evidence link`,
      "Link manually entered values to an uploaded document, manual evidence note, page, sheet, or section before verification."
    ));
  }
  return {
    ...base,
    issues: dedupeIssues(issues),
    facts,
    evidence,
    coveredScopes: scopes,
    populatedFieldCount: facts.length,
    sourcedFieldCount: facts.filter((fact) => fact.evidenceIds.length > 0).length,
    verifiedFieldCount: facts.filter((fact) => fact.reviewStatus === "verified").length,
    documentSummaries: project.documents.map((document) => ({
      documentId: document.id,
      filename: document.filename,
      status: document.status,
      detectedScopes: document.detectedScopes || [],
      coverage: (document.coverage || []).map((entry) => `${entry.scope}:${entry.status}`)
    }))
  };
}

function createIntake(project: TpLocalFileProject, base: Omit<TpIntakeResult, "documentIds" | "recommendedScopes" | "confidentialityConfirmed">): TpRuntimeIntakeResult {
  const inventory = project.documents.map<TpRuntimeDocumentInventoryItem>((document) => ({
    id: document.id,
    filename: document.filename,
    kind: document.kind,
    status: document.status,
    scopes: Array.from(new Set([...(document.requestedScopes || []), ...(document.detectedScopes || [])])),
    coverage: {
      found: (document.coverage || []).filter((entry) => entry.status === "found").length,
      partial: (document.coverage || []).filter((entry) => entry.status === "partial").length,
      notFound: (document.coverage || []).filter((entry) => entry.status === "not_found").length
    }
  }));
  const issues = [...base.issues];
  project.documents.filter((document) => document.status === "failed").forEach((document) => {
    issues.push(issue("intake", "DOCUMENT_FAILED", "warning", "workflow", `Extraction failed for ${document.filename}`, document.extractionMessage || "Retry extraction or replace the document."));
  });
  return {
    ...base,
    issues: dedupeIssues(issues),
    documentIds: project.documents.map((document) => document.id),
    recommendedScopes: Array.from(new Set(inventory.flatMap((entry) => entry.scopes))),
    confidentialityConfirmed: true,
    inventory
  };
}

function requestedDocumentName(scopes: string[], requirement: { idLabel: string }) {
  const labels: Record<string, string> = {
    identity: "Akta/profil perusahaan dan identitas wajib pajak",
    ownership_management: "Daftar pemegang saham, manajemen, dan organisasi",
    related_parties: "Daftar pihak berelasi dan hubungan istimewa",
    business_operations: "Profil usaha, produk, strategi, dan rantai nilai",
    organization: "Bagan organisasi dan reporting lines",
    controlled_transactions: "Ledger transaksi afiliasi, invoice, dan rekonsiliasi",
    financial_current: "Laporan keuangan tahun berjalan",
    financial_prior: "Laporan keuangan tahun sebelumnya",
    tp_policy: "Perjanjian afiliasi dan kebijakan transfer pricing",
    comparables: "Search log, rejection matrix, dan data pembanding",
    non_financial: "Informasi peristiwa non-keuangan material"
  };
  return scopes.map((scope) => labels[scope]).filter(Boolean).join("; ") || requirement.idLabel;
}

function createGapAnalysis(state: TpProjectState, base: Omit<TpGapAnalysisResult, "requirementStatuses" | "requestedDocuments">): TpRuntimeGapResult {
  const readiness = tpGenerationReadiness(state);
  const requestedDocuments = Array.from(new Set(
    readiness.requirements
      .filter((entry) => entry.status !== "ready" && entry.category !== "advisor" && entry.category !== "template")
      .map((entry) => requestedDocumentName(entry.expectedSources, entry))
  ));
  const issues = [...base.issues];
  readiness.blockers.forEach((requirement) => {
    issues.push(issue(
      "gap_analysis",
      "REQUIREMENT_NOT_READY",
      "blocking",
      requirement.category === "advisor" ? "professional_judgment" : "missing_input",
      requirement.idLabel,
      requirement.category === "advisor"
        ? "Advisor wajib melengkapi dan menyetujui keputusan profesional ini sebelum finalisasi."
        : `Lengkapi dari sumber yang sesuai: ${requestedDocumentName(requirement.expectedSources, requirement)}.`,
      requirement.paths[0]
    ));
  });
  return {
    ...base,
    issues: dedupeIssues(issues),
    requirementStatuses: readiness.requirements.map((entry) => ({
      requirementId: entry.id,
      status: entry.status
    })),
    requestedDocuments,
    completeness: tpProjectCompleteness(state),
    criticalRequirementIds: readiness.blockers.map((entry) => entry.id)
  };
}

function sourceTier(value: unknown): TpExternalResearchSource["qualityTier"] {
  return value === "primary_official" || value === "exchange_or_filing" || value === "credible_secondary"
    ? value
    : "discovery_only";
}

function sourceType(value: unknown): TpExternalResearchSource["sourceType"] {
  return value === "official" || value === "industry" ? value : "comparable_candidate";
}

/** Normalizes model/manual research output; no source is considered verified here. */
export function normalizeTpResearchAgentOutput(
  value: unknown,
  state: TpProjectState,
  nowValue?: string | Date,
  canonicalResearchSources?: TpExternalResearchSource[]
): TpRuntimeResearchOutput {
  const now = timestamp(nowValue);
  const record = object(value);
  const rawSources = Array.isArray(record.sources) ? record.sources : [];
  const canonicalByUrl = canonicalResearchSources
    ? new Map(canonicalResearchSources.flatMap((source) => {
        const url = validUrl(source.url);
        return url ? [[url, source] as const] : [];
      }))
    : undefined;
  const sources = rawSources.flatMap<TpExternalResearchSource>((raw) => {
    const source = object(raw);
    const url = validUrl(source.url);
    const canonical = url && canonicalByUrl ? canonicalByUrl.get(url) : undefined;
    if (canonicalByUrl && !canonical) return [];
    const title = clean(canonical?.title ?? source.title, 500);
    if (!url || !title) return [];
    const query = clean(canonical?.query ?? source.query, 1_500);
    const allowedQueries = buildTpResearchQueries(state).map((entry) => entry.query);
    return [{
      title,
      url,
      domain: (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })(),
      sourceType: sourceType(canonical?.sourceType ?? source.sourceType),
      query: allowedQueries.includes(query) ? query : "",
      snippet: clean(canonical?.snippet ?? source.snippet, 4_000),
      score: Number.isFinite(Number(canonical?.score ?? source.score)) ? Math.max(0, Math.min(1, Number(canonical?.score ?? source.score))) : 0,
      qualityTier: sourceTier(canonical?.qualityTier ?? source.qualityTier),
      qualityReason: clean(canonical?.qualityReason ?? source.qualityReason, 800) || "Quality classification requires verification.",
      publishedDate: clean(canonical?.publishedDate ?? source.publishedDate, 80),
      retrievedAt: clean(canonical?.retrievedAt ?? source.retrievedAt, 80) || now
    }];
  });
  const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
  const rawCandidates = Array.isArray(record.candidates) ? record.candidates : [];
  const candidates = rawCandidates.flatMap<TpExternalComparableCandidate>((raw) => {
    const candidate = object(raw);
    const name = clean(candidate.name, 300);
    const sourceUrl = validUrl(candidate.sourceUrl);
    const source = sourceByUrl.get(sourceUrl);
    if (!name || !source || source.sourceType !== "comparable_candidate") return [];
    const sourceText = `${source.title} ${source.snippet}`.toLocaleLowerCase("en-US");
    const nameTokens = name.toLocaleLowerCase("en-US").split(/[^a-z0-9]+/).filter((token) => token.length > 2);
    const nameSupported = nameTokens.length > 0 && nameTokens.every((token) => sourceText.includes(token));
    return [{
      name,
      country: clean(candidate.country, 120),
      businessDescription: clean(candidate.businessDescription, 1_500),
      matchRationale: clean(candidate.matchRationale, 1_500),
      keyDifferences: stringArray(candidate.keyDifferences, 30),
      sourceTitle: source.title,
      sourceUrl: source.url,
      sourceScore: source.score,
      sourceQuality: source.qualityTier,
      screeningStatus: nameSupported ? "needs_financial_screening" : "exclude",
      limitation: nameSupported
        ? "Discovery lead only; identity, independence, controlled transactions, financial data, and quantitative screens require advisor verification."
        : "Excluded automatically because the cited source text does not support the proposed entity name."
    }];
  });
  const warnings = stringArray(record.warnings, 100);
  if (candidates.some((candidate) => candidate.screeningStatus === "exclude")) {
    warnings.push("One or more proposed comparables were excluded because their cited source did not support the entity name.");
  }
  const requestedStatus = clean(record.status);
  const status: TpRuntimeResearchOutput["status"] = !sources.length
    ? requestedStatus === "not_configured" ? "not_configured" : "failed"
    : warnings.length ? "partial" : "completed";
  return {
    status,
    summary: clean(record.summary, 8_000),
    sources: Array.from(new Map(sources.map((source) => [source.url, source])).values()),
    candidates,
    warnings: Array.from(new Set(warnings))
  };
}

/** Verification output cannot elevate evidence unless the cited evidence is precisely located. */
export function normalizeTpVerificationAgentOutput(
  value: unknown,
  evidence: TpEvidenceRecord[],
  facts: TpFactRecord[],
  inputVersion: string,
  nowValue?: string | Date
): TpVerificationResult {
  const now = timestamp(nowValue);
  const record = object(value);
  const eligibleEvidenceIds = new Set(evidence.filter(isLocated).map((entry) => entry.id));
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const requestedFactIds = stringArray(record.verifiedFactIds, 2_000);
  const verifiedFactIds = requestedFactIds.filter((id) => factById.get(id)?.evidenceIds.some((evidenceId) => eligibleEvidenceIds.has(evidenceId)));
  const verifiedClaimIds = stringArray(record.verifiedClaimIds, 2_000);
  const rejectedEvidenceIds = stringArray(record.rejectedEvidenceIds, 2_000).filter((id) => evidence.some((entry) => entry.id === id));
  const citedEvidenceIds = stringArray(record.verifiedEvidenceIds, 2_000);
  const verifiedEvidenceIds = citedEvidenceIds.filter((id) => eligibleEvidenceIds.has(id));
  const unsupported = citedEvidenceIds.filter((id) => !eligibleEvidenceIds.has(id));
  const unsupportedFacts = requestedFactIds.filter((id) => !verifiedFactIds.includes(id));
  const calculations = Array.isArray(record.calculationChecks) ? record.calculationChecks : [];
  const issues: TpWorkflowIssue[] = unsupported.length || unsupportedFacts.length ? [issue(
    "verification",
    "UNLOCATED_EVIDENCE_REJECTED",
    "blocking",
    "unsupported_claim",
    "Verification cited evidence without a precise locator",
    `Rejected evidence IDs: ${unsupported.join(", ") || "none"}; unsupported fact IDs: ${unsupportedFacts.join(", ") || "none"}`
  )] : [];
  return {
    workflowVersion: TP_WORKFLOW_VERSION,
    stage: "verification",
    runId: `verification-${inputVersion.slice(0, 16)}`,
    inputVersion,
    createdAt: now,
    issues,
    verifiedFactIds,
    verifiedClaimIds: unsupported.length ? [] : verifiedClaimIds,
    verifiedEvidenceIds: Array.from(new Set(verifiedEvidenceIds)),
    rejectedEvidenceIds: Array.from(new Set([...rejectedEvidenceIds, ...unsupported])),
    calculationChecks: calculations.map((entry, index) => {
      const check = object(entry);
      return {
        id: clean(check.id, 240) || `calculation-${index + 1}`,
        passed: check.passed === true,
        message: clean(check.message, 1_000)
      };
    })
  };
}

function draftSectionId(value: unknown): TpRuntimeDraftSectionId | undefined {
  const id = clean(value) as TpRuntimeDraftSectionId;
  return Object.prototype.hasOwnProperty.call(draftSectionMap, id) ? id : undefined;
}

export function normalizeTpDraftingAgentOutput(
  value: unknown,
  evidence: TpEvidenceRecord[],
  verifiedFactIds: string[] = []
): TpRuntimeDraftingOutput {
  const record = object(value);
  const eligibleEvidenceIds = new Set(evidence.filter((entry) => entry.verificationStatus === "verified" && isLocated(entry)).map((entry) => entry.id));
  const issues: TpWorkflowIssue[] = [];
  const claims = (Array.isArray(record.claims) ? record.claims : []).flatMap<TpClaimRecord>((raw, index) => {
    const claim = object(raw);
    const sectionId = draftSectionId(claim.sectionId);
    const text = clean(claim.text, 4_000);
    if (!sectionId || !text) return [];
    const kind: TpClaimRecord["kind"] = claim.kind === "legal" || claim.kind === "numeric" || claim.kind === "professional_judgment" || claim.kind === "assumption"
      ? claim.kind
      : "factual";
    const evidenceIds = stringArray(claim.evidenceIds, 100).filter((id) => eligibleEvidenceIds.has(id));
    const requiresEvidence = kind === "factual" || kind === "legal" || kind === "numeric";
    const verificationStatus: TpClaimRecord["verificationStatus"] = kind === "professional_judgment" || kind === "assumption"
      ? "requires_human"
      : requiresEvidence && evidenceIds.length ? "verified" : "rejected";
    if (verificationStatus === "rejected") {
      issues.push(issue(
        "drafting",
        "UNSUPPORTED_DRAFT_CLAIM",
        "blocking",
        "unsupported_claim",
        "Draft contains an unsupported material claim",
        text.slice(0, 500),
        sectionId
      ));
    }
    return [{
      id: clean(claim.id, 240) || `claim-${hash({ sectionId, text, index }).slice(0, 16)}`,
      sectionId,
      text,
      kind,
      evidenceIds,
      verificationStatus
    }];
  });
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const sectionsById = new Map<TpRuntimeDraftSectionId, { id: TpRuntimeDraftSectionId; title: string; content: string; claimIds: string[] }>();
  (Array.isArray(record.sections) ? record.sections : []).forEach((raw) => {
    const section = object(raw);
    const id = draftSectionId(section.id);
    if (!id) return;
    const claimIds = stringArray(section.claimIds, 500).filter((claimId) => claimById.has(claimId));
    if (!claimIds.length) {
      issues.push(issue("drafting", "SECTION_WITHOUT_CLAIMS", "blocking", "unsupported_claim", `Section ${id} has no claim register`, "Return claim-to-evidence records for the section before it is applied.", id));
      return;
    }
    const hasRejectedClaim = claimIds.some((claimId) => claimById.get(claimId)?.verificationStatus === "rejected");
    if (hasRejectedClaim) {
      issues.push(issue("drafting", "SECTION_HAS_REJECTED_CLAIM", "blocking", "unsupported_claim", `Section ${id} contains a rejected claim`, "Remove or source the claim before applying this section.", id));
      return;
    }
    const content = claimIds
      .map((claimId) => claimById.get(claimId)?.text || "")
      .filter(Boolean)
      .join("\n\n");
    if (!content) return;
    sectionsById.set(id, {
      id,
      title: clean(section.title, 300) || draftSectionTitles[id],
      content,
      claimIds
    });
  });
  if (!verifiedFactIds.length && sectionsById.size) {
    issues.push(issue(
      "drafting",
      "NO_VERIFIED_FACTS",
      "blocking",
      "unsupported_claim",
      "Drafting output was supplied without verified facts",
      "Run evidence verification before applying model-generated drafting output."
    ));
    sectionsById.clear();
  }
  return { sections: Array.from(sectionsById.values()), claims, issues: dedupeIssues(issues) };
}

export function buildTpResearchAgentPrompt(state: TpProjectState): TpAgentPrompt {
  const definition = tpAgentDefinitions.find((entry) => entry.role === "research_analyst")!;
  const queries = buildTpResearchQueries(state);
  return {
    stage: "research",
    role: "research_analyst",
    system: [definition.objective, ...definition.guardrails].join("\n- "),
    input: JSON.stringify({
      approvedQueries: queries,
      instructions: [
        "Return official law, industry context, and discovery-only comparable leads separately.",
        "Do not add a taxpayer, affiliate, brand, person, address, tax ID, exact amount, or unpublished document text.",
        "For every comparable lead, quote a short source snippet supporting the exact legal entity name and business activity."
      ]
    }),
    outputSchema: {
      status: "completed | partial | failed",
      summary: "string",
      sources: [{ title: "string", url: "https URL", sourceType: "official | industry | comparable_candidate", query: "one approved query", snippet: "string", qualityTier: "string" }],
      candidates: [{ name: "string", sourceUrl: "URL present in sources", businessDescription: "string", matchRationale: "string" }],
      warnings: ["string"]
    },
    containsClientConfidentialData: false,
    externalUseAllowed: true
  };
}

export function buildTpVerificationAgentPrompt(facts: TpFactRecord[], evidence: TpEvidenceRecord[], research?: TpRuntimeResearchOutput): TpAgentPrompt {
  const definition = tpAgentDefinitions.find((entry) => entry.role === "evidence_verifier")!;
  return {
    stage: "verification",
    role: "evidence_verifier",
    system: [definition.objective, ...definition.guardrails].join("\n- "),
    input: JSON.stringify({
      facts,
      evidence,
      research: research || null,
      instructions: [
        "Verify only facts supported by the cited excerpt at the cited locator.",
        "Treat web comparable results as discovery leads until identity, independence, and financial screening are complete.",
        "Return calculation checks; do not rely on narrative arithmetic."
      ]
    }),
    outputSchema: {
      verifiedFactIds: ["fact id"],
      verifiedClaimIds: ["claim id"],
      verifiedEvidenceIds: ["evidence id with excerpt and locator"],
      rejectedEvidenceIds: ["evidence id"],
      calculationChecks: [{ id: "string", passed: true, message: "string" }]
    },
    containsClientConfidentialData: true,
    externalUseAllowed: false
  };
}

export function buildTpDraftingAgentPrompt(
  state: TpProjectState,
  facts: TpFactRecord[],
  evidence: TpEvidenceRecord[],
  verification?: TpVerificationResult
): TpAgentPrompt {
  const definition = tpAgentDefinitions.find((entry) => entry.role === "local_file_drafter")!;
  const verifiedFacts = new Set(verification?.verifiedFactIds || []);
  return {
    stage: "drafting",
    role: "local_file_drafter",
    system: [definition.objective, ...definition.guardrails].join("\n- "),
    input: JSON.stringify({
      projectFacts: facts.filter((fact) => verifiedFacts.has(fact.id)),
      evidence: evidence.filter((entry) => entry.verificationStatus === "verified" && isLocated(entry)),
      advisorParameters: {
        transactionType: state.transactionType,
        selectedMethod: state.selectedMethod,
        selectedPli: state.selectedPli,
        testedParty: state.testedParty,
        analysisPeriod: state.analysisPeriod
      },
      requiredSections: Object.entries(draftSectionTitles).map(([id, title]) => ({ id, title })),
      instructions: [
        "Draft in Indonesian and cite evidence IDs inline after every material factual, legal, or numeric claim.",
        "Do not fill gaps with general knowledge. Mark professional judgment and assumptions explicitly for human approval.",
        "Do not describe preliminary web-discovered companies as accepted comparables."
      ]
    }),
    outputSchema: {
      sections: [{ id: "required section id", title: "string", content: "string", claimIds: ["claim id"] }],
      claims: [{ id: "string", sectionId: "required section id", text: "string", kind: "factual | legal | numeric | professional_judgment | assumption", evidenceIds: ["verified evidence id"] }]
    },
    containsClientConfidentialData: true,
    externalUseAllowed: false
  };
}

function applyAgentOutputs(
  state: TpProjectState,
  gap: TpRuntimeGapResult,
  research?: TpRuntimeResearchOutput,
  drafting?: TpRuntimeDraftingOutput
) {
  const updated = structuredClone(state);
  updated.analysis.requiredEvidence = Array.from(new Set([...updated.analysis.requiredEvidence, ...gap.requestedDocuments]));
  updated.analysis.actionPlan = Array.from(new Set([...updated.analysis.actionPlan, ...gap.issues.filter((entry) => entry.severity === "blocking").map((entry) => entry.description)]));
  updated.analysis.riskFlags = Array.from(new Set([...updated.analysis.riskFlags, ...gap.issues.filter((entry) => entry.severity === "blocking").map((entry) => entry.title)]));
  if (research) {
    updated.analysis.externalResearchStatus = research.status;
    updated.analysis.externalResearchSummary = research.summary;
    updated.analysis.externalResearchSources = research.sources;
    updated.analysis.externalComparableCandidates = research.candidates;
    updated.analysis.externalResearchWarnings = research.warnings;
  }
  drafting?.sections.forEach((section) => {
    const key = draftSectionMap[section.id];
    if (typeof updated.analysis[key] === "string") {
      (updated.analysis as unknown as Record<string, unknown>)[key] = section.content;
    }
  });
  return updated;
}

function joinNonEmpty(parts: unknown[], separator = "\n\n") {
  return parts.map((entry) => clean(entry)).filter(Boolean).join(separator);
}

function assemblySections(state: TpProjectState, claims: TpClaimRecord[]): TpRuntimeAssemblySection[] {
  const claimIds = (id: string) => claims.filter((claim) => claim.sectionId === id && claim.verificationStatus !== "rejected").map((claim) => claim.id);
  const sections: Array<{ id: string; title: string; content: string }> = [
    { id: "executive_summary", title: draftSectionTitles.executive_summary, content: state.analysis.executiveSummary },
    {
      id: "company_profile",
      title: "Profil Perusahaan dan Grup",
      content: joinNonEmpty([
        state.companyName && `Nama: ${state.companyName}`,
        state.fiscalYear && `Tahun pajak: ${state.fiscalYear}`,
        state.companyAddress && `Alamat: ${state.companyAddress}`,
        state.parentGroup && `Grup: ${state.parentGroup}`,
        state.businessActivities
      ], "\n")
    },
    { id: "industry_analysis", title: draftSectionTitles.industry_analysis, content: state.analysis.industryAnalysis },
    { id: "business_characterization", title: draftSectionTitles.business_characterization, content: joinNonEmpty([state.analysis.businessCharacterization, state.businessStrategy]) },
    {
      id: "controlled_transactions",
      title: "Transaksi yang Dipengaruhi Hubungan Istimewa",
      content: joinNonEmpty([
        state.transactionDetails,
        ...state.affiliatedTransactions.map((entry) => `${entry.transactionType}: ${entry.counterparty}; ${entry.currency} ${entry.value}`),
        state.pricingPolicy
      ])
    },
    { id: "functional_analysis", title: draftSectionTitles.functional_analysis, content: state.analysis.functionalAnalysis },
    { id: "method_selection", title: draftSectionTitles.method_selection, content: joinNonEmpty([state.analysis.methodSelectionJustification, state.selectedMethod && `Metode: ${state.selectedMethod}`]) },
    { id: "pli_selection", title: draftSectionTitles.pli_selection, content: joinNonEmpty([state.analysis.pliSelectionRationale, state.selectedPli && `PLI: ${state.selectedPli}`]) },
    { id: "comparability_analysis", title: draftSectionTitles.comparability_analysis, content: state.analysis.comparabilityAnalysis },
    {
      id: "financial_information",
      title: "Informasi Keuangan",
      content: joinNonEmpty(Object.entries(state.financialData).map(([key, value]) => value && `${key}: ${value}`), "\n")
    },
    { id: "conclusion", title: draftSectionTitles.conclusion, content: state.analysis.conclusion }
  ];
  return sections.map((section) => ({
    ...section,
    status: clean(section.content).length >= 120 ? "populated" : clean(section.content) ? "partial" : "missing",
    claimIds: claimIds(section.id)
  }));
}

function parseNumber(value: unknown) {
  const text = clean(value).replace(/[^0-9,().-]/g, "");
  if (!text) return undefined;
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  const unsigned = text.replace(/[()-]/g, "");
  let normalized = unsigned;
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? unsigned.replace(/\./g, "").replace(",", ".") : unsigned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = /,\d{1,4}$/.test(unsigned) ? unsigned.replace(/\./g, "").replace(",", ".") : unsigned.replace(/,/g, "");
  } else if ((unsigned.match(/\./g) || []).length > 1) {
    normalized = unsigned.replace(/\./g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : undefined;
}

function approximatelyEqual(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(1, Math.abs(left) * 0.005);
}

function qaChecks(state: TpProjectState, sections: TpRuntimeAssemblySection[], facts: TpFactRecord[], evidence: TpEvidenceRecord[]) {
  const readiness = tpGenerationReadiness(state);
  const checks: TpQaResult["checks"] = [];
  checks.push({ id: "required-content", passed: readiness.blockers.length === 0, message: readiness.blockers.length ? `${readiness.blockers.length} mandatory requirement(s) remain open.` : "All mandatory legacy requirements are populated." });
  checks.push({ id: "merge-conflicts", passed: readiness.dataConflicts.length === 0, message: readiness.dataConflicts.length ? `${readiness.dataConflicts.length} extraction conflict(s) remain unresolved.` : "No unresolved extraction conflict." });
  const missingSections = sections.filter((section) => section.status === "missing");
  checks.push({ id: "draft-sections", passed: missingSections.length === 0, message: missingSections.length ? `Missing sections: ${missingSections.map((entry) => entry.title).join(", ")}.` : "All assembled sections contain content." });
  const materialFacts = facts.filter((fact) => /(?:financialData|affiliatedTransactions|shareholders|selectedMethod|selectedPli|testedParty|quartileRange|testedPartyRatio)/.test(fact.fieldPath));
  const verifiedEvidenceIds = new Set(evidence.filter((entry) => entry.verificationStatus === "verified" && isLocated(entry)).map((entry) => entry.id));
  const unsupportedMaterial = materialFacts.filter((fact) => !fact.evidenceIds.some((id) => verifiedEvidenceIds.has(id)));
  checks.push({ id: "material-evidence", passed: materialFacts.length > 0 && unsupportedMaterial.length === 0, message: unsupportedMaterial.length ? `${unsupportedMaterial.length} material field(s) lack verified located evidence.` : materialFacts.length ? "All material fields have verified located evidence." : "No material facts are available for verification." });

  const financial = state.financialData;
  const revenue = parseNumber(financial.revenue);
  const cogs = parseNumber(financial.costOfGoodsSold);
  const gross = parseNumber(financial.grossProfit);
  const expenses = parseNumber(financial.operatingExpenses);
  const operating = parseNumber(financial.operatingProfit);
  const financialEquations: Array<{ id: string; available: boolean; passed: boolean; message: string }> = [
    {
      id: "gross-profit-arithmetic",
      available: revenue !== undefined && cogs !== undefined && gross !== undefined,
      passed: revenue !== undefined && cogs !== undefined && gross !== undefined && approximatelyEqual(revenue - cogs, gross),
      message: "Gross profit should equal revenue minus cost of goods sold."
    },
    {
      id: "operating-profit-arithmetic",
      available: gross !== undefined && expenses !== undefined && operating !== undefined,
      passed: gross !== undefined && expenses !== undefined && operating !== undefined && approximatelyEqual(gross - expenses, operating),
      message: "Operating profit should equal gross profit minus operating expenses."
    }
  ];
  financialEquations.filter((entry) => entry.available).forEach((entry) => checks.push({ id: entry.id, passed: entry.passed, message: entry.passed ? `${entry.message} Check passed.` : `${entry.message} Values do not reconcile.` }));

  const quartiles = [state.quartileRange.q1, state.quartileRange.median, state.quartileRange.q3].map(parseNumber);
  if (quartiles.every((entry) => entry !== undefined)) {
    const [q1, median, q3] = quartiles as number[];
    checks.push({ id: "quartile-order", passed: q1 <= median && median <= q3, message: q1 <= median && median <= q3 ? "Quartile order is valid." : "Quartiles must satisfy Q1 <= median <= Q3." });
  }
  return checks;
}

function deriveLegacyStatus(state: TpProjectState, project: TpLocalFileProject): TpProjectStatus {
  const analyzedStatus = tpProjectStatusAfterAnalysis(state);
  if (analyzedStatus === "ready") return "ready";
  const hasAnalysis = [
    state.analysis.executiveSummary,
    state.analysis.industryAnalysis,
    state.analysis.businessCharacterization,
    state.analysis.functionalAnalysis,
    state.analysis.methodSelectionJustification,
    state.analysis.pliSelectionRationale,
    state.analysis.comparabilityAnalysis,
    state.analysis.conclusion
  ].some(nonEmpty);
  if (hasAnalysis || state.analysis.externalResearchSources.length) return "analyzed";
  if (project.documents.some((document) => document.status === "extracted") || tpProjectCompleteness(state) > 0) return "extracted";
  return "draft";
}

export function runTpAgentRuntime(project: TpLocalFileProject, options: TpAgentRuntimeOptions = {}): TpAgentRuntimeResult {
  const now = timestamp(options.now);
  const inputVersion = hash({ project, evidence: options.evidence || [] });
  const runId = `tp-runtime-${inputVersion.slice(0, 20)}`;
  const evidence = normalizedEvidence([
    ...createManualEvidence(project, now),
    ...(options.evidence || [])
  ], now);
  const base = <T extends TpWorkflowStageId>(stage: T) => ({
    workflowVersion: TP_WORKFLOW_VERSION,
    stage,
    runId: `${runId}-${stage}`,
    inputVersion,
    createdAt: now,
    issues: deriveTpWorkflowIssues(project.state, {
      documentCount: project.documents.length,
      extractedDocumentCount: project.documents.filter((document) => document.status === "extracted").length,
      evidence
    }).filter((entry) => entry.stage === stage)
  });
  const intake = createIntake(project, base("intake"));
  const extraction = createExtraction(project, evidence, base("extraction"));
  const gapAnalysis = createGapAnalysis(project.state, base("gap_analysis"));
  const research = options.researchOutput === undefined ? undefined : normalizeTpResearchAgentOutput(
    options.researchOutput,
    project.state,
    now,
    options.canonicalResearchSources
  );
  const verification = options.verificationOutput === undefined ? undefined : normalizeTpVerificationAgentOutput(options.verificationOutput, extraction.evidence, extraction.facts, inputVersion, now);
  const drafting = options.draftingOutput === undefined ? undefined : normalizeTpDraftingAgentOutput(options.draftingOutput, extraction.evidence, verification?.verifiedFactIds || []);
  const state = applyAgentOutputs(project.state, gapAnalysis, research, drafting);
  const sections = assemblySections(state, drafting?.claims || []);
  const allIssues = dedupeIssues([
    ...intake.issues,
    ...extraction.issues,
    ...gapAnalysis.issues,
    ...(verification?.issues || []),
    ...(drafting?.issues || [])
  ]);
  const documentVersion = `draft-${hash({ state, sections }).slice(0, 16)}`;
  const assembly: TpRuntimeAssemblyResult = {
    ...base("assembly"),
    issues: allIssues.filter((entry) => entry.stage === "assembly"),
    documentVersion,
    templateVersion: "tp-local-file-legacy-v1",
    sectionIds: sections.map((section) => section.id),
    artifactId: `tp-working-draft:${project.id}:${documentVersion}`,
    workingDraft: true,
    sections,
    inputHash: hash({ state, sections }),
    unresolvedIssueIds: allIssues.filter((entry) => entry.status === "open").map((entry) => entry.id)
  };
  const checks = qaChecks(state, sections, extraction.facts, extraction.evidence);
  const qaIssues = [...allIssues.filter((entry) => entry.severity === "blocking")];
  checks.filter((check) => !check.passed).forEach((check) => qaIssues.push(issue("qa", `CHECK_FAILED_${check.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`, "blocking", check.id.includes("arithmetic") || check.id.includes("quartile") ? "calculation" : "workflow", `QA failed: ${check.id}`, check.message)));
  const dedupedQaIssues = dedupeIssues(qaIssues);
  const qa: TpRuntimeQaResult = {
    ...base("qa"),
    issues: dedupedQaIssues,
    checks,
    releaseRecommendation: checks.every((check) => check.passed) && !dedupedQaIssues.some((entry) => entry.severity === "blocking") ? "human_review" : "fail",
    blockerCount: dedupedQaIssues.filter((entry) => entry.severity === "blocking").length,
    warningCount: dedupedQaIssues.filter((entry) => entry.severity === "warning").length
  };
  const completedStages: TpWorkflowStageId[] = ["gap_analysis", "assembly", "qa"];
  if ((intake.documentIds.length || evidence.some((entry) => entry.sourceType === "manual_input" || entry.sourceType === "calculation")) && !intake.issues.some((entry) => entry.severity === "blocking")) completedStages.push("intake");
  if (extraction.facts.length && (project.documents.some((document) => document.status === "extracted") || evidence.some((entry) => entry.sourceType === "manual_input" || entry.sourceType === "calculation"))) completedStages.push("extraction");
  if (research?.sources.length) completedStages.push("research");
  if (verification) completedStages.push("verification");
  if (drafting) completedStages.push("drafting");
  const workflowPlan = planTpAgentWorkflow(state, {
    documentCount: project.documents.length,
    extractedDocumentCount: project.documents.filter((document) => document.status === "extracted").length,
    externalResearchAllowed: options.externalResearchAllowed,
    externalResearchApprovedBy: options.externalResearchApprovedBy,
    evidence: extraction.evidence,
    issues: dedupeIssues([...allIssues, ...qa.issues]),
    completedStages,
    qaPassed: qa.releaseRecommendation === "human_review",
    currentDocumentVersion: documentVersion
  });
  return {
    runtimeVersion: TP_AGENT_RUNTIME_VERSION,
    workflowVersion: TP_WORKFLOW_VERSION,
    runId,
    inputVersion,
    createdAt: now,
    stages: { intake, extraction, gapAnalysis, assembly, qa },
    agentWork: {
      research: buildTpResearchAgentPrompt(state),
      verification: buildTpVerificationAgentPrompt(extraction.facts, extraction.evidence, research),
      drafting: buildTpDraftingAgentPrompt(state, extraction.facts, extraction.evidence, verification)
    },
    normalizedAgentOutputs: { research, verification, drafting },
    workflowPlan,
    legacyUpdate: {
      state,
      status: deriveLegacyStatus(state, project),
      updatedAt: now
    }
  };
}
