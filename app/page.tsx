"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { upload } from "@vercel/blob/client";
import { buildAnalysis, type AnalysisResult as AnalysisResultType, type AnalyzeInput } from "@/lib/analyze";
import { extractionToSearchText, searchSimilarCases, type SimilarCaseResult } from "@/lib/case-search";
import type { ExtractionResult } from "@/lib/extraction";
import { dashboardStats, issueDistribution, outcomeDistribution, recentDocuments, regulations } from "@/lib/mock-data";
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
    subtitle: "Prototype Next.js untuk ekstraksi dokumen sengketa, pencarian putusan pembanding, konteks peraturan PPN, review risiko, dan draft rekomendasi WP.",
    preserved: "Streamlit prototype tetap disimpan di repository sebagai sumber Python lokal. Halaman ini adalah versi Vercel-native baru.",
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
    fileTooLarge: "Satu halaman/chunk PDF masih terlalu besar. Kompres PDF atau split bagian tersebut terlebih dahulu.",
    chunking: "PDF besar terdeteksi. Memecah dokumen menjadi chunk halaman...",
    extractingChunk: "Mengekstrak chunk",
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
    databaseIntro: "Upload PDF putusan besar langsung ke Vercel Blob. Tahap ini menyiapkan penyimpanan dokumen; ekstraksi batch dan database Postgres akan ditambahkan setelah env database tersedia.",
    uploadDecisionPdfs: "Upload PDF Putusan",
    uploadToBlob: "Upload ke Blob",
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
    databaseFallback: "Upload berhasil, tetapi metadata database belum tersimpan. Data tetap muncul sementara di browser."
  },
  en: {
    subtitle: "A Next.js prototype for dispute document extraction, comparable decision search, VAT regulation context, risk review, and taxpayer recommendation drafting.",
    preserved: "The Streamlit prototype remains preserved in the repository as the local Python source. This page is the new Vercel-native version.",
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
    fileTooLarge: "One PDF page/chunk is still too large. Please compress the PDF or split that section first.",
    chunking: "Large PDF detected. Splitting document into page chunks...",
    extractingChunk: "Extracting chunk",
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
    databaseIntro: "Upload large decision PDFs directly to Vercel Blob. This step prepares document storage; batch extraction and Postgres persistence will be added after database env vars are available.",
    uploadDecisionPdfs: "Upload decision PDFs",
    uploadToBlob: "Upload to Blob",
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
    databaseFallback: "Upload succeeded, but database metadata was not saved. The document still appears temporarily in this browser."
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
  const [chatQuestion, setChatQuestion] = useState("Where is input VAT creditability regulated?");
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
  const labels = copy[language];
  const localAnalysis = useMemo(() => buildAnalysis({ ...form, language }), [form, language]);
  const analysis = serverAnalysis ?? localAnalysis;
  const pages: Array<[PageKey, string]> = [
    ["dashboard", labels.dashboard],
    ["guided", labels.guided],
    ["analysis", labels.analysis],
    ["database", labels.database],
    ["regulations", labels.regulations],
    ["reports", labels.reports]
  ];

  useEffect(() => {
    if (page !== "database") return;
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
  }, [page]);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    setForm((current) => ({ ...current, language: nextLanguage }));
    setServerAnalysis(null);
    setAnalysisError("");
    setExportError("");
    if (!chatAnswer) {
      setChatQuestion(nextLanguage === "en" ? "Where is input VAT creditability regulated?" : "Di mana aturan pengkreditan pajak masukan berada?");
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
      return typeof value === "string" ? value : "";
    };
    const unique = (values: string[][]) => Array.from(new Set(values.flat().map((item) => item.trim()).filter(Boolean))).slice(0, 24);
    const combined = (field: keyof ExtractionResult) =>
      parts
        .map((part, index) => {
          const value = part[field];
          return typeof value === "string" && value.trim() ? `Chunk ${index + 1}: ${value.trim()}` : "";
        })
        .filter(Boolean)
        .join("\n\n");

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
        message: parts.length > 1 ? `PDF extracted with LLM across ${parts.length} chunks` : first.llmStatus.message
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
          access: "private",
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
        uploaded.push({
          id: `${blob.pathname}-${Date.now()}`,
          filename: file.name,
          pathname: blob.pathname,
          url: blob.url,
          downloadUrl: blob.downloadUrl,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          status: "uploaded"
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
        }`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blob upload failed.";
      setBlobUploadError(message.includes("BLOB_READ_WRITE_TOKEN") ? labels.blobMissing : message);
    } finally {
      setBlobUploadLoading(false);
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
          />
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

function DecisionDatabasePanel({
  labels,
  files,
  storedDocuments,
  loading,
  status,
  error,
  onFilesChange,
  onUpload
}: {
  labels: (typeof copy)["en"];
  files: File[];
  storedDocuments: StoredDecisionFile[];
  loading: boolean;
  status: string;
  error: string;
  onFilesChange: (fileList: FileList | null) => void;
  onUpload: () => void;
}) {
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
              : labels.uploadHint}
          </p>
        </div>
        {status && <div className="status-banner success">{status}</div>}
        {error && <div className="status-banner error">{error}</div>}
        <button className="primary-button" onClick={onUpload} disabled={loading || files.length === 0}>
          {loading ? labels.uploadingToBlob : labels.uploadToBlob}
        </button>
      </Panel>

      <Panel title={labels.storedDocuments}>
        {storedDocuments.length === 0 ? (
          <div className="empty-state">{labels.noStoredDocuments}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>{labels.fileSize}</th>
                  <th>{labels.uploadedAt}</th>
                  <th>{labels.blobPath}</th>
                  <th>{labels.openPdf}</th>
                </tr>
              </thead>
              <tbody>
                {storedDocuments.map((item) => (
                  <tr key={item.id}>
                    <td>{item.filename}</td>
                    <td>{formatBytes(item.size)}</td>
                    <td>{new Date(item.uploadedAt).toLocaleString()}</td>
                    <td className="mono-cell">{item.pathname}</td>
                    <td>
                      <a href={item.downloadUrl || item.url} target="_blank" rel="noreferrer">
                        {labels.openPdf}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
