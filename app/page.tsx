"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { buildAnalysis, type AnalysisResult as AnalysisResultType, type AnalyzeInput } from "@/lib/analyze";
import type { ExtractionResult } from "@/lib/extraction";
import { dashboardStats, issueDistribution, outcomeDistribution, recentDocuments, regulations } from "@/lib/mock-data";

type Language = "id" | "en";
type PageKey = "dashboard" | "guided" | "analysis" | "regulations" | "reports";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const evidenceOptions = {
  id: ["Faktur Pajak", "SPT Masa PPN", "Bukti pembayaran", "Rekonsiliasi", "Konfirmasi Lawan Transaksi", "Surat Kuasa"],
  en: ["VAT invoice", "VAT return", "Payment evidence", "Reconciliation", "Counterparty confirmation", "Power of attorney"]
};

const copy = {
  id: {
    subtitle: "Prototype Next.js untuk ekstraksi dokumen sengketa, pencarian putusan pembanding, konteks peraturan PPN, review risiko, dan draft rekomendasi WP.",
    preserved: "Streamlit prototype tetap disimpan di repository sebagai sumber Python lokal. Halaman ini adalah versi Vercel-native baru.",
    dashboard: "Dashboard",
    guided: "Alur Terpandu",
    analysis: "Analisis Kasus WP",
    regulations: "Peraturan",
    reports: "Reports",
    dataSummary: "Ringkasan Data",
    dataVisualization: "Visualisasi Data",
    indexed: "Putusan terindeks",
    coverage: "Coverage ekstraksi",
    vatDocs: "Dokumen PPN",
    localRules: "Peraturan lokal",
    llmLabels: "Label LLM",
    startAnalysis: "Buat Analisis",
    taxpayer: "Nama WP / Perusahaan",
    taxType: "Jenis pajak",
    issueType: "Pokok sengketa",
    stage: "Tahap",
    amount: "Nilai koreksi",
    authority: "Posisi DJP",
    taxpayerPosition: "Posisi WP",
    evidence: "Bukti tersedia",
    upload: "Upload dokumen",
    uploadHint: "Untuk Vercel demo, file hanya dibaca di browser dan belum disimpan. Backend storage akan memakai database/object storage pada fase production.",
    results: "Hasil Analisis",
    recommendation: "Draft Rekomendasi",
    topCases: "Putusan Paling Terkait",
    evidenceGaps: "Celah Bukti",
    relatedRules: "Dasar Peraturan",
    recentDocs: "Dokumen Terakhir",
    health: "Check API Health",
    analyzing: "Menganalisis dengan LLM...",
    askRule: "Tanya aturan",
    ruleQuestion: "Pertanyaan aturan PPN",
    chatAnswer: "Jawaban chatbot",
    extractWithLlm: "Ekstrak PDF dengan LLM",
    extracting: "Mengekstrak PDF...",
    extractionResult: "Hasil Ekstraksi",
    extractedEvidence: "Bukti Terdeteksi",
    exportWord: "Download Word",
    exportPdf: "Download PDF",
    exporting: "Membuat file...",
    noPdf: "Pilih file PDF terlebih dahulu.",
    fileTooLarge: "File terlalu besar untuk Vercel upload langsung. Gunakan PDF di bawah 4 MB untuk prototype ini, atau kompres/split PDF terlebih dahulu."
  },
  en: {
    subtitle: "A Next.js prototype for dispute document extraction, comparable decision search, VAT regulation context, risk review, and taxpayer recommendation drafting.",
    preserved: "The Streamlit prototype remains preserved in the repository as the local Python source. This page is the new Vercel-native version.",
    dashboard: "Dashboard",
    guided: "Guided Flow",
    analysis: "Taxpayer Case Analysis",
    regulations: "Regulations",
    reports: "Reports",
    dataSummary: "Data Summary",
    dataVisualization: "Data Visualization",
    indexed: "Indexed decisions",
    coverage: "Extraction coverage",
    vatDocs: "VAT documents",
    localRules: "Local regulations",
    llmLabels: "LLM labels",
    startAnalysis: "Create Analysis",
    taxpayer: "Taxpayer / Company",
    taxType: "Tax type",
    issueType: "Dispute issue",
    stage: "Stage",
    amount: "Correction amount",
    authority: "Tax authority position",
    taxpayerPosition: "Taxpayer position",
    evidence: "Available evidence",
    upload: "Upload document",
    uploadHint: "For the Vercel demo, files are read in-browser and not stored. Production storage should use a database/object storage layer.",
    results: "Analysis Result",
    recommendation: "Recommendation Draft",
    topCases: "Most Relevant Decisions",
    evidenceGaps: "Evidence Gaps",
    relatedRules: "Regulatory Basis",
    recentDocs: "Recent Documents",
    health: "Check API Health",
    analyzing: "Analyzing with LLM...",
    askRule: "Ask regulation",
    ruleQuestion: "VAT regulation question",
    chatAnswer: "Chatbot answer",
    extractWithLlm: "Extract PDF with LLM",
    extracting: "Extracting PDF...",
    extractionResult: "Extraction Result",
    extractedEvidence: "Detected Evidence",
    exportWord: "Download Word",
    exportPdf: "Download PDF",
    exporting: "Creating file...",
    noPdf: "Choose a PDF file first.",
    fileTooLarge: "File is too large for direct Vercel upload. Use a PDF below 4 MB for this prototype, or compress/split the PDF first."
  }
};

const initialInput: AnalyzeInput = {
  taxpayerName: "PT SARI LEMBAH SUBUR",
  taxType: "VAT",
  issueType: "VAT tax base",
  stage: "Appeal",
  correctionAmount: "Rp674,560,719",
  taxAuthorityPosition: "The tax authority maintains the VAT tax base correction based on delivery classification and insufficient rebuttal evidence.",
  taxpayerPosition: "The taxpayer argues that the correction overstates taxable delivery and should be reconciled with reporting and transaction evidence.",
  evidence: ["VAT invoice", "VAT return", "Payment evidence"],
  language: "en"
};

function RsmMark() {
  return (
    <div className="rsm-mark" aria-label="RSM">
      <span className="rsm-gray" />
      <span className="rsm-green" />
      <span className="rsm-blue" />
      <strong>RSM</strong>
    </div>
  );
}

function MiniBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="mini-bar">
      <span>{label}</span>
      <div>
        <i style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <b>{value}</b>
    </div>
  );
}

export default function Home() {
  const [language, setLanguage] = useState<Language>("en");
  const [page, setPage] = useState<PageKey>("dashboard");
  const [form, setForm] = useState<AnalyzeInput>({ ...initialInput, language });
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedName, setUploadedName] = useState("");
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [extractionLoading, setExtractionLoading] = useState(false);
  const [extractionError, setExtractionError] = useState("");
  const [serverAnalysis, setServerAnalysis] = useState<AnalysisResultType | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [exportLoading, setExportLoading] = useState<"docx" | "pdf" | "">("");
  const [exportError, setExportError] = useState("");
  const [chatQuestion, setChatQuestion] = useState("Where is input VAT creditability regulated?");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatStatus, setChatStatus] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const labels = copy[language];
  const localAnalysis = useMemo(() => buildAnalysis({ ...form, language }), [form, language]);
  const analysis = serverAnalysis ?? localAnalysis;
  const pages: Array<[PageKey, string]> = [
    ["dashboard", labels.dashboard],
    ["guided", labels.guided],
    ["analysis", labels.analysis],
    ["regulations", labels.regulations],
    ["reports", labels.reports]
  ];

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    setForm((current) => ({ ...current, language: nextLanguage }));
    setServerAnalysis(null);
    setAnalysisError("");
    setExportError("");
    if (!chatAnswer) {
      setChatQuestion(nextLanguage === "en" ? "Where is input VAT creditability regulated?" : "Di mana aturan pengkreditan pajak masukan berada?");
    }
  }

  function updateForm(field: keyof AnalyzeInput, value: string) {
    setForm((current) => ({ ...current, [field]: value, language }));
    setServerAnalysis(null);
    setAnalysisError("");
    setExportError("");
  }

  function toggleEvidence(item: string) {
    setForm((current) => ({
      ...current,
      evidence: current.evidence.includes(item) ? current.evidence.filter((entry) => entry !== item) : [...current.evidence, item],
      language
    }));
    setServerAnalysis(null);
    setAnalysisError("");
    setExportError("");
  }

  function onFileChange(fileList: FileList | null) {
    const file = fileList?.[0] ?? null;
    setUploadedFile(file);
    setUploadedName(file?.name || "");
    setExtraction(null);
    setExtractionError("");
    setServerAnalysis(null);
    setAnalysisError("");
    setExportError("");
    if (file && file.size > MAX_UPLOAD_BYTES) {
      setExtractionError(`${copy[language].fileTooLarge} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
    }
  }

  async function runExtraction() {
    if (!uploadedFile) {
      setExtractionError(labels.noPdf);
      return;
    }
    if (uploadedFile.size > MAX_UPLOAD_BYTES) {
      setExtractionError(`${labels.fileTooLarge} (${(uploadedFile.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
    setExtractionLoading(true);
    setExtractionError("");
    setExportError("");
    try {
      const payload = new FormData();
      payload.append("file", uploadedFile);
      payload.append("language", language);
      const response = await fetch("/api/extract", { method: "POST", body: payload });
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await response.json() : { error: await response.text() };
      if (!response.ok) {
        const rawError = String(data.error || "PDF extraction failed.");
        const friendly =
          response.status === 413 || rawError.includes("FUNCTION_PAYLOAD_TOO_LARGE") || rawError.includes("Request Entity Too Large")
            ? `${labels.fileTooLarge} (${(uploadedFile.size / 1024 / 1024).toFixed(1)} MB)`
            : rawError;
        throw new Error(friendly);
      }
      setExtraction(data.extraction as ExtractionResult);
      setForm({ ...(data.analyzeInput as AnalyzeInput), language });
      setServerAnalysis(null);
    } catch (error) {
      setExtractionError(error instanceof Error ? error.message : "PDF extraction failed.");
    } finally {
      setExtractionLoading(false);
    }
  }

  async function runAnalysis() {
    setAnalysisLoading(true);
    setAnalysisError("");
    setExportError("");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, language })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Analysis request failed.");
      }
      setServerAnalysis(data as AnalysisResultType);
      setPage("reports");
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Analysis request failed.");
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function downloadReport(format: "docx" | "pdf") {
    setExportLoading(format);
    setExportError("");
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          input: { ...form, language },
          analysis,
          extraction,
          language
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Report export failed.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `rsm-tax-dispute-report.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Report export failed.");
    } finally {
      setExportLoading("");
    }
  }

  async function askRegulation() {
    setChatLoading(true);
    setChatStatus("");
    try {
      const response = await fetch("/api/regulation-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: chatQuestion, language })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Regulation chat request failed.");
      }
      setChatAnswer(data.answer || "");
      setChatStatus(data.llmStatus?.message || "");
    } catch (error) {
      setChatAnswer("");
      setChatStatus(error instanceof Error ? error.message : "Regulation chat request failed.");
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <main>
      <aside className="sidebar">
        <RsmMark />
        <p className="caption">Tax Dispute Simple Advisor</p>
        <label className="field-label" htmlFor="language">
          Language
        </label>
        <select id="language" value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>
          <option value="en">English</option>
          <option value="id">Bahasa Indonesia</option>
        </select>
        <nav>
          {pages.map(([key, title]) => (
            <button key={key} className={page === key ? "active" : ""} onClick={() => setPage(key)}>
              {title}
            </button>
          ))}
        </nav>
        <a className="health-link" href="/api/health">
          {labels.health}
        </a>
      </aside>

      <section className="content">
        <header className="hero">
          <div>
            <p className="eyebrow">Vercel Native Prototype</p>
            <h1>RSM Tax Dispute Simple Advisor</h1>
            <p>{labels.subtitle}</p>
          </div>
          <div className="preserved-note">{labels.preserved}</div>
        </header>

        {page === "dashboard" && (
          <>
            <section className="kpi-grid" aria-label={labels.dataSummary}>
              <Kpi label={labels.indexed} value={dashboardStats.indexedDecisions.toString()} tone="blue" />
              <Kpi label={labels.coverage} value={`${dashboardStats.extractionCoverage}%`} tone="green" />
              <Kpi label={labels.vatDocs} value={dashboardStats.vatDocuments.toString()} tone="blue" />
              <Kpi label={labels.localRules} value={dashboardStats.localRegulations.toString()} tone="gray" />
              <Kpi label={labels.llmLabels} value={dashboardStats.llmLabels.toString()} tone="gray" />
            </section>
            <section className="panel-grid">
              <Panel title="Decision Outcomes">
                <div className="donut" style={{ "--a": "38%", "--b": "70%" } as CSSProperties} />
                <div className="legend">
                  {outcomeDistribution.map((item) => (
                    <span key={item.label}>
                      <i style={{ background: item.color }} /> {item.label} ({item.value})
                    </span>
                  ))}
                </div>
              </Panel>
              <Panel title="Top Dispute Issues">
                {issueDistribution.map((item) => (
                  <MiniBar key={item.label} label={item.label} value={item.value} />
                ))}
              </Panel>
            </section>
            <Panel title={labels.recentDocs}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Decision</th>
                      <th>Document Type</th>
                      <th>Taxpayer</th>
                      <th>Tax</th>
                      <th>Issue</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDocuments.map((doc) => (
                      <tr key={doc.decision}>
                        <td>{doc.decision}</td>
                        <td>{doc.documentType}</td>
                        <td>{doc.taxpayer}</td>
                        <td>{doc.tax}</td>
                        <td>{doc.issue}</td>
                        <td>{doc.outcome}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}

        {(page === "guided" || page === "analysis") && (
          <section className="workbench">
            <Panel title={page === "guided" ? labels.guided : labels.analysis}>
              <div className="upload-box">
                <label>
                  {labels.upload}
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={(event) => onFileChange(event.target.files)}
                  />
                </label>
                <p>{uploadedName || labels.uploadHint}</p>
                {extractionError && <div className="status-banner error">{extractionError}</div>}
                <button className="primary-button secondary-button" onClick={runExtraction} disabled={extractionLoading || !uploadedFile}>
                  {extractionLoading ? labels.extracting : labels.extractWithLlm}
                </button>
              </div>
              {extraction && <ExtractionSummary labels={labels} extraction={extraction} />}
              <div className="form-grid">
                <Input label={labels.taxpayer} value={form.taxpayerName} onChange={(value) => updateForm("taxpayerName", value)} />
                <Input label={labels.taxType} value={form.taxType} onChange={(value) => updateForm("taxType", value)} />
                <Input label={labels.issueType} value={form.issueType} onChange={(value) => updateForm("issueType", value)} />
                <Input label={labels.stage} value={form.stage} onChange={(value) => updateForm("stage", value)} />
                <Input label={labels.amount} value={form.correctionAmount} onChange={(value) => updateForm("correctionAmount", value)} />
              </div>
              <TextArea label={labels.authority} value={form.taxAuthorityPosition} onChange={(value) => updateForm("taxAuthorityPosition", value)} />
              <TextArea label={labels.taxpayerPosition} value={form.taxpayerPosition} onChange={(value) => updateForm("taxpayerPosition", value)} />
              <div className="chips">
                {evidenceOptions[language].map((item) => (
                  <button key={item} className={form.evidence.includes(item) ? "selected" : ""} onClick={() => toggleEvidence(item)}>
                    {item}
                  </button>
                ))}
              </div>
              {analysisError && <div className="status-banner error">{analysisError}</div>}
              <button className="primary-button" onClick={runAnalysis} disabled={analysisLoading}>
                {analysisLoading ? labels.analyzing : labels.startAnalysis}
              </button>
            </Panel>
            <AnalysisResult
              labels={labels}
              analysis={analysis}
              canExport={Boolean(serverAnalysis)}
              exportLoading={exportLoading}
              exportError={exportError}
              onDownload={downloadReport}
            />
          </section>
        )}

        {page === "regulations" && (
          <Panel title={labels.relatedRules}>
            <div className="regulation-grid">
              {regulations.map((item) => (
                <article key={item.id} className="reg-card">
                  <b>{item.title}</b>
                  <span>{item.citation}</span>
                  <p>{item.focus}</p>
                  <div className="score-pill">{item.relevance}% relevance</div>
                </article>
              ))}
            </div>
            <div className="chat-preview">
              <strong>{labels.chatAnswer}</strong>
              <label className="control">
                <span>{labels.ruleQuestion}</span>
                <textarea value={chatQuestion} onChange={(event) => setChatQuestion(event.target.value)} rows={3} />
              </label>
              <button className="primary-button" onClick={askRegulation} disabled={chatLoading}>
                {chatLoading ? (language === "en" ? "Asking..." : "Menjawab...") : labels.askRule}
              </button>
              {chatStatus && <div className="status-banner">{chatStatus}</div>}
              {chatAnswer && <pre>{chatAnswer}</pre>}
            </div>
          </Panel>
        )}

        {page === "reports" && (
          <AnalysisResult
            labels={labels}
            analysis={analysis}
            expanded
            canExport={Boolean(serverAnalysis)}
            exportLoading={exportLoading}
            exportError={exportError}
            onDownload={downloadReport}
          />
        )}
      </section>
    </main>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "blue" | "green" | "gray" }) {
  return (
    <article className={`kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="control">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="control wide">
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} />
    </label>
  );
}

function ExtractionSummary({ labels, extraction }: { labels: (typeof copy)["en"]; extraction: ExtractionResult }) {
  const rows = [
    ["File", extraction.filename],
    ["Decision / Putusan", extraction.putusanNumber],
    ["Taxpayer", extraction.taxpayerName],
    ["NPWP", extraction.taxpayerNpwp],
    ["Tax period", extraction.taxPeriod],
    ["DGT unit", extraction.djpUnit],
    ["Counsel", extraction.legalCounselName],
    ["Issue", extraction.issueType || extraction.issueSubtype],
    ["Amount", extraction.correctionAmount]
  ].filter((row) => row[1]);
  return (
    <div className="extraction-summary">
      <h3>{labels.extractionResult}</h3>
      <div className="table-wrap">
        <table>
          <tbody>
            {rows.map(([field, value]) => (
              <tr key={field}>
                <th>{field}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {extraction.evidence.length > 0 && (
        <>
          <h3>{labels.extractedEvidence}</h3>
          <div className="chips readonly">
            {extraction.evidence.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </>
      )}
      {extraction.summary && <p className="muted">{extraction.summary}</p>}
    </div>
  );
}

function AnalysisResult({
  labels,
  analysis,
  expanded = false,
  canExport = false,
  exportLoading = "",
  exportError = "",
  onDownload
}: {
  labels: (typeof copy)["en"];
  analysis: AnalysisResultType;
  expanded?: boolean;
  canExport?: boolean;
  exportLoading?: "docx" | "pdf" | "";
  exportError?: string;
  onDownload?: (format: "docx" | "pdf") => void;
}) {
  return (
    <Panel title={labels.results}>
      {analysis.llmStatus && (
        <div className={`status-banner ${analysis.llmStatus.used ? "success" : ""}`}>
          {analysis.llmStatus.message}
          {analysis.llmStatus.model ? ` (${analysis.llmStatus.model})` : ""}
        </div>
      )}
      <div className="score-row">
        <Kpi label="Score" value={analysis.score.toString()} tone="blue" />
        <Kpi label="Confidence" value={analysis.confidence} tone="green" />
        <Kpi label="Evidence" value={analysis.evidenceScore.toString()} tone="gray" />
      </div>
      <div className="indication">{analysis.indication}</div>
      <h3>{labels.topCases}</h3>
      <div className="case-list">
        {analysis.topCases.map((item) => (
          <article key={item.id}>
            <b>{item.number}</b>
            <span>
              {item.taxType} | {item.issue} | {item.score}
            </span>
            <p>{item.reasoning}</p>
            <ul>
              {item.matchPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            {expanded && <p className="muted">{item.implication}</p>}
          </article>
        ))}
      </div>
      <h3>{labels.evidenceGaps}</h3>
      <div className="chips readonly">
        {analysis.evidenceGaps.map((gap) => (
          <span key={gap}>{gap}</span>
        ))}
      </div>
      <h3>{labels.recommendation}</h3>
      <pre>{analysis.recommendation}</pre>
      {canExport && onDownload && (
        <div className="export-actions">
          <button className="primary-button" onClick={() => onDownload("docx")} disabled={Boolean(exportLoading)}>
            {exportLoading === "docx" ? labels.exporting : labels.exportWord}
          </button>
          <button className="primary-button secondary-button" onClick={() => onDownload("pdf")} disabled={Boolean(exportLoading)}>
            {exportLoading === "pdf" ? labels.exporting : labels.exportPdf}
          </button>
        </div>
      )}
      {exportError && <div className="status-banner error">{exportError}</div>}
    </Panel>
  );
}
