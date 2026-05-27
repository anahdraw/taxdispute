"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { upload } from "@vercel/blob/client";
import { buildAnalysis, type AnalysisResult as AnalysisResultType, type AnalyzeInput } from "@/lib/analyze";
import { extractionToSearchText, searchSimilarCases, type SimilarCaseResult } from "@/lib/case-search";
import { emptyPpnComponents, type ExtractionResult, type PpnComponents } from "@/lib/extraction";
import { regulations, type Regulation } from "@/lib/mock-data";
import { hasPpnComponentData, ppnClassificationRows, ppnComponentRows, ppnFormulaRows } from "@/lib/ppn-components";
import { filterRegulationsByTopic, normalizeRegulationTopic, regulationTopicOptions, type RegulationTopic } from "@/lib/regulation-knowledge";
import type { SmartChatResponse, SmartChatSourceMode } from "@/lib/smart-chat";
import type { StoredDecisionFile } from "@/lib/stored-decisions";
import { decisionDetailPath } from "@/lib/decision-links";
import { referenceDetailPath } from "@/lib/reference-links";

type Language = "id" | "en";
type PageKey = "dashboard" | "guided" | "analysis" | "database" | "smartchat" | "regulations" | "reports";
type UserRole = "admin" | "user";
type DemoSession = {
  role: UserRole;
  name: string;
};
const MAX_UPLOAD_BYTES = 3.6 * 1024 * 1024;
const STORED_DECISIONS_KEY = "tax-dispute-stored-decisions";
const DEMO_SESSION_KEY = "tax-dispute-demo-session";
const APP_NAME = "RSM Tax Dispute Agentic Advisor";
const APP_SHORT_NAME = "Tax Dispute Agentic Advisor";
const DEMO_USERS: Record<UserRole, { username: string; password: string; name: string }> = {
  admin: { username: "admin", password: "Admin@RSM2026", name: "Admin RSM" },
  user: { username: "user", password: "User@RSM2026", name: "Tax Advisor User" }
};

function canAccessPage(role: UserRole, key: PageKey) {
  if (role === "admin") return true;
  return ["dashboard", "guided", "analysis", "smartchat", "reports"].includes(key);
}

const evidenceOptions = {
  id: ["Faktur Pajak", "SPT Masa PPN", "Bukti pembayaran", "Rekonsiliasi", "Konfirmasi Lawan Transaksi", "Surat Kuasa"],
  en: ["VAT invoice", "VAT return", "Payment evidence", "Reconciliation", "Counterparty confirmation", "Power of attorney"]
};

const copy = {
  id: {
    subtitle: "Gunakan alur kerja ini untuk upload putusan, ekstraksi data terstruktur, mencari putusan pembanding, bertanya aturan PPN atau Transfer Pricing, lalu membuat draft Word/PDF untuk direview advisor.",
    appGuidance: "Gunakan alur ini untuk upload putusan, ekstraksi data, mencari pembanding, tanya peraturan PPN atau Transfer Pricing, lalu membuat draft Word/PDF untuk review advisor.",
    dashboard: "Dashboard",
    guided: "Alur Terpandu",
    analysis: "Analisis Kasus WP",
    database: "Database Putusan",
    smartchat: "Smart Dispute Bot",
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
    noRegulations: "Belum ada aturan untuk topik ini.",
    regulationBotTitle: "Smart Regulation Bot",
    regulationBotIntro: "Tanya banyak aturan sekaligus. Bot memakai RAG khusus peraturan agar jawaban tetap ringkas, berbasis sumber, dan efisien token.",
    regulationQuestion: "Pertanyaan aturan",
    regulationQuestionPlaceholder: "Contoh: aturan apa saja yang mengatur dokumentasi transfer pricing dan prinsip kewajaran?",
    askRegulationBot: "Tanya Bot Aturan",
    askingRegulationBot: "Menelaah aturan...",
    regulationBotAnswer: "Jawaban bot aturan",
    noRegulationBotAnswer: "Ajukan pertanyaan untuk menelaah seluruh aturan tersimpan.",
    bulkRegulationUpload: "Upload list aturan Excel/CSV",
    bulkRegulationHint: "Kolom yang didukung: title/nama, citation/nomor, topic/topik, focus/ringkasan, sourceUrl/link, content/catatan, relevance.",
    importingRegulations: "Mengimpor aturan...",
    importedRegulations: "aturan berhasil diimpor/diperbarui.",
    editRule: "Edit",
    deleteRule: "Hapus",
    updateRule: "Update aturan",
    cancelEdit: "Batal edit",
    cannotDeleteSeed: "Aturan bawaan seed tidak bisa dihapus dari database. Edit/salin sebagai aturan manual jika perlu.",
    smartChatTitle: "Smart Dispute Bot",
    smartChatIntro: "Tanya langsung dengan RAG berbasis putusan dan peraturan. Relevansi memakai hybrid retrieval: kecocokan nama WP/perusahaan, nomor putusan, isu, outcome, lalu similarity teks.",
    smartQuestion: "Pertanyaan",
    smartQuestionPlaceholder: "Contoh: Untuk sengketa transfer pricing jasa afiliasi, berapa putusan yang WP menang atau kalah dan aturan apa yang relevan?",
    smartMode: "Sumber jawaban",
    smartModeAll: "Putusan + Peraturan",
    smartModeDecisions: "Putusan saja",
    smartModeRegulations: "Peraturan saja",
    askSmartChat: "Tanya Smart Dispute Bot",
    askingSmartChat: "Menyaring RAG dan menjawab...",
    smartAnswer: "Jawaban",
    smartCharts: "Visualisasi",
    retrievedDecisions: "Putusan yang dipakai RAG",
    retrievedRules: "Peraturan yang dipakai RAG",
    retrievalSummary: "Ringkasan retrieval",
    noSmartAnswer: "Ajukan pertanyaan untuk melihat jawaban, sumber RAG, dan visualisasi jika relevan.",
    openReference: "Buka referensi",
    loginTitle: "Masuk ke RSM Tax Dispute Agentic Advisor",
    loginSubtitle: "Pilih peran untuk mencoba alur prototype. Admin dapat mengelola database dan peraturan; user fokus ke analisis dan chatbot.",
    username: "Username",
    password: "Password",
    signIn: "Masuk",
    adminLogin: "Admin",
    userLogin: "User",
    loginError: "Username atau password belum cocok.",
    demoAuthNote: "Login ini hanya untuk prototype demo, bukan autentikasi production.",
    signedInAs: "Masuk sebagai",
    logout: "Keluar",
    roleAdmin: "Admin",
    roleUser: "User",
    quickStart: "Mulai Cepat",
    quickGuided: "Upload dan analisis dokumen",
    quickChat: "Tanya Smart Dispute Bot",
    quickAdmin: "Kelola database dan peraturan",
    openAction: "Buka",
    scoreMethodology: "Metodologi skor",
    scoreFormula: "Formula",
    scoreComponent: "Komponen",
    scoreMax: "Bobot maks.",
    scoreEarned: "Poin",
    scoreBasis: "Dasar penilaian",
    scoreNotes: "Catatan skor",
    viewCase: "Detail",
    caseDetail: "Detail Putusan",
    backToDocuments: "Kembali ke list",
    printCaseSheet: "Print / simpan PDF",
    documentProfile: "Profil Dokumen",
    taxpayerParty: "Pemohon Banding / WP",
    authorityParty: "Terbanding / DJP",
    courtPanel: "Majelis Hakim",
    disputedAmount: "Nilai Sengketa",
    disputeNarrative: "Pokok Sengketa",
    decisionContent: "Konten Putusan",
    originalFile: "File asli",
    extractionConfidence: "Confidence ekstraksi",
    noCaseDetail: "Dokumen ini belum punya hasil ekstraksi. Klik Ekstrak dulu untuk membuat detail putusan.",
    casePageLink: "Halaman"
  },
  en: {
    subtitle: "Use this workflow to upload decisions, extract structured data, find comparators, ask VAT or Transfer Pricing regulation questions, then produce Word/PDF drafts for advisor review.",
    appGuidance: "Use this workflow to upload decisions, extract structured data, find comparators, ask VAT or Transfer Pricing regulation questions, then produce Word/PDF drafts for advisor review.",
    dashboard: "Dashboard",
    guided: "Guided Flow",
    analysis: "Taxpayer Case Analysis",
    database: "Decision Database",
    smartchat: "Smart Dispute Bot",
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
    noRegulations: "No regulations yet for this topic.",
    regulationBotTitle: "Smart Regulation Bot",
    regulationBotIntro: "Ask across stored regulations. The bot uses regulation-only RAG so answers stay source-based and token-efficient.",
    regulationQuestion: "Regulation question",
    regulationQuestionPlaceholder: "Example: which rules govern transfer pricing documentation and the arm's length principle?",
    askRegulationBot: "Ask Regulation Bot",
    askingRegulationBot: "Reviewing regulations...",
    regulationBotAnswer: "Regulation bot answer",
    noRegulationBotAnswer: "Ask a question to review all stored regulation cards.",
    bulkRegulationUpload: "Upload regulation list Excel/CSV",
    bulkRegulationHint: "Supported columns: title/name, citation/number, topic, focus/summary, sourceUrl/link, content/notes, relevance.",
    importingRegulations: "Importing regulations...",
    importedRegulations: "regulation(s) imported/updated.",
    editRule: "Edit",
    deleteRule: "Delete",
    updateRule: "Update rule",
    cancelEdit: "Cancel edit",
    cannotDeleteSeed: "Seed regulations cannot be deleted from the database. Edit/save a manual copy if needed.",
    smartChatTitle: "Smart Dispute Bot",
    smartChatIntro: "Ask the RAG bot directly across decisions and regulations. Relevance uses hybrid retrieval: taxpayer/company, decision number, issue, outcome intent, then text similarity.",
    smartQuestion: "Question",
    smartQuestionPlaceholder: "Example: For a transfer pricing dispute on related-party services, how many decisions were won or lost and what rules are relevant?",
    smartMode: "Answer source",
    smartModeAll: "Decisions + Regulations",
    smartModeDecisions: "Decisions only",
    smartModeRegulations: "Regulations only",
    askSmartChat: "Ask Smart Dispute Bot",
    askingSmartChat: "Retrieving RAG context and answering...",
    smartAnswer: "Answer",
    smartCharts: "Visualization",
    retrievedDecisions: "RAG decision sources",
    retrievedRules: "RAG regulation sources",
    retrievalSummary: "Retrieval summary",
    noSmartAnswer: "Ask a question to see an answer, RAG sources, and visualizations when relevant.",
    openReference: "Open reference",
    loginTitle: "Sign in to RSM Tax Dispute Agentic Advisor",
    loginSubtitle: "Choose a demo role. Admin can manage the database and regulations; user focuses on analysis and chatbot workflows.",
    username: "Username",
    password: "Password",
    signIn: "Sign in",
    adminLogin: "Admin",
    userLogin: "User",
    loginError: "Username or password does not match.",
    demoAuthNote: "This login is prototype-only and not production authentication.",
    signedInAs: "Signed in as",
    logout: "Log out",
    roleAdmin: "Admin",
    roleUser: "User",
    quickStart: "Quick Start",
    quickGuided: "Upload and analyze a document",
    quickChat: "Ask Smart Dispute Bot",
    quickAdmin: "Manage database and regulations",
    openAction: "Open",
    scoreMethodology: "Scoring methodology",
    scoreFormula: "Formula",
    scoreComponent: "Component",
    scoreMax: "Max weight",
    scoreEarned: "Points",
    scoreBasis: "Assessment basis",
    scoreNotes: "Score notes",
    viewCase: "Detail",
    caseDetail: "Decision Detail",
    backToDocuments: "Back to list",
    printCaseSheet: "Print / save PDF",
    documentProfile: "Document Profile",
    taxpayerParty: "Appellant / Taxpayer",
    authorityParty: "Appellee / DGT",
    courtPanel: "Judicial Panel",
    disputedAmount: "Disputed Amount",
    disputeNarrative: "Dispute Issue",
    decisionContent: "Decision Content",
    originalFile: "Original file",
    extractionConfidence: "Extraction confidence",
    noCaseDetail: "This document does not have extraction data yet. Click Extract first to create the decision detail.",
    casePageLink: "Page"
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

function QuickActionIcon({ type }: { type: "document" | "chatbot" | "database" }) {
  if (type === "chatbot") {
    return (
      <svg className="quick-action-illustration" viewBox="0 0 96 96" aria-hidden="true">
        <path d="M32 30h32a10 10 0 0 1 10 10v18a10 10 0 0 1-10 10H32a10 10 0 0 1-10-10V40a10 10 0 0 1 10-10Z" />
        <path d="M48 30V18" />
        <path d="M42 18h12" />
        <path d="M28 46h-8a6 6 0 0 0 0 12h8" />
        <path d="M68 46h8a6 6 0 0 1 0 12h-8" />
        <path d="M36 46h.1" />
        <path d="M60 46h.1" />
        <path d="M44 57h12" />
        <path d="M34 68v10h30V68" />
      </svg>
    );
  }

  if (type === "database") {
    return (
      <svg className="quick-action-illustration" viewBox="0 0 96 96" aria-hidden="true">
        <path d="M20 26c0-8 56-8 56 0v44c0 8-56 8-56 0V26Z" />
        <path d="M20 26c0 8 56 8 56 0" />
        <path d="M20 42c0 8 56 8 56 0" />
        <path d="M20 56c0 8 56 8 56 0" />
        <path d="M34 74h28" />
        <path d="M38 18h20" />
        <path d="M48 18v-8" />
      </svg>
    );
  }

  return (
    <svg className="quick-action-illustration" viewBox="0 0 96 96" aria-hidden="true">
      <path d="M28 14h32l16 16v50a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Z" />
      <path d="M60 14v18h16" />
      <path d="M36 46h28" />
      <path d="M36 58h28" />
      <path d="M36 70h18" />
      <path d="M22 26h-8v58h42v-8" />
    </svg>
  );
}

function LoginScreen({
  language,
  labels,
  role,
  username,
  password,
  error,
  onLanguageChange,
  onRoleChange,
  onUsernameChange,
  onPasswordChange,
  onSubmit
}: {
  language: Language;
  labels: (typeof copy)["en"];
  role: UserRole;
  username: string;
  password: string;
  error: string;
  onLanguageChange: (language: Language) => void;
  onRoleChange: (role: UserRole) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <RsmMark />
          <p className="eyebrow">{APP_SHORT_NAME}</p>
          <h1>{labels.loginTitle}</h1>
          <p className="login-subtitle">{labels.loginSubtitle}</p>
        </div>
        <div className="login-panel">
          <label className="field-label" htmlFor="login-language">
            Language
          </label>
          <select id="login-language" value={language} onChange={(event) => onLanguageChange(event.target.value as Language)}>
            <option value="en">English</option>
            <option value="id">Bahasa Indonesia</option>
          </select>
          <div className="role-toggle" aria-label="Login role">
            <button className={role === "admin" ? "active" : ""} onClick={() => onRoleChange("admin")}>
              {labels.adminLogin}
            </button>
            <button className={role === "user" ? "active" : ""} onClick={() => onRoleChange("user")}>
              {labels.userLogin}
            </button>
          </div>
          <Input label={labels.username} value={username} onChange={onUsernameChange} />
          <label className="control">
            <span>{labels.password}</span>
            <input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSubmit()} />
          </label>
          {error && <div className="status-banner error">{error}</div>}
          <button className="primary-button login-button" onClick={onSubmit}>
            {labels.signIn}
          </button>
          <p className="muted login-note">{labels.demoAuthNote}</p>
        </div>
      </section>
    </main>
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

function loadDemoSession(): DemoSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoSession;
    return parsed.role === "admin" || parsed.role === "user" ? parsed : null;
  } catch {
    return null;
  }
}

function saveDemoSession(session: DemoSession | null) {
  if (typeof window === "undefined") return;
  if (!session) {
    window.localStorage.removeItem(DEMO_SESSION_KEY);
    return;
  }
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session));
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

function nonEmpty(value: unknown) {
  return String(value || "").trim();
}

function dash(value: unknown) {
  return nonEmpty(value) || "-";
}

function truncateText(value: unknown, maxLength = 520) {
  const text = cleanMergedText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, "")}...`;
}

function safeDomId(value: unknown) {
  return String(value || "case").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96);
}

type RegulationImportRow = Record<string, string | number | boolean | null | undefined>;

function normalizeImportHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function csvRows(text: string): RegulationImportRow[] {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || "";
  const delimiter =
    firstLine.split(";").length > firstLine.split(",").length && firstLine.split(";").length >= firstLine.split("\t").length
      ? ";"
      : firstLine.split("\t").length > firstLine.split(",").length
        ? "\t"
        : ",";
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = (rows.shift() || []).map(normalizeImportHeader);
  return rows.map((cells) =>
    headers.reduce<RegulationImportRow>((record, header, index) => {
      if (header) record[header] = cells[index] || "";
      return record;
    }, {})
  );
}

function rowValue(row: RegulationImportRow, keys: string[]) {
  const entries = Object.entries(row).map(([key, value]) => [normalizeImportHeader(key), value] as const);
  for (const key of keys) {
    const normalizedKey = normalizeImportHeader(key);
    const value = row[normalizedKey];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  for (const key of keys) {
    const normalizedKey = normalizeImportHeader(key);
    const match = entries.find(([entryKey, value]) => (entryKey.includes(normalizedKey) || normalizedKey.includes(entryKey)) && value !== undefined && value !== null && String(value).trim());
    if (match) return String(match[1]).trim();
  }
  return "";
}

function inferRegulationTopic(row: RegulationImportRow) {
  const explicit = rowValue(row, ["topic", "topik", "jenis", "category", "kategori"]);
  const text = [
    explicit,
    rowValue(row, ["title", "name", "nama", "judul", "rule_name", "nama_aturan"]),
    rowValue(row, ["focus", "summary", "ringkasan", "deskripsi_singkat", "deskripsi", "description"]),
    rowValue(row, ["citation", "number", "nomor", "sitasi", "jenis_peraturan", "peraturan"])
  ]
    .join(" ")
    .toLowerCase();
  if (/transfer pricing|harga transfer|hubungan istimewa|arm.?s length|kewajaran|kelaziman|afiliasi/.test(text)) return "transfer_pricing";
  if (/\bppn\b|vat|pajak pertambahan nilai|ppnbm|pajak masukan|faktur pajak|bkp|jkp/.test(text)) return "vat";
  return normalizeRegulationTopic(explicit);
}

function buildRegulationCitation(row: RegulationImportRow) {
  const ruleType = rowValue(row, ["jenis_peraturan", "jenis aturan", "jenis", "tipe", "type"]);
  const number = rowValue(row, ["nomor", "number", "no", "no_peraturan"]);
  const year = rowValue(row, ["tahun", "year"]);
  const parts = [ruleType, number ? `No. ${number}` : "", year ? `Tahun ${year}` : ""].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return rowValue(row, ["citation", "sitasi", "nomor_sitasi", "peraturan"]);
}

function rowRegulation(row: RegulationImportRow, index: number): Regulation | null {
  const title = rowValue(row, ["title", "name", "nama", "judul", "rule_name", "nama_aturan"]);
  const citation = buildRegulationCitation(row);
  const focus = rowValue(row, ["focus", "summary", "ringkasan", "fungsi", "description", "deskripsi", "deskripsi_singkat", "uraian"]);
  if (!title || !citation || !focus) return null;
  const topic = inferRegulationTopic(row);
  const relevance = Number(rowValue(row, ["relevance", "relevansi", "score", "skor"]) || 75);
  const effectiveDate = rowValue(row, ["tanggal_berlaku", "berlaku", "effective_date", "tanggal"]);
  const sourceNotes = rowValue(row, ["citations", "citation_notes", "source_notes", "catatan_sumber"]);
  const content = [rowValue(row, ["content", "notes", "catatan", "kutipan", "excerpt"]), effectiveDate ? `Tanggal berlaku: ${effectiveDate}` : "", sourceNotes ? `Referensi: ${sourceNotes}` : ""]
    .filter(Boolean)
    .join("\n");
  return {
    id: rowValue(row, ["id"]) || `manual-${topic}-${safeDomId(`${citation}-${title}`) || index + 1}`.toLowerCase(),
    topic,
    title,
    citation,
    focus,
    relevance: Number.isFinite(relevance) ? Math.max(1, Math.min(100, relevance)) : 75,
    source: "manual",
    sourceUrl: rowValue(row, ["source_url", "sourceUrl", "url", "link", "link_sumber", "source", "sumber"]),
    content: content || focus,
    updatedAt: new Date(Date.now() + index).toISOString()
  };
}

function extractionCompleteness(extraction: ExtractionResult | null | undefined) {
  if (!extraction) return 0;
  const scalarFields: Array<keyof ExtractionResult> = [
    "putusanNumber",
    "putusanYear",
    "courtPanel",
    "clerkName",
    "decisionDate",
    "taxpayerName",
    "taxpayerNpwp",
    "taxpayerAddress",
    "legalCounselName",
    "djpUnit",
    "taxType",
    "taxPeriod",
    "skpNumber",
    "djpDecisionNumber",
    "issueType",
    "correctionAmount",
    "taxAuthorityPosition",
    "taxpayerPosition",
    "courtReasoning",
    "outcome"
  ];
  const filled = scalarFields.filter((field) => nonEmpty(extraction[field])).length;
  const arrayFilled = [extraction.judgeNames, extraction.evidence, extraction.legalReferences].filter((items) => Array.isArray(items) && items.length > 0).length;
  return Math.round(((filled + arrayFilled) / (scalarFields.length + 3)) * 100);
}

function printCaseDetail() {
  if (typeof window === "undefined") return;
  document.body.classList.add("print-case-detail");
  window.print();
  window.setTimeout(() => document.body.classList.remove("print-case-detail"), 600);
}

export default function Home() {
  const [language, setLanguage] = useState<Language>("en");
  const [session, setSession] = useState<DemoSession | null>(() => loadDemoSession());
  const [loginRole, setLoginRole] = useState<UserRole>("admin");
  const [loginUsername, setLoginUsername] = useState(DEMO_USERS.admin.username);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [page, setPage] = useState<PageKey>("smartchat");
  const [sidebarHidden, setSidebarHidden] = useState(false);
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
  const [smartQuestion, setSmartQuestion] = useState("For transfer pricing disputes, how many matched decisions were won or lost and what rules are relevant?");
  const [smartMode, setSmartMode] = useState<SmartChatSourceMode>("all");
  const [smartResponse, setSmartResponse] = useState<SmartChatResponse | null>(null);
  const [smartStatus, setSmartStatus] = useState("");
  const [smartError, setSmartError] = useState("");
  const [smartLoading, setSmartLoading] = useState(false);
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
  const [editingRegulationId, setEditingRegulationId] = useState("");
  const [deletingRegulationId, setDeletingRegulationId] = useState("");
  const [regulationImportLoading, setRegulationImportLoading] = useState(false);
  const [regulationQuestion, setRegulationQuestion] = useState(
    language === "en"
      ? "Which regulations govern transfer pricing documentation and the arm's length principle?"
      : "Aturan apa saja yang mengatur dokumentasi transfer pricing dan prinsip kewajaran?"
  );
  const [regulationBotResponse, setRegulationBotResponse] = useState<SmartChatResponse | null>(null);
  const [regulationBotStatus, setRegulationBotStatus] = useState("");
  const [regulationBotError, setRegulationBotError] = useState("");
  const [regulationBotLoading, setRegulationBotLoading] = useState(false);
  const labels = copy[language];
  const localAnalysis = useMemo(() => buildAnalysis({ ...form, language }, extraction), [form, language, extraction]);
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
    ["smartchat", labels.smartchat],
    ["regulations", labels.regulations],
    ["reports", labels.reports]
  ];
  const visiblePages = pages.filter(([key]) => (session ? canAccessPage(session.role, key) : false));

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
    if (session && !canAccessPage(session.role, page)) {
      setPage("smartchat");
    }
  }, [page, session]);

  useEffect(() => {
    if (typeof window === "undefined" || !session) return;
    const targetPage = new URLSearchParams(window.location.search).get("page") as PageKey | null;
    if (targetPage && pages.some(([key]) => key === targetPage) && canAccessPage(session.role, targetPage)) {
      setPage(targetPage);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [session]);

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
    if (!smartResponse) {
      setSmartQuestion(
        nextLanguage === "en"
          ? "For transfer pricing disputes, how many matched decisions were won or lost and what rules are relevant?"
          : "Untuk sengketa transfer pricing, berapa putusan relevan yang menang atau kalah dan aturan apa yang relevan?"
      );
    }
    if (!regulationBotResponse) {
      setRegulationQuestion(
        nextLanguage === "en"
          ? "Which regulations govern transfer pricing documentation and the arm's length principle?"
          : "Aturan apa saja yang mengatur dokumentasi transfer pricing dan prinsip kewajaran?"
      );
    }
    if (caseSearchText || caseSearchExtraction) {
      const query = [caseSearchText, extractionToSearchText(caseSearchExtraction)].filter(Boolean).join("\n");
      setCaseSearchResults(searchSimilarCases(query, nextLanguage));
    }
  }

  function changeLoginRole(nextRole: UserRole) {
    setLoginRole(nextRole);
    setLoginUsername(DEMO_USERS[nextRole].username);
    setLoginPassword("");
    setLoginError("");
  }

  function signIn() {
    const user = DEMO_USERS[loginRole];
    if (loginUsername.trim().toLowerCase() !== user.username || loginPassword !== user.password) {
      setLoginError(labels.loginError);
      return;
    }
    const nextSession = { role: loginRole, name: user.name };
    setSession(nextSession);
    saveDemoSession(nextSession);
    setLoginPassword("");
    setLoginError("");
    setPage("smartchat");
  }

  function logout() {
    setSession(null);
    saveDemoSession(null);
    setPage("dashboard");
    setLoginPassword("");
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
    const pickPpn = (field: keyof PpnComponents) => {
      const value = parts.map((part) => part.ppnComponents?.[field]).find((item) => typeof item === "string" && item.trim());
      return typeof value === "string" ? cleanMergedText(value) : "";
    };
    const ppnIsLb = parts.map((part) => part.ppnComponents?.ppn_is_lb).find((value): value is boolean => typeof value === "boolean");

    return {
      ...first,
      filename: originalName,
      documentType: pick("documentType"),
      putusanNumber: pick("putusanNumber"),
      putusanYear: pick("putusanYear"),
      courtPanel: pick("courtPanel"),
      judgeNames: unique(parts.map((part) => part.judgeNames || [])),
      clerkName: pick("clerkName"),
      procedureType: pick("procedureType"),
      examinationLevel: pick("examinationLevel"),
      caseFileNumber: pick("caseFileNumber"),
      decisionDate: pick("decisionDate"),
      hearingDate: pick("hearingDate"),
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
      ppnComponents: {
        ...emptyPpnComponents(),
        ppn_dpp: pickPpn("ppn_dpp"),
        ppn_pajak_keluaran: pickPpn("ppn_pajak_keluaran"),
        ppn_pajak_masukan: pickPpn("ppn_pajak_masukan"),
        ppn_kb_lb: pickPpn("ppn_kb_lb"),
        ppn_kompensasi: pickPpn("ppn_kompensasi"),
        ppn_masih_harus_bayar: pickPpn("ppn_masih_harus_bayar"),
        ppn_dpp_djp: pickPpn("ppn_dpp_djp"),
        ppn_pm_djp: pickPpn("ppn_pm_djp"),
        ppn_sanksi_pasal_13: pickPpn("ppn_sanksi_pasal_13"),
        ppn_koreksi_dpp: pickPpn("ppn_koreksi_dpp"),
        ppn_koreksi_pm: pickPpn("ppn_koreksi_pm"),
        ppn_tarif: pickPpn("ppn_tarif"),
        ppn_is_lb: typeof ppnIsLb === "boolean" ? ppnIsLb : null,
        ppn_jenis_penyerahan: (pickPpn("ppn_jenis_penyerahan") as PpnComponents["ppn_jenis_penyerahan"]) || "",
        ppn_objek_sengketa: (pickPpn("ppn_objek_sengketa") as PpnComponents["ppn_objek_sengketa"]) || "",
        ppn_notes: combineExtractionText(parts.map((part) => part.ppnComponents?.ppn_notes || ""))
      },
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

  async function askSmartChat() {
    setSmartLoading(true);
    setSmartStatus("");
    setSmartError("");
    try {
      const response = await fetch("/api/smart-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: smartQuestion, language, mode: smartMode })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Smart chatbot request failed.");
      }
      setSmartResponse(data as SmartChatResponse);
      setSmartStatus(data.llmStatus?.message || "");
    } catch (error) {
      setSmartResponse(null);
      setSmartError(error instanceof Error ? error.message : "Smart chatbot request failed.");
    } finally {
      setSmartLoading(false);
    }
  }

  async function askRegulationBot() {
    setRegulationBotLoading(true);
    setRegulationBotStatus("");
    setRegulationBotError("");
    try {
      const response = await fetch("/api/smart-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: regulationQuestion, language, mode: "regulations" })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Regulation chatbot request failed.");
      }
      setRegulationBotResponse(data as SmartChatResponse);
      setRegulationBotStatus(data.llmStatus?.message || "");
    } catch (error) {
      setRegulationBotResponse(null);
      setRegulationBotError(error instanceof Error ? error.message : "Regulation chatbot request failed.");
    } finally {
      setRegulationBotLoading(false);
    }
  }

  function startEditRegulation(item: Regulation) {
    setEditingRegulationId(item.id);
    setRegulationTopic(normalizeRegulationTopic(item.topic));
    setManualRule({
      title: item.title,
      citation: item.citation,
      focus: item.focus,
      sourceUrl: item.sourceUrl || "",
      content: item.content || ""
    });
    setRegulationStatus("");
    setRegulationError("");
    document.getElementById("manual-regulation-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEditRegulation() {
    setEditingRegulationId("");
    setManualRule({ title: "", citation: "", focus: "", sourceUrl: "", content: "" });
  }

  async function deleteRegulation(item: Regulation) {
    if ((item.source || "seed") === "seed") {
      setRegulationError(labels.cannotDeleteSeed);
      return;
    }
    if (!window.confirm(`${labels.deleteRule}: ${item.title}?`)) return;
    setDeletingRegulationId(item.id);
    setRegulationStatus("");
    setRegulationError("");
    try {
      const response = await fetch("/api/regulations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id })
      });
      const data = (await response.json()) as { records?: Regulation[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not delete regulation.");
      }
      if (Array.isArray(data.records)) setRegulationRecords(data.records);
      setRegulationStatus(language === "en" ? "Regulation deleted." : "Aturan dihapus.");
    } catch (error) {
      setRegulationError(error instanceof Error ? error.message : "Could not delete regulation.");
    } finally {
      setDeletingRegulationId("");
    }
  }

  async function importRegulationList(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setRegulationImportLoading(true);
    setRegulationStatus("");
    setRegulationError("");
    try {
      let rows: RegulationImportRow[] = [];
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<RegulationImportRow>(sheet, { defval: "" });
      } else {
        rows = csvRows(await file.text());
      }
      const records = rows.map(rowRegulation).filter((item): item is Regulation => Boolean(item));
      if (!records.length) {
        throw new Error(
          language === "en"
            ? "No valid regulations found. Include title, citation, and focus/summary columns."
            : "Tidak ada aturan valid. Sertakan kolom title/nama, citation/nomor, dan focus/ringkasan."
        );
      }
      const response = await fetch("/api/regulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records })
      });
      const data = (await response.json()) as { records?: Regulation[]; imported?: number; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not import regulations.");
      }
      if (Array.isArray(data.records)) setRegulationRecords(data.records);
      setRegulationStatus(`${data.imported || records.length} ${labels.importedRegulations}`);
    } catch (error) {
      setRegulationError(error instanceof Error ? error.message : "Could not import regulations.");
    } finally {
      setRegulationImportLoading(false);
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
          id: editingRegulationId || undefined,
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
      setEditingRegulationId("");
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

  if (!session) {
    return (
      <LoginScreen
        language={language}
        labels={labels}
        role={loginRole}
        username={loginUsername}
        password={loginPassword}
        error={loginError}
        onLanguageChange={changeLanguage}
        onRoleChange={changeLoginRole}
        onUsernameChange={(value) => {
          setLoginUsername(value.trim().toLowerCase());
          setLoginError("");
        }}
        onPasswordChange={(value) => {
          setLoginPassword(value);
          setLoginError("");
        }}
        onSubmit={signIn}
      />
    );
  }

  return (
    <main className={`app-shell ${sidebarHidden ? "sidebar-hidden" : ""}`}>
      <aside className="sidebar">
        <RsmMark />
        <p className="caption">{APP_SHORT_NAME}</p>
        <div className="session-card">
          <span>{labels.signedInAs}</span>
          <b>{session.name}</b>
          <i>{session.role === "admin" ? labels.roleAdmin : labels.roleUser}</i>
          <button className="table-button compact" onClick={logout}>
            {labels.logout}
          </button>
        </div>
        <label className="field-label" htmlFor="language">
          Language
        </label>
        <select id="language" value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>
          <option value="en">English</option>
          <option value="id">Bahasa Indonesia</option>
        </select>
        <nav>
          {visiblePages.map(([key, title]) => (
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
        <div className="content-toolbar">
          <button className="table-button compact sidebar-visibility-button" onClick={() => setSidebarHidden((current) => !current)}>
            {sidebarHidden ? (language === "en" ? "Show menu" : "Tampilkan menu") : language === "en" ? "Hide menu" : "Sembunyikan menu"}
          </button>
        </div>
        <header className="hero">
          <div>
            <h1>{APP_NAME}</h1>
            <p>{labels.subtitle}</p>
          </div>
        </header>

        {page === "dashboard" && (
          <>
            <section className="quick-actions" aria-label={labels.quickStart}>
              <article className="quick-action-card quick-action-green">
                <div>
                  <span>{labels.quickStart}</span>
                  <b>{labels.quickChat}</b>
                  <button className="table-button" onClick={() => setPage("smartchat")}>{labels.openAction}</button>
                </div>
                <QuickActionIcon type="chatbot" />
              </article>
              <article className="quick-action-card quick-action-blue">
                <div>
                  <span>{labels.quickStart}</span>
                  <b>{labels.quickGuided}</b>
                  <button className="table-button" onClick={() => setPage("guided")}>{labels.openAction}</button>
                </div>
                <QuickActionIcon type="document" />
              </article>
              {session.role === "admin" && (
                <article className="quick-action-card quick-action-gray">
                  <div>
                    <span>{labels.quickStart}</span>
                    <b>{labels.quickAdmin}</b>
                    <button className="table-button" onClick={() => setPage("database")}>{labels.openAction}</button>
                  </div>
                  <QuickActionIcon type="database" />
                </article>
              )}
            </section>
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

        {page === "smartchat" && (
          <SmartChatPanel
            labels={labels}
            question={smartQuestion}
            mode={smartMode}
            response={smartResponse}
            status={smartStatus}
            error={smartError}
            loading={smartLoading}
            onQuestionChange={setSmartQuestion}
            onModeChange={setSmartMode}
            onAsk={askSmartChat}
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
              <label className="table-button upload-inline">
                {regulationImportLoading ? labels.importingRegulations : labels.bulkRegulationUpload}
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={(event) => {
                    importRegulationList(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            <p className="muted import-hint">{labels.bulkRegulationHint}</p>
            {regulationStatus && <div className="status-banner success">{regulationStatus}</div>}
            {regulationError && <div className="status-banner error">{regulationError}</div>}
            <div className="regulation-bot-box">
              <div>
                <h3>{labels.regulationBotTitle}</h3>
                <p className="muted">{labels.regulationBotIntro}</p>
              </div>
              <label className="control wide">
                <span>{labels.regulationQuestion}</span>
                <textarea
                  value={regulationQuestion}
                  onChange={(event) => setRegulationQuestion(event.target.value)}
                  placeholder={labels.regulationQuestionPlaceholder}
                  rows={4}
                />
              </label>
              <button className="primary-button" onClick={askRegulationBot} disabled={regulationBotLoading || !regulationQuestion.trim()}>
                {regulationBotLoading ? labels.askingRegulationBot : labels.askRegulationBot}
              </button>
              {regulationBotError && <div className="status-banner error">{regulationBotError}</div>}
              <div className="regulation-bot-answer">
                <h3>{labels.regulationBotAnswer}</h3>
                {!regulationBotResponse ? (
                  <div className="empty-state">{labels.noRegulationBotAnswer}</div>
                ) : (
                  <>
                    {regulationBotStatus && <div className="status-banner success">{regulationBotStatus}</div>}
                    <MarkdownText text={regulationBotResponse.answer} />
                    <div className="source-list compact-source-list">
                      {regulationBotResponse.ruleHits.slice(0, 6).map((item) => (
                        <article key={item.id} className="source-card">
                          <b>{item.title}</b>
                          <span>{item.citation} · {item.topic}</span>
                          <p>{item.snippet}</p>
                          <small>Relevance {item.score}% · {item.source}</small>
                          <a href={referenceDetailPath("regulation", item.id, regulationQuestion)}>{labels.openReference}</a>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
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
                        <div className="reg-card-actions">
                          <a className="table-button compact" href={referenceDetailPath("regulation", item.id)}>
                            {labels.openReference}
                          </a>
                          <button className="table-button compact" onClick={() => startEditRegulation(item)}>
                            {labels.editRule}
                          </button>
                          <button
                            className="table-button compact danger"
                            onClick={() => deleteRegulation(item)}
                            disabled={deletingRegulationId === item.id}
                          >
                            {deletingRegulationId === item.id ? labels.deletingStored : labels.deleteRule}
                          </button>
                        </div>
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
            <div id="manual-regulation-form" className="manual-rule-box">
              <h3>{labels.manualRegulation}</h3>
              {editingRegulationId && (
                <div className="status-banner success compact-status">
                  {language === "en" ? "Editing existing regulation." : "Sedang edit aturan tersimpan."}
                </div>
              )}
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
                  {manualRuleSaving ? labels.savingManualRule : editingRegulationId ? labels.updateRule : labels.saveManualRule}
                </button>
                {editingRegulationId && (
                  <button className="table-button" onClick={cancelEditRegulation}>
                    {labels.cancelEdit}
                  </button>
                )}
              </div>
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

function InlineRichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong> : <span key={`${part}-${index}`}>{part}</span>
      )}
    </>
  );
}

function MarkdownText({ text }: { text: string }) {
  const blocks = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className="rich-text">
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const isList = lines.every((line) => /^[-•]\s+/.test(line));
        if (isList) {
          return (
            <ul key={`block-${index}`}>
              {lines.map((line, lineIndex) => (
                <li key={`line-${lineIndex}`}>
                  <InlineRichText text={line.replace(/^[-•]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={`block-${index}`}>
            <InlineRichText text={block.replace(/^#{1,6}\s*/, "")} />
          </p>
        );
      })}
    </div>
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

function DetailRows({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="case-detail-rows">
      {rows
        .filter(([, value]) => {
          if (Array.isArray(value)) return value.length > 0;
          return value !== null && value !== undefined && String(value).trim() !== "";
        })
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function CaseDetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="case-detail-card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function HoverHelp({ text, hint }: { text: React.ReactNode; hint: string }) {
  return (
    <span className="hover-help" tabIndex={0} aria-label={typeof text === "string" ? `${text}. ${hint}` : hint}>
      <span className="hover-help-label">{text}</span>
      <span className="hover-help-icon" aria-hidden="true">i</span>
      <span className="hover-help-tooltip" role="tooltip">{hint}</span>
    </span>
  );
}

function PpnComponentsCard({ extraction, language }: { extraction: ExtractionResult; language: "id" | "en" }) {
  if (!hasPpnComponentData(extraction)) return null;
  const ppn = extraction.ppnComponents;
  const componentRows = ppnComponentRows(ppn, language);
  const classificationRows = ppnClassificationRows(ppn, language);
  const formulaRows = ppnFormulaRows(ppn, language);
  const title = language === "en" ? "VAT Components" : "Komponen PPN";
  const formulaTitle = language === "en" ? "Indicative formula check" : "Cek rumus indikatif";

  return (
    <CaseDetailCard title={title}>
      <div className="ppn-component-table">
        <table>
          <thead>
            <tr>
              <th>{language === "en" ? "Component" : "Komponen"}</th>
              <th>Key</th>
              <th>{language === "en" ? "Extracted value" : "Nilai terekstraksi"}</th>
            </tr>
          </thead>
          <tbody>
            {[...componentRows, ...classificationRows].map((row) => (
              <tr key={row.key}>
                <td>
                  <HoverHelp text={row.label} hint={row.hint} />
                </td>
                <td className="mono-cell">{row.key}</td>
                <td className={String(row.value).startsWith("Rp") || String(row.value).startsWith("-Rp") ? "currency-cell" : ""}>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {formulaRows.length > 0 && (
        <>
          <h4 className="case-subtitle">{formulaTitle}</h4>
          <div className="ppn-component-table">
            <table>
              <thead>
                <tr>
                  <th>{language === "en" ? "Formula" : "Rumus"}</th>
                  <th>{language === "en" ? "Indicative result" : "Hasil indikatif"}</th>
                </tr>
              </thead>
              <tbody>
                {formulaRows.map((row) => (
                  <tr key={row.formula}>
                    <td>
                      <HoverHelp text={row.formula} hint={row.basis} />
                    </td>
                    <td className="currency-cell">{row.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {ppn.ppn_notes && <p className="muted ppn-note">{ppn.ppn_notes}</p>}
    </CaseDetailCard>
  );
}

function CaseDetailSheet({ labels, document }: { labels: (typeof copy)["en"]; document: StoredDecisionFile }) {
  const extraction = document.extraction;
  if (!extraction) {
    return <div className="empty-state">{labels.noCaseDetail}</div>;
  }

  const completeness = extractionCompleteness(extraction);
  const outcomeLabel = classifyOutcome(extraction.outcome || "", labels.caseDetail === "Decision Detail" ? "en" : "id");
  const badges = [
    extraction.taxType,
    extraction.issueType || extraction.issueSubtype,
    extraction.documentType,
    outcomeLabel !== "Unclassified" && outcomeLabel !== "Belum terklasifikasi" ? outcomeLabel : "",
    completeness ? `${completeness}% ${labels.extractionConfidence}` : ""
  ].filter((badge): badge is string => Boolean(badge));
  const judges = Array.isArray(extraction.judgeNames) && extraction.judgeNames.length ? extraction.judgeNames.join("; ") : "";
  const legalReferences = Array.isArray(extraction.legalReferences) && extraction.legalReferences.length ? extraction.legalReferences.join("; ") : "";
  const evidence = Array.isArray(extraction.evidence) && extraction.evidence.length ? extraction.evidence.join("; ") : "";
  const language = labels.caseDetail === "Decision Detail" ? "en" : "id";
  const tabBase = `case-tabs-${safeDomId(document.id)}`;

  return (
    <article className="case-detail-sheet">
      <div className="case-detail-header">
        <div>
          <span className="case-detail-kicker">Putusan detail</span>
          <h3>{dash(extraction.putusanNumber || document.filename)}</h3>
          <p>
            {dash(extraction.putusanYear)}
            {extraction.courtPanel ? ` · ${extraction.courtPanel}` : ""}
            {extraction.hearingDate ? ` · Sidang ${extraction.hearingDate}` : ""}
          </p>
        </div>
        <div className="case-detail-meter">
          <span>{labels.extractionConfidence}</span>
          <strong>{completeness}%</strong>
        </div>
      </div>

      <div className="case-detail-badges">
        {badges.map((badge) => (
          <span key={badge}>{badge}</span>
        ))}
      </div>

      <div className="case-detail-tabs">
        <input className="case-tab-radio" id={`${tabBase}-metadata`} name={tabBase} type="radio" defaultChecked />
        <input className="case-tab-radio" id={`${tabBase}-calculation`} name={tabBase} type="radio" />
        <input className="case-tab-radio" id={`${tabBase}-paragraphs`} name={tabBase} type="radio" />
        <div className="case-tab-list" role="tablist" aria-label={language === "en" ? "Decision detail sections" : "Bagian detail putusan"}>
          <label htmlFor={`${tabBase}-metadata`}>{language === "en" ? "1. Key metadata" : "1. Metadata penting"}</label>
          <label htmlFor={`${tabBase}-calculation`}>{language === "en" ? "2. Calculation" : "2. Perhitungan"}</label>
          <label htmlFor={`${tabBase}-paragraphs`}>{language === "en" ? "3. Key paragraphs" : "3. Paragraf penting"}</label>
        </div>
        <div className="case-tab-panels">
          <section className="case-tab-panel">
            <div className="case-file-stats">
              <div>
                <span>{labels.originalFile}</span>
                <b>{document.filename}</b>
              </div>
              <div>
                <span>{labels.fileSize}</span>
                <b>{formatBytes(document.size)}</b>
              </div>
              <div>
                <span>{labels.uploadedAt}</span>
                <b>{new Date(document.uploadedAt).toLocaleString()}</b>
              </div>
              <div>
                <span>LLM</span>
                <b>{extraction.llmStatus?.model || "-"}</b>
              </div>
            </div>
            <CaseDetailCard title={language === "en" ? "Key information" : "Informasi kunci"}>
              <DetailRows
                rows={[
                  ["Outcome", dash(extraction.outcome)],
                  [language === "en" ? "Classification" : "Klasifikasi", outcomeLabel],
                  [labels.taxType, dash(extraction.taxType)],
                  [language === "en" ? "Tax period" : "Masa/Tahun Pajak", dash(extraction.taxPeriod)],
                  [labels.decisionNumber, dash(extraction.putusanNumber)],
                  ["Nomor SKP/STP", dash(extraction.skpNumber)],
                  ["Nomor KEP", dash(extraction.djpDecisionNumber)],
                  [labels.disputedAmount, dash(extraction.correctionAmount)],
                  [language === "en" ? "Correction object" : "Objek koreksi", dash(extraction.correctionObject)]
                ]}
              />
            </CaseDetailCard>
            <div className="case-detail-grid two">
              <CaseDetailCard title={labels.taxpayerParty}>
                <DetailRows
                  rows={[
                    ["Nama", dash(extraction.taxpayerName)],
                    ["NPWP", dash(extraction.taxpayerNpwp)],
                    ["Alamat", truncateText(extraction.taxpayerAddress, 220)],
                    ["Wakil", dash(extraction.representativeName)],
                    ["Kuasa hukum", dash(extraction.legalCounselName)],
                    ["Lisensi kuasa", dash(extraction.legalCounselLicense)]
                  ]}
                />
              </CaseDetailCard>
              <CaseDetailCard title={labels.authorityParty}>
                <DetailRows
                  rows={[
                    ["Unit", dash(extraction.djpUnit || extraction.appelleeName)],
                    ["Nomor KEP", dash(extraction.djpDecisionNumber)],
                    ["Nomor SKP/STP", dash(extraction.skpNumber)],
                    ["Jenis pajak", dash(extraction.taxType)],
                    ["Masa/Tahun Pajak", dash(extraction.taxPeriod)]
                  ]}
                />
              </CaseDetailCard>
            </div>
            <CaseDetailCard title={labels.courtPanel}>
              <DetailRows
                rows={[
                  ["Majelis", dash(extraction.courtPanel)],
                  ["Hakim", judges || "-"],
                  ["Panitera", dash(extraction.clerkName)],
                  ["Jenis acara", dash(extraction.procedureType)],
                  ["Tingkat pemeriksaan", dash(extraction.examinationLevel)],
                  ["Nomor berkas", dash(extraction.caseFileNumber)],
                  ["Tanggal putusan", dash(extraction.decisionDate)]
                ]}
              />
            </CaseDetailCard>
          </section>
          <section className="case-tab-panel">
            {hasPpnComponentData(extraction) ? (
              <PpnComponentsCard extraction={extraction} language={language} />
            ) : (
              <CaseDetailCard title={language === "en" ? "Extracted VAT components" : "Komponen PPN terekstraksi"}>
                <p>
                  {language === "en"
                    ? "No structured VAT component has been extracted for this record yet. Use Re-extract to read the new VAT fields from the document."
                    : "Belum ada komponen PPN terstruktur pada data ini. Gunakan Re-extract agar field PPN baru dibaca dari dokumen."}
                </p>
              </CaseDetailCard>
            )}
            <CaseDetailCard title={labels.disputedAmount}>
              <DetailRows
                rows={[
                  ["Sebelum / nilai koreksi", dash(extraction.correctionAmount)],
                  ["Objek koreksi", dash(extraction.correctionObject)],
                  ["Outcome", dash(extraction.outcome)],
                  ["Klasifikasi", outcomeLabel]
                ]}
              />
            </CaseDetailCard>
          </section>
          <section className="case-tab-panel">
            <CaseDetailCard title={labels.disputeNarrative}>
              <div className="case-issue-card">
                <b>{dash(extraction.issueType || extraction.issueSubtype || extraction.correctionObject)}</b>
                <p>{truncateText(extraction.summary || extraction.correctionReason || extraction.taxAuthorityPosition, 700)}</p>
              </div>
            </CaseDetailCard>
            <div className="case-detail-grid two">
              <CaseDetailCard title={labels.authority}>
                <p>{truncateText(extraction.taxAuthorityPosition || extraction.correctionReason, 700) || "-"}</p>
              </CaseDetailCard>
              <CaseDetailCard title={labels.taxpayerPosition}>
                <p>{truncateText(extraction.taxpayerPosition || extraction.taxpayerRebuttal, 700) || "-"}</p>
              </CaseDetailCard>
            </div>
            <div className="case-detail-grid two">
              <CaseDetailCard title={labels.extractedEvidence}>
                <p>{evidence || "-"}</p>
              </CaseDetailCard>
              <CaseDetailCard title={labels.relatedRules}>
                <p>{legalReferences || "-"}</p>
              </CaseDetailCard>
            </div>
            <CaseDetailCard title={labels.decisionContent}>
              <DetailRows
                rows={[
                  ["Pertimbangan", truncateText(extraction.courtReasoning, 1000)],
                  ["Amar putusan", truncateText(extraction.outcome, 520)]
                ]}
              />
            </CaseDetailCard>
          </section>
        </div>
      </div>
    </article>
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
  type SortKey = "filename" | "status" | "confidence" | "decision" | "taxpayer" | "size" | "uploadedAt";
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "uploadedAt", direction: "desc" });
  const [copiedDocumentId, setCopiedDocumentId] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const sortedDocuments = useMemo(() => {
    const getValue = (item: StoredDecisionFile, key: SortKey) => {
      if (key === "status") return item.status || (item.extraction ? "extracted" : "uploaded");
      if (key === "confidence") return extractionCompleteness(item.extraction);
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
  const selectedDocument = selectedDocumentId ? storedDocuments.find((item) => item.id === selectedDocumentId) || null : null;

  useEffect(() => {
    setPageNumber((current) => Math.min(Math.max(1, current), totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (selectedDocumentId && !storedDocuments.some((item) => item.id === selectedDocumentId)) {
      setSelectedDocumentId("");
    }
  }, [selectedDocumentId, storedDocuments]);

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
      <Panel title={selectedDocument ? labels.caseDetail : labels.storedDocuments}>
        {!selectedDocument && (
          <>
            <div className="database-upload-strip">
              <div className="database-upload-copy">
                <b>{labels.uploadDecisionPdfs}</b>
                <span>
                  {files.length
                    ? `${files.length} file(s): ${files.map((file) => `${file.name} (${formatBytes(file.size)})`).join(", ")}`
                    : labels.databaseUploadHint}
                </span>
              </div>
              <label className="database-file-picker">
                <span>{labels.uploadDecisionPdfs}</span>
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  onChange={(event) => onFilesChange(event.target.files)}
                />
              </label>
              <button className="primary-button database-upload-button" onClick={onUpload} disabled={loading || files.length === 0}>
                {loading ? labels.uploadingToBlob : labels.uploadAndExtract}
              </button>
            </div>
            {status && <div className="status-banner success compact-status">{status}</div>}
            {error && <div className="status-banner error compact-status">{error}</div>}
          </>
        )}
        {storedDocuments.length === 0 ? (
          <div className="empty-state">{labels.noStoredDocuments}</div>
        ) : selectedDocument ? (
          <>
            <div className="case-detail-actions">
              <button className="table-button" onClick={() => setSelectedDocumentId("")}>
                {labels.backToDocuments}
              </button>
              <button className="table-button" onClick={printCaseDetail}>
                {labels.printCaseSheet}
              </button>
              <button
                className="table-button"
                onClick={() => onExtract(selectedDocument)}
                disabled={Boolean(extractingDocumentId || deletingDocumentId) || !(selectedDocument.url || selectedDocument.downloadUrl || "").startsWith("https://")}
              >
                {extractingDocumentId === selectedDocument.id ? labels.extractingStored : labels.reExtractStored}
              </button>
              <button
                className="table-button danger"
                onClick={() => onDelete(selectedDocument)}
                disabled={Boolean(extractingDocumentId || deletingDocumentId)}
              >
                {deletingDocumentId === selectedDocument.id ? labels.deletingStored : labels.deleteStored}
              </button>
              {(selectedDocument.downloadUrl || selectedDocument.url).startsWith("https://") && (
                <a className="table-button" href={referenceDetailPath("decision", selectedDocument.id)}>
                  {labels.openPdf}
                </a>
              )}
            </div>
            <CaseDetailSheet labels={labels} document={selectedDocument} />
          </>
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
                    <th><SortButton sortKey="confidence">{labels.extractionConfidence}</SortButton></th>
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
                    const confidence = extractionCompleteness(item.extraction);
                    return (
                      <tr key={item.id}>
                        <td className="file-cell">
                          {item.extraction ? (
                            <a className="text-link" href={decisionDetailPath(item.id)}>
                              {item.filename}
                            </a>
                          ) : (
                            item.filename
                          )}
                        </td>
                        <td>
                          <span className={`db-status ${status}`}>{status}</span>
                        </td>
                        <td>
                          <span className={`confidence-pill ${confidence >= 80 ? "high" : confidence >= 55 ? "medium" : "low"}`}>
                            {item.extraction ? `${confidence}%` : "-"}
                          </span>
                        </td>
                        <td>
                          {item.extraction?.putusanNumber ? (
                            <a className="text-link" href={decisionDetailPath(item.id)}>
                              {item.extraction.putusanNumber}
                            </a>
                          ) : (
                            "-"
                          )}
                        </td>
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
                          <button className="table-button" onClick={() => setSelectedDocumentId(item.id)} disabled={!item.extraction}>
                            {labels.viewCase}
                          </button>
                          {item.extraction && (
                            <a className="table-button" href={decisionDetailPath(item.id)}>
                              {labels.casePageLink}
                            </a>
                          )}
                          <button className="table-button danger" onClick={() => onDelete(item)} disabled={busy}>
                            {deletingDocumentId === item.id ? labels.deletingStored : labels.deleteStored}
                          </button>
                        </td>
                        <td>
                          {hasPdfUrl ? (
                            <a href={referenceDetailPath("decision", item.id)}>
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

function SmartChart({ chart }: { chart: SmartChatResponse["charts"][number] }) {
  const max = Math.max(...chart.items.map((item) => item.value), 1);
  return (
    <article className="smart-chart-card">
      <h3>{chart.title}</h3>
      {chart.type === "donut" && <div className="donut compact-donut" style={buildDonutStyle(chart.items)} />}
      <div className="smart-chart-bars">
        {chart.items.map((item) => (
          <div key={item.label} className="smart-chart-bar">
            <span>{item.label}</span>
            <div>
              <i style={{ width: `${Math.max(6, (item.value / max) * 100)}%`, background: item.color }} />
            </div>
            <b>{item.value}</b>
          </div>
        ))}
      </div>
    </article>
  );
}

function SmartChatPanel({
  labels,
  question,
  mode,
  response,
  status,
  error,
  loading,
  onQuestionChange,
  onModeChange,
  onAsk
}: {
  labels: (typeof copy)["en"];
  question: string;
  mode: SmartChatSourceMode;
  response: SmartChatResponse | null;
  status: string;
  error: string;
  loading: boolean;
  onQuestionChange: (value: string) => void;
  onModeChange: (value: SmartChatSourceMode) => void;
  onAsk: () => void;
}) {
  return (
    <section className="smart-chat-layout">
      <Panel title={labels.smartChatTitle}>
        <p className="muted lead-copy">{labels.smartChatIntro}</p>
        <div className="smart-chat-form">
          <label className="control wide">
            <span>{labels.smartQuestion}</span>
            <textarea
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              placeholder={labels.smartQuestionPlaceholder}
              rows={5}
            />
          </label>
          <div className="control">
            <span>{labels.smartMode}</span>
            <div className="mode-segment">
              {[
                ["all", labels.smartModeAll],
                ["decisions", labels.smartModeDecisions],
                ["regulations", labels.smartModeRegulations]
              ].map(([value, title]) => (
                <button key={value} className={mode === value ? "active" : ""} onClick={() => onModeChange(value as SmartChatSourceMode)}>
                  {title}
                </button>
              ))}
            </div>
          </div>
        </div>
        {error && <div className="status-banner error">{error}</div>}
        <button className="primary-button" onClick={onAsk} disabled={loading || !question.trim()}>
          {loading ? labels.askingSmartChat : labels.askSmartChat}
        </button>
      </Panel>

      <Panel title={labels.smartAnswer}>
        {!response ? (
          <div className="empty-state">{labels.noSmartAnswer}</div>
        ) : (
          <>
            {status && <div className="status-banner success">{status}</div>}
            <MarkdownText text={response.answer} />
            <div className="retrieval-summary">
              <b>{labels.retrievalSummary}</b>
              <span>
                {response.retrieval.usedDecisions}/{response.retrieval.totalDecisions} decisions ·{" "}
                {response.retrieval.usedRegulations}/{response.retrieval.totalRegulations} regulations
              </span>
            </div>
            {response.charts.length > 0 && (
              <>
                <h3 className="section-subtitle">{labels.smartCharts}</h3>
                <div className="smart-chart-grid">
                  {response.charts.map((chart) => (
                    <SmartChart key={chart.title} chart={chart} />
                  ))}
                </div>
              </>
            )}
            <div className="source-grid">
              <div>
                <h3 className="section-subtitle">{labels.retrievedDecisions}</h3>
                <div className="source-list">
                  {response.decisionHits.length ? (
                    response.decisionHits.slice(0, 5).map((item) => (
                      <article key={item.id} className="source-card">
                        <b>{item.number}</b>
                        <span>{item.taxpayer} · {item.taxType} · {item.issue}</span>
                        <p>{item.outcome}</p>
                        <small>Relevance {item.score}%{item.matchReasons?.length ? ` · ${item.matchReasons.join(", ")}` : ""}</small>
                        <a href={referenceDetailPath("decision", item.id, question)}>
                          {labels.openReference}
                        </a>
                      </article>
                    ))
                  ) : (
                    <div className="empty-state">{labels.noDynamicDocuments}</div>
                  )}
                </div>
              </div>
              <div>
                <h3 className="section-subtitle">{labels.retrievedRules}</h3>
                <div className="source-list">
                  {response.ruleHits.length ? (
                    response.ruleHits.slice(0, 5).map((item) => (
                      <article key={item.id} className="source-card">
                        <b>{item.title}</b>
                        <span>{item.citation} · {item.topic}</span>
                        <p>{item.snippet}</p>
                        <small>Relevance {item.score}% · {item.source}</small>
                        <a href={referenceDetailPath("regulation", item.id, question)}>
                          {labels.openReference}
                        </a>
                      </article>
                    ))
                  ) : (
                    <div className="empty-state">{labels.noRegulations}</div>
                  )}
                </div>
              </div>
            </div>
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
      {analysis.scoringBreakdown && (
        <div className="score-breakdown">
          <div className="score-breakdown-head">
            <h3>{labels.scoreMethodology}</h3>
            <span>{analysis.scoringBreakdown.version}</span>
          </div>
          <p>
            <b>{labels.scoreFormula}:</b> {analysis.scoringBreakdown.formula}
          </p>
          <div className="score-components">
            {analysis.scoringBreakdown.components.map((component) => (
              <article key={component.id}>
                <div>
                  <b>{component.label}</b>
                  <span>
                    {component.earnedPoints}/{component.maxPoints}
                  </span>
                </div>
                <meter min="0" max={component.maxPoints} value={component.earnedPoints} />
                <p>{component.rationale}</p>
                <small>{component.signals.slice(0, 3).join(" · ")}</small>
              </article>
            ))}
          </div>
          <ul className="score-notes">
            {analysis.scoringBreakdown.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
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
      <MarkdownText text={analysis.recommendation} />
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
