"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { upload } from "@vercel/blob/client";
import { buildAnalysis, type AnalysisResult as AnalysisResultType, type AnalyzeInput } from "@/lib/analyze";
import { extractionToSearchText, searchSimilarCases, type SimilarCaseResult } from "@/lib/case-search";
import type { ExtractionResult } from "@/lib/extraction";
import { regulations, type Regulation } from "@/lib/mock-data";
import { filterRegulationsByTopic, regulationTopicOptions, type RegulationTopic } from "@/lib/regulation-knowledge";
import type { StoredDecisionFile } from "@/lib/stored-decisions";

type Language = "id" | "en";
type PageKey = "dashboard" | "guided" | "analysis" | "database" | "regulations" | "reports";
const MAX_UPLOAD_BYTES = 3.6 * 1024 * 1024;
const STORED_DECISIONS_KEY = "tax-dispute-stored-decisions";

const evidenceOptions = {
  id: ["Faktur Pajak", "SPT Masa PPN", "Bukti pembayaran", "Rekonsiliasi", "Konfirmasi Lawan Transaksi", "Surat Kuasa"],
  en: ["VAT invoice", "VAT return", "Payment evidence", "Reconciliation", "Counterparty confirmation", "Power of attorney"]
};

const copy = {
  id: {
    subtitle: "Prototype Next.js untuk ekstraksi dokumen sengketa, pencarian putusan pembanding, konteks peraturan pajak, review risiko, dan draft rekomendasi WP.",
    appGuidance: "Gunakan alur ini untuk upload putusan, ekstraksi data, mencari pembanding, tanya peraturan PPN atau Transfer Pricing, lalu membuat draft Word/PDF untuk review advisor.",
    dashboard: "Dashboard",
    guided: "Alur Terpandu",
    analysis: "Analisis Kasus WP",
    database: "Database Putusan",
    regulations: "Peraturan",
    reports: "Reports",
    dataSummary: "Ringkasan Data",
    dataVisualization: "Visualisasi Data",
    indexed: "Putusan terindeks",
    coverage: "Coverage ekstraksi",
    vatDocs: "Dokumen PPN/TP",
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
    ruleQuestion: "Pertanyaan aturan pajak",
    chatAnswer: "Jawaban chatbot",
    extractWithLlm: "Ekstrak PDF dengan LLM",
    extracting: "Mengekstrak PDF...",
    extractionResult: "Hasil Ekstraksi",
    extractedEvidence: "Bukti Terdeteksi",
    exportWord: "Download Word",
    exportPdf: "Download PDF",
    exporting: "Membuat file...",
    noPdf: "Pilih file PDF terlebih dahulu.",
    fileTooLarge: "Satu halaman/bagian PDF masih terlalu besar. Kompres PDF atau split bagian tersebut terlebih dahulu.",
    chunking: "PDF besar terdeteksi. Memecah dokumen menjadi beberapa bagian halaman...",
    extractingChunk: "Mengekstrak bagian",
    caseSearchTitle: "Pencarian Kasus Mirip",
    caseSearchIntro: "Cari putusan pembanding berdasarkan narasi sengketa, kata kunci, atau PDF. Hasil menampilkan persentase kemiripan dan alasan mengapa putusan tersebut relevan.",
    caseQuery: "Kata kunci / narasi kasus",
    caseQueryPlaceholder: "Contoh: Sengketa PPN atas koreksi DPP, bukti pembayaran lengkap, faktur pajak, SPT Masa PPN, DJP menolak karena rekonsiliasi transaksi.",
    caseUpload: "Upload dokumen kasus",
    searchSimilar: "Cari Kasus Mirip",
    searchingSimilar: "Mencari kasus mirip...",
    caseResults: "Hasil Kemiripan",
    similarity: "Kemiripan",
    whySimilar: "Mengapa mirip",
    keyOverlap: "Titik kemiripan",
    differences: "Hal yang perlu dibedakan",
    useInArgument: "Cara pakai dalam argumentasi",
    noCaseQuery: "Isi narasi/kata kunci atau upload PDF terlebih dahulu.",
    extractedForSearch: "Dokumen berhasil diekstrak untuk pencarian.",
    databaseTitle: "Database Putusan",
    databaseIntro: "Upload PDF putusan besar langsung ke Vercel Blob. Setelah upload, aplikasi akan mengekstrak informasi utama dengan LLM dan menyimpan metadata beserta hasil ekstraksi ke database.",
    databaseUploadHint: "PDF akan disimpan ke Blob. Setelah itu klik Upload + Ekstrak, atau gunakan tombol Ekstrak pada dokumen yang sudah tersimpan.",
    uploadDecisionPdfs: "Upload PDF Putusan",
    uploadToBlob: "Upload ke Blob",
    uploadAndExtract: "Upload + Ekstrak",
    uploadingToBlob: "Mengupload ke Blob...",
    blobUploadProgress: "Progress upload",
    storedDocuments: "Dokumen Tersimpan",
    noStoredDocuments: "Belum ada dokumen yang diupload dari browser ini.",
    openPdf: "Buka PDF",
    blobMissing: "BLOB_READ_WRITE_TOKEN belum tersedia di Vercel/project lokal.",
    fileSize: "Ukuran file",
    uploadedAt: "Waktu upload",
    blobPath: "Path Blob",
    databaseSaved: "Metadata dokumen tersimpan di database.",
    databaseFallback: "Upload berhasil, tetapi metadata database belum tersimpan. Data tetap muncul sementara di browser.",
    extractionSaved: "Hasil ekstraksi tersimpan di database.",
    extractionPending: "Upload berhasil, tetapi ekstraksi belum tersimpan.",
    status: "Status",
    decisionNumber: "Nomor putusan",
    extractStored: "Ekstrak",
    reExtractStored: "Ekstrak ulang",
    extractingStored: "Mengekstrak...",
    deleteStored: "Hapus",
    deletingStored: "Menghapus...",
    copyBlob: "Copy URL",
    copiedBlob: "Copied",
    action: "Aksi",
    confirmDelete: "Hapus dokumen ini dari database dan Blob?",
    deleteSaved: "Dokumen dihapus.",
    noDynamicDocuments: "Belum ada dokumen database. Upload PDF di menu Database Putusan agar dashboard terisi otomatis.",
    decisionOutcomes: "Outcome Putusan",
    topDisputeIssues: "Top Pokok Sengketa",
    regulationTopic: "Topik peraturan",
    updateFromOrtax: "Update dari Ortax",
    updatingRules: "Mengambil aturan dari Ortax...",
    regulationUpdated: "Knowledge peraturan diperbarui.",
    source: "Sumber",
    openSource: "Buka sumber",
    manualRegulation: "Upload / input manual aturan",
    manualTitle: "Nama aturan",
    manualCitation: "Nomor / sitasi",
    manualFocus: "Ringkasan fungsi aturan",
    manualSourceUrl: "Link sumber",
    manualContent: "Catatan atau kutipan ringkas",
    uploadManualRule: "Upload file teks aturan",
    saveManualRule: "Simpan aturan manual",
    savingManualRule: "Menyimpan aturan...",
    regulationHelp: "Pilih topik untuk memperbarui knowledge dari Ortax. Untuk aturan yang belum tersedia, upload/paste ringkasan manual agar chatbot bisa memakainya.",
    allTopics: "Semua topik",
    totalRecords: "Total data",
    itemsPerPage: "Per halaman",
    pageOf: "Halaman",
    previousPage: "Sebelumnya",
    nextPage: "Berikutnya",
    showingRecords: "Menampilkan",
    storedRuleList: "List aturan tersimpan",
    jumpToStoredRules: "Lihat list aturan tersimpan",
    noRegulations: "Belum ada aturan untuk topik ini."
  },
  en: {
    subtitle: "A Next.js prototype for dispute document extraction, comparable decision search, tax regulation context, risk review, and taxpayer recommendation drafting.",
    appGuidance: "Use this workflow to upload decisions, extract structured data, find comparators, ask VAT or Transfer Pricing regulation questions, then produce Word/PDF drafts for advisor review.",
    dashboard: "Dashboard",
    guided: "Guided Flow",
    analysis: "Taxpayer Case Analysis",
    database: "Decision Database",
    regulations: "Regulations",
    reports: "Reports",
    dataSummary: "Data Summary",
    dataVisualization: "Data Visualization",
    indexed: "Indexed decisions",
    coverage: "Extraction coverage",
    vatDocs: "VAT/TP documents",
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
    ruleQuestion: "Tax regulation question",
    chatAnswer: "Chatbot answer",
    extractWithLlm: "Extract PDF with LLM",
    extracting: "Extracting PDF...",
    extractionResult: "Extraction Result",
    extractedEvidence: "Detected Evidence",
    exportWord: "Download Word",
    exportPdf: "Download PDF",
    exporting: "Creating file...",
    noPdf: "Choose a PDF file first.",
    fileTooLarge: "One PDF page/section is still too large. Please compress the PDF or split that section first.",
    chunking: "Large PDF detected. Splitting document into page sections...",
    extractingChunk: "Extracting section",
    caseSearchTitle: "Similar Case Search",
    caseSearchIntro: "Search comparable decisions using a dispute narrative, keywords, or a PDF. Results show similarity percentage and why each decision is relevant.",
    caseQuery: "Keywords / case narrative",
    caseQueryPlaceholder: "Example: VAT dispute on tax base correction, complete payment evidence, tax invoices, VAT return, tax authority rejects due to transaction reconciliation.",
    caseUpload: "Upload case document",
    searchSimilar: "Find Similar Cases",
    searchingSimilar: "Finding similar cases...",
    caseResults: "Similarity Results",
    similarity: "Similarity",
    whySimilar: "Why similar",
    keyOverlap: "Match points",
    differences: "Points to distinguish",
    useInArgument: "How to use in argument",
    noCaseQuery: "Enter a narrative/keyword or upload a PDF first.",
    extractedForSearch: "Document extracted for search.",
    databaseTitle: "Decision Database",
    databaseIntro: "Upload large decision PDFs directly to Vercel Blob. After upload, the app extracts key information with the LLM and saves both metadata and extraction JSON to the database.",
    databaseUploadHint: "PDFs are stored in Blob. Then click Upload + Extract, or use the Extract button for already stored documents.",
    uploadDecisionPdfs: "Upload decision PDFs",
    uploadToBlob: "Upload to Blob",
    uploadAndExtract: "Upload + Extract",
    uploadingToBlob: "Uploading to Blob...",
    blobUploadProgress: "Upload progress",
    storedDocuments: "Stored Documents",
    noStoredDocuments: "No documents have been uploaded from this browser yet.",
    openPdf: "Open PDF",
    blobMissing: "BLOB_READ_WRITE_TOKEN is not available in Vercel/local project env.",
    fileSize: "File size",
    uploadedAt: "Uploaded at",
    blobPath: "Blob path",
    databaseSaved: "Document metadata saved to database.",
    databaseFallback: "Upload succeeded, but database metadata was not saved. The document still appears temporarily in this browser.",
    extractionSaved: "Extraction saved to database.",
    extractionPending: "Upload succeeded, but extraction was not saved.",
    status: "Status",
    decisionNumber: "Decision number",
    extractStored: "Extract",
    reExtractStored: "Re-extract",
    extractingStored: "Extracting...",
    deleteStored: "Delete",
    deletingStored: "Deleting...",
    copyBlob: "Copy URL",
    copiedBlob: "Copied",
    action: "Action",
    confirmDelete: "Delete this document from the database and Blob?",
    deleteSaved: "Document deleted.",
    noDynamicDocuments: "No database documents yet. Upload PDFs in Decision Database so the dashboard updates automatically.",
    decisionOutcomes: "Decision Outcomes",
    topDisputeIssues: "Top Dispute Issues",
    regulationTopic: "Regulation topic",
    updateFromOrtax: "Update from Ortax",
    updatingRules: "Fetching rules from Ortax...",
    regulationUpdated: "Regulation knowledge updated.",
    source: "Source",
    openSource: "Open source",
    manualRegulation: "Manual rule upload / input",
    manualTitle: "Rule name",
    manualCitation: "Number / citation",
    manualFocus: "Rule summary",
    manualSourceUrl: "Source link",
    manualContent: "Notes or short excerpt",
    uploadManualRule: "Upload rule text file",
    saveManualRule: "Save manual rule",
    savingManualRule: "Saving rule...",
    regulationHelp: "Choose a topic to refresh knowledge from Ortax. For rules not yet available, upload or paste a manual summary so the chatbot can use it.",
    allTopics: "All topics",
    totalRecords: "Total records",
    itemsPerPage: "Per page",
    pageOf: "Page",
    previousPage: "Previous",
    nextPage: "Next",
    showingRecords: "Showing",
    storedRuleList: "Stored regulation list",
    jumpToStoredRules: "View stored regulation list",
    noRegulations: "No regulations yet for this topic."
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

function sanitizeFilePart(value: string) {
  return (value || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildReportFilename(format: "docx" | "pdf", input: AnalyzeInput, extraction: ExtractionResult | null) {
  const taxpayer = sanitizeFilePart(input.taxpayerName || extraction?.taxpayerName || "taxpayer");
  const caseNumber = sanitizeFilePart(extraction?.putusanNumber || extraction?.skpNumber || extraction?.djpDecisionNumber || input.issueType || "case");
  const year = sanitizeFilePart(extraction?.putusanYear || extraction?.taxPeriod || new Date().getFullYear().toString());
  return `${taxpayer}_${caseNumber}_${year}.${format}`;
}

function loadStoredDecisions(): StoredDecisionFile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORED_DECISIONS_KEY);
    return raw ? (JSON.parse(raw) as StoredDecisionFile[]) : [];
  } catch {
    return [];
  }
}

function saveStoredDecisions(items: StoredDecisionFile[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORED_DECISIONS_KEY, JSON.stringify(items));
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function getPageNumbers(currentPage: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  return Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
}

function getPaginationRange(totalItems: number, currentPage: number, perPage: number) {
  if (!totalItems) return { start: 0, end: 0 };
  const start = (currentPage - 1) * perPage + 1;
  return {
    start,
    end: Math.min(start + perPage - 1, totalItems)
  };
}

function cleanMergedText(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\bChunk\s+\d+\s*:\s*/gi, "\n\n")
    .replace(/\b(?:Section|Bagian|Halaman|Pages?)\s+\d+(?:\s*[-–]\s*\d+)?\s*:\s*/gi, "\n\n")
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function combineExtractionText(parts: string[]) {
  const seen = new Set<string>();
  return parts
    .map(cleanMergedText)
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLowerCase().replace(/\s+/g, " ").slice(0, 260);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n\n");
}

function classifyOutcome(outcome: string, language: Language) {
  const text = outcome.toLowerCase();
  if (/dikabulkan seluruh|fully|granted in full|seluruhnya/.test(text)) {
    return language === "en" ? "Taxpayer fully prevailed" : "WP dikabulkan seluruhnya";
  }
  if (/dikabulkan sebagian|partial|partially|sebagian/.test(text)) {
    return language === "en" ? "Taxpayer partially prevailed" : "WP dikabulkan sebagian";
  }
  if (/tidak dapat diterima|gugur|formal|dismiss/.test(text)) {
    return language === "en" ? "Formal dismissal" : "Tidak dapat diterima / gugur";
  }
  if (/ditolak|djp|terbanding|authority|rejected/.test(text)) {
    return language === "en" ? "Tax authority prevailed" : "DJP menang / banding ditolak";
  }
  return language === "en" ? "Unclassified" : "Belum terklasifikasi";
}

function buildDynamicDashboard(documents: StoredDecisionFile[], language: Language, localRegulationCount: number) {
  const extracted = documents.filter((item) => item.extraction);
  const topicDocs = documents.filter((item) =>
    /ppn|vat|transfer pricing|harga transfer|hubungan istimewa|afiliasi/i.test([item.extraction?.taxType, item.extraction?.issueType, item.filename].filter(Boolean).join(" "))
  ).length;
  const issueCounts = new Map<string, number>();
  const outcomeCounts = new Map<string, number>();

  for (const item of documents) {
    const extraction = item.extraction;
    const issue = cleanMergedText(extraction?.issueType || extraction?.issueSubtype || extraction?.correctionObject || (language === "en" ? "Unclassified" : "Belum terklasifikasi"));
    issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);
    const outcome = classifyOutcome(extraction?.outcome || "", language);
    outcomeCounts.set(outcome, (outcomeCounts.get(outcome) || 0) + 1);
  }

  const colors = ["#54585A", "#43A047", "#66C7EE", "#8A8F93", "#009CDE"];
  return {
    stats: {
      indexedDecisions: documents.length,
      extractionCoverage: documents.length ? Math.round((extracted.length / documents.length) * 100) : 0,
      vatDocuments: topicDocs,
      localRegulations: localRegulationCount,
      llmLabels: extracted.length
    },
    outcomeDistribution: Array.from(outcomeCounts.entries()).map(([label, value], index) => ({
      label,
      value,
      color: colors[index % colors.length]
    })),
    issueDistribution: Array.from(issueCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, value]) => ({ label, value })),
    recentDocuments: documents.slice(0, 6).map((item) => ({
      decision: item.extraction?.putusanNumber || item.filename,
      documentType: item.extraction?.documentType || "-",
      taxpayer: item.extraction?.taxpayerName || "-",
      tax: item.extraction?.taxType || "-",
      issue: item.extraction?.issueType || item.extraction?.correctionObject || "-",
      outcome: item.extraction?.outcome || "-"
    }))
  };
}

function buildDonutStyle(items: Array<{ value: number; color: string }>): CSSProperties {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) return {};
  let cursor = 0;
  const segments = items
    .map((item) => {
      const start = cursor;
      cursor += (item.value / total) * 100;
      return `${item.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    })
    .join(", ");
  return { background: `conic-gradient(${segments})` };
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
  const [extractionProgress, setExtractionProgress] = useState("");
  const [serverAnalysis, setServerAnalysis] = useState<AnalysisResultType | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [exportLoading, setExportLoading] = useState<"docx" | "pdf" | "">("");
  const [exportError, setExportError] = useState("");
  const [chatQuestion, setChatQuestion] = useState("Where is transfer pricing documentation regulated?");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatStatus, setChatStatus] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [caseSearchText, setCaseSearchText] = useState("");
  const [caseSearchFile, setCaseSearchFile] = useState<File | null>(null);
  const [caseSearchFileName, setCaseSearchFileName] = useState("");
  const [caseSearchExtraction, setCaseSearchExtraction] = useState<ExtractionResult | null>(null);
  const [caseSearchResults, setCaseSearchResults] = useState<SimilarCaseResult[]>([]);
  const [caseSearchLoading, setCaseSearchLoading] = useState(false);
  const [caseSearchStatus, setCaseSearchStatus] = useState("");
  const [caseSearchError, setCaseSearchError] = useState("");
  const [databaseFiles, setDatabaseFiles] = useState<File[]>([]);
  const [storedDocuments, setStoredDocuments] = useState<StoredDecisionFile[]>(() => loadStoredDecisions());
  const [blobUploadLoading, setBlobUploadLoading] = useState(false);
  const [blobUploadStatus, setBlobUploadStatus] = useState("");
  const [blobUploadError, setBlobUploadError] = useState("");
  const [extractingDocumentId, setExtractingDocumentId] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [regulationRecords, setRegulationRecords] = useState<Regulation[]>(regulations);
  const [regulationTopic, setRegulationTopic] = useState<RegulationTopic>("transfer_pricing");
  const [regulationStatus, setRegulationStatus] = useState("");
  const [regulationError, setRegulationError] = useState("");
  const [regulationLoading, setRegulationLoading] = useState(false);
  const [manualRule, setManualRule] = useState({
    title: "",
    citation: "",
    focus: "",
    sourceUrl: "",
    content: ""
  });
  const [manualRuleSaving, setManualRuleSaving] = useState(false);
  const [regulationPage, setRegulationPage] = useState(1);
  const [regulationPerPage, setRegulationPerPage] = useState(6);
  const labels = copy[language];
  const localAnalysis = useMemo(() => buildAnalysis({ ...form, language }), [form, language]);
  const analysis = serverAnalysis ?? localAnalysis;
  const dynamicDashboard = useMemo(() => buildDynamicDashboard(storedDocuments, language, regulationRecords.length), [storedDocuments, language, regulationRecords.length]);
  const visibleRegulations = useMemo(() => filterRegulationsByTopic(regulationRecords, regulationTopic), [regulationRecords, regulationTopic]);
  const regulationTotalPages = Math.max(1, Math.ceil(visibleRegulations.length / regulationPerPage));
  const currentRegulationPage = Math.min(regulationPage, regulationTotalPages);
  const pagedRegulations = useMemo(
    () => visibleRegulations.slice((currentRegulationPage - 1) * regulationPerPage, currentRegulationPage * regulationPerPage),
    [visibleRegulations, currentRegulationPage, regulationPerPage]
  );
  const pages: Array<[PageKey, string]> = [
    ["dashboard", labels.dashboard],
    ["guided", labels.guided],
    ["analysis", labels.analysis],
    ["database", labels.database],
    ["regulations", labels.regulations],
    ["reports", labels.reports]
  ];

  useEffect(() => {
    let cancelled = false;
    async function loadDatabaseDocuments() {
      try {
        const response = await fetch("/api/decisions");
        if (!response.ok) return;
        const data = (await response.json()) as { records?: StoredDecisionFile[] };
        if (!cancelled && Array.isArray(data.records)) {
          setStoredDocuments(data.records);
          saveStoredDecisions(data.records);
        }
      } catch {
        // Local browser cache remains the fallback until database connectivity is available.
      }
    }
    loadDatabaseDocuments();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setRegulationPage((current) => Math.min(Math.max(1, current), regulationTotalPages));
  }, [regulationTotalPages]);

  useEffect(() => {
    let cancelled = false;
    async function loadRegulations() {
      try {
        const response = await fetch("/api/regulations");
        if (!response.ok) return;
        const data = (await response.json()) as { records?: Regulation[] };
        if (!cancelled && Array.isArray(data.records) && data.records.length) {
          setRegulationRecords(data.records);
        }
      } catch {
        // Seed regulation cards remain available if the database is unavailable.
      }
    }
    loadRegulations();
    return () => {
      cancelled = true;
    };
  }, []);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    setForm((current) => ({ ...current, language: nextLanguage }));
    setServerAnalysis(null);
    setAnalysisError("");
    setExportError("");
    if (!chatAnswer) {
      setChatQuestion(nextLanguage === "en" ? "Where is transfer pricing documentation regulated?" : "Di mana aturan dokumentasi transfer pricing berada?");
    }
    if (caseSearchText || caseSearchExtraction) {
      const query = [caseSearchText, extractionToSearchText(caseSearchExtraction)].filter(Boolean).join("\n");
      setCaseSearchResults(searchSimilarCases(query, nextLanguage));
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
    setExtractionProgress("");
    setServerAnalysis(null);
    setAnalysisError("");
    setExportError("");
  }

  async function splitPdfForUpload(file: File, setProgress = setExtractionProgress) {
    if (file.size <= MAX_UPLOAD_BYTES) {
      return [file];
    }
    setProgress(labels.chunking);
    const { PDFDocument } = await import("pdf-lib");
    const sourceBytes = await file.arrayBuffer();
    const sourceDoc = await PDFDocument.load(sourceBytes);
    const chunks: File[] = [];
    let pageIndex = 0;
    const baseName = file.name.replace(/\.pdf$/i, "");

    while (pageIndex < sourceDoc.getPageCount()) {
      let pageCount = Math.min(5, sourceDoc.getPageCount() - pageIndex);
      let chunkBytes: Uint8Array | null = null;

      while (pageCount >= 1) {
        const chunkDoc = await PDFDocument.create();
        const indices = Array.from({ length: pageCount }, (_, offset) => pageIndex + offset);
        const copiedPages = await chunkDoc.copyPages(sourceDoc, indices);
        copiedPages.forEach((page) => chunkDoc.addPage(page));
        chunkBytes = await chunkDoc.save();
        if (chunkBytes.byteLength <= MAX_UPLOAD_BYTES || pageCount === 1) {
          break;
        }
        pageCount = Math.max(1, Math.floor(pageCount / 2));
      }

      if (!chunkBytes || chunkBytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new Error(`${labels.fileTooLarge} (${((chunkBytes?.byteLength || 0) / 1024 / 1024).toFixed(1)} MB)`);
      }

      const startPage = pageIndex + 1;
      const endPage = pageIndex + pageCount;
      const chunkBlob = new Blob([chunkBytes.slice().buffer], { type: "application/pdf" });
      chunks.push(
        new File([chunkBlob], `${baseName}-pages-${startPage}-${endPage}.pdf`, {
          type: "application/pdf"
        })
      );
      pageIndex += pageCount;
    }

    return chunks;
  }

  async function extractOnePdf(file: File) {
    const payload = new FormData();
    payload.append("file", file);
    payload.append("language", language);
    const response = await fetch("/api/extract", { method: "POST", body: payload });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : { error: await response.text() };
    if (!response.ok) {
      const rawError = String(data.error || "PDF extraction failed.");
      const friendly =
        response.status === 413 || rawError.includes("FUNCTION_PAYLOAD_TOO_LARGE") || rawError.includes("Request Entity Too Large")
          ? `${labels.fileTooLarge} (${(file.size / 1024 / 1024).toFixed(1)} MB)`
          : rawError;
      throw new Error(friendly);
    }
    return data.extraction as ExtractionResult;
  }

  function mergeExtractions(parts: ExtractionResult[], originalName: string): ExtractionResult {
    const first = parts[0];
    const pick = (field: keyof ExtractionResult) => {
      const value = parts.map((part) => part[field]).find((item) => typeof item === "string" && item.trim());
      return typeof value === "string" ? cleanMergedText(value) : "";
    };
    const unique = (values: string[][]) => Array.from(new Set(values.flat().map((item) => item.trim()).filter(Boolean))).slice(0, 24);
    const combined = (field: keyof ExtractionResult) =>
      combineExtractionText(
        parts.map((part) => {
          const value = part[field];
          return typeof value === "string" ? value : "";
        })
      );

    return {
      ...first,
      filename: originalName,
      documentType: pick("documentType"),
      putusanNumber: pick("putusanNumber"),
      putusanYear: pick("putusanYear"),
      taxpayerName: pick("taxpayerName"),
      taxpayerNpwp: pick("taxpayerNpwp"),
      taxpayerAddress: pick("taxpayerAddress"),
      representativeName: pick("representativeName"),
      legalCounselName: pick("legalCounselName"),
      legalCounselLicense: pick("legalCounselLicense"),
      appelleeName: pick("appelleeName"),
      djpUnit: pick("djpUnit"),
      taxType: pick("taxType"),
      taxPeriod: pick("taxPeriod"),
      skpNumber: pick("skpNumber"),
      djpDecisionNumber: pick("djpDecisionNumber"),
      issueType: pick("issueType"),
      issueSubtype: pick("issueSubtype"),
      correctionAmount: pick("correctionAmount"),
      correctionObject: pick("correctionObject"),
      correctionReason: combined("correctionReason") || pick("correctionReason"),
      taxpayerRebuttal: combined("taxpayerRebuttal") || pick("taxpayerRebuttal"),
      taxAuthorityPosition: combined("taxAuthorityPosition") || pick("taxAuthorityPosition"),
      taxpayerPosition: combined("taxpayerPosition") || pick("taxpayerPosition"),
      evidence: unique(parts.map((part) => part.evidence)),
      legalReferences: unique(parts.map((part) => part.legalReferences)),
      courtReasoning: combined("courtReasoning") || pick("courtReasoning"),
      outcome: pick("outcome"),
      summary: combined("summary") || pick("summary"),
      extractedAt: new Date().toISOString(),
      llmStatus: {
        used: true,
        model: first.llmStatus.model,
        message:
          parts.length > 1
            ? language === "en"
              ? `PDF extracted with LLM across ${parts.length} document sections`
              : `PDF diekstrak dengan LLM dari ${parts.length} bagian dokumen`
            : first.llmStatus.message
      }
    };
  }

  async function runExtraction() {
    if (!uploadedFile) {
      setExtractionError(labels.noPdf);
      return;
    }
    setExtractionLoading(true);
    setExtractionError("");
    setExtractionProgress("");
    setExportError("");
    try {
      const chunks = await splitPdfForUpload(uploadedFile);
      const extractedParts: ExtractionResult[] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        setExtractionProgress(`${labels.extractingChunk} ${index + 1}/${chunks.length}`);
        extractedParts.push(await extractOnePdf(chunks[index]));
      }
      const mergedExtraction = mergeExtractions(extractedParts, uploadedFile.name);
      setExtraction(mergedExtraction);
      setForm({
        taxpayerName: mergedExtraction.taxpayerName,
        taxType: mergedExtraction.taxType || (language === "en" ? "VAT" : "PPN"),
        issueType: mergedExtraction.issueType || mergedExtraction.issueSubtype || (language === "en" ? "VAT dispute" : "Sengketa PPN"),
        stage: mergedExtraction.documentType?.toLowerCase().includes("banding") ? (language === "en" ? "Appeal" : "Banding") : language === "en" ? "Appeal" : "Banding",
        correctionAmount: mergedExtraction.correctionAmount,
        taxAuthorityPosition: mergedExtraction.taxAuthorityPosition || mergedExtraction.correctionReason,
        taxpayerPosition: mergedExtraction.taxpayerPosition || mergedExtraction.taxpayerRebuttal,
        evidence: mergedExtraction.evidence || [],
        language
      });
      setServerAnalysis(null);
    } catch (error) {
      setExtractionError(error instanceof Error ? error.message : "PDF extraction failed.");
    } finally {
      setExtractionLoading(false);
      setExtractionProgress("");
    }
  }

  function onCaseSearchFileChange(fileList: FileList | null) {
    const file = fileList?.[0] ?? null;
    setCaseSearchFile(file);
    setCaseSearchFileName(file?.name || "");
    setCaseSearchExtraction(null);
    setCaseSearchResults([]);
    setCaseSearchStatus("");
    setCaseSearchError("");
  }

  function updateCaseSearchText(value: string) {
    setCaseSearchText(value);
    setCaseSearchResults([]);
    setCaseSearchError("");
    setCaseSearchStatus("");
  }

  async function runCaseSearch() {
    setCaseSearchLoading(true);
    setCaseSearchStatus("");
    setCaseSearchError("");
    try {
      let extracted: ExtractionResult | null = caseSearchExtraction;
      if (caseSearchFile) {
        const chunks = await splitPdfForUpload(caseSearchFile, setCaseSearchStatus);
        const extractedParts: ExtractionResult[] = [];
        for (let index = 0; index < chunks.length; index += 1) {
          setCaseSearchStatus(`${labels.extractingChunk} ${index + 1}/${chunks.length}`);
          extractedParts.push(await extractOnePdf(chunks[index]));
        }
        extracted = mergeExtractions(extractedParts, caseSearchFile.name);
        setCaseSearchExtraction(extracted);
        setCaseSearchStatus(labels.extractedForSearch);
      }

      const query = [caseSearchText, extractionToSearchText(extracted)].filter(Boolean).join("\n");
      if (!query.trim()) {
        throw new Error(labels.noCaseQuery);
      }
      setCaseSearchResults(searchSimilarCases(query, language));
    } catch (error) {
      setCaseSearchError(error instanceof Error ? error.message : "Case search failed.");
    } finally {
      setCaseSearchLoading(false);
    }
  }

  function onDatabaseFilesChange(fileList: FileList | null) {
    const files = Array.from(fileList || []).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    setDatabaseFiles(files);
    setBlobUploadStatus("");
    setBlobUploadError("");
  }

  async function uploadDatabaseFiles() {
    if (!databaseFiles.length) {
      setBlobUploadError(labels.noPdf);
      return;
    }
    setBlobUploadLoading(true);
    setBlobUploadStatus("");
    setBlobUploadError("");
    try {
      const uploaded: StoredDecisionFile[] = [];
      for (let index = 0; index < databaseFiles.length; index += 1) {
        const file = databaseFiles[index];
        setBlobUploadStatus(`${labels.uploadingToBlob} ${index + 1}/${databaseFiles.length}: ${file.name}`);
        const pathname = `decisions/${Date.now()}-${sanitizeFilePart(file.name) || "decision"}.pdf`;
        const blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          multipart: file.size > 8 * 1024 * 1024,
          clientPayload: JSON.stringify({
            filename: file.name,
            size: file.size,
            uploadedFrom: "tax-dispute-prototype"
          }),
          onUploadProgress: (event) => {
            setBlobUploadStatus(
              `${labels.blobUploadProgress} ${index + 1}/${databaseFiles.length}: ${event.percentage.toFixed(0)}% - ${file.name}`
            );
          }
        });
        let extracted: ExtractionResult | null = null;
        try {
          const chunks = await splitPdfForUpload(file, (message) => setBlobUploadStatus(`${file.name}: ${message}`));
          const extractedParts: ExtractionResult[] = [];
          for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
            setBlobUploadStatus(`${labels.extractingChunk} ${chunkIndex + 1}/${chunks.length}: ${file.name}`);
            extractedParts.push(await extractOnePdf(chunks[chunkIndex]));
          }
          extracted = mergeExtractions(extractedParts, file.name);
        } catch (error) {
          setBlobUploadStatus(
            `${language === "en" ? "Uploaded, extraction skipped for" : "Upload berhasil, ekstraksi dilewati untuk"} ${file.name}: ${
              error instanceof Error ? error.message : "extraction failed"
            }`
          );
        }

        uploaded.push({
          id: `${blob.pathname}-${Date.now()}`,
          filename: file.name,
          pathname: blob.pathname,
          url: blob.url,
          downloadUrl: blob.downloadUrl,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          status: extracted ? "extracted" : "uploaded",
          extraction: extracted
        });
      }
      const next = [...uploaded, ...storedDocuments];
      setStoredDocuments(next);
      saveStoredDecisions(next);
      setDatabaseFiles([]);
      let savedToDatabase = 0;
      for (const item of uploaded) {
        const response = await fetch("/api/decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item)
        });
        if (response.ok) savedToDatabase += 1;
      }
      setBlobUploadStatus(
        `${uploaded.length} ${language === "en" ? "document(s) uploaded to Blob." : "dokumen berhasil diupload ke Blob."} ${
          savedToDatabase === uploaded.length ? labels.databaseSaved : labels.databaseFallback
        } ${uploaded.every((item) => item.extraction) ? labels.extractionSaved : labels.extractionPending}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blob upload failed.";
      setBlobUploadError(message.includes("BLOB_READ_WRITE_TOKEN") ? labels.blobMissing : message);
    } finally {
      setBlobUploadLoading(false);
    }
  }

  async function extractStoredDocument(item: StoredDecisionFile) {
    setExtractingDocumentId(item.id);
    setBlobUploadStatus("");
    setBlobUploadError("");
    try {
      const response = await fetch("/api/decisions/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...item, language })
      });
      const data = (await response.json()) as { extraction?: ExtractionResult; error?: string };
      if (!response.ok || !data.extraction) {
        throw new Error(data.error || "Stored document extraction failed.");
      }
      const next = storedDocuments.map((document) =>
        document.id === item.id ? { ...document, status: "extracted" as const, extraction: data.extraction || null } : document
      );
      setStoredDocuments(next);
      saveStoredDecisions(next);
      setBlobUploadStatus(labels.extractionSaved);
    } catch (error) {
      setBlobUploadError(error instanceof Error ? error.message : "Stored document extraction failed.");
    } finally {
      setExtractingDocumentId("");
    }
  }

  async function deleteStoredDocument(item: StoredDecisionFile) {
    if (!window.confirm(labels.confirmDelete)) return;
    setDeletingDocumentId(item.id);
    setBlobUploadStatus("");
    setBlobUploadError("");
    try {
      const response = await fetch("/api/decisions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item)
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; blobWarning?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not delete document.");
      }
      const next = storedDocuments.filter((document) => document.id !== item.id);
      setStoredDocuments(next);
      saveStoredDecisions(next);
      setBlobUploadStatus(data.blobWarning ? `${labels.deleteSaved} Blob: ${data.blobWarning}` : labels.deleteSaved);
    } catch (error) {
      setBlobUploadError(error instanceof Error ? error.message : "Could not delete document.");
    } finally {
      setDeletingDocumentId("");
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
        body: JSON.stringify({ input: { ...form, language }, extraction })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Analysis request failed.");
      }
      setServerAnalysis(data as AnalysisResultType);
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
      anchor.download = `${buildReportFilename(format, form, extraction)}`;
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
        body: JSON.stringify({ question: chatQuestion, language, topic: regulationTopic })
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

  async function updateRegulationsFromOrtax() {
    setRegulationLoading(true);
    setRegulationStatus("");
    setRegulationError("");
    try {
      const response = await fetch("/api/regulations/ortax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: regulationTopic })
      });
      const data = (await response.json()) as { records?: Regulation[]; error?: string; imported?: number };
      if (!response.ok) {
        throw new Error(data.error || "Could not update Ortax regulations.");
      }
      if (Array.isArray(data.records) && data.records.length) {
        setRegulationRecords(data.records);
      }
      setRegulationStatus(`${labels.regulationUpdated} ${data.imported || 0} ${language === "en" ? "record(s)" : "data"}.`);
    } catch (error) {
      setRegulationError(error instanceof Error ? error.message : "Could not update Ortax regulations.");
    } finally {
      setRegulationLoading(false);
    }
  }

  async function saveManualRegulation() {
    setManualRuleSaving(true);
    setRegulationStatus("");
    setRegulationError("");
    try {
      const response = await fetch("/api/regulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: regulationTopic,
          ...manualRule,
          relevance: 75
        })
      });
      const data = (await response.json()) as { records?: Regulation[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not save regulation.");
      }
      if (Array.isArray(data.records) && data.records.length) {
        setRegulationRecords(data.records);
      }
      setManualRule({ title: "", citation: "", focus: "", sourceUrl: "", content: "" });
      setRegulationStatus(labels.regulationUpdated);
    } catch (error) {
      setRegulationError(error instanceof Error ? error.message : "Could not save regulation.");
    } finally {
      setManualRuleSaving(false);
    }
  }

  async function onManualRuleFileChange(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    const text = await file.text().catch(() => "");
    setManualRule((current) => ({
      ...current,
      title: current.title || file.name.replace(/\.[a-z0-9]+$/i, ""),
      content: text || current.content,
      focus: current.focus || text.slice(0, 600)
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
          <div className="preserved-note">{labels.appGuidance}</div>
        </header>

        {page === "dashboard" && (
          <>
            <section className="kpi-grid" aria-label={labels.dataSummary}>
              <Kpi label={labels.indexed} value={dynamicDashboard.stats.indexedDecisions.toString()} tone="blue" />
              <Kpi label={labels.coverage} value={`${dynamicDashboard.stats.extractionCoverage}%`} tone="green" />
              <Kpi label={labels.vatDocs} value={dynamicDashboard.stats.vatDocuments.toString()} tone="blue" />
              <Kpi label={labels.localRules} value={dynamicDashboard.stats.localRegulations.toString()} tone="gray" />
              <Kpi label={labels.llmLabels} value={dynamicDashboard.stats.llmLabels.toString()} tone="gray" />
            </section>
            <section className="panel-grid">
              <Panel title={labels.decisionOutcomes}>
                {dynamicDashboard.outcomeDistribution.length ? (
                  <>
                    <div className="donut" style={buildDonutStyle(dynamicDashboard.outcomeDistribution)} />
                    <div className="legend">
                      {dynamicDashboard.outcomeDistribution.map((item) => (
                        <span key={item.label}>
                          <i style={{ background: item.color }} /> {item.label} ({item.value})
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty-state">{labels.noDynamicDocuments}</div>
                )}
              </Panel>
              <Panel title={labels.topDisputeIssues}>
                {dynamicDashboard.issueDistribution.length ? dynamicDashboard.issueDistribution.map((item) => (
                  <MiniBar key={item.label} label={item.label} value={item.value} />
                )) : <div className="empty-state">{labels.noDynamicDocuments}</div>}
              </Panel>
            </section>
            <Panel title={labels.recentDocs}>
              {dynamicDashboard.recentDocuments.length ? <div className="table-wrap">
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
                    {dynamicDashboard.recentDocuments.map((doc) => (
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
              </div> : <div className="empty-state">{labels.noDynamicDocuments}</div>}
            </Panel>
          </>
        )}

        {page === "guided" && (
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
                {extractionProgress && <div className="status-banner">{extractionProgress}</div>}
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

        {page === "analysis" && (
          <CaseSearchPanel
            labels={labels}
            text={caseSearchText}
            fileName={caseSearchFileName}
            extraction={caseSearchExtraction}
            results={caseSearchResults}
            loading={caseSearchLoading}
            status={caseSearchStatus}
            error={caseSearchError}
            onTextChange={updateCaseSearchText}
            onFileChange={onCaseSearchFileChange}
            onSearch={runCaseSearch}
          />
        )}

        {page === "database" && (
          <DecisionDatabasePanel
            labels={labels}
            files={databaseFiles}
            storedDocuments={storedDocuments}
            loading={blobUploadLoading}
            status={blobUploadStatus}
            error={blobUploadError}
            onFilesChange={onDatabaseFilesChange}
            onUpload={uploadDatabaseFiles}
            onExtract={extractStoredDocument}
            onDelete={deleteStoredDocument}
            extractingDocumentId={extractingDocumentId}
            deletingDocumentId={deletingDocumentId}
          />
        )}

        {page === "regulations" && (
          <Panel title={labels.relatedRules}>
            <p className="muted lead-copy">{labels.regulationHelp}</p>
            <div className="regulation-toolbar">
              <label className="control">
                <span>{labels.regulationTopic}</span>
                <select
                  value={regulationTopic}
                  onChange={(event) => {
                    setRegulationTopic(event.target.value as RegulationTopic);
                    setRegulationPage(1);
                  }}
                >
                  {regulationTopicOptions.map((topic) => (
                    <option key={topic.key} value={topic.key}>
                      {topic[language]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button" onClick={updateRegulationsFromOrtax} disabled={regulationLoading}>
                {regulationLoading ? labels.updatingRules : labels.updateFromOrtax}
              </button>
              <a className="table-button jump-link" href="#stored-regulations">
                {labels.jumpToStoredRules}
              </a>
            </div>
            {regulationStatus && <div className="status-banner success">{regulationStatus}</div>}
            {regulationError && <div className="status-banner error">{regulationError}</div>}
            <div id="stored-regulations" className="stored-rule-list">
              <h3>{labels.storedRuleList}</h3>
              {visibleRegulations.length === 0 ? (
                <div className="empty-state">{labels.noRegulations}</div>
              ) : (
                <>
                  <PaginationControls
                    labels={labels}
                    totalItems={visibleRegulations.length}
                    currentPage={currentRegulationPage}
                    perPage={regulationPerPage}
                    perPageOptions={[3, 6, 9, 12]}
                    onPageChange={setRegulationPage}
                    onPerPageChange={setRegulationPerPage}
                  />
                  <div className="regulation-grid">
                    {pagedRegulations.map((item) => (
                      <article key={item.id} className="reg-card">
                        <b>{item.title}</b>
                        <span>{item.citation}</span>
                        <p>{item.focus}</p>
                        {item.content && <p className="muted">{item.content}</p>}
                        <small>
                          {labels.source}: {item.source || "seed"}
                          {item.sourceUrl && item.sourceUrl.startsWith("https://") ? (
                            <>
                              {" · "}
                              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                                {labels.openSource}
                              </a>
                            </>
                          ) : null}
                        </small>
                        <div className="score-pill">{item.relevance}% relevance</div>
                      </article>
                    ))}
                  </div>
                  <PaginationControls
                    labels={labels}
                    totalItems={visibleRegulations.length}
                    currentPage={currentRegulationPage}
                    perPage={regulationPerPage}
                    perPageOptions={[3, 6, 9, 12]}
                    onPageChange={setRegulationPage}
                    onPerPageChange={setRegulationPerPage}
                  />
                </>
              )}
            </div>
            <div className="manual-rule-box">
              <h3>{labels.manualRegulation}</h3>
              <div className="form-grid">
                <Input label={labels.manualTitle} value={manualRule.title} onChange={(value) => setManualRule((current) => ({ ...current, title: value }))} />
                <Input label={labels.manualCitation} value={manualRule.citation} onChange={(value) => setManualRule((current) => ({ ...current, citation: value }))} />
                <Input label={labels.manualSourceUrl} value={manualRule.sourceUrl} onChange={(value) => setManualRule((current) => ({ ...current, sourceUrl: value }))} />
              </div>
              <TextArea label={labels.manualFocus} value={manualRule.focus} onChange={(value) => setManualRule((current) => ({ ...current, focus: value }))} />
              <TextArea label={labels.manualContent} value={manualRule.content} onChange={(value) => setManualRule((current) => ({ ...current, content: value }))} />
              <div className="regulation-actions">
                <label className="table-button upload-inline">
                  {labels.uploadManualRule}
                  <input type="file" accept=".txt,.md,.text" onChange={(event) => onManualRuleFileChange(event.target.files)} />
                </label>
                <button className="primary-button secondary-button" onClick={saveManualRegulation} disabled={manualRuleSaving}>
                  {manualRuleSaving ? labels.savingManualRule : labels.saveManualRule}
                </button>
              </div>
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

function PaginationControls({
  labels,
  totalItems,
  currentPage,
  perPage,
  perPageOptions = [10, 25, 50, 100],
  onPageChange,
  onPerPageChange
}: {
  labels: (typeof copy)["en"];
  totalItems: number;
  currentPage: number;
  perPage: number;
  perPageOptions?: number[];
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const range = getPaginationRange(totalItems, safePage, perPage);
  const pages = getPageNumbers(safePage, totalPages);
  return (
    <div className="pagination-bar">
      <div className="pagination-summary">
        <strong>
          {labels.totalRecords}: {totalItems}
        </strong>
        <span>
          {labels.showingRecords} {range.start}-{range.end}
        </span>
      </div>
      <label className="per-page-control">
        <span>{labels.itemsPerPage}</span>
        <select
          value={perPage}
          onChange={(event) => {
            onPerPageChange(Number(event.target.value));
            onPageChange(1);
          }}
        >
          {perPageOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <div className="page-buttons" aria-label={`${labels.pageOf} ${safePage} / ${totalPages}`}>
        <button className="table-button compact" onClick={() => onPageChange(Math.max(1, safePage - 1))} disabled={safePage === 1}>
          {labels.previousPage}
        </button>
        {pages.map((page, index) => {
          const previous = pages[index - 1];
          return (
            <span key={page} className="page-button-group">
              {previous && page - previous > 1 ? <span className="page-ellipsis">...</span> : null}
              <button className={`page-number ${page === safePage ? "active" : ""}`} onClick={() => onPageChange(page)}>
                {page}
              </button>
            </span>
          );
        })}
        <button className="table-button compact" onClick={() => onPageChange(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages}>
          {labels.nextPage}
        </button>
      </div>
    </div>
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

function DecisionDatabasePanel({
  labels,
  files,
  storedDocuments,
  loading,
  status,
  error,
  extractingDocumentId,
  deletingDocumentId,
  onFilesChange,
  onUpload,
  onExtract,
  onDelete
}: {
  labels: (typeof copy)["en"];
  files: File[];
  storedDocuments: StoredDecisionFile[];
  loading: boolean;
  status: string;
  error: string;
  extractingDocumentId: string;
  deletingDocumentId: string;
  onFilesChange: (fileList: FileList | null) => void;
  onUpload: () => void;
  onExtract: (item: StoredDecisionFile) => void;
  onDelete: (item: StoredDecisionFile) => void;
}) {
  type SortKey = "filename" | "status" | "decision" | "taxpayer" | "size" | "uploadedAt";
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "uploadedAt", direction: "desc" });
  const [copiedDocumentId, setCopiedDocumentId] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const sortedDocuments = useMemo(() => {
    const getValue = (item: StoredDecisionFile, key: SortKey) => {
      if (key === "status") return item.status || (item.extraction ? "extracted" : "uploaded");
      if (key === "decision") return item.extraction?.putusanNumber || "";
      if (key === "taxpayer") return item.extraction?.taxpayerName || "";
      if (key === "size") return item.size || 0;
      if (key === "uploadedAt") return new Date(item.uploadedAt).getTime() || 0;
      return item.filename || "";
    };
    return [...storedDocuments].sort((a, b) => {
      const left = getValue(a, sort.key);
      const right = getValue(b, sort.key);
      const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
      return sort.direction === "asc" ? result : -result;
    });
  }, [storedDocuments, sort]);
  const totalPages = Math.max(1, Math.ceil(sortedDocuments.length / perPage));
  const currentPage = Math.min(pageNumber, totalPages);
  const pagedDocuments = useMemo(
    () => sortedDocuments.slice((currentPage - 1) * perPage, currentPage * perPage),
    [sortedDocuments, currentPage, perPage]
  );

  useEffect(() => {
    setPageNumber((current) => Math.min(Math.max(1, current), totalPages));
  }, [totalPages]);

  function toggleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
    setPageNumber(1);
  }

  function SortButton({ sortKey, children }: { sortKey: SortKey; children: React.ReactNode }) {
    return (
      <button className="sort-button" onClick={() => toggleSort(sortKey)}>
        {children}
        <span>{sort.key === sortKey ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}</span>
      </button>
    );
  }

  async function copyBlobUrl(item: StoredDecisionFile) {
    const target = item.url || item.downloadUrl || item.pathname;
    if (!target.startsWith("https://")) return;
    try {
      await navigator.clipboard.writeText(target);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = target;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopiedDocumentId(item.id);
    window.setTimeout(() => setCopiedDocumentId((current) => (current === item.id ? "" : current)), 1800);
  }

  return (
    <section className="database-layout">
      <Panel title={labels.databaseTitle}>
        <p className="muted lead-copy">{labels.databaseIntro}</p>
        <div className="upload-box">
          <label>
            {labels.uploadDecisionPdfs}
            <input
              type="file"
              accept=".pdf,application/pdf"
              multiple
              onChange={(event) => onFilesChange(event.target.files)}
            />
          </label>
          <p>
            {files.length
              ? `${files.length} file(s): ${files.map((file) => `${file.name} (${formatBytes(file.size)})`).join(", ")}`
              : labels.databaseUploadHint}
          </p>
        </div>
        {status && <div className="status-banner success">{status}</div>}
        {error && <div className="status-banner error">{error}</div>}
        <button className="primary-button" onClick={onUpload} disabled={loading || files.length === 0}>
          {loading ? labels.uploadingToBlob : labels.uploadAndExtract}
        </button>
      </Panel>

      <Panel title={labels.storedDocuments}>
        {storedDocuments.length === 0 ? (
          <div className="empty-state">{labels.noStoredDocuments}</div>
        ) : (
          <>
            <PaginationControls
              labels={labels}
              totalItems={sortedDocuments.length}
              currentPage={currentPage}
              perPage={perPage}
              onPageChange={setPageNumber}
              onPerPageChange={setPerPage}
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th><SortButton sortKey="filename">File</SortButton></th>
                    <th><SortButton sortKey="status">{labels.status}</SortButton></th>
                    <th><SortButton sortKey="decision">{labels.decisionNumber}</SortButton></th>
                    <th><SortButton sortKey="taxpayer">{labels.taxpayer}</SortButton></th>
                    <th><SortButton sortKey="size">{labels.fileSize}</SortButton></th>
                    <th><SortButton sortKey="uploadedAt">{labels.uploadedAt}</SortButton></th>
                    <th>{labels.blobPath}</th>
                    <th>{labels.action}</th>
                    <th>{labels.openPdf}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDocuments.map((item) => {
                    const status = item.status || (item.extraction ? "extracted" : "uploaded");
                    const busy = Boolean(extractingDocumentId || deletingDocumentId);
                    const hasPdfUrl = Boolean((item.url || item.downloadUrl || "").startsWith("https://"));
                    return (
                      <tr key={item.id}>
                        <td className="file-cell">{item.filename}</td>
                        <td>
                          <span className={`db-status ${status}`}>{status}</span>
                        </td>
                        <td>{item.extraction?.putusanNumber || "-"}</td>
                        <td>{item.extraction?.taxpayerName || "-"}</td>
                        <td>{formatBytes(item.size)}</td>
                        <td>{new Date(item.uploadedAt).toLocaleString()}</td>
                        <td>
                          <button className="table-button compact" onClick={() => copyBlobUrl(item)} disabled={!hasPdfUrl}>
                            {copiedDocumentId === item.id ? labels.copiedBlob : labels.copyBlob}
                          </button>
                        </td>
                        <td className="action-cell">
                          <button className="table-button" onClick={() => onExtract(item)} disabled={busy || !hasPdfUrl}>
                            {extractingDocumentId === item.id ? labels.extractingStored : status === "extracted" ? labels.reExtractStored : labels.extractStored}
                          </button>
                          <button className="table-button danger" onClick={() => onDelete(item)} disabled={busy}>
                            {deletingDocumentId === item.id ? labels.deletingStored : labels.deleteStored}
                          </button>
                        </td>
                        <td>
                          {hasPdfUrl ? (
                            <a href={item.downloadUrl || item.url} target="_blank" rel="noreferrer">
                              {labels.openPdf}
                            </a>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationControls
              labels={labels}
              totalItems={sortedDocuments.length}
              currentPage={currentPage}
              perPage={perPage}
              onPageChange={setPageNumber}
              onPerPageChange={setPerPage}
            />
          </>
        )}
      </Panel>
    </section>
  );
}

function CaseSearchPanel({
  labels,
  text,
  fileName,
  extraction,
  results,
  loading,
  status,
  error,
  onTextChange,
  onFileChange,
  onSearch
}: {
  labels: (typeof copy)["en"];
  text: string;
  fileName: string;
  extraction: ExtractionResult | null;
  results: SimilarCaseResult[];
  loading: boolean;
  status: string;
  error: string;
  onTextChange: (value: string) => void;
  onFileChange: (fileList: FileList | null) => void;
  onSearch: () => void;
}) {
  return (
    <section className="case-search-layout">
      <Panel title={labels.caseSearchTitle}>
        <p className="muted lead-copy">{labels.caseSearchIntro}</p>
        <label className="control">
          <span>{labels.caseQuery}</span>
          <textarea
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder={labels.caseQueryPlaceholder}
            rows={7}
          />
        </label>
        <div className="upload-box">
          <label>
            {labels.caseUpload}
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => onFileChange(event.target.files)}
            />
          </label>
          <p>{fileName || labels.uploadHint}</p>
        </div>
        {status && <div className="status-banner success">{status}</div>}
        {error && <div className="status-banner error">{error}</div>}
        <button className="primary-button" onClick={onSearch} disabled={loading}>
          {loading ? labels.searchingSimilar : labels.searchSimilar}
        </button>
        {extraction && <ExtractionSummary labels={labels} extraction={extraction} />}
      </Panel>

      <Panel title={labels.caseResults}>
        {results.length === 0 ? (
          <div className="empty-state">{labels.noCaseQuery}</div>
        ) : (
          <div className="similarity-list">
            {results.map((item, index) => (
              <article key={item.decision.id} className="similarity-card">
                <div className="similarity-head">
                  <div>
                    <span className="rank">{index + 1}</span>
                    <b>{item.decision.number}</b>
                    <p>
                      {item.decision.taxType} | {item.decision.issue} | {item.decision.amount}
                    </p>
                  </div>
                  <div className="similarity-meter" aria-label={`${labels.similarity} ${item.similarity}%`}>
                    <strong>{item.similarity}%</strong>
                    <span>{labels.similarity}</span>
                  </div>
                </div>
                <div className="match-bar">
                  <i style={{ width: `${item.similarity}%` }} />
                </div>
                <div className="analysis-block">
                  <h3>{labels.whySimilar}</h3>
                  <p>{item.whySimilar}</p>
                  <h3>{labels.keyOverlap}</h3>
                  <div className="chips readonly">
                    {(item.sharedTerms.length ? item.sharedTerms : item.decision.matchPoints).map((point) => (
                      <span key={point}>{point}</span>
                    ))}
                  </div>
                  <h3>{labels.differences}</h3>
                  <p>{item.differences}</p>
                  <h3>{labels.useInArgument}</h3>
                  <p>{item.useInArgument}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </section>
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
