"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { buildAnalysis, type AnalyzeInput } from "@/lib/analyze";
import { dashboardStats, issueDistribution, outcomeDistribution, recentDocuments, regulations } from "@/lib/mock-data";

type Language = "id" | "en";
type PageKey = "dashboard" | "guided" | "analysis" | "regulations" | "reports";

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
    health: "Check API Health"
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
    health: "Check API Health"
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
  const [uploadedName, setUploadedName] = useState("");
  const labels = copy[language];
  const analysis = useMemo(() => buildAnalysis({ ...form, language }), [form, language]);
  const pages: Array<[PageKey, string]> = [
    ["dashboard", labels.dashboard],
    ["guided", labels.guided],
    ["analysis", labels.analysis],
    ["regulations", labels.regulations],
    ["reports", labels.reports]
  ];

  function updateForm(field: keyof AnalyzeInput, value: string) {
    setForm((current) => ({ ...current, [field]: value, language }));
  }

  function toggleEvidence(item: string) {
    setForm((current) => ({
      ...current,
      evidence: current.evidence.includes(item) ? current.evidence.filter((entry) => entry !== item) : [...current.evidence, item],
      language
    }));
  }

  return (
    <main>
      <aside className="sidebar">
        <RsmMark />
        <p className="caption">Tax Dispute Simple Advisor</p>
        <label className="field-label" htmlFor="language">
          Language
        </label>
        <select id="language" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
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
                    accept=".pdf,.doc,.docx"
                    onChange={(event) => setUploadedName(event.target.files?.[0]?.name || "")}
                  />
                </label>
                <p>{uploadedName || labels.uploadHint}</p>
              </div>
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
              <button className="primary-button" onClick={() => setPage("reports")}>
                {labels.startAnalysis}
              </button>
            </Panel>
            <AnalysisResult labels={labels} analysis={analysis} />
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
              <strong>Chatbot preview</strong>
              <p>
                {language === "en"
                  ? "Ask where a VAT rule is located and the app will answer with the rule title, citation, and relevant section once the production regulation database is connected."
                  : "Tanyakan lokasi aturan PPN, lalu aplikasi akan menjawab nama aturan, sitasi, dan bagian relevan setelah database production tersambung."}
              </p>
            </div>
          </Panel>
        )}

        {page === "reports" && <AnalysisResult labels={labels} analysis={analysis} expanded />}
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

function AnalysisResult({ labels, analysis, expanded = false }: { labels: (typeof copy)["en"]; analysis: ReturnType<typeof buildAnalysis>; expanded?: boolean }) {
  return (
    <Panel title={labels.results}>
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
    </Panel>
  );
}
