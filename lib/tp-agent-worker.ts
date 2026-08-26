import { createHash, randomUUID } from "crypto";
import { getTpLocalFileProjectById, listTaxRegulations, updateTpLocalFileProjectFromAgentRun } from "./db";
import { normalizeModelChoice, type LlmModelChoice } from "./model-options";
import { callOpenAIText, canUseConfidentialLlm, extractJsonObject, hasRemoteLlm } from "./openai";
import {
  claimNextTpAgentRun,
  listTpAgentRuns,
  markTpAgentRunFailed,
  markTpAgentRunSucceeded,
  type TpAgentRun
} from "./tp-agent-queue";
import {
  runTpAgentRuntime,
  type TpAgentPrompt,
  type TpRuntimeResearchOutput
} from "./tp-agent-runtime";
import type { TpEvidenceRecord, TpFactRecord, TpVerificationResult } from "./tp-agent-workflow";
import type { TpLocalFileProject } from "./tp-local-file";
import { runTpExternalResearch } from "./tavily";
import { selectTpRegulationContext } from "./tp-regulation-context";

export type ProcessTpAgentOptions = {
  workerId?: string;
  projectId?: string;
  leaseSeconds?: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function runInput(run: TpAgentRun) {
  const input = record(run.input);
  const snapshot = input.projectSnapshot && typeof input.projectSnapshot === "object"
    ? input.projectSnapshot as TpLocalFileProject
    : undefined;
  return {
    input,
    snapshot,
    language: input.language === "en" ? "en" as const : "id" as const,
    useExternalResearch: input.useExternalResearch === true,
    approvedBy: String(input.externalResearchApprovedBy || ""),
    modelChoice: normalizeModelChoice(input.modelChoice)
  };
}

function outputOf(runs: TpAgentRun[], stage: TpAgentRun["stage"], inputHash: string) {
  return runs.find((candidate) => candidate.stage === stage && candidate.status === "succeeded" && candidate.inputHash === inputHash)?.output;
}

function dependencyLineage(runs: TpAgentRun[], run: TpAgentRun) {
  const byId = new Map(runs.map((candidate) => [candidate.id, candidate]));
  const selected = new Map<string, TpAgentRun>();
  const visit = (runId: string) => {
    const candidate = byId.get(runId);
    if (!candidate || selected.has(candidate.id) || candidate.projectId !== run.projectId || candidate.inputHash !== run.inputHash) return;
    selected.set(candidate.id, candidate);
    candidate.dependencyRunIds.forEach(visit);
  };
  run.dependencyRunIds.forEach(visit);
  return Array.from(selected.values());
}

function resultOf(value: unknown) {
  const output = record(value);
  return output.result && typeof output.result === "object" ? record(output.result) : output;
}

function evidenceOf(value: unknown): TpEvidenceRecord[] {
  const result = resultOf(value);
  return Array.isArray(result.evidence) ? result.evidence as TpEvidenceRecord[] : [];
}

function factsOf(value: unknown): TpFactRecord[] {
  const result = resultOf(value);
  return Array.isArray(result.facts) ? result.facts as TpFactRecord[] : [];
}

function verificationOf(value: unknown): TpVerificationResult | undefined {
  const result = resultOf(value);
  return result.stage === "verification" ? result as unknown as TpVerificationResult : undefined;
}

function stableEvidenceId(prefix: string, value: unknown) {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20)}`;
}

function researchEvidence(value: unknown): TpEvidenceRecord[] {
  const result = resultOf(value);
  const sources = Array.isArray(result.sources) ? result.sources : [];
  return sources.flatMap((raw): TpEvidenceRecord[] => {
    const source = record(raw);
    const url = String(source.url || "").trim();
    const title = String(source.title || "").trim();
    const excerpt = String(source.snippet || "").trim();
    if (!url || !title || !excerpt) return [];
    return [{
      id: stableEvidenceId("research-evidence", url),
      sourceType: source.qualityTier === "exchange_or_filing" ? "public_filing" : "web_discovery",
      sourceId: url,
      title,
      url,
      sourceHash: createHash("sha256").update(`${title}\n${excerpt}`).digest("hex"),
      locator: { section: title },
      excerpt,
      fieldPaths: ["analysis.externalResearchSources"],
      confidentiality: "public",
      verificationStatus: "unverified",
      collectedBy: "research_analyst",
      collectedAt: String(source.retrievedAt || new Date().toISOString())
    }];
  });
}

function regulationEvidence(value: unknown[]): TpEvidenceRecord[] {
  return value.flatMap((raw): TpEvidenceRecord[] => {
    const regulation = record(raw);
    const status = String(regulation.legalStatus || "unknown");
    if (status !== "active" && status !== "amended") return [];
    const title = String(regulation.title || regulation.citation || "").trim();
    const url = String(regulation.sourceUrl || "").trim();
    const provisions = Array.isArray(regulation.keyProvisions) ? regulation.keyProvisions : [];
    return provisions.flatMap((rawProvision, index): TpEvidenceRecord[] => {
      const provision = record(rawProvision);
      const excerpt = String(provision.text || "").trim();
      if (!title || !url || !excerpt) return [];
      const page = Number(provision.page);
      return [{
        id: stableEvidenceId("regulation-evidence", { url, provision, index }),
        sourceType: "official_regulation",
        sourceId: url,
        title,
        url,
        sourceHash: createHash("sha256").update(`${title}\n${excerpt}`).digest("hex"),
        locator: {
          ...(Number.isInteger(page) && page > 0 ? { page } : {}),
          ...(String(provision.article || "").trim() ? { section: String(provision.article).trim() } : {})
        },
        excerpt,
        fieldPaths: ["analysis.regulatoryReferences"],
        confidentiality: "public",
        verificationStatus: "unverified",
        collectedBy: "research_analyst",
        collectedAt: new Date().toISOString()
      }];
    });
  });
}

function supplementalEvidenceOf(value: unknown): TpEvidenceRecord[] {
  const output = record(value);
  return Array.isArray(output.evidence) ? output.evidence as TpEvidenceRecord[] : [];
}

function promoteVerifiedEvidence(evidence: TpEvidenceRecord[], verification?: TpVerificationResult) {
  if (!verification) return evidence;
  const rejectedEvidenceIds = new Set(verification.rejectedEvidenceIds);
  const verifiedEvidenceIds = new Set(
    verification.verifiedEvidenceIds
      .filter((evidenceId) => !rejectedEvidenceIds.has(evidenceId))
  );
  return evidence.map((entry): TpEvidenceRecord => verifiedEvidenceIds.has(entry.id) ? {
    ...entry,
    verificationStatus: "verified",
    verifiedBy: "evidence_verifier",
    verifiedAt: verification.createdAt
  } : entry);
}

async function callAgent(prompt: TpAgentPrompt, choice: LlmModelChoice, additionalContext = "") {
  if (!hasRemoteLlm(choice)) return undefined;
  if (prompt.containsClientConfidentialData && !canUseConfidentialLlm(choice)) return undefined;
  const input = `${prompt.input}${additionalContext ? `\n\n${additionalContext}` : ""}\n\nReturn JSON only matching this schema:\n${JSON.stringify(prompt.outputSchema)}`;
  const reasoningEffort = prompt.stage === "research" ? "medium" as const : "high" as const;
  const raw = await callOpenAIText(input, prompt.system, choice, { reasoningEffort, textVerbosity: "high" });
  return extractJsonObject(raw);
}

function priorContext(runs: TpAgentRun[], run: TpAgentRun) {
  const lineage = dependencyLineage(runs, run);
  const extraction = outputOf(lineage, "extraction", run.inputHash);
  const research = outputOf(lineage, "research", run.inputHash);
  const verification = outputOf(lineage, "verification", run.inputHash);
  const drafting = outputOf(lineage, "drafting", run.inputHash);
  const facts = factsOf(extraction);
  const evidenceById = new Map<string, TpEvidenceRecord>();
  [
    ...evidenceOf(extraction),
    ...researchEvidence(research),
    ...supplementalEvidenceOf(verification)
  ].forEach((entry) => evidenceById.set(entry.id, entry));
  const evidence = Array.from(evidenceById.values());
  const verificationResult = verificationOf(verification);
  return {
    facts,
    evidence: promoteVerifiedEvidence(evidence, verificationResult),
    researchOutput: resultOf(research),
    verificationOutput: resultOf(verification),
    verificationResult,
    draftingOutput: resultOf(drafting)
  };
}

function researchFallback(bundle: Awaited<ReturnType<typeof runTpExternalResearch>>): TpRuntimeResearchOutput {
  return {
    status: bundle.status,
    summary: bundle.sources.length
      ? `${bundle.sources.length} external sources collected for advisor verification.`
      : "No external sources were collected. Continue with manual research.",
    sources: bundle.sources,
    candidates: [],
    warnings: bundle.warnings
  };
}

async function executeStage(run: TpAgentRun, project: TpLocalFileProject, allRuns: TpAgentRun[], workerId: string) {
  const parsed = runInput(run);
  const snapshot = parsed.snapshot || project;
  const prior = priorContext(allRuns, run);
  const options = {
    evidence: prior.evidence,
    researchOutput: prior.researchOutput,
    verificationOutput: prior.verificationOutput,
    draftingOutput: prior.draftingOutput,
    externalResearchAllowed: parsed.useExternalResearch,
    externalResearchApprovedBy: parsed.approvedBy
  };
  let runtime = runTpAgentRuntime(snapshot, options);

  if (run.stage === "intake") return { result: runtime.stages.intake };
  if (run.stage === "extraction") {
    return {
      result: runtime.stages.extraction,
      pendingDocumentIds: snapshot.documents.filter((document) => document.status === "uploaded").map((document) => document.id),
      failedDocumentIds: snapshot.documents.filter((document) => document.status === "failed").map((document) => document.id)
    };
  }
  if (run.stage === "gap_analysis") return { result: runtime.stages.gapAnalysis };

  if (run.stage === "research") {
    const manualSources = snapshot.state.analysis.externalResearchSources;
    const bundle = parsed.useExternalResearch && parsed.approvedBy
      ? await runTpExternalResearch(snapshot.state)
      : {
          status: manualSources.length ? "partial" as const : "not_configured" as const,
          sources: manualSources,
          warnings: [manualSources.length
            ? "Only manually supplied research sources are available; verification remains required."
            : "External research was not approved; manual research tasks remain open."],
          queries: []
        };
    let modelOutput: unknown;
    let modelWarning = "";
    if (parsed.useExternalResearch && parsed.approvedBy) {
      try {
        modelOutput = await callAgent(runtime.agentWork.research, parsed.modelChoice, `RETRIEVED SOURCES:\n${JSON.stringify(bundle)}`);
      } catch (error) {
        modelWarning = `Research summarizer unavailable; preserved retrieved sources for manual verification (${error instanceof Error ? error.message : "unknown error"}).`;
      }
    }
    const modelRecord = record(modelOutput);
    const agentOutput = modelOutput
      ? {
          ...modelRecord,
          sources: bundle.sources,
          warnings: [...bundle.warnings, ...(modelWarning ? [modelWarning] : []), ...(Array.isArray(modelRecord.warnings) ? modelRecord.warnings.map(String) : [])]
        }
      : {
          ...researchFallback(bundle),
          warnings: [...bundle.warnings, ...(modelWarning ? [modelWarning] : [])]
        };
    runtime = runTpAgentRuntime(snapshot, {
      ...options,
      researchOutput: agentOutput,
      canonicalResearchSources: bundle.sources
    });
    return { result: runtime.normalizedAgentOutputs.research, agentOutput, queries: bundle.queries };
  }

  if (run.stage === "verification") {
    const regulations = selectTpRegulationContext(await listTaxRegulations().catch(() => []), 15);
    const verificationEvidence = [...prior.evidence, ...regulationEvidence(regulations)];
    runtime = runTpAgentRuntime(snapshot, { ...options, evidence: verificationEvidence });
    let agentOutput: unknown;
    let verificationWarning = "";
    try {
      agentOutput = await callAgent(runtime.agentWork.verification, parsed.modelChoice);
    } catch (error) {
      verificationWarning = error instanceof Error ? error.message : "unknown model error";
    }
    agentOutput ||= {
      verifiedFactIds: [],
      verifiedClaimIds: [],
      verifiedEvidenceIds: [],
      rejectedEvidenceIds: [],
      calculationChecks: [],
      issues: [`Verification model is unavailable; human verification is required${verificationWarning ? ` (${verificationWarning})` : ""}.`]
    };
    runtime = runTpAgentRuntime(snapshot, { ...options, evidence: verificationEvidence, verificationOutput: agentOutput });
    return { result: runtime.normalizedAgentOutputs.verification, agentOutput, evidence: verificationEvidence };
  }

  if (run.stage === "drafting") {
    const regulations = selectTpRegulationContext(await listTaxRegulations().catch(() => []), 15);
    let agentOutput: unknown;
    let draftingWarning = "";
    try {
      agentOutput = await callAgent(runtime.agentWork.drafting, parsed.modelChoice, `APPROVED REGULATION CONTEXT:\n${JSON.stringify(regulations)}`);
    } catch (error) {
      draftingWarning = error instanceof Error ? error.message : "unknown model error";
    }
    agentOutput ||= {
      sections: [],
      claims: [],
      issues: [`Drafting model is unavailable; use the manual editor or configure an approved model${draftingWarning ? ` (${draftingWarning})` : ""}.`]
    };
    runtime = runTpAgentRuntime(snapshot, { ...options, draftingOutput: agentOutput });
    const projectVersion = String(parsed.input.projectVersion || "");
    let stale = Boolean(projectVersion && project.updatedAt !== projectVersion);
    if (!stale && runtime.normalizedAgentOutputs.drafting?.sections.length) {
      const updated = await updateTpLocalFileProjectFromAgentRun({
        ...project,
        state: runtime.legacyUpdate.state,
        status: runtime.legacyUpdate.status,
        updatedAt: runtime.legacyUpdate.updatedAt
      }, projectVersion || project.updatedAt, run.id, workerId);
      stale = !updated;
    }
    return { result: runtime.normalizedAgentOutputs.drafting, agentOutput, staleProjectSnapshot: stale };
  }

  if (run.stage === "assembly") return {
    result: runtime.stages.assembly,
    artifactSnapshot: {
      ...snapshot,
      state: runtime.legacyUpdate.state,
      status: runtime.legacyUpdate.status,
      updatedAt: runtime.legacyUpdate.updatedAt
    }
  };
  if (run.stage === "qa") return { result: runtime.stages.qa, workflowPlan: runtime.workflowPlan };
  throw new Error(`Unsupported automated TP stage: ${run.stage}`);
}

export async function processNextTpAgentRun(options: ProcessTpAgentOptions = {}) {
  const workerId = options.workerId || `tp-worker-${randomUUID()}`;
  const run = await claimNextTpAgentRun({
    workerId,
    projectId: options.projectId,
    leaseSeconds: options.leaseSeconds || 600
  });
  if (!run) return { processed: false as const, run: null };
  try {
    const project = await getTpLocalFileProjectById(run.projectId);
    if (!project) throw new Error("TP project no longer exists.");
    const allRuns = await listTpAgentRuns({ projectId: run.projectId, limit: 500 });
    const output = await executeStage(run, project, allRuns, workerId);
    const completed = await markTpAgentRunSucceeded(run.id, workerId, output);
    return { processed: true as const, run: completed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "TP agent execution failed.";
    const retryable = !/unsupported|not found|no longer exists|invalid/i.test(message);
    const failed = await markTpAgentRunFailed({ runId: run.id, workerId, error: message, retryable });
    return { processed: true as const, run: failed };
  }
}
