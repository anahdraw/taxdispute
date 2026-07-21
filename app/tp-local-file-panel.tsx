"use client";

import { useEffect, useMemo, useState } from "react";
import { upload } from "@vercel/blob/client";
import { LLM_MODEL_HEADER, type LlmModelChoice } from "@/lib/model-options";
import {
  emptyTpProjectState,
  tpDocumentKinds,
  tpExtractionScopes,
  tpGenerationReadiness,
  tpProjectCompleteness,
  type TpAffiliatedParty,
  type TpComparable,
  type TpManagement,
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
type WorkspaceTab = "sources" | "profile" | "transactions" | "readiness" | "review";

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

  const headers = useMemo(() => ({ [LLM_MODEL_HEADER]: modelChoice }), [modelChoice]);
  const completeness = project ? tpProjectCompleteness(project.state) : 0;
  const readiness = useMemo(() => project ? tpGenerationReadiness(project.state) : null, [project]);

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
  }

  useEffect(() => { void loadProjects(true).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);

  async function createProjectRecord(name = "") {
    const payload = await jsonResponse<{ project: TpLocalFileProject }>(await fetch("/api/tp-local-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || (en ? "New TP Local File" : "Local File TP Baru") })
    }));
    setProject(payload.project);
    setProjectName(payload.project.name);
    setTab("sources");
    await loadProjects();
    return payload.project;
  }

  async function createProject() {
    setBusy(true); setError("");
    try { await createProjectRecord(projectName); }
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

  async function uploadAndExtractFiles(targetProject: TpLocalFileProject, sourceFiles: File[]) {
    let working = { ...targetProject, documents: [...targetProject.documents] };
    for (let index = 0; index < sourceFiles.length; index += 1) {
      const file = sourceFiles[index];
      setStatus(`${en ? "Uploading" : "Mengunggah"} ${index + 1}/${sourceFiles.length}: ${file.name}`);
      const blob = await upload(`tp-local-files/${targetProject.id}/${Date.now()}-${safePart(file.name)}`, file, {
          access: "public",
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
        coverage: []
      };
      working = (await saveProject({ ...working, documents: [...working.documents, source], updatedAt: new Date().toISOString() }, en ? "Document uploaded." : "Dokumen diunggah.")) || working;
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
    setStatus(en ? "Documents extracted and merged into the working paper." : "Dokumen diekstrak dan digabung ke working paper.");
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
      const payload = await jsonResponse<{ project: TpLocalFileProject }>(await fetch(`/api/tp-local-files/${encodeURIComponent(project.id)}/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ language })
      }));
      setProject(payload.project); setStatus(en ? "Advisor review completed." : "Review advisor selesai."); setTab("review"); await loadProjects();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
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
      <div><p className="eyebrow">TP LOCAL FILE</p><h2>{en ? "Build a Local File from one or more source documents" : "Susun Local File dari satu atau beberapa dokumen sumber"}</h2><p>{en ? "A single file may contain company, ownership, transaction, financial, and TP-policy information. Auto-detect scans all selected content groups and keeps every extracted fact traceable to its source." : "Satu file dapat memuat informasi perusahaan, kepemilikan, transaksi, keuangan, dan kebijakan TP sekaligus. Deteksi otomatis memeriksa seluruh kelompok konten dan menjaga setiap fakta tetap terlacak ke sumbernya."}</p></div>
      {error && <div className="status-banner error">{error}</div>}
      <div className="tp-start-card">
        <div className="tp-start-step"><span>1</span><div><strong>{en ? "Choose the first source document" : "Pilih dokumen sumber pertama"}</strong><small>{en ? "A company profile is recommended, but you can start from any available document." : "Profil perusahaan disarankan, tetapi Anda dapat mulai dari dokumen apa pun yang tersedia."}</small></div></div>
        <div className="tp-start-grid">
          <label className="tp-field"><span>{en ? "Document category" : "Kategori dokumen"}</span><select value={documentKind} onChange={(event) => setDocumentKind(event.target.value as TpSourceDocument["kind"])}>{tpDocumentKinds.map((kind) => <option key={kind.id} value={kind.id}>{en ? kind.en : kind.idLabel}</option>)}</select></label>
          <label className="tp-field"><span>{en ? "Project name (optional)" : "Nama proyek (opsional)"}</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={en ? "Automatically taken from the file name" : "Otomatis dari nama file"} /></label>
        </div>
        <ScopeSelector language={language} auto={autoDetectScopes} selected={selectedScopes} onAutoChange={setAutoDetectScopes} onChange={setSelectedScopes} />
        <label className="tp-source-drop"><span>{en ? "Upload PDF or Word source documents" : "Unggah dokumen sumber PDF atau Word"}</span><input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} /><small>{files.length ? `${files.length} ${en ? "file(s) selected" : "file dipilih"}` : (en ? "Company profile, legal ownership, financial statement, TP policy, agreement, or other evidence." : "Profil perusahaan, legalitas kepemilikan, laporan keuangan, kebijakan TP, perjanjian, atau bukti lain.")}</small></label>
        <div className="tp-start-actions"><button className="primary-button" onClick={startFromSource} disabled={busy || !files.length}>{busy ? (en ? "Creating & extracting..." : "Membuat & mengekstrak...") : (en ? "Start from document" : "Mulai dari dokumen")}</button><button className="table-button" onClick={createProject} disabled={busy}>{en ? "Create an empty project" : "Buat proyek kosong"}</button></div>
      </div>
    </section>;
  }

  return <section className="tp-workspace">
    <header className="tp-workspace-header">
      <div><p className="eyebrow">TP LOCAL FILE · PLATINUM</p><h2>{en ? "Transfer Pricing Working Paper" : "Working Paper Transfer Pricing"}</h2><p>{en ? "Upload source documents, review extracted facts, run an advisor analysis, and export a structured Word draft." : "Unggah dokumen sumber, review fakta terekstrak, jalankan analisis advisor, dan ekspor draft Word terstruktur."}</p></div>
      <div className="tp-header-actions"><button className="table-button" onClick={createProject} disabled={busy}>+ {en ? "New" : "Baru"}</button><button className="table-button danger" onClick={deleteProject} disabled={busy}>{en ? "Delete" : "Hapus"}</button></div>
    </header>

    <div className="tp-project-bar">
      <label><span>{en ? "Project" : "Proyek"}</span><select value={project.id} onChange={(event) => void selectProject(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.companyName || item.name} · {item.fiscalYear || item.status}</option>)}</select></label>
      <label className="tp-project-name"><span>{en ? "Working title" : "Judul kerja"}</span><input value={projectName} onChange={(event) => { setProjectName(event.target.value); setProject((current) => current ? { ...current, name: event.target.value } : current); }} /></label>
      <div className="tp-completeness"><span>{en ? "Completeness" : "Kelengkapan"}</span><strong>{completeness}%</strong><progress max="100" value={completeness} /></div>
    </div>

    <nav className="tp-tabs" aria-label="TP Local File sections">
      {([[
        "sources", en ? "1. Source documents" : "1. Dokumen sumber"
      ], ["profile", en ? "2. Company profile" : "2. Profil perusahaan"], ["transactions", en ? "3. Transactions & method" : "3. Transaksi & metode"], ["readiness", en ? "4. Generation readiness" : "4. Kesiapan generasi"], ["review", en ? "5. Advisor review" : "5. Review advisor"]] as Array<[WorkspaceTab, string]>).map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}
    </nav>

    {status && <div className="status-banner success compact-status">{status}</div>}
    {error && <div className="status-banner error compact-status">{error}</div>}

    {tab === "sources" && <div className="tp-tab-panel sources">
      <div className="tp-upload-strip">
        <label><span>{en ? "Document category" : "Kategori dokumen"}</span><select value={documentKind} onChange={(event) => setDocumentKind(event.target.value as TpSourceDocument["kind"])}>{tpDocumentKinds.map((kind) => <option key={kind.id} value={kind.id}>{en ? kind.en : kind.idLabel}</option>)}</select></label>
        <label className="tp-file-picker"><span>{en ? "PDF or Word files" : "File PDF atau Word"}</span><input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} /></label>
        <button className="primary-button" onClick={uploadAndExtract} disabled={busy || !files.length}>{busy ? (en ? "Processing..." : "Memproses...") : (en ? "Upload & extract" : "Unggah & ekstrak")}</button>
      </div>
      <ScopeSelector language={language} auto={autoDetectScopes} selected={selectedScopes} onAutoChange={setAutoDetectScopes} onChange={setSelectedScopes} compact />
      <div className="tp-document-list">
        {project.documents.length ? project.documents.map((document) => <article key={document.id}>
          <div><strong>{document.filename}</strong><span>{tpDocumentKinds.find((kind) => kind.id === document.kind)?.[en ? "en" : "idLabel"]}</span>{Boolean(document.detectedScopes?.length) && <div className="tp-detected-scopes">{document.detectedScopes?.map((scope) => <span key={scope}>{en ? tpExtractionScopes.find((item) => item.id === scope)?.en : tpExtractionScopes.find((item) => item.id === scope)?.idLabel}</span>)}</div>}</div>
          <div><span className={`tp-status ${document.status}`}>{document.status}</span><small>{document.extractionMessage || (en ? "Waiting for extraction" : "Menunggu ekstraksi")}</small></div>
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

    {tab === "review" && <div className="tp-tab-panel review">
      <div className="tp-review-summary"><div><span>{en ? "Completeness" : "Kelengkapan"}</span><strong>{completeness}%</strong></div><div><span>{en ? "Documents" : "Dokumen"}</span><strong>{project.documents.length}</strong></div><div><span>{en ? "Final checks" : "Pemeriksaan final"}</span><strong>{readiness?.blockers.length || 0}</strong></div></div>
      {!project.state.analysis.executiveSummary && <div className="empty-state compact"><strong>{en ? "Advisor analysis has not been run." : "Analisis advisor belum dijalankan."}</strong><button className="primary-button" onClick={analyzeProject} disabled={busy}>{en ? "Run analysis" : "Jalankan analisis"}</button></div>}
      {project.state.analysis.executiveSummary && <div className="tp-analysis-sections">
        <AnalysisSection title={en ? "Executive summary" : "Ringkasan eksekutif"} text={project.state.analysis.executiveSummary} />
        <AnalysisSection title={en ? "Functional analysis" : "Analisis fungsi, aset, dan risiko"} text={project.state.analysis.functionalAnalysis} />
        <AnalysisSection title={en ? "Method and PLI" : "Metode dan PLI"} text={`${project.state.analysis.methodSelectionJustification}\n\n${project.state.analysis.pliSelectionRationale}`} />
        <AnalysisSection title={en ? "Comparability and conclusion" : "Kesebandingan dan kesimpulan"} text={`${project.state.analysis.comparabilityAnalysis}\n\n${project.state.analysis.conclusion}`} />
        <ListSection title={en ? "Risk flags" : "Faktor risiko"} items={project.state.analysis.riskFlags} />
        <ListSection title={en ? "Evidence still required" : "Bukti yang masih diperlukan"} items={project.state.analysis.requiredEvidence} />
      </div>}
      <div className="tp-sticky-actions"><button className="primary-button" onClick={analyzeProject} disabled={busy}>{en ? "Update analysis" : "Perbarui analisis"}</button><a className="primary-button secondary-button" href={`/api/tp-local-files/${encodeURIComponent(project.id)}/export?language=${language}`}>{en ? "Download Word Local File" : "Unduh Word Local File"}</a></div>
    </div>}
  </section>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="tp-field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function Area({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="tp-field"><span>{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function AnalysisSection({ title, text }: { title: string; text: string }) { return <section><h3>{title}</h3>{text.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>; }
function ListSection({ title, items }: { title: string; items: string[] }) { return <section><h3>{title}</h3><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></section>; }

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
