"use client";

import { useEffect, useMemo, useState } from "react";
import { upload } from "@vercel/blob/client";
import { LLM_MODEL_HEADER, type LlmModelChoice } from "@/lib/model-options";
import type { TpAgentRun } from "@/lib/tp-agent-queue";
import { tpAgentDefinitions, type TpWorkflowPlan, type TpWorkflowStageId } from "@/lib/tp-agent-workflow";
import {
  emptyTpProjectState,
  tpDocumentKinds,
  tpExtractionScopes,
  tpGenerationReadiness,
  tpProjectCompleteness,
  type TpAffiliatedParty,
  type TpComparable,
  type TpManagement,
  type TpManualEvidence,
  type TpOrganizationDepartment,
  type TpRejectionMatrixRow,
  type TpSearchCriteriaResult,
  type TpLocalFileProject,
  type TpLocalFileProjectSummary,
  type TpExtractionScope,
  type TpProjectState,
  type TpShareholder,
  type TpSourceDocument,
  type TpTransaction
} from "@/lib/tp-local-file";

type Language = "id" | "en";
type WorkspaceTab = "manual" | "sources" | "profile" | "transactions" | "readiness" | "agents" | "review";

const manualStepPaths = [
  ["companyName", "fiscalYear", "companyAddress", "establishmentInfo"],
  ["businessActivities", "shareholders", "management", "affiliatedParties"],
  ["affiliatedTransactions", "transactionDetails", "pricingPolicy", "backgroundTransaction"],
  ["farAnalysis.functionsPerformed", "farAnalysis.assetsUsed", "farAnalysis.risksAssumed"],
  ["selectedMethod", "selectedPli", "testedParty", "searchCriteriaResults", "rejectionMatrix", "comparableCompanies"],
  ["financialData.revenue", "financialData.operatingProfit", "financialData.netIncome", "nonFinancialEvents"],
  ["manualEvidence"]
] as const;

function valueAtManualPath(state: TpProjectState, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, state);
}

function manualValuePresent(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(manualValuePresent);
  return Boolean(String(value ?? "").trim());
}

function manualStepComplete(state: TpProjectState, step: number) {
  const paths = manualStepPaths[step] || [];
  return paths.length > 0 && paths.every((path) => manualValuePresent(valueAtManualPath(state, path)));
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(text || `Request failed (${response.status}).`); }
  if (!response.ok) throw new Error(String(payload.error || `Request failed (${response.status}).`));
  return payload as T;
}

function safePart(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 100) || "document";
}

function latestAgentRun(runs: TpAgentRun[], stage: TpWorkflowStageId) {
  return runs.find((run) => run.stage === stage);
}

function agentRunResult(run: TpAgentRun | undefined) {
  const output = run?.output && typeof run.output === "object" ? run.output as Record<string, unknown> : {};
  return output.result && typeof output.result === "object" ? output.result as Record<string, unknown> : output;
}

export default function TpLocalFilePanel({ language, modelChoice }: { language: Language; modelChoice: LlmModelChoice }) {
  const en = language === "en";
  const [projects, setProjects] = useState<TpLocalFileProjectSummary[]>([]);
  const [project, setProject] = useState<TpLocalFileProject | null>(null);
  const [projectName, setProjectName] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("sources");
  const [files, setFiles] = useState<File[]>([]);
  const [documentKind, setDocumentKind] = useState<TpSourceDocument["kind"]>("auto_mixed");
  const [autoDetectScopes, setAutoDetectScopes] = useState(true);
  const [selectedScopes, setSelectedScopes] = useState<TpExtractionScope[]>(tpExtractionScopes.map((scope) => scope.id));
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [externalResearchConfigured, setExternalResearchConfigured] = useState(false);
  const [useExternalResearch, setUseExternalResearch] = useState(false);
  const [agentRuns, setAgentRuns] = useState<TpAgentRun[]>([]);
  const [agentPlan, setAgentPlan] = useState<TpWorkflowPlan | null>(null);
  const [manualSourceTitle, setManualSourceTitle] = useState("");
  const [manualSourceUrl, setManualSourceUrl] = useState("");
  const [manualSourceSnippet, setManualSourceSnippet] = useState("");
  const [manualSourceType, setManualSourceType] = useState<"official" | "industry" | "comparable_candidate">("industry");
  const [approvalNotes, setApprovalNotes] = useState("");
  const [manualStep, setManualStep] = useState(0);
  const [manualEvidenceTitle, setManualEvidenceTitle] = useState("");
  const [manualEvidenceKind, setManualEvidenceKind] = useState<TpManualEvidence["sourceKind"]>("management_interview");
  const [manualEvidenceReference, setManualEvidenceReference] = useState("");
  const [manualEvidenceLocator, setManualEvidenceLocator] = useState("");
  const [manualEvidenceExcerpt, setManualEvidenceExcerpt] = useState("");
  const [manualEvidencePaths, setManualEvidencePaths] = useState("");

  const headers = useMemo(() => ({ [LLM_MODEL_HEADER]: modelChoice }), [modelChoice]);
  const completeness = project ? tpProjectCompleteness(project.state) : 0;
  const readiness = useMemo(() => project ? tpGenerationReadiness(project.state) : null, [project]);
  const approvedDocumentVersion = useMemo(() => {
    const currentHash = agentRuns[0]?.inputHash;
    const approval = agentRuns.find((run) => run.inputHash === currentHash && run.stage === "human_approval" && run.status === "succeeded");
    const result = agentRunResult(approval);
    return result.decision === "approved" ? String(result.reviewedDocumentVersion || "") : "";
  }, [agentRuns]);
  const qaEligibleForApproval = useMemo(() => {
    const currentHash = agentRuns[0]?.inputHash;
    const qa = agentRuns.find((run) => run.inputHash === currentHash && run.stage === "qa" && run.status === "succeeded");
    return agentRunResult(qa).releaseRecommendation === "human_review";
  }, [agentRuns]);
  const hasActiveAgentRuns = agentRuns.some((run) => ["queued", "retry_wait", "running"].includes(run.status));
  const manualSteps = [
    { title: en ? "Entity and scope" : "Entitas dan ruang lingkup", note: en ? "Taxpayer identity and covered fiscal year" : "Identitas wajib pajak dan tahun yang dicakup" },
    { title: en ? "Group and business" : "Grup dan kegiatan usaha", note: en ? "Ownership, management, operations, and related parties" : "Kepemilikan, manajemen, usaha, dan pihak afiliasi" },
    { title: en ? "Controlled transactions" : "Transaksi afiliasi", note: en ? "Transaction register, agreements, and pricing policy" : "Register transaksi, perjanjian, dan kebijakan harga" },
    { title: "FAR", note: en ? "Functions, assets, risks, contracts, and benefit test" : "Fungsi, aset, risiko, kontrak, dan benefit test" },
    { title: en ? "Method and benchmark" : "Metode dan benchmark", note: en ? "Tested party, PLI, search trail, and comparables" : "Pihak diuji, PLI, search trail, dan pembanding" },
    { title: en ? "Financial information" : "Informasi keuangan", note: en ? "Current/prior year, tested result, and non-financial events" : "Tahun berjalan/sebelumnya, hasil uji, dan peristiwa nonkeuangan" },
    { title: en ? "Evidence and completion" : "Bukti dan penyelesaian", note: en ? "Register manual provenance, review gaps, then start agents" : "Registrasikan provenance manual, review gap, lalu jalankan agen" }
  ];

  async function loadProjects(selectFirst = false) {
    const payload = await jsonResponse<{ records: TpLocalFileProjectSummary[] }>(await fetch("/api/tp-local-files?page=1&perPage=50"));
    setProjects(payload.records || []);
    if (selectFirst && payload.records?.[0]) await selectProject(payload.records[0].id);
  }

  async function selectProject(id: string) {
    setError("");
    const payload = await jsonResponse<{ project: TpLocalFileProject }>(await fetch(`/api/tp-local-files/${encodeURIComponent(id)}`));
    setProject(payload.project);
    setProjectName(payload.project.name);
    await loadAgentPipeline(id).catch(() => undefined);
  }

  async function loadAgentPipeline(projectId = project?.id) {
    if (!projectId) return;
    const payload = await jsonResponse<{ runs: TpAgentRun[]; plan: TpWorkflowPlan }>(await fetch(`/api/tp-local-files/${encodeURIComponent(projectId)}/pipeline`));
    setAgentRuns(payload.runs || []);
    setAgentPlan(payload.plan || null);
  }

  useEffect(() => {
    void loadProjects(true).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    void fetch("/api/tp-local-files/research-status")
      .then((response) => jsonResponse<{ configured: boolean }>(response))
      .then((payload) => {
        setExternalResearchConfigured(payload.configured);
        setUseExternalResearch(false);
      })
      .catch(() => setExternalResearchConfigured(false));
  }, []);

  useEffect(() => {
    if (!project?.id || !hasActiveAgentRuns) return;
    const projectId = project.id;
    const timer = window.setInterval(() => {
      void Promise.all([
        fetch(`/api/tp-local-files/${encodeURIComponent(projectId)}/pipeline`).then((response) => jsonResponse<{ runs: TpAgentRun[]; plan: TpWorkflowPlan }>(response)),
        fetch(`/api/tp-local-files/${encodeURIComponent(projectId)}`).then((response) => jsonResponse<{ project: TpLocalFileProject }>(response))
      ]).then(([pipeline, current]) => {
        setAgentRuns(pipeline.runs || []);
        setAgentPlan(pipeline.plan || null);
        setProject(current.project);
        setProjectName(current.project.name);
      }).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [project?.id, hasActiveAgentRuns]);

  async function createProjectRecord(name = "", initialTab: WorkspaceTab = "sources") {
    const payload = await jsonResponse<{ project: TpLocalFileProject }>(await fetch("/api/tp-local-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || (en ? "New TP Local File" : "Local File TP Baru") })
    }));
    setProject(payload.project);
    setProjectName(payload.project.name);
    setTab(initialTab);
    if (initialTab === "manual") setManualStep(0);
    await loadProjects();
    return payload.project;
  }

  async function createProject() {
    setBusy(true); setError("");
    try { await createProjectRecord(projectName); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function startManualProject() {
    setBusy(true); setError("");
    try { await createProjectRecord(projectName || (en ? "Manual TP Local File" : "Local File TP Manual"), "manual"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function saveProject(nextProject = project, message = en ? "Project saved." : "Proyek disimpan.") {
    if (!nextProject) return null;
    const payload = await jsonResponse<{ project: TpLocalFileProject }>(await fetch(`/api/tp-local-files/${encodeURIComponent(nextProject.id)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextProject)
    }));
    setProject(payload.project); setProjectName(payload.project.name); setStatus(message); await loadProjects();
    return payload.project;
  }

  function updateState(patch: Partial<TpProjectState>) {
    setProject((current) => current ? { ...current, state: { ...current.state, ...patch } } : current);
  }

  async function saveManualStep(nextStep?: number) {
    if (!project) return;
    setBusy(true); setError("");
    try {
      const saved = await saveProject({ ...project, name: projectName || project.name }, en ? "Manual TP inputs saved." : "Input TP manual disimpan.");
      if (saved && typeof nextStep === "number") setManualStep(Math.max(0, Math.min(manualStepPaths.length - 1, nextStep)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function addManualEvidence() {
    if (!project) return;
    const fieldPaths = Array.from(new Set(manualEvidencePaths.split(/[\n,]+/).map((entry) => entry.trim()).filter((entry) => /^[a-zA-Z][a-zA-Z0-9.[\]#_-]{0,240}$/.test(entry))));
    if (!manualEvidenceTitle.trim() || !manualEvidenceReference.trim() || !manualEvidenceLocator.trim() || !manualEvidenceExcerpt.trim() || !fieldPaths.length) {
      setError(en ? "Evidence title, reference/owner, locator, excerpt/note, and at least one valid field path are required." : "Judul bukti, referensi/pemilik, lokator, kutipan/catatan, dan minimal satu field path yang valid wajib diisi.");
      return;
    }
    const unsupportedPaths = fieldPaths.filter((path) => !manualValuePresent(valueAtManualPath(project.state, path)));
    if (unsupportedPaths.length) {
      setError(en
        ? `Evidence can only support populated fields. Check: ${unsupportedPaths.join(", ")}.`
        : `Bukti hanya boleh menunjuk field yang sudah terisi. Periksa: ${unsupportedPaths.join(", ")}.`);
      return;
    }
    const evidence: TpManualEvidence = {
      id: `manual-evidence-${crypto.randomUUID()}`,
      title: manualEvidenceTitle.trim().slice(0, 300),
      sourceKind: manualEvidenceKind,
      reference: manualEvidenceReference.trim().slice(0, 500),
      locator: manualEvidenceLocator.trim().slice(0, 500),
      excerpt: manualEvidenceExcerpt.trim().slice(0, 4_000),
      fieldPaths,
      createdAt: new Date().toISOString()
    };
    const fieldSources = { ...project.state.fieldSources };
    fieldPaths.forEach((path) => { fieldSources[path] = Array.from(new Set([...(fieldSources[path] || []), evidence.id])); });
    setBusy(true); setError("");
    try {
      await saveProject({
        ...project,
        state: {
          ...project.state,
          manualEvidence: [...project.state.manualEvidence, evidence],
          fieldSources
        }
      }, en ? "Manual evidence registered; verification is still required." : "Bukti manual diregistrasikan; verifikasi tetap diperlukan.");
      setManualEvidenceTitle(""); setManualEvidenceReference(""); setManualEvidenceLocator(""); setManualEvidenceExcerpt("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function removeManualEvidence(evidenceId: string) {
    if (!project) return;
    const fieldSources = Object.fromEntries(Object.entries(project.state.fieldSources).map(([path, ids]) => [path, ids.filter((id) => id !== evidenceId)]).filter(([, ids]) => ids.length));
    await saveProject({ ...project, state: { ...project.state, manualEvidence: project.state.manualEvidence.filter((entry) => entry.id !== evidenceId), fieldSources } }, en ? "Manual evidence removed." : "Bukti manual dihapus.");
  }

  async function uploadAndExtractFiles(targetProject: TpLocalFileProject, sourceFiles: File[]) {
    let working = { ...targetProject, documents: [...targetProject.documents] };
    for (let index = 0; index < sourceFiles.length; index += 1) {
      const file = sourceFiles[index];
      setStatus(`${en ? "Uploading" : "Mengunggah"} ${index + 1}/${sourceFiles.length}: ${file.name}`);
      const blob = await upload(`tp-local-files/${targetProject.id}/${Date.now()}-${safePart(file.name)}`, file, {
          access: "private",
          handleUploadUrl: "/api/blob/upload",
          multipart: file.size > 8 * 1024 * 1024,
          clientPayload: JSON.stringify({ projectId: targetProject.id, kind: documentKind, filename: file.name })
      });
      const source: TpSourceDocument = {
        id: `tpdoc-${crypto.randomUUID()}`,
        filename: file.name,
        kind: documentKind,
        url: blob.url,
        downloadUrl: blob.downloadUrl || blob.url,
        size: file.size,
        status: "uploaded",
        extractionMessage: "",
        uploadedAt: new Date().toISOString(),
        requestedScopes: autoDetectScopes ? [] : selectedScopes,
        detectedScopes: [],
        coverage: [],
        evidence: []
      };
      working = (await saveProject({ ...working, documents: [...working.documents, source] }, en ? "Document uploaded." : "Dokumen diunggah.")) || working;
      setStatus(`${en ? "Extracting" : "Mengekstrak"} ${file.name}`);
      const extracted = await jsonResponse<{ project: TpLocalFileProject }>(await fetch(`/api/tp-local-files/${encodeURIComponent(targetProject.id)}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ documentId: source.id, language })
      }));
      working = extracted.project;
      setProject(working);
    }
    setFiles([]);
    try {
      await queueAgentPipeline(working);
      await runNextAgent(working.id);
      setTab("agents");
      setStatus(en ? "Documents extracted; the resumable TP agent workflow has started." : "Dokumen selesai diekstrak; workflow agent TP yang resumable telah dimulai.");
    } catch (reason) {
      setStatus(en ? "Documents extracted. Start the agent workflow from the Agent tab when the queue is available." : "Dokumen selesai diekstrak. Jalankan workflow dari tab Agent saat antrean tersedia.");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    await loadProjects();
    return working;
  }

  async function uploadAndExtract() {
    if (!project || !files.length) return;
    setBusy(true); setError(""); setStatus("");
    try { await uploadAndExtractFiles(project, files); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function retryDocumentExtraction(documentId: string) {
    if (!project) return;
    setBusy(true); setError(""); setStatus(en ? "Retrying document extraction..." : "Mengulangi ekstraksi dokumen...");
    try {
      const extracted = await jsonResponse<{ project: TpLocalFileProject }>(await fetch(`/api/tp-local-files/${encodeURIComponent(project.id)}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ documentId, language })
      }));
      setProject(extracted.project);
      await queueAgentPipeline(extracted.project);
      setStatus(en ? "Document re-extracted and the agent workflow was resumed." : "Dokumen selesai diekstrak ulang dan workflow agent dilanjutkan.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function startFromSource() {
    if (!files.length) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const inferredName = files[0].name.replace(/\.(pdf|docx?)$/i, "").replace(/[-_]+/g, " ").trim();
      const created = await createProjectRecord(projectName || inferredName);
      await uploadAndExtractFiles(created, files);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function analyzeProject() {
    if (!project) return;
    setBusy(true); setError(""); setStatus(en ? "Preparing TP advisor review..." : "Menyiapkan review advisor TP...");
    try {
      await saveProject({ ...project, name: projectName || project.name });
      const payload = await jsonResponse<{ project: TpLocalFileProject; research?: { status: string; sourceCount: number; warnings: string[] } }>(await fetch(`/api/tp-local-files/${encodeURIComponent(project.id)}/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ language, useExternalResearch })
      }));
      const sourceNote = payload.research?.sourceCount
        ? ` ${payload.research.sourceCount} ${en ? "external sources reviewed." : "sumber eksternal ditelaah."}`
        : "";
      setProject(payload.project); setStatus(`${en ? "Advisor review completed." : "Review advisor selesai."}${sourceNote}`); setTab("review"); await loadProjects();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  }

  async function startAgentPipeline() {
    if (!project) return;
    setBusy(true); setError(""); setStatus(en ? "Queueing the TP agent workflow..." : "Menyiapkan antrean workflow agent TP...");
    try {
      const saved = await saveProject({ ...project, name: projectName || project.name });
      if (!saved) return;
      await queueAgentPipeline(saved);
      await runNextAgent(saved.id);
      setTab("agents");
      setStatus(en ? "Agent workflow queued. It can resume from stored checkpoints." : "Workflow agent masuk antrean dan dapat dilanjutkan dari checkpoint tersimpan.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function queueAgentPipeline(targetProject: TpLocalFileProject) {
    const payload = await jsonResponse<{ runs: TpAgentRun[]; plan: TpWorkflowPlan }>(await fetch(`/api/tp-local-files/${encodeURIComponent(targetProject.id)}/pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ action: "start", language, useExternalResearch })
    }));
    setAgentRuns(payload.runs || []); setAgentPlan(payload.plan || null);
    return payload;
  }

  async function runNextAgent(projectId = project?.id) {
    if (!projectId) return;
    const payload = await jsonResponse<{ runs: TpAgentRun[]; plan: TpWorkflowPlan }>(await fetch(`/api/tp-local-files/${encodeURIComponent(projectId)}/pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run_next" })
    }));
    setAgentRuns(payload.runs || []); setAgentPlan(payload.plan || null);
    return payload;
  }

  async function cancelAgentPipeline() {
    if (!project) return;
    setBusy(true); setError("");
    try {
      const payload = await jsonResponse<{ runs: TpAgentRun[]; plan: TpWorkflowPlan }>(await fetch(`/api/tp-local-files/${encodeURIComponent(project.id)}/pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", reason: "Cancelled from the TP workspace." })
      }));
      setAgentRuns(payload.runs || []); setAgentPlan(payload.plan || null);
      setStatus(en ? "Active agent runs cancelled." : "Proses agent aktif dibatalkan.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function recordHumanReview(decision: "approved" | "changes_requested" | "rejected") {
    if (!project) return;
    setBusy(true); setError("");
    try {
      const payload = await jsonResponse<{ runs: TpAgentRun[]; plan: TpWorkflowPlan }>(await fetch(`/api/tp-local-files/${encodeURIComponent(project.id)}/pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "human_review", decision, notes: approvalNotes })
      }));
      setAgentRuns(payload.runs || []); setAgentPlan(payload.plan || null);
      setStatus(decision === "approved"
        ? (en ? "The exact QA-passed version was approved." : "Versi tepat yang lolos QA telah disetujui.")
        : (en ? "The review decision was recorded." : "Keputusan review telah dicatat."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function addManualResearchSource() {
    if (!project) return;
    setError("");
    try {
      const sourceUrl = new URL(manualSourceUrl.trim());
      if (!/^https?:$/.test(sourceUrl.protocol)) throw new Error(en ? "Use an HTTP(S) source URL." : "Gunakan URL sumber HTTP(S).");
      if (!manualSourceTitle.trim()) throw new Error(en ? "Source title is required." : "Judul sumber wajib diisi.");
      const source = {
        title: manualSourceTitle.trim().slice(0, 500),
        url: sourceUrl.toString(),
        domain: sourceUrl.hostname.replace(/^www\./, ""),
        sourceType: manualSourceType,
        query: "Manual advisor research",
        snippet: manualSourceSnippet.trim().slice(0, 4_000),
        score: 0,
        qualityTier: "discovery_only" as const,
        qualityReason: "Manually supplied source; verification and quality classification remain required.",
        publishedDate: "",
        retrievedAt: new Date().toISOString()
      };
      const nextProject = {
        ...project,
        state: {
          ...project.state,
          analysis: {
            ...project.state.analysis,
            externalResearchSources: [
              ...project.state.analysis.externalResearchSources.filter((item) => item.url !== source.url),
              source
            ],
            externalResearchStatus: "partial" as const,
            externalResearchWarnings: Array.from(new Set([
              ...project.state.analysis.externalResearchWarnings,
              "Manual research sources require source and claim verification before use."
            ]))
          }
        }
      };
      await saveProject(nextProject, en ? "Manual research source saved." : "Sumber riset manual disimpan.");
      setManualSourceTitle(""); setManualSourceUrl(""); setManualSourceSnippet("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function deleteProject() {
    if (!project || !window.confirm(en ? "Delete this TP project and its uploaded files?" : "Hapus proyek TP dan file yang diunggah?")) return;
    setBusy(true); setError("");
    try {
      await jsonResponse(await fetch(`/api/tp-local-files/${encodeURIComponent(project.id)}`, { method: "DELETE" }));
      setProject(null); setProjectName(""); await loadProjects(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  }

  if (!project) {
    return <section className="tp-workspace empty">
      <div><p className="eyebrow">TP LOCAL FILE</p><h2>{en ? "Build a complete Local File from documents or manual inputs" : "Susun Local File lengkap dari dokumen atau input manual"}</h2><p>{en ? "Start with PDF/Word evidence, or use the guided manual workflow when no file is available. Manual facts remain unverified until their provenance and review are recorded." : "Mulai dari bukti PDF/Word, atau gunakan alur manual terpandu bila belum ada file. Fakta manual tetap belum terverifikasi sampai provenance dan reviewnya dicatat."}</p></div>
      {error && <div className="status-banner error">{error}</div>}
      <div className="tp-start-card">
        <div className="tp-start-step"><span>1</span><div><strong>{en ? "Choose the first source document" : "Pilih dokumen sumber pertama"}</strong><small>{en ? "A company profile is recommended, but you can start from any available document." : "Profil perusahaan disarankan, tetapi Anda dapat mulai dari dokumen apa pun yang tersedia."}</small></div></div>
        <div className="tp-start-grid">
          <label className="tp-field"><span>{en ? "Document category" : "Kategori dokumen"}</span><select value={documentKind} onChange={(event) => setDocumentKind(event.target.value as TpSourceDocument["kind"])}>{tpDocumentKinds.map((kind) => <option key={kind.id} value={kind.id}>{en ? kind.en : kind.idLabel}</option>)}</select></label>
          <label className="tp-field"><span>{en ? "Project name (optional)" : "Nama proyek (opsional)"}</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={en ? "Automatically taken from the file name" : "Otomatis dari nama file"} /></label>
        </div>
        <ScopeSelector language={language} auto={autoDetectScopes} selected={selectedScopes} onAutoChange={setAutoDetectScopes} onChange={setSelectedScopes} />
        <label className="tp-source-drop"><span>{en ? "Upload PDF or Word source documents" : "Unggah dokumen sumber PDF atau Word"}</span><input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} /><small>{files.length ? `${files.length} ${en ? "file(s) selected" : "file dipilih"}` : (en ? "Company profile, legal ownership, financial statement, TP policy, agreement, or other evidence." : "Profil perusahaan, legalitas kepemilikan, laporan keuangan, kebijakan TP, perjanjian, atau bukti lain.")}</small></label>
        <div className="tp-start-actions"><button className="primary-button" onClick={startFromSource} disabled={busy || !files.length}>{busy ? (en ? "Creating & extracting..." : "Membuat & mengekstrak...") : (en ? "Start from document" : "Mulai dari dokumen")}</button><button className="table-button" onClick={startManualProject} disabled={busy}>{en ? "Start manual TP workflow" : "Mulai alur TP manual"}</button></div>
      </div>
    </section>;
  }

  return <section className="tp-workspace">
    <header className="tp-workspace-header">
      <div><p className="eyebrow">TP LOCAL FILE · PLATINUM</p><h2>{en ? "Transfer Pricing Working Paper" : "Working Paper Transfer Pricing"}</h2><p>{en ? "Use documents, guided manual inputs, or both; every route reaches the same evidence, advisor, QA, and approval gates." : "Gunakan dokumen, input manual terpandu, atau keduanya; seluruh jalur melewati evidence, advisor, QA, dan approval gate yang sama."}</p></div>
      <div className="tp-header-actions"><button className="table-button" onClick={createProject} disabled={busy}>+ {en ? "New" : "Baru"}</button><button className="table-button danger" onClick={deleteProject} disabled={busy}>{en ? "Delete" : "Hapus"}</button></div>
    </header>

    <div className="tp-project-bar">
      <label><span>{en ? "Project" : "Proyek"}</span><select value={project.id} onChange={(event) => void selectProject(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.companyName || item.name} · {item.fiscalYear || item.status}</option>)}</select></label>
      <label className="tp-project-name"><span>{en ? "Working title" : "Judul kerja"}</span><input value={projectName} onChange={(event) => { setProjectName(event.target.value); setProject((current) => current ? { ...current, name: event.target.value } : current); }} /></label>
      <div className="tp-completeness"><span>{en ? "Completeness" : "Kelengkapan"}</span><strong>{completeness}%</strong><progress max="100" value={completeness} /></div>
    </div>

    <nav className="tp-tabs" aria-label="TP Local File sections">
      {([[
        "manual", en ? "1. Manual workflow" : "1. Alur manual"
      ], ["sources", en ? "2. Source documents" : "2. Dokumen sumber"], ["profile", en ? "3. Company profile" : "3. Profil perusahaan"], ["transactions", en ? "4. Transactions & method" : "4. Transaksi & metode"], ["readiness", en ? "5. Generation readiness" : "5. Kesiapan generasi"], ["agents", en ? "6. Agent workflow" : "6. Workflow agent"], ["review", en ? "7. Advisor review" : "7. Review advisor"]] as Array<[WorkspaceTab, string]>).map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); if (key === "agents") void loadAgentPipeline(); }}>{label}</button>)}
    </nav>

    <div className={`tp-research-control ${externalResearchConfigured ? "ready" : "unavailable"}`}>
      <label>
        <input type="checkbox" checked={useExternalResearch} disabled={!externalResearchConfigured || busy} onChange={(event) => setUseExternalResearch(event.target.checked)} />
        <span><strong>{en ? "External comparable research (explicit opt-in)" : "Riset pembanding eksternal (persetujuan eksplisit)"}</strong><small>{externalResearchConfigured ? (en ? "When selected, Tavily receives filtered business descriptors only; client identity and transaction values are excluded." : "Jika dicentang, Tavily hanya menerima deskriptor usaha yang telah difilter; identitas klien dan nilai transaksi tidak dikirim.") : (en ? "Add TAVILY_API_KEY to enable structured research." : "Tambahkan TAVILY_API_KEY untuk mengaktifkan riset terstruktur.")}</small></span>
      </label>
      <b>{externalResearchConfigured ? (en ? "Ready" : "Siap") : (en ? "Not configured" : "Belum dikonfigurasi")}</b>
    </div>

    {status && <div className="status-banner success compact-status">{status}</div>}
    {error && <div className="status-banner error compact-status">{error}</div>}

    {tab === "manual" && <ManualTpWorkflow
      language={language}
      project={project}
      steps={manualSteps}
      step={manualStep}
      busy={busy}
      readiness={readiness}
      evidenceForm={{
        title: manualEvidenceTitle,
        kind: manualEvidenceKind,
        reference: manualEvidenceReference,
        locator: manualEvidenceLocator,
        excerpt: manualEvidenceExcerpt,
        paths: manualEvidencePaths
      }}
      onStepChange={setManualStep}
      onUpdateState={updateState}
      onEvidenceTitleChange={setManualEvidenceTitle}
      onEvidenceKindChange={setManualEvidenceKind}
      onEvidenceReferenceChange={setManualEvidenceReference}
      onEvidenceLocatorChange={setManualEvidenceLocator}
      onEvidenceExcerptChange={setManualEvidenceExcerpt}
      onEvidencePathsChange={setManualEvidencePaths}
      onAddEvidence={() => void addManualEvidence()}
      onRemoveEvidence={(evidenceId) => void removeManualEvidence(evidenceId)}
      onSaveStep={(nextStep) => void saveManualStep(nextStep)}
      onReviewGaps={() => setTab("readiness")}
      onStartAgents={() => void startAgentPipeline()}
    />}

    {tab === "sources" && <div className="tp-tab-panel sources">
      <div className="tp-upload-strip">
        <label><span>{en ? "Document category" : "Kategori dokumen"}</span><select value={documentKind} onChange={(event) => setDocumentKind(event.target.value as TpSourceDocument["kind"])}>{tpDocumentKinds.map((kind) => <option key={kind.id} value={kind.id}>{en ? kind.en : kind.idLabel}</option>)}</select></label>
        <label className="tp-file-picker"><span>{en ? "PDF or Word files" : "File PDF atau Word"}</span><input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} /></label>
        <button className="primary-button" onClick={uploadAndExtract} disabled={busy || !files.length}>{busy ? (en ? "Processing..." : "Memproses...") : (en ? "Upload & extract" : "Unggah & ekstrak")}</button>
      </div>
      <ScopeSelector language={language} auto={autoDetectScopes} selected={selectedScopes} onAutoChange={setAutoDetectScopes} onChange={setSelectedScopes} compact />
      <div className="tp-document-list">
        {project.documents.length ? project.documents.map((document) => <article key={document.id}>
          <div><strong>{document.filename}</strong><span>{tpDocumentKinds.find((kind) => kind.id === document.kind)?.[en ? "en" : "idLabel"]}</span><a href={`/api/tp-local-files/${encodeURIComponent(project.id)}/documents/${encodeURIComponent(document.id)}`} target="_blank" rel="noreferrer">{en ? "Open authorized source" : "Buka sumber terotorisasi"}</a>{Boolean(document.detectedScopes?.length) && <div className="tp-detected-scopes">{document.detectedScopes?.map((scope) => <span key={scope}>{en ? tpExtractionScopes.find((item) => item.id === scope)?.en : tpExtractionScopes.find((item) => item.id === scope)?.idLabel}</span>)}</div>}</div>
          <div><span className={`tp-status ${document.status}`}>{document.status}</span><small>{document.extractionMessage || (en ? "Waiting for extraction" : "Menunggu ekstraksi")}</small>{document.status !== "extracted" && <button className="table-button" onClick={() => void retryDocumentExtraction(document.id)} disabled={busy}>{en ? "Retry extraction" : "Ulangi ekstraksi"}</button>}</div>
        </article>) : <div className="empty-state compact"><strong>{en ? "No source documents yet." : "Belum ada dokumen sumber."}</strong><span>{en ? "A company profile is a good first document." : "Profil perusahaan adalah dokumen awal yang baik."}</span></div>}
      </div>
    </div>}

    {tab === "profile" && <div className="tp-tab-panel">
      <div className="tp-form-grid">
        <Field label={en ? "Company name" : "Nama perusahaan"} value={project.state.companyName} onChange={(companyName) => updateState({ companyName })} />
        <Field label="NPWP" value={project.state.npwp} onChange={(npwp) => updateState({ npwp })} />
        <Field label={en ? "Fiscal year" : "Tahun pajak"} value={project.state.fiscalYear} onChange={(fiscalYear) => updateState({ fiscalYear })} />
        <Field label={en ? "Parent company" : "Entitas induk"} value={project.state.parentCompany} onChange={(parentCompany) => updateState({ parentCompany })} />
        <Field label={en ? "Group" : "Grup"} value={project.state.parentGroup} onChange={(parentGroup) => updateState({ parentGroup })} />
        <Field label={en ? "Employees" : "Jumlah pegawai"} value={project.state.employeeCount} onChange={(employeeCount) => updateState({ employeeCount })} />
      </div>
      <Area label={en ? "Address" : "Alamat"} value={project.state.companyAddress} onChange={(companyAddress) => updateState({ companyAddress })} />
      <Area label={en ? "Business activities" : "Kegiatan usaha"} value={project.state.businessActivities} onChange={(businessActivities) => updateState({ businessActivities })} />
      <Area label={en ? "Business strategy" : "Strategi bisnis"} value={project.state.businessStrategy} onChange={(businessStrategy) => updateState({ businessStrategy })} />
      <Area label={en ? "Organization narrative" : "Narasi struktur organisasi"} value={project.state.organizationStructure} onChange={(organizationStructure) => updateState({ organizationStructure })} />
      <EditableShareholders language={language} rows={project.state.shareholders} onChange={(shareholders) => updateState({ shareholders })} />
      <EditableManagement language={language} rows={project.state.management} onChange={(management) => updateState({ management })} />
      <EditableDepartments language={language} rows={project.state.organizationDepartments} onChange={(organizationDepartments) => updateState({ organizationDepartments })} />
      <EditableAffiliates language={language} rows={project.state.affiliatedParties} onChange={(affiliatedParties) => updateState({ affiliatedParties })} />
      <div className="tp-sticky-actions"><button className="primary-button" onClick={() => void saveProject({ ...project, name: projectName || project.name })} disabled={busy}>{en ? "Save profile" : "Simpan profil"}</button></div>
    </div>}

    {tab === "transactions" && <div className="tp-tab-panel">
      <Area label={en ? "Transaction background and commercial rationale" : "Latar belakang dan rasional komersial transaksi"} value={project.state.backgroundTransaction} onChange={(backgroundTransaction) => updateState({ backgroundTransaction })} />
      <Area label={en ? "Controlled transaction details" : "Detail transaksi afiliasi"} value={project.state.transactionDetails} onChange={(transactionDetails) => updateState({ transactionDetails })} />
      <Area label={en ? "Pricing policy" : "Kebijakan harga"} value={project.state.pricingPolicy} onChange={(pricingPolicy) => updateState({ pricingPolicy })} />
      <Area label={en ? "Supply chain and transaction flow" : "Rantai pasok dan alur transaksi"} value={project.state.supplyChainManagement} onChange={(supplyChainManagement) => updateState({ supplyChainManagement })} />
      <EditableTransactions language={language} rows={project.state.affiliatedTransactions} onChange={(affiliatedTransactions) => updateState({ affiliatedTransactions })} />
      <div className="tp-financial-comparison">
        <section><h3>{en ? "Current-year financial information" : "Informasi keuangan tahun berjalan"}</h3><div className="tp-form-grid two-compact">{Object.entries(project.state.financialData).map(([key, entry]) => <Field key={key} label={financialLabel(key, language)} value={entry} onChange={(value) => updateState({ financialData: { ...project.state.financialData, [key]: value } })} />)}</div></section>
        <section><h3>{en ? "Prior-year financial information" : "Informasi keuangan tahun sebelumnya"}</h3><div className="tp-form-grid two-compact">{Object.entries(project.state.financialDataPrior).map(([key, entry]) => <Field key={key} label={financialLabel(key, language)} value={entry} onChange={(value) => updateState({ financialDataPrior: { ...project.state.financialDataPrior, [key]: value } })} />)}</div></section>
      </div>
      <h3>{en ? "Method and testing parameters" : "Metode dan parameter pengujian"}</h3>
      <div className="tp-form-grid three">
        <Field label={en ? "Selected method" : "Metode terpilih"} value={project.state.selectedMethod} onChange={(selectedMethod) => updateState({ selectedMethod })} />
        <Field label="PLI" value={project.state.selectedPli} onChange={(selectedPli) => updateState({ selectedPli })} />
        <Field label={en ? "Tested party" : "Pihak yang diuji"} value={project.state.testedParty} onChange={(testedParty) => updateState({ testedParty })} />
        <Field label={en ? "Analysis period" : "Periode analisis"} value={project.state.analysisPeriod} onChange={(analysisPeriod) => updateState({ analysisPeriod })} />
        <Field label="Q1" value={project.state.quartileRange.q1} onChange={(q1) => updateState({ quartileRange: { ...project.state.quartileRange, q1 } })} />
        <Field label={en ? "Median" : "Median"} value={project.state.quartileRange.median} onChange={(median) => updateState({ quartileRange: { ...project.state.quartileRange, median } })} />
        <Field label="Q3" value={project.state.quartileRange.q3} onChange={(q3) => updateState({ quartileRange: { ...project.state.quartileRange, q3 } })} />
        <Field label={en ? "Tested-party ratio" : "Rasio pihak diuji"} value={project.state.testedPartyRatio} onChange={(testedPartyRatio) => updateState({ testedPartyRatio })} />
      </div>
      <Area label={en ? "Comparability factors" : "Faktor kesebandingan"} value={project.state.comparabilityFactors} onChange={(comparabilityFactors) => updateState({ comparabilityFactors })} />
      <EditableSearchCriteria language={language} rows={project.state.searchCriteriaResults} onChange={(searchCriteriaResults) => updateState({ searchCriteriaResults })} />
      <EditableComparables language={language} rows={project.state.comparableCompanies} onChange={(comparableCompanies) => updateState({ comparableCompanies })} />
      <EditableRejectionMatrix language={language} rows={project.state.rejectionMatrix} onChange={(rejectionMatrix) => updateState({ rejectionMatrix })} />
      <div className="tp-sticky-actions"><button className="primary-button" onClick={() => void saveProject({ ...project, name: projectName || project.name })} disabled={busy}>{en ? "Save working paper" : "Simpan working paper"}</button><button className="primary-button secondary-button" onClick={analyzeProject} disabled={busy}>{en ? "Run advisor analysis" : "Jalankan analisis advisor"}</button></div>
    </div>}

    {tab === "readiness" && readiness && <div className="tp-tab-panel readiness">
      <div className="tp-readiness-intro">
        <div><h3>{en ? "What goes into the Local File" : "Apa saja yang masuk ke Local File"}</h3><p>{en ? "This map follows the original TP-Doc workflow. It separates reusable template content, facts extracted from source documents, supporting documents normally still required, and professional judgments that must be confirmed before the final draft." : "Peta ini mengikuti alur TP-Doc asli. Isinya memisahkan konten template yang dapat digunakan ulang, fakta dari dokumen sumber, dokumen pendukung yang biasanya masih diperlukan, dan pertimbangan profesional yang wajib dikonfirmasi sebelum draft final."}</p></div>
        <div className={`tp-readiness-callout ${readiness.blockers.length ? "warning" : "ready"}`}><strong>{readiness.blockers.length ? `${readiness.blockers.length} ${en ? "final-draft checks remain" : "pemeriksaan draft final tersisa"}` : (en ? "Ready for final review" : "Siap untuk review final")}</strong><span>{en ? "A working draft can still be generated with clearly marked gaps." : "Draft kerja tetap dapat dibuat dengan gap yang ditandai jelas."}</span></div>
      </div>
      <div className="tp-readiness-summary">
        {readiness.summary.map((item) => <div key={item.category} className={`category-${item.category}`}><span>{requirementCategoryLabel(item.category, language)}</span><strong>{item.ready}/{item.total}</strong><small>{en ? "complete" : "lengkap"}</small></div>)}
      </div>
      <div className="tp-requirement-list">
        {readiness.requirements.map((item) => <article key={item.id}>
          <div className="tp-requirement-main"><span className={`tp-requirement-status ${item.status}`}>{requirementStatusLabel(item.status, language)}</span><div><strong>{en ? item.en : item.idLabel}</strong><small>{item.section} · {requirementCategoryLabel(item.category, language)}</small></div></div>
          <div className="tp-requirement-action">{item.expectedSources.length ? <span>{en ? "Typical source" : "Sumber umum"}: {item.expectedSources.map((scope) => en ? tpExtractionScopes.find((entry) => entry.id === scope)?.en : tpExtractionScopes.find((entry) => entry.id === scope)?.idLabel).join(", ")}</span> : <span>{item.category === "advisor" ? (en ? "Confirm in Transactions & method" : "Konfirmasi di Transaksi & metode") : (en ? "Provided by the report template" : "Disediakan oleh template laporan")}</span>}{item.requiredBeforeFinal && <b>{en ? "Required for final" : "Wajib untuk final"}</b>}</div>
        </article>)}
      </div>
      <div className="tp-sticky-actions"><button className="table-button" onClick={() => setTab("sources")}>{en ? "Add source document" : "Tambah dokumen sumber"}</button><button className="table-button" onClick={() => setTab("transactions")}>{en ? "Complete advisor inputs" : "Lengkapi input advisor"}</button><button className="primary-button" onClick={analyzeProject} disabled={busy}>{en ? "Generate advisor working draft" : "Buat draft kerja advisor"}</button></div>
    </div>}

    {tab === "agents" && <div className="tp-tab-panel tp-agent-workflow">
      <div className="tp-readiness-intro">
        <div><h3>{en ? "Evidence-first TP agent workflow" : "Workflow agent TP berbasis bukti"}</h3><p>{en ? "Each specialist works from a stored project snapshot. AI may extract, research, challenge, and draft; deterministic gates control progression and a human remains responsible for final approval." : "Setiap spesialis bekerja dari snapshot proyek yang tersimpan. AI dapat mengekstrak, meneliti, menguji, dan menyusun; quality gate deterministik mengontrol progres dan manusia tetap bertanggung jawab atas persetujuan final."}</p></div>
        <div className={`tp-readiness-callout ${agentPlan?.canFinalize ? "ready" : "warning"}`}><strong>{agentPlan?.canFinalize ? (en ? "Eligible for finalization" : "Memenuhi syarat finalisasi") : `${agentPlan?.blockers.length || 0} ${en ? "blocking issue(s)" : "blocker"}`}</strong><span>{en ? "A gap-marked working draft may be produced before final approval." : "Draft kerja dengan penanda gap dapat dibuat sebelum persetujuan final."}</span></div>
      </div>
      <div className="tp-agent-grid">
        {tpAgentDefinitions.map((definition) => {
          const latest = latestAgentRun(agentRuns, definition.stage);
          const planned = agentPlan?.stages.find((item) => item.stage === definition.stage);
          const displayedStatus = latest?.status || planned?.status || "pending";
          return <article key={definition.stage} className={`tp-agent-card status-${displayedStatus}`}>
            <header><div><small>{definition.stage.replaceAll("_", " ")}</small><strong>{definition.name}</strong></div><span>{displayedStatus.replaceAll("_", " ")}</span></header>
            <p>{definition.objective}</p>
            {latest?.lastError?.message && <div className="tp-agent-error">{latest.lastError.message}</div>}
            {planned?.recommendedActions?.[0] && <small>{planned.recommendedActions[0]}</small>}
          </article>;
        })}
      </div>
      <section className="tp-manual-research">
        <header><div><h3>{en ? "Add manual research" : "Tambahkan riset manual"}</h3><p>{en ? "Record a source found outside the AI workflow. It remains discovery-only until the Verification Agent or an advisor validates the exact claim." : "Catat sumber yang ditemukan di luar workflow AI. Sumber tetap berstatus discovery-only sampai klaimnya diverifikasi oleh Agent Verifikasi atau advisor."}</p></div></header>
        <div className="tp-form-grid three">
          <label className="tp-field"><span>{en ? "Source type" : "Jenis sumber"}</span><select value={manualSourceType} onChange={(event) => setManualSourceType(event.target.value as typeof manualSourceType)}><option value="official">{en ? "Official / regulation" : "Resmi / regulasi"}</option><option value="industry">{en ? "Industry" : "Industri"}</option><option value="comparable_candidate">{en ? "Comparable candidate" : "Kandidat pembanding"}</option></select></label>
          <Field label={en ? "Source title" : "Judul sumber"} value={manualSourceTitle} onChange={setManualSourceTitle} />
          <Field label="URL" value={manualSourceUrl} onChange={setManualSourceUrl} />
        </div>
        <Area label={en ? "Supporting excerpt / note" : "Kutipan pendukung / catatan"} value={manualSourceSnippet} onChange={setManualSourceSnippet} />
        <button className="table-button" onClick={addManualResearchSource} disabled={busy || !manualSourceTitle.trim() || !manualSourceUrl.trim()}>{en ? "Save manual source" : "Simpan sumber manual"}</button>
      </section>
      <section className="tp-manual-research">
        <header><div><h3>{en ? "Human version approval" : "Persetujuan versi oleh manusia"}</h3><p>{en ? "Approval is bound to the exact assembled version and is invalidated by any later project change." : "Persetujuan terikat pada versi hasil assembly yang tepat dan tidak berlaku untuk perubahan proyek berikutnya."}</p></div></header>
        <Area label={en ? "Reviewer notes" : "Catatan reviewer"} value={approvalNotes} onChange={setApprovalNotes} />
        <div className="tp-agent-review-actions"><button className="primary-button" onClick={() => void recordHumanReview("approved")} disabled={busy || !qaEligibleForApproval || agentPlan?.canFinalize === true}>{en ? "Approve exact QA version" : "Setujui versi QA ini"}</button><button className="table-button" onClick={() => void recordHumanReview("changes_requested")} disabled={busy || !agentRuns.some((run) => run.stage === "assembly" && run.status === "succeeded")}>{en ? "Request changes" : "Minta perubahan"}</button><button className="table-button danger" onClick={() => void recordHumanReview("rejected")} disabled={busy || !agentRuns.some((run) => run.stage === "assembly" && run.status === "succeeded")}>{en ? "Reject version" : "Tolak versi"}</button></div>
      </section>
      {agentPlan?.blockers?.length ? <section className="tp-agent-blockers"><h3>{en ? "Open blocking issues" : "Blocker yang masih terbuka"}</h3><ul>{agentPlan.blockers.slice(0, 12).map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.description}</span></li>)}</ul></section> : null}
      <div className="tp-sticky-actions"><button className="primary-button" onClick={startAgentPipeline} disabled={busy || (!project.documents.length && !project.state.manualEvidence.length)}>{en ? "Start / resume agent workflow" : "Mulai / lanjutkan workflow agent"}</button><button className="table-button" onClick={() => void runNextAgent()} disabled={busy || !agentRuns.some((run) => ["queued", "retry_wait"].includes(run.status))}>{en ? "Run next agent now" : "Jalankan agent berikutnya"}</button><button className="table-button" onClick={() => void loadAgentPipeline()} disabled={busy}>{en ? "Refresh progress" : "Perbarui progres"}</button><button className="table-button danger" onClick={cancelAgentPipeline} disabled={busy || !agentRuns.some((run) => ["queued", "retry_wait", "running"].includes(run.status))}>{en ? "Cancel active runs" : "Batalkan proses aktif"}</button></div>
    </div>}

    {tab === "review" && <div className="tp-tab-panel review">
      <div className="tp-review-summary"><div><span>{en ? "Completeness" : "Kelengkapan"}</span><strong>{completeness}%</strong></div><div><span>{en ? "Documents" : "Dokumen"}</span><strong>{project.documents.length}</strong></div><div><span>{en ? "Final checks" : "Pemeriksaan final"}</span><strong>{readiness?.blockers.length || 0}</strong></div></div>
      {!project.state.analysis.executiveSummary && <div className="empty-state compact"><strong>{en ? "Advisor analysis has not been run." : "Analisis advisor belum dijalankan."}</strong><button className="primary-button" onClick={analyzeProject} disabled={busy}>{en ? "Run analysis" : "Jalankan analisis"}</button></div>}
      {project.state.analysis.executiveSummary && <div className="tp-analysis-sections">
        <AnalysisSection title={en ? "Executive summary" : "Ringkasan eksekutif"} text={project.state.analysis.executiveSummary} />
        <AnalysisSection title={en ? "Industry and business context" : "Konteks industri dan bisnis"} text={`${project.state.analysis.industryAnalysis}\n\n${project.state.analysis.businessCharacterization}`} />
        <AnalysisSection title={en ? "Functional analysis" : "Analisis fungsi, aset, dan risiko"} text={project.state.analysis.functionalAnalysis} />
        <AnalysisSection title={en ? "Method and PLI" : "Metode dan PLI"} text={`${project.state.analysis.methodSelectionJustification}\n\n${project.state.analysis.pliSelectionRationale}`} />
        <AnalysisSection title={en ? "Comparability and conclusion" : "Kesebandingan dan kesimpulan"} text={`${project.state.analysis.comparabilityAnalysis}\n\n${project.state.analysis.conclusion}`} />
        {project.state.analysis.externalResearchSummary && <AnalysisSection title={en ? "External research synthesis" : "Sintesis riset eksternal"} text={project.state.analysis.externalResearchSummary} />}
        <ComparableResearch language={language} project={project} />
        <ListSection title={en ? "Risk flags" : "Faktor risiko"} items={project.state.analysis.riskFlags} />
        <ListSection title={en ? "Evidence still required" : "Bukti yang masih diperlukan"} items={project.state.analysis.requiredEvidence} />
        <ListSection title={en ? "Assumptions requiring confirmation" : "Asumsi yang perlu dikonfirmasi"} items={project.state.analysis.assumptions} />
        <ListSection title={en ? "Likely counterarguments" : "Counterargument yang mungkin"} items={project.state.analysis.counterarguments} />
        <ListSection title={en ? "Sequenced action plan" : "Rencana tindakan berurutan"} items={project.state.analysis.actionPlan} />
      </div>}
      <div className="tp-sticky-actions"><button className="primary-button" onClick={analyzeProject} disabled={busy}>{en ? "Update analysis" : "Perbarui analisis"}</button><a className="primary-button secondary-button" href={`/api/tp-local-files/${encodeURIComponent(project.id)}/export?language=${language}`}>{en ? "Download current working draft" : "Unduh draft kerja terkini"}</a>{approvedDocumentVersion && <a className="primary-button secondary-button" href={`/api/tp-local-files/${encodeURIComponent(project.id)}/export?language=${language}&version=${encodeURIComponent(approvedDocumentVersion)}`}>{en ? "Download approved QA version" : "Unduh versi QA yang disetujui"}</a>}</div>
    </div>}
  </section>;
}

function ManualTpWorkflow({
  language, project, steps, step, busy, readiness, evidenceForm,
  onStepChange, onUpdateState, onEvidenceTitleChange, onEvidenceKindChange,
  onEvidenceReferenceChange, onEvidenceLocatorChange, onEvidenceExcerptChange,
  onEvidencePathsChange, onAddEvidence, onRemoveEvidence, onSaveStep,
  onReviewGaps, onStartAgents
}: {
  language: Language;
  project: TpLocalFileProject;
  steps: Array<{ title: string; note: string }>;
  step: number;
  busy: boolean;
  readiness: ReturnType<typeof tpGenerationReadiness> | null;
  evidenceForm: { title: string; kind: TpManualEvidence["sourceKind"]; reference: string; locator: string; excerpt: string; paths: string };
  onStepChange: (step: number) => void;
  onUpdateState: (patch: Partial<TpProjectState>) => void;
  onEvidenceTitleChange: (value: string) => void;
  onEvidenceKindChange: (value: TpManualEvidence["sourceKind"]) => void;
  onEvidenceReferenceChange: (value: string) => void;
  onEvidenceLocatorChange: (value: string) => void;
  onEvidenceExcerptChange: (value: string) => void;
  onEvidencePathsChange: (value: string) => void;
  onAddEvidence: () => void;
  onRemoveEvidence: (evidenceId: string) => void;
  onSaveStep: (nextStep?: number) => void;
  onReviewGaps: () => void;
  onStartAgents: () => void;
}) {
  const en = language === "en";
  const state = project.state;
  const completed = steps.filter((_, index) => manualStepComplete(state, index)).length;
  return <div className="tp-tab-panel tp-manual-wizard">
    <aside className="tp-manual-steps">
      <header><strong>{en ? "Manual TP Doc" : "TP Doc Manual"}</strong><span>{completed}/{steps.length} {en ? "steps complete" : "tahap lengkap"}</span></header>
      <progress max={steps.length} value={completed} />
      {steps.map((entry, index) => <button key={entry.title} className={`${step === index ? "active" : ""} ${manualStepComplete(state, index) ? "complete" : ""}`} onClick={() => onStepChange(index)}><b>{index + 1}</b><span><strong>{entry.title}</strong><small>{entry.note}</small></span></button>)}
    </aside>
    <div className="tp-manual-stage">
      <header><div><span>{en ? "Manual step" : "Tahap manual"} {step + 1}/{steps.length}</span><h3>{steps[step]?.title}</h3><p>{steps[step]?.note}</p></div><span className={`tp-manual-stage-status ${manualStepComplete(state, step) ? "complete" : "open"}`}>{manualStepComplete(state, step) ? (en ? "Complete" : "Lengkap") : (en ? "In progress" : "Belum lengkap")}</span></header>

      {step === 0 && <div className="tp-manual-stage-body">
        <div className="tp-form-grid three"><Field label={en ? "Legal company name" : "Nama legal perusahaan"} value={state.companyName} onChange={(companyName) => onUpdateState({ companyName })} /><Field label={en ? "Short name" : "Nama singkat"} value={state.companyShortName} onChange={(companyShortName) => onUpdateState({ companyShortName })} /><Field label="NPWP" value={state.npwp} onChange={(npwp) => onUpdateState({ npwp })} /><Field label={en ? "Fiscal year" : "Tahun pajak"} value={state.fiscalYear} onChange={(fiscalYear) => onUpdateState({ fiscalYear })} /><Field label={en ? "Parent company" : "Entitas induk"} value={state.parentCompany} onChange={(parentCompany) => onUpdateState({ parentCompany })} /><Field label={en ? "Business group" : "Grup usaha"} value={state.parentGroup} onChange={(parentGroup) => onUpdateState({ parentGroup })} /></div>
        <Area label={en ? "Registered address" : "Alamat terdaftar"} value={state.companyAddress} onChange={(companyAddress) => onUpdateState({ companyAddress })} />
        <Area label={en ? "Establishment and legal information" : "Informasi pendirian dan legal"} value={state.establishmentInfo} onChange={(establishmentInfo) => onUpdateState({ establishmentInfo })} />
      </div>}

      {step === 1 && <div className="tp-manual-stage-body">
        <div className="tp-form-grid three"><Field label={en ? "Brand" : "Merek"} value={state.brandName} onChange={(brandName) => onUpdateState({ brandName })} /><Field label={en ? "Employees" : "Jumlah pegawai"} value={state.employeeCount} onChange={(employeeCount) => onUpdateState({ employeeCount })} /><Field label={en ? "Ownership source reference" : "Referensi sumber kepemilikan"} value={state.shareholdersSource} onChange={(shareholdersSource) => onUpdateState({ shareholdersSource })} /></div>
        <Area label={en ? "Business activities" : "Kegiatan usaha"} value={state.businessActivities} onChange={(businessActivities) => onUpdateState({ businessActivities })} />
        <Area label={en ? "Business strategy" : "Strategi bisnis"} value={state.businessStrategy} onChange={(businessStrategy) => onUpdateState({ businessStrategy })} />
        <Area label={en ? "Restructuring during the year" : "Restrukturisasi selama tahun berjalan"} value={state.businessRestructuring} onChange={(businessRestructuring) => onUpdateState({ businessRestructuring })} />
        <Area label={en ? "Organization and reporting lines" : "Organisasi dan garis pelaporan"} value={state.organizationStructure} onChange={(organizationStructure) => onUpdateState({ organizationStructure })} />
        <EditableShareholders language={language} rows={state.shareholders} onChange={(shareholders) => onUpdateState({ shareholders })} />
        <EditableManagement language={language} rows={state.management} onChange={(management) => onUpdateState({ management })} />
        <EditableAffiliates language={language} rows={state.affiliatedParties} onChange={(affiliatedParties) => onUpdateState({ affiliatedParties })} />
      </div>}

      {step === 2 && <div className="tp-manual-stage-body">
        <div className="tp-form-grid"><Field label={en ? "Transaction category / delineation" : "Kategori / delineasi transaksi"} value={state.transactionType} onChange={(transactionType) => onUpdateState({ transactionType })} /><Field label={en ? "Pricing mechanism" : "Mekanisme penetapan harga"} value={state.pricingPolicy} onChange={(pricingPolicy) => onUpdateState({ pricingPolicy })} /></div>
        <Area label={en ? "Background and commercial rationale" : "Latar belakang dan rasional komersial"} value={state.backgroundTransaction} onChange={(backgroundTransaction) => onUpdateState({ backgroundTransaction })} />
        <Area label={en ? "Controlled transaction details" : "Detail transaksi afiliasi"} value={state.transactionDetails} onChange={(transactionDetails) => onUpdateState({ transactionDetails })} />
        <Area label={en ? "Supply chain and transaction flow" : "Rantai pasok dan alur transaksi"} value={state.supplyChainManagement} onChange={(supplyChainManagement) => onUpdateState({ supplyChainManagement })} />
        <EditableTransactions language={language} rows={state.affiliatedTransactions} onChange={(affiliatedTransactions) => onUpdateState({ affiliatedTransactions })} />
      </div>}

      {step === 3 && <div className="tp-manual-stage-body">
        <div className="tp-manual-guidance"><strong>{en ? "Describe actual conduct, not contract labels only." : "Uraikan perilaku aktual, bukan hanya label kontrak."}</strong><span>{en ? "Keep entity-level and transaction-level FAR distinct where their characterizations differ." : "Pisahkan FAR tingkat entitas dan tingkat transaksi bila karakterisasinya berbeda."}</span></div>
        <Area label={en ? "Functions performed" : "Fungsi yang dilakukan"} value={state.farAnalysis.functionsPerformed} onChange={(functionsPerformed) => onUpdateState({ farAnalysis: { ...state.farAnalysis, functionsPerformed } })} />
        <Area label={en ? "Assets used" : "Aset yang digunakan"} value={state.farAnalysis.assetsUsed} onChange={(assetsUsed) => onUpdateState({ farAnalysis: { ...state.farAnalysis, assetsUsed } })} />
        <Area label={en ? "Risks assumed and controlled" : "Risiko yang ditanggung dan dikendalikan"} value={state.farAnalysis.risksAssumed} onChange={(risksAssumed) => onUpdateState({ farAnalysis: { ...state.farAnalysis, risksAssumed } })} />
        <Area label={en ? "Contractual terms" : "Ketentuan kontraktual"} value={state.farAnalysis.contractualTerms} onChange={(contractualTerms) => onUpdateState({ farAnalysis: { ...state.farAnalysis, contractualTerms } })} />
        <Area label={en ? "Economic circumstances" : "Kondisi ekonomi"} value={state.farAnalysis.economicCircumstances} onChange={(economicCircumstances) => onUpdateState({ farAnalysis: { ...state.farAnalysis, economicCircumstances } })} />
        <Area label={en ? "Intangibles used / DEMPE observations" : "Aset tidak berwujud / observasi DEMPE"} value={state.farAnalysis.intangiblesUsed} onChange={(intangiblesUsed) => onUpdateState({ farAnalysis: { ...state.farAnalysis, intangiblesUsed } })} />
        <Area label={en ? "Service benefit, duplication, and shareholder-activity test" : "Uji manfaat jasa, duplikasi, dan shareholder activity"} value={state.farAnalysis.serviceBenefitTest} onChange={(serviceBenefitTest) => onUpdateState({ farAnalysis: { ...state.farAnalysis, serviceBenefitTest } })} />
      </div>}

      {step === 4 && <div className="tp-manual-stage-body">
        <div className="tp-form-grid three"><Field label={en ? "Selected method" : "Metode terpilih"} value={state.selectedMethod} onChange={(selectedMethod) => onUpdateState({ selectedMethod })} /><Field label="PLI" value={state.selectedPli} onChange={(selectedPli) => onUpdateState({ selectedPli })} /><Field label={en ? "Tested party" : "Pihak yang diuji"} value={state.testedParty} onChange={(testedParty) => onUpdateState({ testedParty })} /><Field label={en ? "Analysis period" : "Periode analisis"} value={state.analysisPeriod} onChange={(analysisPeriod) => onUpdateState({ analysisPeriod })} /></div>
        <Area label={en ? "Comparability factors and method rationale" : "Faktor kesebandingan dan alasan pemilihan metode"} value={state.comparabilityFactors} onChange={(comparabilityFactors) => onUpdateState({ comparabilityFactors })} />
        <EditableSearchCriteria language={language} rows={state.searchCriteriaResults} onChange={(searchCriteriaResults) => onUpdateState({ searchCriteriaResults })} />
        <EditableComparables language={language} rows={state.comparableCompanies} onChange={(comparableCompanies) => onUpdateState({ comparableCompanies })} />
        <EditableRejectionMatrix language={language} rows={state.rejectionMatrix} onChange={(rejectionMatrix) => onUpdateState({ rejectionMatrix })} />
      </div>}

      {step === 5 && <div className="tp-manual-stage-body">
        <div className="tp-financial-comparison"><section><h3>{en ? "Current year" : "Tahun berjalan"}</h3><div className="tp-form-grid two-compact">{Object.entries(state.financialData).map(([key, entry]) => <Field key={key} label={financialLabel(key, language)} value={entry} onChange={(value) => onUpdateState({ financialData: { ...state.financialData, [key]: value } })} />)}</div></section><section><h3>{en ? "Prior year" : "Tahun sebelumnya"}</h3><div className="tp-form-grid two-compact">{Object.entries(state.financialDataPrior).map(([key, entry]) => <Field key={key} label={financialLabel(key, language)} value={entry} onChange={(value) => onUpdateState({ financialDataPrior: { ...state.financialDataPrior, [key]: value } })} />)}</div></section></div>
        <div className="tp-form-grid four-compact"><Field label="Q1" value={state.quartileRange.q1} onChange={(q1) => onUpdateState({ quartileRange: { ...state.quartileRange, q1 } })} /><Field label="Median" value={state.quartileRange.median} onChange={(median) => onUpdateState({ quartileRange: { ...state.quartileRange, median } })} /><Field label="Q3" value={state.quartileRange.q3} onChange={(q3) => onUpdateState({ quartileRange: { ...state.quartileRange, q3 } })} /><Field label={en ? "Tested result" : "Hasil pihak diuji"} value={state.testedPartyRatio} onChange={(testedPartyRatio) => onUpdateState({ testedPartyRatio })} /></div>
        <Area label={en ? "Non-financial events affecting price or profit" : "Peristiwa nonkeuangan yang memengaruhi harga atau laba"} value={state.nonFinancialEvents} onChange={(nonFinancialEvents) => onUpdateState({ nonFinancialEvents })} />
      </div>}

      {step === 6 && <div className="tp-manual-stage-body">
        <div className="tp-manual-guidance warning"><strong>{en ? "Manual input is not self-verifying." : "Input manual tidak memverifikasi dirinya sendiri."}</strong><span>{en ? "Register where each material fact came from. It remains unverified until the verification stage or human reviewer confirms it." : "Catat asal setiap fakta material. Statusnya tetap belum terverifikasi sampai tahap verifikasi atau reviewer manusia mengonfirmasinya."}</span></div>
        <section className="tp-manual-evidence-form"><header><div><h3>{en ? "Register manual evidence" : "Registrasikan bukti manual"}</h3><p>{en ? "Examples: management interview, ledger reference, agreement clause, or calculation working paper." : "Contoh: wawancara manajemen, referensi ledger, klausul perjanjian, atau working paper perhitungan."}</p></div></header><div className="tp-form-grid three"><Field label={en ? "Evidence title" : "Judul bukti"} value={evidenceForm.title} onChange={onEvidenceTitleChange} /><label className="tp-field"><span>{en ? "Source kind" : "Jenis sumber"}</span><select value={evidenceForm.kind} onChange={(event) => onEvidenceKindChange(event.target.value as TpManualEvidence["sourceKind"])}><option value="management_interview">{en ? "Management interview" : "Wawancara manajemen"}</option><option value="ledger_reference">{en ? "Ledger reference" : "Referensi ledger"}</option><option value="agreement_reference">{en ? "Agreement reference" : "Referensi perjanjian"}</option><option value="manual_calculation">{en ? "Manual calculation" : "Perhitungan manual"}</option><option value="other">{en ? "Other" : "Lainnya"}</option></select></label><Field label={en ? "Reference / owner" : "Referensi / pemilik data"} value={evidenceForm.reference} onChange={onEvidenceReferenceChange} /><Field label={en ? "Locator / interview question / GL account" : "Lokator / pertanyaan / akun GL"} value={evidenceForm.locator} onChange={onEvidenceLocatorChange} /><Field label={en ? "Supported field paths, comma separated" : "Field path yang didukung, pisahkan koma"} value={evidenceForm.paths} onChange={onEvidencePathsChange} /></div><Area label={en ? "Exact excerpt, response, or calculation note" : "Kutipan, jawaban, atau catatan perhitungan"} value={evidenceForm.excerpt} onChange={onEvidenceExcerptChange} /><small>{en ? "Examples: companyName, affiliatedTransactions, farAnalysis.functionsPerformed, financialData.revenue" : "Contoh: companyName, affiliatedTransactions, farAnalysis.functionsPerformed, financialData.revenue"}</small><button className="table-button" onClick={onAddEvidence} disabled={busy}>{en ? "Add to evidence register" : "Tambahkan ke register bukti"}</button></section>
        <div className="tp-manual-evidence-list">{state.manualEvidence.length ? state.manualEvidence.map((evidence) => <article key={evidence.id}><div><strong>{evidence.title}</strong><span>{evidence.sourceKind.replaceAll("_", " ")} · {evidence.reference || (en ? "no reference" : "tanpa referensi")}</span><small>{evidence.fieldPaths.join(", ")}</small><p>{evidence.excerpt}</p></div><button className="table-button danger" onClick={() => onRemoveEvidence(evidence.id)} disabled={busy}>{en ? "Remove" : "Hapus"}</button></article>) : <div className="empty-state compact"><strong>{en ? "No manual evidence registered." : "Belum ada bukti manual."}</strong><span>{en ? "At least one sourced fact is required to start the agent workflow without a document." : "Minimal satu fakta bersumber diperlukan untuk memulai workflow agen tanpa dokumen."}</span></div>}</div>
        {readiness && <div className={`tp-readiness-callout ${readiness.blockers.length ? "warning" : "ready"}`}><strong>{readiness.blockers.length ? `${readiness.blockers.length} ${en ? "mandatory item(s) remain" : "item wajib tersisa"}` : (en ? "Manual inputs are ready for agent review" : "Input manual siap direview agen")}</strong><span>{en ? "The agent workflow will still verify evidence, draft, assemble, and run QA." : "Workflow agen tetap akan melakukan verifikasi bukti, drafting, assembly, dan QA."}</span></div>}
      </div>}

      <footer className="tp-manual-navigation"><button className="table-button" onClick={() => onSaveStep(step - 1)} disabled={busy || step === 0}>{en ? "Save & back" : "Simpan & kembali"}</button>{step < steps.length - 1 ? <button className="primary-button" onClick={() => onSaveStep(step + 1)} disabled={busy}>{en ? "Save & continue" : "Simpan & lanjut"}</button> : <><button className="table-button" onClick={onReviewGaps} disabled={busy}>{en ? "Review all gaps" : "Review seluruh gap"}</button><button className="primary-button" onClick={onStartAgents} disabled={busy || !state.manualEvidence.length || !state.companyName || !state.fiscalYear}>{en ? "Save and start TP agents" : "Simpan dan jalankan agen TP"}</button></>}</footer>
    </div>
  </div>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="tp-field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function Area({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="tp-field"><span>{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function AnalysisSection({ title, text }: { title: string; text: string }) { return <section><h3>{title}</h3>{text.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>; }
function ListSection({ title, items }: { title: string; items: string[] }) { return <section><h3>{title}</h3><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></section>; }

function ComparableResearch({ language, project }: { language: Language; project: TpLocalFileProject }) {
  const en = language === "en";
  const analysis = project.state.analysis;
  if (!analysis.externalComparableCandidates.length && !analysis.externalResearchSources.length) return null;
  return <section className="tp-external-research">
    <header><div><h3>{en ? "Preliminary comparable screening" : "Screening awal pembanding"}</h3><p>{en ? "Discovery candidates only. Final acceptance requires independence, ownership, financial-period, loss-making, and commercial-database screening." : "Hanya kandidat hasil discovery. Penerimaan final memerlukan screening independensi, kepemilikan, periode keuangan, kerugian, dan database komersial."}</p></div><span>{analysis.externalResearchSources.length} {en ? "sources" : "sumber"}</span></header>
    {analysis.externalComparableCandidates.length > 0 && <div className="tp-comparable-candidates">
      {analysis.externalComparableCandidates.map((candidate, index) => <article key={`${candidate.sourceUrl}-${index}`}>
        <div className="tp-candidate-heading"><div><strong>{candidate.name || (en ? "Unnamed candidate" : "Kandidat tanpa nama")}</strong><small>{candidate.country || (en ? "Country not verified" : "Negara belum diverifikasi")}</small></div><span className={`screening-${candidate.screeningStatus}`}>{candidate.screeningStatus.replaceAll("_", " ")}</span></div>
        <p>{candidate.businessDescription}</p>
        <dl><div><dt>{en ? "Why it may fit" : "Alasan berpotensi cocok"}</dt><dd>{candidate.matchRationale}</dd></div><div><dt>{en ? "Material differences / checks" : "Perbedaan / pemeriksaan material"}</dt><dd>{candidate.keyDifferences.join("; ") || candidate.limitation}</dd></div></dl>
        <footer><a href={candidate.sourceUrl} target="_blank" rel="noreferrer">{candidate.sourceTitle || (en ? "Open source" : "Buka sumber")}</a><span>{candidate.sourceQuality.replaceAll("_", " ")} · {Math.round(candidate.sourceScore * 100)}% {en ? "retrieval score" : "skor retrieval"}</span></footer>
      </article>)}
    </div>}
    {analysis.externalResearchWarnings.length > 0 && <details className="tp-research-warnings"><summary>{en ? "Research limitations and warnings" : "Keterbatasan dan peringatan riset"}</summary><ul>{analysis.externalResearchWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    <details className="tp-research-sources"><summary>{en ? "Research source audit trail" : "Audit trail sumber riset"}</summary><div>{analysis.externalResearchSources.map((source, index) => <article key={`${source.url}-${index}`}><strong>{source.title}</strong><span>{source.sourceType.replaceAll("_", " ")} · {source.qualityTier.replaceAll("_", " ")} · {Math.round(source.score * 100)}%</span><p>{source.snippet}</p><small>{source.qualityReason}</small><a href={source.url} target="_blank" rel="noreferrer">{source.domain || source.url}</a></article>)}</div></details>
  </section>;
}

function ScopeSelector({ language, auto, selected, onAutoChange, onChange, compact = false }: {
  language: Language;
  auto: boolean;
  selected: TpExtractionScope[];
  onAutoChange: (value: boolean) => void;
  onChange: (value: TpExtractionScope[]) => void;
  compact?: boolean;
}) {
  const en = language === "en";
  const toggle = (scope: TpExtractionScope) => onChange(selected.includes(scope) ? selected.filter((item) => item !== scope) : [...selected, scope]);
  return <section className={`tp-scope-selector ${compact ? "compact" : ""}`}>
    <header><div><strong>{en ? "Content to inspect" : "Konten yang diperiksa"}</strong><small>{en ? "One document may contribute to several Local File sections." : "Satu dokumen dapat mengisi beberapa bagian Local File."}</small></div><label className="tp-auto-toggle"><input type="checkbox" checked={auto} onChange={(event) => onAutoChange(event.target.checked)} /><span>{en ? "Auto-detect all" : "Deteksi semua otomatis"}</span></label></header>
    {!auto && <div className="tp-scope-options">{tpExtractionScopes.map((scope) => <button key={scope.id} type="button" className={selected.includes(scope.id) ? "selected" : ""} onClick={() => toggle(scope.id)}>{en ? scope.en : scope.idLabel}</button>)}</div>}
  </section>;
}

function requirementCategoryLabel(category: "template" | "extractable" | "additional" | "advisor", language: Language) {
  const labels = {
    template: ["Template statis", "Static template"],
    extractable: ["Dinamis / ekstraksi", "Dynamic / extracted"],
    additional: ["Dokumen tambahan", "Additional documents"],
    advisor: ["Input advisor", "Advisor input"]
  } as const;
  return labels[category][language === "en" ? 1 : 0];
}

function requirementStatusLabel(status: "ready" | "partial" | "missing", language: Language) {
  const labels = { ready: ["Lengkap", "Ready"], partial: ["Sebagian", "Partial"], missing: ["Belum ada", "Missing"] } as const;
  return labels[status][language === "en" ? 1 : 0];
}

function EditableShareholders({ language, rows, onChange }: { language: Language; rows: TpShareholder[]; onChange: (rows: TpShareholder[]) => void }) {
  const en = language === "en"; const update = (index: number, key: keyof TpShareholder, value: string) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  return <section className="tp-edit-table"><header><h3>{en ? "Ownership" : "Kepemilikan"}</h3><button className="table-button" onClick={() => onChange([...rows, { name: "", shares: "", capital: "", percentage: "" }])}>+ {en ? "Row" : "Baris"}</button></header>{rows.map((row, index) => <div className="tp-edit-row four" key={index}><input placeholder={en ? "Shareholder" : "Pemegang saham"} value={row.name} onChange={(event) => update(index, "name", event.target.value)} /><input placeholder={en ? "Shares" : "Saham"} value={row.shares} onChange={(event) => update(index, "shares", event.target.value)} /><input placeholder={en ? "Capital" : "Modal"} value={row.capital} onChange={(event) => update(index, "capital", event.target.value)} /><input placeholder="%" value={row.percentage} onChange={(event) => update(index, "percentage", event.target.value)} /></div>)}</section>;
}
function EditableManagement({ language, rows, onChange }: { language: Language; rows: TpManagement[]; onChange: (rows: TpManagement[]) => void }) {
  const en = language === "en"; const update = (index: number, key: keyof TpManagement, value: string) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  return <section className="tp-edit-table"><header><h3>{en ? "Management" : "Manajemen"}</h3><button className="table-button" onClick={() => onChange([...rows, { position: "", name: "" }])}>+ {en ? "Row" : "Baris"}</button></header>{rows.map((row, index) => <div className="tp-edit-row two" key={index}><input placeholder={en ? "Position" : "Jabatan"} value={row.position} onChange={(event) => update(index, "position", event.target.value)} /><input placeholder={en ? "Name" : "Nama"} value={row.name} onChange={(event) => update(index, "name", event.target.value)} /></div>)}</section>;
}
function EditableDepartments({ language, rows, onChange }: { language: Language; rows: TpOrganizationDepartment[]; onChange: (rows: TpOrganizationDepartment[]) => void }) {
  const en = language === "en"; const update = (index: number, key: keyof TpOrganizationDepartment, value: string) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  return <section className="tp-edit-table"><header><h3>{en ? "Organization departments" : "Departemen organisasi"}</h3><button className="table-button" onClick={() => onChange([...rows, { name: "", head: "", employees: "" }])}>+ {en ? "Department" : "Departemen"}</button></header>{rows.map((row, index) => <div className="tp-edit-row three" key={index}><input placeholder={en ? "Department" : "Departemen"} value={row.name} onChange={(event) => update(index, "name", event.target.value)} /><input placeholder={en ? "Head" : "Pimpinan"} value={row.head} onChange={(event) => update(index, "head", event.target.value)} /><input placeholder={en ? "Employees" : "Pegawai"} value={row.employees} onChange={(event) => update(index, "employees", event.target.value)} /></div>)}</section>;
}
function EditableAffiliates({ language, rows, onChange }: { language: Language; rows: TpAffiliatedParty[]; onChange: (rows: TpAffiliatedParty[]) => void }) {
  const en = language === "en"; const update = (index: number, key: keyof TpAffiliatedParty, value: string) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  return <section className="tp-edit-table"><header><h3>{en ? "Related parties" : "Pihak afiliasi"}</h3><button className="table-button" onClick={() => onChange([...rows, { name: "", country: "", relationship: "", transactionType: "" }])}>+ {en ? "Row" : "Baris"}</button></header>{rows.map((row, index) => <div className="tp-edit-row four" key={index}><input placeholder={en ? "Name" : "Nama"} value={row.name} onChange={(event) => update(index, "name", event.target.value)} /><input placeholder={en ? "Country" : "Negara"} value={row.country} onChange={(event) => update(index, "country", event.target.value)} /><input placeholder={en ? "Relationship" : "Hubungan"} value={row.relationship} onChange={(event) => update(index, "relationship", event.target.value)} /><input placeholder={en ? "Transaction" : "Transaksi"} value={row.transactionType} onChange={(event) => update(index, "transactionType", event.target.value)} /></div>)}</section>;
}
function EditableTransactions({ language, rows, onChange }: { language: Language; rows: TpTransaction[]; onChange: (rows: TpTransaction[]) => void }) {
  const en = language === "en"; const update = (index: number, key: keyof TpTransaction, value: string) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  return <section className="tp-edit-table"><header><h3>{en ? "Controlled transactions" : "Transaksi afiliasi"}</h3><button className="table-button" onClick={() => onChange([...rows, { counterparty: "", country: "", affiliationType: "", transactionType: "", value: "", currency: "IDR", note: "" }])}>+ {en ? "Transaction" : "Transaksi"}</button></header>{rows.map((row, index) => <div className="tp-edit-row transaction" key={index}><input placeholder={en ? "Counterparty" : "Lawan transaksi"} value={row.counterparty} onChange={(event) => update(index, "counterparty", event.target.value)} /><input placeholder={en ? "Type" : "Jenis"} value={row.transactionType} onChange={(event) => update(index, "transactionType", event.target.value)} /><input placeholder={en ? "Value" : "Nilai"} value={row.value} onChange={(event) => update(index, "value", event.target.value)} /><input placeholder="Currency" value={row.currency} onChange={(event) => update(index, "currency", event.target.value)} /></div>)}</section>;
}
function EditableSearchCriteria({ language, rows, onChange }: { language: Language; rows: TpSearchCriteriaResult[]; onChange: (rows: TpSearchCriteriaResult[]) => void }) {
  const en = language === "en"; const update = (index: number, key: keyof TpSearchCriteriaResult, value: string) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  return <section className="tp-edit-table"><header><h3>{en ? "Comparable search trail" : "Jejak pencarian pembanding"}</h3><button className="table-button" onClick={() => onChange([...rows, { step: "", criteria: "", resultCount: "" }])}>+ {en ? "Step" : "Tahap"}</button></header>{rows.map((row, index) => <div className="tp-edit-row three" key={index}><input placeholder={en ? "Step" : "Tahap"} value={row.step} onChange={(event) => update(index, "step", event.target.value)} /><input placeholder={en ? "Search criterion" : "Kriteria pencarian"} value={row.criteria} onChange={(event) => update(index, "criteria", event.target.value)} /><input placeholder={en ? "Result count" : "Jumlah hasil"} value={row.resultCount} onChange={(event) => update(index, "resultCount", event.target.value)} /></div>)}</section>;
}
function EditableComparables({ language, rows, onChange }: { language: Language; rows: TpComparable[]; onChange: (rows: TpComparable[]) => void }) {
  const en = language === "en"; const update = (index: number, key: keyof TpComparable, value: string) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  return <section className="tp-edit-table"><header><h3>{en ? "Comparable companies" : "Perusahaan pembanding"}</h3><button className="table-button" onClick={() => onChange([...rows, { name: "", country: "", description: "", ratio: "" }])}>+ {en ? "Comparable" : "Pembanding"}</button></header>{rows.map((row, index) => <div className="tp-edit-row four" key={index}><input placeholder={en ? "Company" : "Perusahaan"} value={row.name} onChange={(event) => update(index, "name", event.target.value)} /><input placeholder={en ? "Country" : "Negara"} value={row.country} onChange={(event) => update(index, "country", event.target.value)} /><input placeholder={en ? "Business description" : "Deskripsi usaha"} value={row.description} onChange={(event) => update(index, "description", event.target.value)} /><input placeholder={en ? "Ratio" : "Rasio"} value={row.ratio} onChange={(event) => update(index, "ratio", event.target.value)} /></div>)}</section>;
}
function EditableRejectionMatrix({ language, rows, onChange }: { language: Language; rows: TpRejectionMatrixRow[]; onChange: (rows: TpRejectionMatrixRow[]) => void }) {
  const en = language === "en"; const update = (index: number, patch: Partial<TpRejectionMatrixRow>) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  return <section className="tp-edit-table"><header><h3>{en ? "Acceptance / rejection matrix" : "Matriks penerimaan / penolakan"}</h3><button className="table-button" onClick={() => onChange([...rows, { name: "", reason: "", accepted: false }])}>+ {en ? "Candidate" : "Kandidat"}</button></header>{rows.map((row, index) => <div className="tp-edit-row rejection" key={index}><input placeholder={en ? "Company" : "Perusahaan"} value={row.name} onChange={(event) => update(index, { name: event.target.value })} /><input placeholder={en ? "Reason" : "Alasan"} value={row.reason} onChange={(event) => update(index, { reason: event.target.value })} /><label><input type="checkbox" checked={row.accepted} onChange={(event) => update(index, { accepted: event.target.checked })} /><span>{en ? "Accepted" : "Diterima"}</span></label></div>)}</section>;
}
function financialLabel(key: string, language: Language) {
  const labels: Record<string, [string, string]> = { revenue: ["Pendapatan", "Revenue"], costOfGoodsSold: ["Harga pokok penjualan", "Cost of goods sold"], grossProfit: ["Laba kotor", "Gross profit"], operatingExpenses: ["Beban usaha", "Operating expenses"], operatingProfit: ["Laba usaha", "Operating profit"], netIncome: ["Laba bersih", "Net income"] };
  return labels[key]?.[language === "en" ? 1 : 0] || key;
}
