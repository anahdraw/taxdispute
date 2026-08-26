import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import { getTpLocalFileProjectById, hasDatabase } from "@/lib/db";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { processNextTpAgentRun } from "@/lib/tp-agent-worker";
import {
  cancelTpAgentRun,
  enqueueTpAgentRun,
  listTpAgentRuns,
  recordTpHumanApproval,
  tpAgentInputHash,
  type TpAgentRun
} from "@/lib/tp-agent-queue";
import {
  planTpAgentWorkflow,
  tpAgentDefinitions,
  type TpEvidenceRecord,
  type TpWorkflowContext,
  type TpWorkflowStageId
} from "@/lib/tp-agent-workflow";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

async function authorizedProject(request: Request, id: string) {
  const auth = await requireFeature(request, "tpLocalFile");
  if ("response" in auth) return { response: auth.response } as const;
  const project = await getTpLocalFileProjectById(id);
  if (!project) return { response: NextResponse.json({ error: "TP project not found." }, { status: 404 }) } as const;
  if (auth.session.role !== "admin" && project.ownerUsername !== auth.session.username) {
    return { response: NextResponse.json({ error: "You do not have access to this TP project." }, { status: 403 }) } as const;
  }
  return { project, auth } as const;
}

function outputRecord(run: TpAgentRun) {
  return run.output && typeof run.output === "object" ? run.output as Record<string, unknown> : {};
}

function inputRecord(run: TpAgentRun) {
  return run.input && typeof run.input === "object" ? run.input as Record<string, unknown> : {};
}

function workflowContext(project: Awaited<ReturnType<typeof getTpLocalFileProjectById>>, runs: TpAgentRun[]): TpWorkflowContext {
  if (!project) return {};
  const latestInputHash = runs[0]?.inputHash;
  const currentRuns = latestInputHash ? runs.filter((run) => run.inputHash === latestInputHash) : runs;
  const succeeded = currentRuns.filter((run) => run.status === "succeeded");
  const completedStages = Array.from(new Set(succeeded.map((run) => run.stage))) as TpWorkflowStageId[];
  const extractionRun = succeeded.find((run) => run.stage === "extraction");
  const extractionResult = extractionRun ? resultOfRun(extractionRun) : {};
  const verificationRun = succeeded.find((run) => run.stage === "verification");
  const verificationResult = verificationRun ? resultOfRun(verificationRun) : {};
  const rejectedEvidenceIds = new Set(Array.isArray(verificationResult.rejectedEvidenceIds) ? verificationResult.rejectedEvidenceIds.map(String) : []);
  const verifiedEvidenceIds = new Set((Array.isArray(verificationResult.verifiedEvidenceIds) ? verificationResult.verifiedEvidenceIds.map(String) : [])
    .filter((evidenceId) => !rejectedEvidenceIds.has(evidenceId)));
  const evidence = (Array.isArray(extractionResult.evidence) ? extractionResult.evidence as TpEvidenceRecord[] : [])
    .map((entry): TpEvidenceRecord => verifiedEvidenceIds.has(entry.id) ? {
      ...entry,
      verificationStatus: "verified",
      verifiedBy: "evidence_verifier",
      verifiedAt: verificationRun?.completedAt || new Date().toISOString()
    } : entry);
  const qaRun = succeeded.find((run) => run.stage === "qa");
  const qaOutput = qaRun ? outputRecord(qaRun) : {};
  const qaResult = qaOutput.result && typeof qaOutput.result === "object" ? qaOutput.result as Record<string, unknown> : qaOutput;
  const latestInput = currentRuns[0]?.input && typeof currentRuns[0].input === "object" ? currentRuns[0].input as Record<string, unknown> : {};
  const assemblyRun = succeeded.find((run) => run.stage === "assembly");
  const assemblyResult = assemblyRun ? resultOfRun(assemblyRun) : {};
  const assemblySnapshotValue = assemblyRun ? outputRecord(assemblyRun).artifactSnapshot : undefined;
  const assemblySnapshot = assemblySnapshotValue && typeof assemblySnapshotValue === "object" && !Array.isArray(assemblySnapshotValue)
    ? assemblySnapshotValue as Record<string, unknown>
    : {};
  const assemblyMatchesCurrentProject = assemblySnapshot.id === project.id && tpAgentInputHash({
    name: assemblySnapshot.name,
    state: assemblySnapshot.state,
    documents: assemblySnapshot.documents
  }) === tpAgentInputHash({ name: project.name, state: project.state, documents: project.documents });
  const currentDocumentVersion = assemblyMatchesCurrentProject ? String(assemblyResult.documentVersion || "") || undefined : undefined;
  const approvalRun = succeeded.find((run) => run.stage === "human_approval");
  const approvalResult = approvalRun ? resultOfRun(approvalRun) : {};
  const approvedDocumentVersion = assemblyMatchesCurrentProject && approvalResult.decision === "approved"
    ? String(approvalResult.reviewedDocumentVersion || "") || undefined
    : undefined;
  return {
    documentCount: project.documents.length,
    extractedDocumentCount: project.documents.filter((document) => document.status === "extracted").length,
    completedStages,
    evidence,
    externalResearchAllowed: latestInput.useExternalResearch === true,
    externalResearchApprovedBy: String(latestInput.externalResearchApprovedBy || "") || undefined,
    qaPassed: qaResult.releaseRecommendation === "human_review",
    currentDocumentVersion,
    approvedDocumentVersion
  };
}

function resultOfRun(run: TpAgentRun) {
  const output = outputRecord(run);
  return output.result && typeof output.result === "object" ? output.result as Record<string, unknown> : output;
}

export async function GET(request: Request, context: RouteContext) {
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const { id } = await context.params;
  const access = await authorizedProject(request, id);
  if ("response" in access) return access.response;
  try {
    const runs = await listTpAgentRuns({ projectId: id, limit: 100 });
    return NextResponse.json({
      runs,
      plan: planTpAgentWorkflow(access.project.state, workflowContext(access.project, runs))
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the TP agent pipeline." }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const { id } = await context.params;
  const access = await authorizedProject(request, id);
  if ("response" in access) return access.response;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "start");
    if (action === "run_next") {
      const processed = await processNextTpAgentRun({ projectId: id, leaseSeconds: 600 });
      const runs = await listTpAgentRuns({ projectId: id, limit: 100 });
      const refreshedProject = await getTpLocalFileProjectById(id) || access.project;
      return NextResponse.json({ processed, runs, plan: planTpAgentWorkflow(refreshedProject.state, workflowContext(refreshedProject, runs)) });
    }
    if (action === "cancel") {
      const active = await listTpAgentRuns({ projectId: id, statuses: ["queued", "retry_wait", "running"], limit: 100 });
      await Promise.all(active.map((run) => cancelTpAgentRun({
        runId: run.id,
        cancelledBy: access.auth.session.sub,
        reason: String(body.reason || "Cancelled by the project user.").slice(0, 500)
      })));
      const runs = await listTpAgentRuns({ projectId: id, limit: 100 });
      return NextResponse.json({ runs, plan: planTpAgentWorkflow(access.project.state, workflowContext(access.project, runs)) });
    }
    if (action === "human_review") {
      const decision = String(body.decision || "");
      if (decision !== "approved" && decision !== "changes_requested" && decision !== "rejected") {
        return NextResponse.json({ error: "A valid human review decision is required." }, { status: 400 });
      }
      const runs = await listTpAgentRuns({ projectId: id, limit: 100 });
      const inputHash = runs[0]?.inputHash;
      const currentRuns = inputHash ? runs.filter((run) => run.inputHash === inputHash) : [];
      const assemblyRun = currentRuns.find((run) => run.stage === "assembly" && run.status === "succeeded");
      const qaRun = currentRuns.find((run) => run.stage === "qa" && run.status === "succeeded");
      const assemblyResult = assemblyRun ? resultOfRun(assemblyRun) : {};
      const qaResult = qaRun ? resultOfRun(qaRun) : {};
      if (!inputHash || !assemblyRun || !qaRun || !assemblyResult.documentVersion || !assemblyResult.artifactId) {
        return NextResponse.json({ error: "Complete assembly and QA before recording the human review." }, { status: 409 });
      }
      if (decision === "approved" && qaResult.releaseRecommendation !== "human_review") {
        return NextResponse.json({ error: "This exact document version has not passed QA." }, { status: 409 });
      }
      const snapshotValue = outputRecord(assemblyRun).artifactSnapshot;
      const artifactSnapshot = snapshotValue && typeof snapshotValue === "object" && !Array.isArray(snapshotValue)
        ? snapshotValue as Record<string, unknown>
        : {};
      const reviewedContentHash = tpAgentInputHash({
        name: artifactSnapshot.name,
        state: artifactSnapshot.state,
        documents: artifactSnapshot.documents
      });
      const currentContentHash = tpAgentInputHash({
        name: access.project.name,
        state: access.project.state,
        documents: access.project.documents
      });
      if (!artifactSnapshot.id || artifactSnapshot.id !== access.project.id || reviewedContentHash !== currentContentHash) {
        return NextResponse.json({ error: "The TP project changed after this version was assembled. Start a new workflow before recording approval." }, { status: 409 });
      }
      await recordTpHumanApproval({
        projectId: id,
        inputHash,
        dependencyRunId: qaRun.id,
        reviewerId: access.auth.session.sub,
        documentVersion: String(assemblyResult.documentVersion),
        artifactId: String(assemblyResult.artifactId),
        decision,
        notes: String(body.notes || "")
      });
      const refreshedRuns = await listTpAgentRuns({ projectId: id, limit: 100 });
      return NextResponse.json({
        runs: refreshedRuns,
        plan: planTpAgentWorkflow(access.project.state, workflowContext(access.project, refreshedRuns))
      });
    }
    if (action !== "start") return NextResponse.json({ error: "Unsupported pipeline action." }, { status: 400 });
    if (!access.project.documents.length && !access.project.state.manualEvidence.length && !Object.keys(access.project.state.fieldSources).length) {
      return NextResponse.json({ error: "Upload at least one source document or enter sourced facts before starting the pipeline." }, { status: 400 });
    }

    const useExternalResearch = body.useExternalResearch === true;
    const input = {
      projectId: id,
      projectVersion: access.project.updatedAt,
      language: body.language === "en" ? "en" : "id",
      useExternalResearch,
      externalResearchApprovedBy: useExternalResearch ? access.auth.session.sub : "",
      requestedBy: access.auth.session.sub,
      requestedAt: new Date().toISOString(),
      modelChoice: modelChoiceFromRequest(request),
      projectSnapshot: access.project
    };
    const stableWorkflowInputHash = tpAgentInputHash({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      language: input.language,
      useExternalResearch: input.useExternalResearch,
      externalResearchApprovedBy: input.externalResearchApprovedBy,
      modelChoice: input.modelChoice
    });
    const existingRuns = await listTpAgentRuns({ projectId: id, limit: 100 });
    const matchingRuns = existingRuns.filter((run) => {
      const candidate = inputRecord(run);
      return candidate.projectVersion === input.projectVersion
        && candidate.language === input.language
        && candidate.useExternalResearch === input.useExternalResearch
        && candidate.modelChoice === input.modelChoice;
    });
    const latestChainHash = matchingRuns[0]?.inputHash;
    const latestChain = latestChainHash ? matchingRuns.filter((run) => run.inputHash === latestChainHash) : [];
    const terminalRun = latestChain.find((run) => run.status === "failed" || run.status === "cancelled");
    const reusableRun = terminalRun ? undefined : latestChain[0];
    const workflowInputHash = reusableRun?.inputHash || (terminalRun
      ? tpAgentInputHash({ stableWorkflowInputHash, resumeAfter: terminalRun.id, requestedAt: input.requestedAt })
      : stableWorkflowInputHash);
    let dependencyRunIds: string[] = [];
    const queued: TpAgentRun[] = [];
    for (const agent of tpAgentDefinitions) {
      if (agent.stage === "human_approval") break;
      const run = await enqueueTpAgentRun({
        projectId: id,
        agentRole: agent.role,
        dependencyRunIds,
        input,
        inputHash: workflowInputHash,
        maxAttempts: agent.actor === "ai" ? 3 : 2,
        priority: 100 - queued.length
      });
      queued.push(run);
      dependencyRunIds = [run.id];
    }
    const runs = await listTpAgentRuns({ projectId: id, limit: 100 });
    return NextResponse.json({
      queued,
      runs,
      plan: planTpAgentWorkflow(access.project.state, workflowContext(access.project, runs))
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start the TP agent pipeline." }, { status: 500 });
  }
}
