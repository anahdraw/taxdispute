"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { upload } from "@vercel/blob/client";
import { buildAnalysis, type AnalysisResult as AnalysisResultType, type AnalyzeInput } from "@/lib/analyze";
import { extractionToSearchText, searchSimilarCases, type SimilarCaseResult } from "@/lib/case-search";
import { emptyPpnComponents, type ExtractionResult, type PpnComponents } from "@/lib/extraction";
import { regulations, type Regulation } from "@/lib/mock-data";
import { hasPpnComponentData, ppnClassificationRows, ppnComponentRows, ppnFormulaRows } from "@/lib/ppn-components";
import { filterRegulationsByTopic, normalizeRegulationTopic, regulationTopicOptions, type RegulationTopic } from "@/lib/regulation-knowledge";
import { regulationSourceMatches, regulationSourceScopeOptions, type RegulationSourceScope } from "@/lib/regulation-sources";
import type { SmartChatResponse, SmartChatSourceMode } from "@/lib/smart-chat";
import type { StoredDecisionFile } from "@/lib/stored-decisions";
import { buildReportKey, buildStoredReport, type StoredReport } from "@/lib/stored-reports";
import { decisionDetailPath } from "@/lib/decision-links";
import { referenceDetailPath } from "@/lib/reference-links";
import type { ActivityLog, ManagedUser, SubscriptionTier, SystemCheck, TierFeatureKey, UserRole } from "@/lib/admin";
import { defaultTierForRole, normalizeSubscriptionTier, normalizeUsername, seedUsers, userIdFromUsername } from "@/lib/admin";
import {
  defaultAdminRuntimeSettings,
  planHasFeature,
  promptFeatureKeys,
  type AdminRuntimeSettings,
  type PromptFeatureKey,
  type PromptLanguage
} from "@/lib/settings-schema";
import {
  DEFAULT_LLM_MODEL_CHOICE,
  LLM_MODEL_HEADER,
  MODEL_CHOICE_STORAGE_KEY,
  normalizeModelChoice,
  type LlmModelChoice
} from "@/lib/model-options";
import { TIER_PREVIEW_HEADER } from "@/lib/tier-preview";

type Language = "id" | "en";
type ThemeMode = "dark" | "light";
type PageKey = "dashboard" | "guided" | "database" | "smartchat" | "regulations" | "reports" | "admin";
type RegulationTabKey = "bot" | "update" | "list" | "manual";
type RegulationTopicFilter = RegulationTopic | "all";
type DisputeTabKey = "chat" | "similar";
type AdminTabKey = "logs" | "users" | "privacy" | "api";
type AppSession = {
  role: UserRole;
  tier: SubscriptionTier;
  name: string;
  username?: string;
};
const MAX_UPLOAD_BYTES = 3.6 * 1024 * 1024;
const STORED_DECISIONS_KEY = "tax-dispute-stored-decisions";
const STORED_REPORTS_KEY = "tax-dispute-stored-reports";
const APP_SESSION_KEY = "tax-dispute-session";
const ADMIN_USERS_KEY = "tax-dispute-admin-users";
const ACTIVITY_LOGS_KEY = "tax-dispute-activity-logs";
const THEME_MODE_KEY = "tax-dispute-theme-mode-v2";
const SIDEBAR_COLLAPSED_KEY = "tax-dispute-sidebar-collapsed";
const APP_NAME = "Tax Dispute Agentic Advisor";
const APP_SHORT_NAME = "Tax Dispute Agentic Advisor";
const DEFAULT_USER_BY_ROLE = {
  admin: seedUsers.find((user) => user.role === "admin") || seedUsers[0],
  user: seedUsers.find((user) => user.role === "user") || seedUsers[1]
};

const DEFAULT_RUNTIME_SETTINGS = defaultAdminRuntimeSettings();

function canAccessPage(role: UserRole, tier: SubscriptionTier, key: PageKey, plans = DEFAULT_RUNTIME_SETTINGS.plans) {
  if (role === "admin") return true;
  if (key === "dashboard") return planHasFeature(plans, tier, "dashboard");
  if (key === "guided") return planHasFeature(plans, tier, "guided");
  if (key === "database") return planHasFeature(plans, tier, "databaseRead");
  if (key === "smartchat") return planHasFeature(plans, tier, "disputeBot");
  if (key === "regulations") return planHasFeature(plans, tier, "regulationRead");
  if (key === "reports") return planHasFeature(plans, tier, "reports");
  return false;
}

function modelRequestHeaders(modelChoice: LlmModelChoice, previewTier?: SubscriptionTier) {
  return {
    [LLM_MODEL_HEADER]: modelChoice,
    ...(previewTier ? { [TIER_PREVIEW_HEADER]: previewTier } : {})
  };
}

function jsonRequestHeaders(modelChoice: LlmModelChoice, previewTier?: SubscriptionTier) {
  return { "Content-Type": "application/json", ...modelRequestHeaders(modelChoice, previewTier) };
}

const evidenceOptions = {
  id: ["Faktur Pajak", "SPT Masa PPN", "Bukti pembayaran", "Rekonsiliasi", "Konfirmasi Lawan Transaksi", "Surat Kuasa"],
  en: ["VAT invoice", "VAT return", "Payment evidence", "Reconciliation", "Counterparty confirmation", "Power of attorney"]
};

const copy = {
  id: {
    subtitle: "Upload putusan, ekstrak data, cari pembanding, tanya aturan, lalu ekspor draft.",
    appGuidance: "Upload putusan, ekstrak data, cari pembanding, tanya aturan, lalu ekspor draft.",
    dashboard: "Dashboard",
    guided: "Analisis Putusan Tingkat Lanjut",
    database: "Database Putusan",
    smartchat: "Dispute Analysis",
    regulations: "Peraturan",
    reports: "Reports",
    admin: "Admin",
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
    uploadHint: "Pilih PDF untuk ekstraksi. Penyimpanan aktif jika Blob/database tersedia.",
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
    caseSearchIntro: "Cari putusan pembanding dari narasi, kata kunci, atau PDF.",
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
    reportDatabaseTitle: "Database Report",
    reportDatabaseIntro: "Buka dan unduh ulang report tersimpan.",
    savedReports: "Report tersimpan",
    noSavedReports: "Belum ada report tersimpan. Buat analisis di tab Analisis baru terlebih dahulu.",
    reportSaved: "Report tersimpan di database.",
    reportLoaded: "Report tersimpan dipakai ulang. Klik Update Analysis jika ingin menghitung ulang.",
    updateAnalysis: "Update Analysis",
    openReportDetail: "Lihat detail",
    redownloadReport: "Unduh ulang",
    reportUpdatedAt: "Update terakhir",
    useSavedReport: "Pakai report ini",
    loadingReportDetail: "Memuat detail report...",
    databaseTitle: "Database Putusan",
    databaseIntro: "Upload PDF putusan, ekstrak metadata, lalu simpan ke database.",
    databaseUploadHint: "PDF disimpan ke Blob. Ekstraksi dapat dijalankan setelah upload.",
    uploadDecisionPdfs: "Upload PDF Putusan",
    uploadToBlob: "Upload ke Blob",
    uploadAndExtract: "Upload + Ekstrak",
    uploadingToBlob: "Mengupload ke Blob...",
    blobUploadProgress: "Progress upload",
    storedDocuments: "Dokumen Tersimpan",
    noStoredDocuments: "Belum ada dokumen yang diupload dari browser ini.",
    loadingDecisionDetail: "Memuat detail putusan...",
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
    updatingRules: "Memeriksa layanan...",
    regulationUpdated: "Knowledge peraturan diperbarui.",
    source: "Sumber",
    openSource: "Buka sumber",
    manualRegulation: "Upload / input manual aturan",
    manualTitle: "Nama aturan",
    manualCitation: "Nomor / sitasi",
    manualFocus: "Ringkasan fungsi aturan",
    manualSourceUrl: "Link sumber",
    manualPdfUrl: "Link PDF resmi (opsional)",
    manualContent: "Catatan atau kutipan ringkas",
    uploadManualRule: "Upload file teks aturan",
    saveManualRule: "Simpan aturan manual",
    savingManualRule: "Menyimpan aturan...",
    regulationHelp: "Kelola chatbot RAG, update sumber, import daftar peraturan, dan daftar aturan tersimpan.",
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
    regulationBotTitle: "Regulatory RAG Bot",
    regulationBotIntro: "Tanya peraturan dengan konteks sumber, status, dan batasan penggunaan yang terlihat.",
    regulationQuestion: "Pertanyaan aturan",
    regulationQuestionPlaceholder: "Contoh: aturan apa saja yang mengatur dokumentasi transfer pricing dan prinsip kewajaran?",
    askRegulationBot: "Kirim pertanyaan",
    askingRegulationBot: "Menelaah aturan...",
    regulationBotAnswer: "Jawaban berbasis sumber",
    noRegulationBotAnswer: "Mulai dari pertanyaan spesifik. Bot akan menampilkan ringkasan, sumber, dan batasan konteks.",
    bulkRegulationUpload: "Upload list aturan Excel/CSV",
    bulkRegulationHint: "Kolom fleksibel: Peraturan/title, Judul/Substansi Utama/focus, Kegunaan Praktis/content, Status, Sumber Resmi/sourceUrl/link, topic, relevance.",
    importingRegulations: "Mengimpor aturan...",
    importedRegulations: "aturan berhasil diimpor/diperbarui.",
    enrichSources: "Ambil & indeks PDF resmi",
    enrichingSources: "Mengambil dan menelaah PDF...",
    enrichRuleSource: "Indeks PDF resmi",
    sourceEnriched: "aturan berhasil diambil dan diindeks dari repository resmi.",
    noRulesWithSource: "Tidak ada aturan dengan link repository resmi yang dapat diproses.",
    regulationTabBot: "RAG Chatbot",
    regulationTabUpdate: "Update & Import",
    regulationTabList: "Aturan tersimpan",
    regulationTabManual: "Input manual",
    regulationUpdateTitle: "Update knowledge aturan",
    regulationUpdateIntro: "Impor daftar aturan, lalu ambil PDF dari JDIH BPK, JDIH Kemenkeu, DJP, atau repository resmi lain untuk diindeks ke RAG.",
    editRule: "Edit",
    deleteRule: "Hapus",
    updateRule: "Update aturan",
    cancelEdit: "Batal edit",
    cannotDeleteSeed: "Aturan bawaan seed tidak bisa dihapus dari database. Edit/salin sebagai aturan manual jika perlu.",
    smartChatTitle: "Dispute Analysis",
    smartChatIntro: "Tanya RAG atau cari kasus mirip dari narasi/PDF.",
    disputeTabChat: "RAG Chatbot",
    disputeTabSimilar: "Cari kasus mirip",
    smartQuestion: "Pertanyaan",
    smartQuestionPlaceholder: "Contoh: Untuk sengketa transfer pricing jasa afiliasi, berapa putusan yang WP menang atau kalah dan aturan apa yang relevan?",
    smartMode: "Sumber jawaban",
    smartModeAll: "Putusan + Peraturan",
    smartModeDecisions: "Putusan saja",
    smartModeRegulations: "Peraturan saja",
    askSmartChat: "Tanya Dispute Analysis",
    askingSmartChat: "Menyaring RAG dan menjawab...",
    smartAnswer: "Jawaban",
    smartCharts: "Visualisasi",
    retrievedDecisions: "Putusan yang dipakai RAG",
    retrievedRules: "Peraturan yang dipakai RAG",
    retrievalSummary: "Ringkasan retrieval",
    noSmartAnswer: "Ajukan pertanyaan untuk melihat jawaban, sumber RAG, dan visualisasi jika relevan.",
    openReference: "Buka referensi",
    loginTitle: "Masuk ke RSM Tax Dispute Agentic Advisor",
    loginSubtitle: "Admin mengelola sistem; user fokus analisis dan chatbot.",
    username: "Username",
    password: "Password",
    signIn: "Masuk",
    adminLogin: "Admin",
    userLogin: "User",
    loginError: "Username atau password belum cocok.",
    signedInAs: "Masuk sebagai",
    logout: "Keluar",
    roleAdmin: "Admin",
    roleUser: "User",
    quickStart: "Mulai Cepat",
    quickChat: "Buka Dispute Analysis",
    quickAdmin: "Kelola database dan peraturan",
    openAction: "Buka",
    workspace: "Workspace",
    commandCenter: "Command Center",
    activeRole: "Role aktif",
    dataMode: "Mode data",
    aiRuntime: "AI runtime",
    aiRuntimeHint: "Mini seimbang, Nano cepat, Local offline, On-prem privat.",
    modelMini: "Mini",
    modelMiniHint: "Seimbang",
    modelNano: "Nano",
    modelNanoHint: "Cepat",
    modelLocal: "Local",
    modelLocalHint: "Rules",
    modelOnPrem: "On-prem",
    modelOnPremHint: "Privat",
    aiModelTitle: "Model AI",
    aiProvider: "Penyedia AI",
    aiProviderOpenAI: "OpenAI / kompatibel (cloud/API)",
    aiProviderOllama: "Ollama / lokal on-premise",
    aiProviderRules: "Local rules / tanpa LLM",
    aiModelOpenAI: "Model OpenAI",
    aiModelLocal: "Model lokal",
    aiApiBaseUrl: "Alamat API (Base URL)",
    aiGoodFor: "Cocok untuk",
    aiNote: "Catatan",
    aiRecommendation: "Rekomendasi",
    aiRuntimeLocked: "Model detail dan endpoint produksi dibaca dari environment server.",
    aiInstalled: "Tersedia",
    aiEnvOnly: "Env server",
    aiVariation: "Variasi jawaban",
    aiContextCapacity: "Kapasitas konteks",
    aiTextLimit: "Batas teks per proses",
    workspaceSignal: "Sinyal knowledge",
    liveWorkspace: "Database aktif",
    localWorkspace: "Local first",
    indexedHelper: "Korpus putusan",
    coverageHelper: "Ekstraksi selesai",
    vatDocsHelper: "Tag PPN/TP",
    localRulesHelper: "Knowledge aturan",
    llmLabelsHelper: "Label struktur",
    theme: "Tema",
    lightMode: "Terang",
    darkMode: "Gelap",
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
    casePageLink: "Halaman",
    adminTitle: "Admin Center",
    adminIntro: "Kelola user, log, privasi, dan kesiapan API.",
    adminLogs: "Log aktivitas",
    adminUsers: "User management",
    adminPrivacy: "Privasi & akses",
    adminCheckApi: "Pengaturan",
    privacyTitle: "Kontrol akses & privasi",
    privacyIntro: "Role mengatur izin. Paket akses mengatur fitur dan limit bulanan.",
    subscriptionTier: "Paket akses",
    tierSilver: "Silver",
    tierGold: "Gold",
    tierPlatinum: "Platinum",
    tierDocuments: "Limit dokumen bulanan",
    tierChats: "Limit pertanyaan chatbot bulanan",
    unlimited: "Unlimited",
    accessMatrix: "Matriks akses",
    securityControls: "Kontrol aktif",
    saasReadiness: "Kesiapan production",
    featureLabel: "Fitur",
    allowed: "Ya",
    blocked: "Tidak",
    analysisDepth: "Level analisis",
    regulationDepth: "Pendalaman aturan",
    comparableDepth: "Analisis putusan",
    reportDepth: "Output report",
    ruleIntakeStrategy: "Konsumsi aturan baru",
    privacySilverDesc: "Analisis dan draft sederhana.",
    privacyGoldDesc: "Tim advisor dengan akses database.",
    privacyPlatinumDesc: "Kontrol penuh, admin, dan integrasi.",
    activityLogs: "Log aktivitas aplikasi",
    noActivityLogs: "Belum ada log aktivitas.",
    refresh: "Refresh",
    logAction: "Aktivitas",
    logTarget: "Target",
    logStatus: "Status",
    logDetail: "Detail",
    logActor: "Aktor",
    logTime: "Waktu",
    userManagement: "Manajemen user",
    addOrUpdateUser: "Tambah / update user",
    managedUsers: "Daftar user",
    displayName: "Nama tampilan",
    userStatus: "Status user",
    active: "Aktif",
    inactive: "Nonaktif",
    saveUser: "Simpan user",
    resetForm: "Reset form",
    deleteUser: "Hapus user",
    editUser: "Edit user",
    cannotDeleteSelf: "User yang sedang login tidak bisa dihapus.",
    userSaved: "User berhasil disimpan.",
    userDeleted: "User berhasil dihapus.",
    apiCheck: "API & integrasi",
    runApiCheck: "Jalankan check",
    apiCheckIntro: "Cek OpenAI, Blob, database, dan tabel utama.",
    lastChecked: "Terakhir dicek",
    okStatus: "OK",
    warningStatus: "Warning",
    errorStatus: "Error",
    openHealthPage: "Buka halaman health"
  },
  en: {
    subtitle: "Upload decisions, extract data, find comparators, ask rules, then export drafts.",
    appGuidance: "Upload decisions, extract data, find comparators, ask rules, then export drafts.",
    dashboard: "Dashboard",
    guided: "Advanced Dispute Analysis",
    database: "Decision Database",
    smartchat: "Dispute Analysis",
    regulations: "Regulations",
    reports: "Reports",
    admin: "Admin",
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
    uploadHint: "Choose a PDF for extraction. Storage is used when Blob/database is configured.",
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
    caseSearchIntro: "Find comparable decisions from narrative, keywords, or PDF.",
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
    reportDatabaseTitle: "Report Database",
    reportDatabaseIntro: "Open and redownload saved reports.",
    savedReports: "Saved reports",
    noSavedReports: "No saved reports yet. Create an analysis in the New analysis tab first.",
    reportSaved: "Report saved to database.",
    reportLoaded: "Saved report reused. Click Update Analysis if you want to rerun it.",
    updateAnalysis: "Update Analysis",
    openReportDetail: "View detail",
    redownloadReport: "Download again",
    reportUpdatedAt: "Last updated",
    useSavedReport: "Use this report",
    loadingReportDetail: "Loading report detail...",
    databaseTitle: "Decision Database",
    databaseIntro: "Upload decision PDFs, extract metadata, and save to the database.",
    databaseUploadHint: "PDFs are stored in Blob. Extraction can run after upload.",
    uploadDecisionPdfs: "Upload decision PDFs",
    uploadToBlob: "Upload to Blob",
    uploadAndExtract: "Upload + Extract",
    uploadingToBlob: "Uploading to Blob...",
    blobUploadProgress: "Upload progress",
    storedDocuments: "Stored Documents",
    noStoredDocuments: "No documents have been uploaded from this browser yet.",
    loadingDecisionDetail: "Loading decision detail...",
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
    updatingRules: "Checking services...",
    regulationUpdated: "Regulation knowledge updated.",
    source: "Source",
    openSource: "Open source",
    manualRegulation: "Manual rule upload / input",
    manualTitle: "Rule name",
    manualCitation: "Number / citation",
    manualFocus: "Rule summary",
    manualSourceUrl: "Source link",
    manualPdfUrl: "Official PDF link (optional)",
    manualContent: "Notes or short excerpt",
    uploadManualRule: "Upload rule text file",
    saveManualRule: "Save manual rule",
    savingManualRule: "Saving rule...",
    regulationHelp: "Manage the regulation RAG chatbot, source refresh, list import, and stored rule cards.",
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
    regulationBotTitle: "Regulatory RAG Bot",
    regulationBotIntro: "Ask regulations with visible source context, status notes, and usage limits.",
    regulationQuestion: "Regulation question",
    regulationQuestionPlaceholder: "Example: which rules govern transfer pricing documentation and the arm's length principle?",
    askRegulationBot: "Send question",
    askingRegulationBot: "Reviewing regulations...",
    regulationBotAnswer: "Source-grounded answer",
    noRegulationBotAnswer: "Start with a specific question. The bot will show an answer, sources, and context limits.",
    bulkRegulationUpload: "Upload regulation list Excel/CSV",
    bulkRegulationHint: "Flexible columns: Peraturan/title, Judul/Substansi Utama/focus, Kegunaan Praktis/content, Status, Sumber Resmi/sourceUrl/link, topic, relevance.",
    importingRegulations: "Importing regulations...",
    importedRegulations: "regulation(s) imported/updated.",
    enrichSources: "Fetch & index official PDFs",
    enrichingSources: "Fetching and reviewing PDFs...",
    enrichRuleSource: "Index official PDF",
    sourceEnriched: "regulation(s) fetched and indexed from official repositories.",
    noRulesWithSource: "No regulations with official repository links are available for processing.",
    regulationTabBot: "RAG Chatbot",
    regulationTabUpdate: "Update & Import",
    regulationTabList: "Stored rules",
    regulationTabManual: "Manual input",
    regulationUpdateTitle: "Update regulation knowledge",
    regulationUpdateIntro: "Import a regulation list, then fetch PDFs from JDIH BPK, JDIH Ministry of Finance, DGT, or another official repository for RAG indexing.",
    editRule: "Edit",
    deleteRule: "Delete",
    updateRule: "Update rule",
    cancelEdit: "Cancel edit",
    cannotDeleteSeed: "Seed regulations cannot be deleted from the database. Edit/save a manual copy if needed.",
    smartChatTitle: "Dispute Analysis",
    smartChatIntro: "Ask RAG or find similar cases from narrative/PDF.",
    disputeTabChat: "RAG Chatbot",
    disputeTabSimilar: "Similar case search",
    smartQuestion: "Question",
    smartQuestionPlaceholder: "Example: For a transfer pricing dispute on related-party services, how many decisions were won or lost and what rules are relevant?",
    smartMode: "Answer source",
    smartModeAll: "Decisions + Regulations",
    smartModeDecisions: "Decisions only",
    smartModeRegulations: "Regulations only",
    askSmartChat: "Ask Dispute Analysis",
    askingSmartChat: "Retrieving RAG context and answering...",
    smartAnswer: "Answer",
    smartCharts: "Visualization",
    retrievedDecisions: "RAG decision sources",
    retrievedRules: "RAG regulation sources",
    retrievalSummary: "Retrieval summary",
    noSmartAnswer: "Ask a question to see an answer, RAG sources, and visualizations when relevant.",
    openReference: "Open reference",
    loginTitle: "Sign in to RSM Tax Dispute Agentic Advisor",
    loginSubtitle: "Admins manage the system; users focus on analysis and chat.",
    username: "Username",
    password: "Password",
    signIn: "Sign in",
    adminLogin: "Admin",
    userLogin: "User",
    loginError: "Username or password does not match.",
    signedInAs: "Signed in as",
    logout: "Log out",
    roleAdmin: "Admin",
    roleUser: "User",
    quickStart: "Quick Start",
    quickChat: "Open Dispute Analysis",
    quickAdmin: "Manage database and regulations",
    openAction: "Open",
    workspace: "Workspace",
    commandCenter: "Command Center",
    activeRole: "Active role",
    dataMode: "Data mode",
    aiRuntime: "AI runtime",
    aiRuntimeHint: "Mini balanced, Nano fast, Local offline, On-prem private.",
    modelMini: "Mini",
    modelMiniHint: "Balanced",
    modelNano: "Nano",
    modelNanoHint: "Fast",
    modelLocal: "Local",
    modelLocalHint: "Rules",
    modelOnPrem: "On-prem",
    modelOnPremHint: "Private",
    aiModelTitle: "AI model",
    aiProvider: "AI provider",
    aiProviderOpenAI: "OpenAI / compatible (cloud/API)",
    aiProviderOllama: "Ollama / local on-premise",
    aiProviderRules: "Local rules / no LLM",
    aiModelOpenAI: "OpenAI model",
    aiModelLocal: "Local model",
    aiApiBaseUrl: "API address (Base URL)",
    aiGoodFor: "Good for",
    aiNote: "Note",
    aiRecommendation: "Recommendation",
    aiRuntimeLocked: "Production model details and endpoints are read from server environment variables.",
    aiInstalled: "Available",
    aiEnvOnly: "Server env",
    aiVariation: "Answer variation",
    aiContextCapacity: "Context capacity",
    aiTextLimit: "Text limit per process",
    workspaceSignal: "Knowledge signal",
    liveWorkspace: "Live database",
    localWorkspace: "Local first",
    indexedHelper: "Decision corpus",
    coverageHelper: "Extracted files",
    vatDocsHelper: "VAT/TP tags",
    localRulesHelper: "Rule knowledge",
    llmLabelsHelper: "Structured labels",
    theme: "Theme",
    lightMode: "Light",
    darkMode: "Dark",
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
    casePageLink: "Page",
    adminTitle: "Admin Center",
    adminIntro: "Manage users, logs, privacy, and API readiness.",
    adminLogs: "Activity logs",
    adminUsers: "User management",
    adminPrivacy: "Privacy & access",
    adminCheckApi: "Settings",
    privacyTitle: "Access & privacy controls",
    privacyIntro: "Roles set permissions. Access plans set features and monthly limits.",
    subscriptionTier: "Access plan",
    tierSilver: "Silver",
    tierGold: "Gold",
    tierPlatinum: "Platinum",
    tierDocuments: "Monthly document limit",
    tierChats: "Monthly chatbot question limit",
    unlimited: "Unlimited",
    accessMatrix: "Access matrix",
    securityControls: "Active controls",
    saasReadiness: "Production readiness",
    featureLabel: "Feature",
    allowed: "Yes",
    blocked: "No",
    analysisDepth: "Analysis depth",
    regulationDepth: "Regulation depth",
    comparableDepth: "Decision analysis",
    reportDepth: "Report output",
    ruleIntakeStrategy: "New-rule intake",
    privacySilverDesc: "Simple analysis and report drafting.",
    privacyGoldDesc: "Advisor teams with database access.",
    privacyPlatinumDesc: "Full controls, admin, and integrations.",
    activityLogs: "Application activity logs",
    noActivityLogs: "No activity logs yet.",
    refresh: "Refresh",
    logAction: "Action",
    logTarget: "Target",
    logStatus: "Status",
    logDetail: "Detail",
    logActor: "Actor",
    logTime: "Time",
    userManagement: "User management",
    addOrUpdateUser: "Add / update user",
    managedUsers: "Managed users",
    displayName: "Display name",
    userStatus: "User status",
    active: "Active",
    inactive: "Inactive",
    saveUser: "Save user",
    resetForm: "Reset form",
    deleteUser: "Delete user",
    editUser: "Edit user",
    cannotDeleteSelf: "The signed-in user cannot be deleted.",
    userSaved: "User saved.",
    userDeleted: "User deleted.",
    apiCheck: "API & integrations",
    runApiCheck: "Run check",
    apiCheckIntro: "Check OpenAI, Blob, database, and core tables.",
    lastChecked: "Last checked",
    okStatus: "OK",
    warningStatus: "Warning",
    errorStatus: "Error",
    openHealthPage: "Open health page"
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

function RsmTaxBotMark() {
  return (
    <div className="rsm-taxbot-mark" aria-label="RSM TaxBot">
      <span className="rsm-taxbot-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="rsm-taxbot-wordmark">
        <strong>RSM</strong>
        <small>TaxBot</small>
      </span>
      <span className="rsm-taxbot-signal" aria-hidden="true" />
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

type AppIconName =
  | "admin"
  | "collapse"
  | "dashboard"
  | "database"
  | "expand"
  | "guided"
  | "info"
  | "logout"
  | "moon"
  | "regulations"
  | "reports"
  | "smartchat"
  | "sun"
  | "user";

function AppIcon({ name }: { name: AppIconName }) {
  const paths: Record<AppIconName, ReactNode> = {
    admin: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V20h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.1-2.1.1-.1A1.7 1.7 0 0 0 7 14.6a1.7 1.7 0 0 0-1.5-1H5v-3h.5A1.7 1.7 0 0 0 7 9.6a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.1-2.1.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4h3v.4a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.1 2.1-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v3h-.1a1.7 1.7 0 0 0-1.5 1.4Z" /></>,
    collapse: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m8-5-3-3 3-3" /></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
    expand: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m5-5 3-3-3-3" /></>,
    guided: <><path d="M9 5h11M9 12h11M9 19h11" /><path d="m3.5 5 1.2 1.2L7 3.8m-3.5 8.1 1.2 1.2L7 10.7m-3.5 8.1L4.7 20 7 17.6" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
    logout: <><path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5" /><path d="m15 16 4-4-4-4m4 4H9" /></>,
    moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
    regulations: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H20v17H7.5A3.5 3.5 0 0 0 4 22V5.5Z" /><path d="M4 18.5A3.5 3.5 0 0 1 7.5 15H20M8 6h8M8 10h7" /></>,
    reports: <><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></>,
    smartchat: <><path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12Z" /><path d="M8 12h8M10 8h4" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>
  };

  return <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const pageIcons: Record<PageKey, AppIconName> = {
  dashboard: "dashboard",
  guided: "guided",
  database: "database",
  smartchat: "smartchat",
  regulations: "regulations",
  reports: "reports",
  admin: "admin"
};

function ThemeToggle({
  labels,
  value,
  onChange,
  compact = false,
  iconOnly = false
}: {
  labels: (typeof copy)["en"];
  value: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  compact?: boolean;
  iconOnly?: boolean;
}) {
  return (
    <div className={`theme-toggle ${compact ? "compact" : ""} ${iconOnly ? "icon-only" : ""}`} role="group" aria-label={labels.theme}>
      <button type="button" className={value === "light" ? "active" : ""} onClick={() => onChange("light")} aria-label={labels.lightMode} title={labels.lightMode}>
        {iconOnly ? <AppIcon name="sun" /> : labels.lightMode}
      </button>
      <button type="button" className={value === "dark" ? "active" : ""} onClick={() => onChange("dark")} aria-label={labels.darkMode} title={labels.darkMode}>
        {iconOnly ? <AppIcon name="moon" /> : labels.darkMode}
      </button>
    </div>
  );
}

function modelRuntimeCopy(labels: (typeof copy)["en"], choice: LlmModelChoice) {
  if (choice === "openai-nano") return { label: labels.modelNano, hint: labels.modelNanoHint };
  if (choice === "local-rules") return { label: labels.modelLocal, hint: labels.modelLocalHint };
  if (choice === "local-onprem") return { label: labels.modelOnPrem, hint: labels.modelOnPremHint };
  return { label: labels.modelMini, hint: labels.modelMiniHint };
}

type AiProviderChoice = "openai" | "ollama" | "rules";

function modelProviderFromChoice(choice: LlmModelChoice): AiProviderChoice {
  if (choice === "local-onprem") return "ollama";
  if (choice === "local-rules") return "rules";
  return "openai";
}

function ModelRuntimePanel({
  labels,
  value,
  onChange
}: {
  labels: (typeof copy)["en"];
  value: LlmModelChoice;
  onChange: (value: LlmModelChoice) => void;
}) {
  const isEnglish = labels.signIn === "Sign in";
  const provider = modelProviderFromChoice(value);
  const active = modelRuntimeCopy(labels, value);
  const providerOptions: Array<{ value: AiProviderChoice; label: string }> = [
    { value: "openai", label: labels.aiProviderOpenAI },
    { value: "ollama", label: labels.aiProviderOllama },
    { value: "rules", label: labels.aiProviderRules }
  ];
  const summaries: Record<LlmModelChoice, { title: string; badge: string; goodFor: string; note: string }> = {
    "openai-mini": {
      title: isEnglish ? "Balanced cloud" : "Cloud hemat-akurat",
      badge: "API",
      goodFor: isEnglish
        ? "metadata extraction, summaries, classification, and normal report drafts."
        : "ekstraksi metadata, ringkasan, klasifikasi, dan draft laporan umum.",
      note: isEnglish
        ? "Default for stable demos and advisor-quality output."
        : "Default untuk demo stabil dan kualitas jawaban advisor."
    },
    "openai-nano": {
      title: isEnglish ? "Fast cloud" : "Cloud cepat-hemat",
      badge: "API",
      goodFor: isEnglish ? "cheap triage, short labels, and high-volume quick checks." : "triase murah, label pendek, dan cek cepat volume tinggi.",
      note: isEnglish ? "Use mini again for harder reasoning." : "Gunakan mini lagi untuk penalaran yang lebih sulit."
    },
    "local-rules": {
      title: isEnglish ? "Offline rules" : "Rules lokal",
      badge: "Offline",
      goodFor: isEnglish ? "safe fallback, scoring demo, and deterministic local analysis." : "fallback aman, demo scoring, dan analisis lokal deterministik.",
      note: isEnglish ? "No external AI call is made." : "Tidak ada panggilan AI eksternal."
    },
    "local-onprem": {
      title: isEnglish ? "Private endpoint" : "Endpoint privat",
      badge: "Private",
      goodFor: isEnglish ? "on-premise deployments with OpenAI-compatible local gateways." : "deployment on-premise dengan gateway lokal kompatibel OpenAI.",
      note: isEnglish ? "Configure TDP_LOCAL_LLM_URL and TDP_LOCAL_LLM_MODEL on the server." : "Atur TDP_LOCAL_LLM_URL dan TDP_LOCAL_LLM_MODEL di server."
    }
  };
  const summary = summaries[value];
  const baseUrlValue =
    provider === "openai" ? "https://api.openai.com/v1" : provider === "ollama" ? "TDP_LOCAL_LLM_URL" : "local-rules";
  const localModelValue = provider === "ollama" ? "TDP_LOCAL_LLM_MODEL / local-tax-dispute" : "local-rules";
  const presetCards: Array<{ choice: LlmModelChoice; title: string; subtitle: string; badge: string }> = [
    {
      choice: "openai-mini",
      title: "gpt-5.4-mini",
      subtitle: isEnglish ? "Balanced cloud" : "Cloud hemat-akurat",
      badge: "API"
    },
    {
      choice: "openai-nano",
      title: "gpt-5.4-nano",
      subtitle: isEnglish ? "Lowest-cost cloud" : "Cloud paling hemat",
      badge: "API"
    },
    {
      choice: "local-rules",
      title: isEnglish ? "Local rules" : "Rules lokal",
      subtitle: isEnglish ? "Offline fallback" : "Fallback offline",
      badge: "Offline"
    },
    {
      choice: "local-onprem",
      title: isEnglish ? "On-prem endpoint" : "Endpoint on-prem",
      subtitle: isEnglish ? "Private compatible API" : "API privat kompatibel",
      badge: "Private"
    }
  ];
  const localCandidates = [
    { name: "qwen3:8b", size: "~5.2GB", hint: isEnglish ? "accurate local default" : "default lokal akurat" },
    { name: "qwen3:4b", size: "~2.5GB", hint: isEnglish ? "small-machine friendly" : "hemat untuk mesin kecil" },
    { name: "qwen3-vl:8b", size: "~6.1GB", hint: isEnglish ? "document vision" : "vision dokumen" },
    { name: "deepseek-ocr", size: "~6.7GB", hint: isEnglish ? "OCR experiment" : "eksperimen OCR" }
  ];

  const changeProvider = (nextProvider: AiProviderChoice) => {
    if (nextProvider === "openai") onChange(value === "openai-nano" ? "openai-nano" : "openai-mini");
    if (nextProvider === "ollama") onChange("local-onprem");
    if (nextProvider === "rules") onChange("local-rules");
  };

  return (
    <section className="model-ai-panel" aria-label={labels.aiModelTitle}>
      <div className="model-ai-panel-head">
        <div>
          <span>{labels.aiModelTitle}</span>
          <p>{labels.aiRuntimeLocked}</p>
        </div>
        <b>{active.label} · {active.hint}</b>
      </div>

      <label className="model-ai-field model-ai-field-full">
        <span>{labels.aiProvider}</span>
        <select value={provider} onChange={(event) => changeProvider(event.target.value as AiProviderChoice)}>
          {providerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="model-ai-form-row">
        <label className="model-ai-field">
          <span>{provider === "openai" ? labels.aiModelOpenAI : labels.aiModelLocal}</span>
          {provider === "openai" ? (
            <select value={value === "openai-nano" ? "openai-nano" : "openai-mini"} onChange={(event) => onChange(event.target.value as LlmModelChoice)}>
              <option value="openai-mini">gpt-5.4-mini - {isEnglish ? "balanced cloud" : "cloud hemat-akurat"}</option>
              <option value="openai-nano">gpt-5.4-nano - {isEnglish ? "fast low-cost cloud" : "cloud cepat-hemat"}</option>
            </select>
          ) : (
            <input value={localModelValue} readOnly />
          )}
        </label>
        <label className="model-ai-field">
          <span>{labels.aiApiBaseUrl}</span>
          <input value={baseUrlValue} readOnly />
        </label>
      </div>

      <article className={`model-ai-summary ${value}`}>
        <div>
          <strong>{summary.title}</strong>
          <small>{summary.badge}</small>
        </div>
        <p>
          <b>{labels.aiGoodFor}:</b> {summary.goodFor}
        </p>
        <p>
          <b>{labels.aiNote}:</b> {summary.note}
        </p>
      </article>

      <div className="model-ai-preset-grid" role="group" aria-label={labels.aiRuntime}>
        {presetCards.map((card) => (
          <button key={card.choice} type="button" className={value === card.choice ? "active" : ""} onClick={() => onChange(card.choice)}>
            <span>{card.title}</span>
            <small>{card.subtitle}</small>
            <i>{card.badge}</i>
          </button>
        ))}
      </div>

      {provider === "ollama" && (
        <div className="model-ai-local-block">
          <div className="model-ai-installed">OK {isEnglish ? "Local endpoint mode is selected." : "Mode endpoint lokal sudah dipilih."}</div>
          <div className="model-ai-candidate-grid" aria-label={labels.aiProviderOllama}>
            {localCandidates.map((candidate) => (
              <article key={candidate.name}>
                <div>
                  <b>{candidate.name}</b>
                  <span>{candidate.size}</span>
                </div>
                <p>{candidate.hint}</p>
                <small>{labels.aiEnvOnly}</small>
              </article>
            ))}
          </div>
        </div>
      )}

      <p className="model-ai-recommendation">
        {labels.aiRecommendation}:{" "}
        {isEnglish
          ? "use mini for dependable cloud work, nano for cheap volume, local rules for offline demos, and on-prem when client data must stay private."
          : "pakai mini untuk cloud yang stabil, nano untuk volume murah, local rules untuk demo offline, dan on-prem saat data klien harus tetap privat."}
      </p>

      <div className="model-ai-params">
        <label>
          <span>{labels.aiVariation}</span>
          <input value="0" readOnly />
          <small>{isEnglish ? "0 = stable and consistent" : "0 = stabil dan konsisten"}</small>
        </label>
        <label>
          <span>{labels.aiContextCapacity}</span>
          <input value="8192" readOnly />
          <small>{isEnglish ? "tokens readable by the active model" : "token yang bisa dibaca model"}</small>
        </label>
        <label>
          <span>{labels.aiTextLimit}</span>
          <input value="12000" readOnly />
          <small>{isEnglish ? "characters per AI request" : "karakter per panggilan AI"}</small>
        </label>
      </div>
    </section>
  );
}

function LoginScreen({
  language,
  labels,
  themeMode,
  role,
  username,
  password,
  error,
  onLanguageChange,
  onThemeChange,
  onRoleChange,
  onUsernameChange,
  onPasswordChange,
  onSubmit
}: {
  language: Language;
  labels: (typeof copy)["en"];
  themeMode: ThemeMode;
  role: UserRole;
  username: string;
  password: string;
  error: string;
  onLanguageChange: (language: Language) => void;
  onThemeChange: (mode: ThemeMode) => void;
  onRoleChange: (role: UserRole) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <main className={`login-shell theme-${themeMode}`}>
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
          <label className="field-label theme-field-label">{labels.theme}</label>
          <ThemeToggle labels={labels} value={themeMode} onChange={onThemeChange} />
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

function loadStoredReports(): StoredReport[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORED_REPORTS_KEY);
    return raw ? (JSON.parse(raw) as StoredReport[]) : [];
  } catch {
    return [];
  }
}

function saveStoredReports(items: StoredReport[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORED_REPORTS_KEY, JSON.stringify(items));
}

function loadAppSession(): AppSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(APP_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppSession;
    if (parsed.role !== "admin" && parsed.role !== "user") return null;
    return {
      ...parsed,
      tier: normalizeSubscriptionTier(parsed.tier, parsed.role)
    };
  } catch {
    return null;
  }
}

function saveAppSession(session: AppSession | null) {
  if (typeof window === "undefined") return;
  if (!session) {
    window.localStorage.removeItem(APP_SESSION_KEY);
    return;
  }
  window.localStorage.setItem(APP_SESSION_KEY, JSON.stringify(session));
}

function mergeManagedUsers(users: ManagedUser[]) {
  const byUsername = new Map<string, ManagedUser>();
  users.forEach((user) => {
    const username = normalizeUsername(user.username);
    if (!username) return;
    byUsername.set(username, normalizeUserForClient({ ...user, username }));
  });
  seedUsers.forEach((user) => {
    const username = normalizeUsername(user.username);
    if (!username || byUsername.has(username)) return;
    byUsername.set(username, { ...user, username });
  });
  return Array.from(byUsername.values()).sort((a, b) => `${a.role}-${a.tier}-${a.username}`.localeCompare(`${b.role}-${b.tier}-${b.username}`));
}

function loadManagedUsers(): ManagedUser[] {
  if (typeof window === "undefined") return seedUsers;
  try {
    const raw = window.localStorage.getItem(ADMIN_USERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as ManagedUser[]) : [];
    return mergeManagedUsers(Array.isArray(parsed) ? parsed : []);
  } catch {
    return seedUsers;
  }
}

function saveManagedUsers(users: ManagedUser[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ADMIN_USERS_KEY, JSON.stringify(mergeManagedUsers(users)));
}

function loadActivityLogs(): ActivityLog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ACTIVITY_LOGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as ActivityLog[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 200) : [];
  } catch {
    return [];
  }
}

function saveActivityLogs(logs: ActivityLog[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVITY_LOGS_KEY, JSON.stringify(logs.slice(0, 200)));
}

function createBlankUser(role: UserRole = "user"): ManagedUser {
  const now = new Date().toISOString();
  return {
    id: "",
    username: "",
    password: "",
    name: "",
    role,
    tier: defaultTierForRole(role),
    status: "active",
    createdAt: now,
    updatedAt: now
  };
}

function tierLabel(tier: SubscriptionTier) {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function normalizeUserForClient(user: ManagedUser): ManagedUser {
  const role = user.role === "admin" ? "admin" : "user";
  return {
    ...user,
    role,
    tier: normalizeSubscriptionTier(user.tier, role)
  };
}

function normalizeSessionForClient(session: AppSession): AppSession {
  const role = session.role === "admin" ? "admin" : "user";
  return {
    ...session,
    role,
    tier: normalizeSubscriptionTier(session.tier, role)
  };
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
type RegulationImportCell = string | number | boolean | null | undefined;

function normalizeImportHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function regulationHeaderScore(cells: RegulationImportCell[]) {
  const headers = cells.map((cell) => normalizeImportHeader(String(cell || ""))).filter(Boolean);
  const includesAny = (patterns: string[]) => patterns.some((pattern) => headers.some((header) => header === pattern || header.includes(pattern)));
  return (
    (includesAny(["peraturan", "title", "judul", "nama_aturan"]) ? 5 : 0) +
    (includesAny(["substansi", "focus", "summary", "ringkasan", "kegunaan_praktis"]) ? 4 : 0) +
    (includesAny(["sumber_resmi", "source_url", "official_source", "link"]) ? 3 : 0) +
    (includesAny(["citation", "sitasi", "nomor", "jenis_peraturan"]) ? 2 : 0) +
    (includesAny(["status", "kelompok", "topic", "topik", "prioritas"]) ? 1 : 0)
  );
}

function regulationRowsFromMatrix(matrix: RegulationImportCell[][]): RegulationImportRow[] {
  if (!matrix.length) return [];
  const candidateRows = matrix.slice(0, Math.min(40, matrix.length));
  let headerIndex = 0;
  let bestScore = -1;
  candidateRows.forEach((cells, index) => {
    const score = regulationHeaderScore(cells);
    if (score > bestScore) {
      bestScore = score;
      headerIndex = index;
    }
  });
  if (bestScore < 5) headerIndex = 0;

  const headers = (matrix[headerIndex] || []).map((cell, index) => normalizeImportHeader(String(cell || `column_${index + 1}`)));
  return matrix.slice(headerIndex + 1).reduce<RegulationImportRow[]>((records, cells) => {
    const record = headers.reduce<RegulationImportRow>((row, header, index) => {
      if (header) row[header] = cells[index] ?? "";
      return row;
    }, {});
    if (Object.values(record).some((value) => String(value ?? "").trim())) records.push(record);
    return records;
  }, []);
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
  return regulationRowsFromMatrix(rows);
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
    rowValue(row, ["title", "name", "nama", "judul", "rule_name", "nama_aturan", "peraturan"]),
    rowValue(row, ["focus", "summary", "ringkasan", "judul_substansi_utama", "substansi_utama", "kegunaan_praktis", "deskripsi_singkat", "deskripsi", "description"]),
    rowValue(row, ["citation", "number", "nomor", "sitasi", "jenis_peraturan", "peraturan", "relasi_perubahan_penting"])
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
  return rowValue(row, ["citation", "sitasi", "nomor_sitasi", "peraturan", "nama_peraturan", "aturan"]);
}

function rowRegulation(row: RegulationImportRow, index: number): Regulation | null {
  const title = rowValue(row, ["title", "name", "nama", "judul", "rule_name", "nama_aturan", "peraturan", "nama_peraturan", "aturan"]);
  const citation = buildRegulationCitation(row);
  const focus = rowValue(row, [
    "focus",
    "summary",
    "ringkasan",
    "fungsi",
    "judul_substansi_utama",
    "substansi_utama",
    "kegunaan_praktis",
    "description",
    "deskripsi",
    "deskripsi_singkat",
    "uraian"
  ]);
  if (!title || !citation || !focus) return null;
  const topic = inferRegulationTopic(row);
  const relevance = Number(rowValue(row, ["relevance", "relevansi", "score", "skor"]) || 75);
  const effectiveDate = rowValue(row, ["tanggal_berlaku", "berlaku", "effective_date", "tanggal"]);
  const status = rowValue(row, ["status", "status_per_20_juli_2026", "status_terakhir", "status_berlaku"]);
  const relation = rowValue(row, ["relasi_perubahan_penting", "relasi", "perubahan", "amendment", "relationship"]);
  const sourceNotes = rowValue(row, ["citations", "citation_notes", "source_notes", "catatan_sumber", "catatan_database"]);
  const practicalUse = rowValue(row, ["kegunaan_praktis", "practical_use", "use_case"]);
  const content = [
    rowValue(row, ["content", "notes", "catatan", "kutipan", "excerpt"]),
    practicalUse && practicalUse !== focus ? `Kegunaan praktis: ${practicalUse}` : "",
    status ? `Status: ${status}` : "",
    relation ? `Relasi/perubahan penting: ${relation}` : "",
    effectiveDate ? `Tanggal berlaku/relevansi waktu: ${effectiveDate}` : "",
    sourceNotes ? `Referensi/catatan: ${sourceNotes}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  return {
    id: rowValue(row, ["id"]) || `manual-${topic}-${safeDomId(`${citation}-${title}`) || index + 1}`.toLowerCase(),
    topic,
    title,
    citation,
    focus,
    relevance: Number.isFinite(relevance) ? Math.max(1, Math.min(100, relevance)) : 75,
    source: /^https?:\/\//i.test(rowValue(row, ["source_url", "sourceUrl", "url", "link", "link_sumber", "source", "sumber", "sumber_resmi", "official_source"]))
      ? "official"
      : "manual",
    sourceUrl: rowValue(row, ["source_url", "sourceUrl", "url", "link", "link_sumber", "source", "sumber", "sumber_resmi", "official_source"]),
    pdfUrl: rowValue(row, ["pdf_url", "pdf", "link_pdf", "url_pdf", "download_url", "tautan_pdf"]),
    content: content || focus,
    updatedAt: new Date(Date.now() + index).toISOString()
  };
}

function extractionCompleteness(extraction: ExtractionResult | null | undefined) {
  if (!extraction) return 0;
  const summaryScore = Number((extraction as ExtractionResult & { extractionCompleteness?: number }).extractionCompleteness);
  if (Number.isFinite(summaryScore) && summaryScore >= 0) return Math.round(summaryScore);
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
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [modelChoice, setModelChoice] = useState<LlmModelChoice>(DEFAULT_LLM_MODEL_CHOICE);
  const [runtimeSettings, setRuntimeSettings] = useState<AdminRuntimeSettings>(() => defaultAdminRuntimeSettings());
  const [session, setSession] = useState<AppSession | null>(null);
  const [adminPreviewTier, setAdminPreviewTier] = useState<SubscriptionTier>("platinum");
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>(() => loadManagedUsers());
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(() => loadActivityLogs());
  const [adminTab, setAdminTab] = useState<AdminTabKey>("logs");
  const [adminStatus, setAdminStatus] = useState("");
  const [adminError, setAdminError] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [userForm, setUserForm] = useState<ManagedUser>(() => createBlankUser());
  const [editingUserId, setEditingUserId] = useState("");
  const [systemChecks, setSystemChecks] = useState<SystemCheck[]>([]);
  const [systemCounts, setSystemCounts] = useState<Record<string, number>>({});
  const [systemCheckedAt, setSystemCheckedAt] = useState("");
  const [loginRole, setLoginRole] = useState<UserRole>("admin");
  const [loginUsername, setLoginUsername] = useState(DEFAULT_USER_BY_ROLE.admin.username);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [page, setPage] = useState<PageKey>("smartchat");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const [reportStatus, setReportStatus] = useState("");
  const [storedReports, setStoredReports] = useState<StoredReport[]>(() => loadStoredReports());
  const [hydratingReportId, setHydratingReportId] = useState("");
  const [selectedReportId, setSelectedReportId] = useState("");
  const [activeReportId, setActiveReportId] = useState("");
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
  const [regulationTopic, setRegulationTopic] = useState<RegulationTopicFilter>("all");
  const [regulationSourceScope, setRegulationSourceScope] = useState<RegulationSourceScope>("all");
  const [regulationStatus, setRegulationStatus] = useState("");
  const [regulationError, setRegulationError] = useState("");
  const [regulationTab, setRegulationTab] = useState<RegulationTabKey>("bot");
  const [manualRule, setManualRule] = useState({
    title: "",
    citation: "",
    focus: "",
    sourceUrl: "",
    pdfUrl: "",
    content: ""
  });
  const [manualRuleSaving, setManualRuleSaving] = useState(false);
  const [regulationPage, setRegulationPage] = useState(1);
  const [regulationPerPage, setRegulationPerPage] = useState(6);
  const [editingRegulationId, setEditingRegulationId] = useState("");
  const [deletingRegulationId, setDeletingRegulationId] = useState("");
  const [regulationImportLoading, setRegulationImportLoading] = useState(false);
  const [sourceEnrichLoading, setSourceEnrichLoading] = useState(false);
  const [enrichingRegulationId, setEnrichingRegulationId] = useState("");
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
  const effectiveTier = session?.role === "admin" ? adminPreviewTier : (session?.tier || "silver");
  const effectiveAccessRole: UserRole = session?.role === "admin" ? "user" : (session?.role || "user");
  const requestPreviewTier = session?.role === "admin" ? adminPreviewTier : undefined;
  const localAnalysis = useMemo(() => buildAnalysis({ ...form, language }, extraction), [form, language, extraction]);
  const analysis = serverAnalysis ?? localAnalysis;
  const currentReportKey = useMemo(
    () => buildReportKey({ ...form, language }, extraction, modelChoice, effectiveTier),
    [effectiveTier, form, language, extraction, modelChoice]
  );
  const reusableReport = useMemo(
    () => storedReports.find((report) => report.language === language && report.reportKey === currentReportKey) || null,
    [storedReports, language, currentReportKey]
  );
  const selectedReport = useMemo(
    () => storedReports.find((report) => report.id === selectedReportId) || storedReports[0] || null,
    [storedReports, selectedReportId]
  );
  const dynamicDashboard = useMemo(() => buildDynamicDashboard(storedDocuments, language, regulationRecords.length), [storedDocuments, language, regulationRecords.length]);
  const visibleRegulations = useMemo(
    () => filterRegulationsByTopic(regulationRecords, regulationTopic).filter((record) => regulationSourceMatches(record.sourceUrl, regulationSourceScope)),
    [regulationRecords, regulationSourceScope, regulationTopic]
  );
  const regulationTotalPages = Math.max(1, Math.ceil(visibleRegulations.length / regulationPerPage));
  const currentRegulationPage = Math.min(regulationPage, regulationTotalPages);
  const pagedRegulations = useMemo(
    () => visibleRegulations.slice((currentRegulationPage - 1) * regulationPerPage, currentRegulationPage * regulationPerPage),
    [visibleRegulations, currentRegulationPage, regulationPerPage]
  );
  const pages: Array<[PageKey, string]> = [
    ["dashboard", labels.dashboard],
    ["guided", labels.guided],
    ["database", labels.database],
    ["smartchat", labels.smartchat],
    ["regulations", labels.regulations],
    ["reports", labels.reports]
  ];
  const visiblePages = pages.filter(([key]) => (session ? canAccessPage(effectiveAccessRole, effectiveTier, key, runtimeSettings.plans) : false));

  useEffect(() => {
    try {
      const storedTheme = window.localStorage.getItem(THEME_MODE_KEY);
      if (storedTheme === "light" || storedTheme === "dark") {
        setThemeMode(storedTheme);
      }
    } catch {
      // Theme persistence is optional; the UI still works with the default mode.
    }
  }, []);

  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
    } catch {
      // Sidebar persistence is optional.
    }
  }, []);

  useEffect(() => {
    try {
      setModelChoice(normalizeModelChoice(window.localStorage.getItem(MODEL_CHOICE_STORAGE_KEY)));
    } catch {
      // Model preference is optional; server-side allow-list still protects requests.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadServerSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as { session?: AppSession | null };
        if (cancelled) return;
        if (data.session) {
          const nextSession = normalizeSessionForClient(data.session);
          setSession(nextSession);
          saveAppSession(nextSession);
        } else {
          setSession(null);
          saveAppSession(null);
        }
      } catch {
        if (!cancelled) {
          setSession(null);
          saveAppSession(null);
        }
      }
    }
    loadServerSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function loadRuntimeSettings() {
      try {
        const endpoint = session?.role === "admin" ? "/api/admin/settings" : "/api/settings";
        const response = await fetch(endpoint, { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as {
          settings?: AdminRuntimeSettings;
          plans?: AdminRuntimeSettings["plans"];
          updatedAt?: string;
        };
        if (!response.ok || cancelled) return;
        if (data.settings) setRuntimeSettings(data.settings);
        else if (data.plans) setRuntimeSettings((current) => ({ ...current, plans: data.plans!, updatedAt: data.updatedAt || current.updatedAt }));
      } catch {
        // Built-in access and prompt defaults remain active when settings cannot be loaded.
      }
    }
    void loadRuntimeSettings();
    return () => {
      cancelled = true;
    };
  }, [session?.role, session?.username]);

  useEffect(() => {
    if (!session || !canAccessPage(session.role, session.tier, "database", runtimeSettings.plans)) return;
    let cancelled = false;
    async function loadDatabaseDocuments() {
      try {
        const response = await fetch("/api/decisions?perPage=1000");
        if (!response.ok) return;
        const data = (await response.json()) as { records?: StoredDecisionFile[] };
        if (!cancelled && Array.isArray(data.records)) {
          setStoredDocuments(data.records);
          saveStoredDecisions(data.records);
        }
      } catch {
        // Local browser cache remains available until database connectivity is available.
      }
    }
    loadDatabaseDocuments();
    return () => {
      cancelled = true;
    };
  }, [runtimeSettings.plans, session?.username, session?.role, session?.tier]);

  useEffect(() => {
    if (!session || !canAccessPage(session.role, session.tier, "reports", runtimeSettings.plans)) return;
    let cancelled = false;
    async function loadReportDatabase() {
      try {
        const response = await fetch("/api/reports?perPage=200");
        if (!response.ok) return;
        const data = (await response.json()) as { records?: StoredReport[] };
        if (!cancelled && Array.isArray(data.records)) {
          const next = data.records.length ? data.records : loadStoredReports();
          setStoredReports(next);
          saveStoredReports(next);
          if (!selectedReportId && next[0]) {
            setSelectedReportId(next[0].id);
            void hydrateStoredReport(next[0].id);
          }
        }
      } catch {
        // Local browser cache remains available until database connectivity is available.
      }
    }
    loadReportDatabase();
    return () => {
      cancelled = true;
    };
  }, [runtimeSettings.plans, session?.username, session?.role, session?.tier]);

  useEffect(() => {
    if (session && page !== "admin" && !canAccessPage(effectiveAccessRole, effectiveTier, page, runtimeSettings.plans)) {
      setPage("smartchat");
    }
  }, [effectiveAccessRole, effectiveTier, page, runtimeSettings.plans, session]);

  useEffect(() => {
    if (session?.role !== "admin" && (regulationTab === "update" || regulationTab === "manual")) {
      setRegulationTab("bot");
    }
  }, [regulationTab, session?.role]);

  useEffect(() => {
    if (typeof window === "undefined" || !session) return;
    const targetPage = new URLSearchParams(window.location.search).get("page") as PageKey | null;
    if (targetPage && pages.some(([key]) => key === targetPage) && canAccessPage(effectiveAccessRole, effectiveTier, targetPage, runtimeSettings.plans)) {
      setPage(targetPage);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [effectiveAccessRole, effectiveTier, runtimeSettings.plans, session]);

  useEffect(() => {
    setRegulationPage((current) => Math.min(Math.max(1, current), regulationTotalPages));
  }, [regulationTotalPages]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function loadRegulations() {
      try {
        const response = await fetch("/api/regulations?perPage=500");
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
  }, [session?.username, session?.role]);

  useEffect(() => {
    if (!session || session.role !== "admin") return;
    let cancelled = false;
    async function loadUsers() {
      try {
        const response = await fetch("/api/admin/users");
        if (!response.ok) return;
        const data = (await response.json()) as { records?: ManagedUser[] };
        if (!cancelled && Array.isArray(data.records) && data.records.length) {
          const next = mergeManagedUsers(data.records);
          setManagedUsers(next);
          saveManagedUsers(next);
        }
      } catch {
        // Browser-local users remain available when the admin API is offline.
      }
    }
    loadUsers();
    return () => {
      cancelled = true;
    };
  }, [session?.username, session?.role]);

  useEffect(() => {
    if (!session || session.role !== "admin") return;
    refreshActivityLogs();
    runSystemCheck(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.role]);

  async function recordActivity(
    action: string,
    target: string,
    status: ActivityLog["status"] = "success",
    detail = "",
    actorSession: AppSession | null = session
  ) {
    const log: ActivityLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: new Date().toISOString(),
      actor: actorSession?.name || "Guest",
      role: actorSession?.role || "guest",
      action,
      target,
      status,
      detail
    };
    const next = [log, ...activityLogs].slice(0, 200);
    setActivityLogs(next);
    saveActivityLogs(next);
    try {
      const response = await fetch("/api/admin/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(log)
      });
      const data = (await response.json().catch(() => ({}))) as { records?: ActivityLog[] };
      if (response.ok && Array.isArray(data.records) && data.records.length) {
        setActivityLogs(data.records);
        saveActivityLogs(data.records);
      }
    } catch {
      // Local log remains available when the database is unavailable.
    }
  }

  async function refreshActivityLogs() {
    setAdminError("");
    try {
      const response = await fetch("/api/admin/logs?limit=200");
      const data = (await response.json()) as { records?: ActivityLog[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load activity logs.");
      if (Array.isArray(data.records)) {
        const next = data.records.length ? data.records : loadActivityLogs();
        setActivityLogs(next);
        saveActivityLogs(next);
      }
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not load activity logs.");
    }
  }

  async function refreshManagedUsers() {
    setAdminError("");
    try {
      const response = await fetch("/api/admin/users");
      const data = (await response.json()) as { records?: ManagedUser[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load users.");
      if (Array.isArray(data.records)) {
        const next = mergeManagedUsers(data.records);
        setManagedUsers(next);
        saveManagedUsers(next);
      }
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not load users.");
    }
  }

  async function runSystemCheck(showStatus = true) {
    setAdminLoading(true);
    setAdminError("");
    if (showStatus) setAdminStatus("");
    try {
      const response = await fetch("/api/admin/check", { headers: modelRequestHeaders(modelChoice) });
      const data = (await response.json()) as {
        checks?: SystemCheck[];
        counts?: Record<string, number>;
        generatedAt?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not run API check.");
      setSystemChecks(data.checks || []);
      setSystemCounts(data.counts || {});
      setSystemCheckedAt(data.generatedAt || new Date().toISOString());
      if (showStatus) {
        setAdminStatus(language === "en" ? "API check completed." : "Check API selesai.");
        void recordActivity("API check", "Admin", "success", "System integration check completed.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not run API check.";
      setAdminError(message);
      if (showStatus) void recordActivity("API check", "Admin", "error", message);
    } finally {
      setAdminLoading(false);
    }
  }

  function startEditUser(user: ManagedUser) {
    setEditingUserId(user.id);
    setUserForm(normalizeUserForClient(user));
    setAdminTab("users");
    setAdminStatus("");
    setAdminError("");
  }

  function resetUserForm() {
    setEditingUserId("");
    setUserForm(createBlankUser());
    setAdminError("");
  }

  async function saveUser() {
    setAdminLoading(true);
    setAdminStatus("");
    setAdminError("");
    try {
      const username = normalizeUsername(userForm.username);
      if (!username || (!editingUserId && !userForm.password) || !userForm.name) {
        throw new Error(
          language === "en"
            ? "Username, display name, and password for new users are required."
            : "Username, nama tampilan, dan password untuk user baru wajib diisi."
        );
      }
      const now = new Date().toISOString();
      const user: ManagedUser = {
        ...userForm,
        id: userForm.id || userIdFromUsername(username),
        username,
        tier: normalizeSubscriptionTier(userForm.tier, userForm.role),
        createdAt: userForm.createdAt || now,
        updatedAt: now
      };
      const localNext = mergeManagedUsers([user, ...managedUsers.filter((item) => item.id !== user.id && normalizeUsername(item.username) !== username)]);
      setManagedUsers(localNext);
      saveManagedUsers(localNext);
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user)
      });
      const data = (await response.json().catch(() => ({}))) as { records?: ManagedUser[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save user.");
      if (Array.isArray(data.records)) {
        const next = mergeManagedUsers(data.records);
        setManagedUsers(next);
        saveManagedUsers(next);
      }
      setAdminStatus(labels.userSaved);
      resetUserForm();
      void recordActivity(editingUserId ? "Update user" : "Create user", username, "success", `${user.name} (${user.role}, ${tierLabel(user.tier)})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save user.";
      setAdminError(message);
      void recordActivity("Save user", userForm.username || "unknown", "error", message);
    } finally {
      setAdminLoading(false);
    }
  }

  async function deleteUser(user: ManagedUser) {
    if ((session?.username && normalizeUsername(user.username) === normalizeUsername(session.username)) || user.name === session?.name) {
      setAdminError(labels.cannotDeleteSelf);
      return;
    }
    if (!window.confirm(`${labels.deleteUser}: ${user.name}?`)) return;
    setAdminLoading(true);
    setAdminStatus("");
    setAdminError("");
    try {
      const localNext = managedUsers.filter((item) => item.id !== user.id);
      setManagedUsers(localNext);
      saveManagedUsers(localNext);
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id })
      });
      const data = (await response.json().catch(() => ({}))) as { records?: ManagedUser[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not delete user.");
      if (Array.isArray(data.records)) {
        const next = mergeManagedUsers(data.records);
        setManagedUsers(next);
        saveManagedUsers(next);
      }
      setAdminStatus(labels.userDeleted);
      void recordActivity("Delete user", user.username, "warning", user.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete user.";
      setAdminError(message);
      void recordActivity("Delete user", user.username, "error", message);
    } finally {
      setAdminLoading(false);
    }
  }

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

  function changeTheme(nextTheme: ThemeMode) {
    setThemeMode(nextTheme);
    try {
      window.localStorage.setItem(THEME_MODE_KEY, nextTheme);
    } catch {
      // Theme persistence is optional; the active session still updates immediately.
    }
  }

  function changeModelChoice(nextChoice: LlmModelChoice) {
    setModelChoice(nextChoice);
    setServerAnalysis(null);
    setSmartResponse(null);
    setRegulationBotResponse(null);
    setAnalysisError("");
    setSmartError("");
    setRegulationBotError("");
    try {
      window.localStorage.setItem(MODEL_CHOICE_STORAGE_KEY, nextChoice);
    } catch {
      // Model preference is optional; the active request headers still update immediately.
    }
  }

  async function saveRuntimeSettings(nextSettings: AdminRuntimeSettings) {
    setAdminLoading(true);
    setAdminStatus("");
    setAdminError("");
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: nextSettings })
      });
      const data = (await response.json().catch(() => ({}))) as { settings?: AdminRuntimeSettings; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error || "Could not save application settings.");
      setRuntimeSettings(data.settings);
      setAdminStatus(language === "en" ? "Application settings saved." : "Pengaturan aplikasi tersimpan.");
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not save application settings.");
    } finally {
      setAdminLoading(false);
    }
  }

  function changeAdminPreviewTier(nextTier: SubscriptionTier) {
    const tier = normalizeSubscriptionTier(nextTier, "user");
    setAdminPreviewTier(tier);
    setServerAnalysis(null);
    setSmartResponse(null);
    setSmartStatus("");
    setSmartError("");
    setRegulationBotResponse(null);
    setRegulationBotStatus("");
    setRegulationBotError("");
    if (page !== "admin" && !canAccessPage("user", tier, page, runtimeSettings.plans)) setPage("smartchat");
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Sidebar persistence is optional.
      }
      return next;
    });
  }

  function changeLoginRole(nextRole: UserRole) {
    setLoginRole(nextRole);
    setLoginUsername((managedUsers.find((user) => user.role === nextRole && user.status === "active") || DEFAULT_USER_BY_ROLE[nextRole]).username);
    setLoginPassword("");
    setLoginError("");
  }

  async function signIn() {
    const username = normalizeUsername(loginUsername);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: loginPassword, role: loginRole })
      });
      const data = (await response.json().catch(() => ({}))) as { session?: AppSession; error?: string };
      if (!response.ok || !data.session) {
        throw new Error(data.error || labels.loginError);
      }
      const nextSession = normalizeSessionForClient(data.session);
      setSession(nextSession);
      saveAppSession(nextSession);
      setLoginPassword("");
      setLoginError("");
      setPage("smartchat");
      setSmartResponse(null);
      setSmartStatus("");
      setSmartError("");
      setRegulationBotResponse(null);
      setRegulationBotStatus("");
      setRegulationBotError("");
      if (nextSession.role === "admin") {
        void refreshManagedUsers();
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : labels.loginError);
    }
  }

  function logout() {
    fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setSession(null);
    saveAppSession(null);
    setPage("dashboard");
    setLoginPassword("");
    setSmartResponse(null);
    setSmartStatus("");
    setSmartError("");
    setRegulationBotResponse(null);
    setRegulationBotStatus("");
    setRegulationBotError("");
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
    const response = await fetch("/api/extract", { method: "POST", headers: modelRequestHeaders(modelChoice), body: payload });
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
      void recordActivity("Extract PDF", uploadedFile.name, "success", `${mergedExtraction.putusanNumber || mergedExtraction.taxpayerName || "Document"} extracted.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "PDF extraction failed.";
      setExtractionError(message);
      void recordActivity("Extract PDF", uploadedFile.name, "error", message);
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
      void recordActivity("Similar case search", "Dispute Analysis", "success", query.slice(0, 140));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Case search failed.";
      setCaseSearchError(message);
      void recordActivity("Similar case search", "Dispute Analysis", "error", message);
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
            uploadedFrom: "tax-dispute-agentic-advisor"
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
      void recordActivity("Upload decisions", "Decision Database", "success", `${uploaded.length} document(s), ${savedToDatabase} saved to database.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blob upload failed.";
      setBlobUploadError(message.includes("BLOB_READ_WRITE_TOKEN") ? labels.blobMissing : message);
      void recordActivity("Upload decisions", "Decision Database", "error", message);
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
        headers: jsonRequestHeaders(modelChoice),
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
      void recordActivity("Re-extract decision", item.filename, "success", data.extraction.putusanNumber || item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stored document extraction failed.";
      setBlobUploadError(message);
      void recordActivity("Re-extract decision", item.filename, "error", message);
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
      void recordActivity("Delete decision", item.filename, "warning", item.extraction?.putusanNumber || item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete document.";
      setBlobUploadError(message);
      void recordActivity("Delete decision", item.filename, "error", message);
    } finally {
      setDeletingDocumentId("");
    }
  }

  async function runAnalysis() {
    const currentInput = { ...form, language };
    if (reusableReport) {
      setServerAnalysis(reusableReport.analysis);
      setActiveReportId(reusableReport.id);
      setSelectedReportId(reusableReport.id);
      setReportStatus(labels.reportLoaded);
      return;
    }
    await runAnalysisRequest(currentInput);
  }

  async function runAnalysisRequest(currentInput = { ...form, language }) {
    setAnalysisLoading(true);
    setAnalysisError("");
    setExportError("");
    setReportStatus("");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: jsonRequestHeaders(modelChoice, requestPreviewTier),
        body: JSON.stringify({ input: currentInput, extraction })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Analysis request failed.");
      }
      const nextAnalysis = data as AnalysisResultType;
      setServerAnalysis(nextAnalysis);
      const report = buildStoredReport({ input: currentInput, extraction, analysis: nextAnalysis, language, modelChoice, tier: effectiveTier });
      await persistReport(report);
      setActiveReportId(report.id);
      setSelectedReportId(report.id);
      setReportStatus(labels.reportSaved);
      void recordActivity("Create report", report.title, "success", `${report.caseNumber || report.taxpayerName || report.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis request failed.";
      setAnalysisError(message);
      void recordActivity("Create report", "Guided Flow", "error", message);
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function persistReport(report: StoredReport) {
    const next = [report, ...storedReports.filter((item) => item.id !== report.id && !(item.reportKey === report.reportKey && item.language === report.language))];
    setStoredReports(next);
    saveStoredReports(next);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report })
      });
      const data = (await response.json().catch(() => ({}))) as { records?: StoredReport[] };
      if (response.ok && Array.isArray(data.records) && data.records.length) {
        const merged = [report, ...data.records.filter((item) => item.id !== report.id)];
        setStoredReports(merged);
        saveStoredReports(merged);
      }
    } catch {
      // Browser-local saved reports remain available if the database call fails.
    }
  }

  function reportIsHydrated(report: StoredReport | null | undefined) {
    return Boolean(report?.analysis && typeof report.analysis.score !== "undefined" && report.input && Object.keys(report.input).length);
  }

  async function hydrateStoredReport(reportId: string) {
    const existing = storedReports.find((item) => item.id === reportId);
    if (reportIsHydrated(existing)) return existing || null;
    try {
      setHydratingReportId(reportId);
      const response = await fetch(`/api/reports?id=${encodeURIComponent(reportId)}`);
      const data = (await response.json().catch(() => ({}))) as { record?: StoredReport; error?: string };
      if (!response.ok || !data.record) {
        throw new Error(data.error || "Could not load report detail.");
      }
      const fullReport = data.record;
      setStoredReports((current) => {
        const merged = current.map((item) => (item.id === fullReport.id ? fullReport : item));
        const next = merged.some((item) => item.id === fullReport.id) ? merged : [fullReport, ...merged];
        saveStoredReports(next);
        return next;
      });
      return fullReport;
    } catch (error) {
      setReportStatus("");
      setExportError(error instanceof Error ? error.message : "Could not load report detail.");
      return existing || null;
    } finally {
      setHydratingReportId("");
    }
  }

  async function selectStoredReport(reportId: string) {
    setSelectedReportId(reportId);
    await hydrateStoredReport(reportId);
  }

  async function loadReportIntoGuided(report: StoredReport) {
    if (!canAccessPage(effectiveAccessRole, effectiveTier, "guided", runtimeSettings.plans)) {
      setExportError(language === "en" ? "Advanced Dispute Analysis is available on Platinum." : "Analisis Putusan Tingkat Lanjut tersedia pada paket Platinum.");
      return;
    }
    const fullReport = (await hydrateStoredReport(report.id)) || report;
    if (!reportIsHydrated(fullReport)) {
      setExportError("Report detail is not available yet.");
      return;
    }
    setForm(fullReport.input);
    setExtraction(fullReport.extraction || null);
    setServerAnalysis(fullReport.analysis);
    setActiveReportId(fullReport.id);
    setSelectedReportId(fullReport.id);
    setLanguage(fullReport.language);
    setReportStatus(labels.reportLoaded);
    setPage("guided");
  }

  async function downloadReport(format: "docx" | "pdf", report?: StoredReport) {
    setExportLoading(format);
    setExportError("");
    try {
      const fullReport = report ? (await hydrateStoredReport(report.id)) || report : null;
      if (report && !reportIsHydrated(fullReport)) {
        throw new Error("Report detail is not available yet.");
      }
      const payloadInput = fullReport?.input || { ...form, language };
      const payloadExtraction = fullReport ? fullReport.extraction || null : extraction;
      const payloadAnalysis = fullReport?.analysis || analysis;
      const payloadLanguage = fullReport?.language || language;
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          input: payloadInput,
          analysis: payloadAnalysis,
          extraction: payloadExtraction,
          language: payloadLanguage
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
      anchor.download = `${buildReportFilename(format, payloadInput, payloadExtraction)}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      void recordActivity("Download report", format.toUpperCase(), "success", anchor.download);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Report export failed.";
      setExportError(message);
      void recordActivity("Download report", format.toUpperCase(), "error", message);
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
        headers: jsonRequestHeaders(modelChoice, requestPreviewTier),
        body: JSON.stringify({ question: smartQuestion, language, mode: smartMode })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Smart chatbot request failed.");
      }
      setSmartResponse(data as SmartChatResponse);
      setSmartStatus(data.llmStatus?.message || "");
      void recordActivity("Ask dispute bot", "Dispute Analysis", "success", smartQuestion.slice(0, 160));
    } catch (error) {
      setSmartResponse(null);
      const message = error instanceof Error ? error.message : "Smart chatbot request failed.";
      setSmartError(message);
      void recordActivity("Ask dispute bot", "Dispute Analysis", "error", message);
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
        headers: jsonRequestHeaders(modelChoice, requestPreviewTier),
        body: JSON.stringify({ question: regulationQuestion, language, mode: "regulations" })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Regulation chatbot request failed.");
      }
      setRegulationBotResponse(data as SmartChatResponse);
      setRegulationBotStatus(data.llmStatus?.message || "");
      void recordActivity("Ask regulation bot", "Regulations", "success", regulationQuestion.slice(0, 160));
    } catch (error) {
      setRegulationBotResponse(null);
      const message = error instanceof Error ? error.message : "Regulation chatbot request failed.";
      setRegulationBotError(message);
      void recordActivity("Ask regulation bot", "Regulations", "error", message);
    } finally {
      setRegulationBotLoading(false);
    }
  }

  async function startEditRegulation(item: Regulation) {
    let target = item;
    try {
      const response = await fetch(`/api/regulations?id=${encodeURIComponent(item.id)}`);
      const data = (await response.json().catch(() => ({}))) as { record?: Regulation };
      if (response.ok && data.record) target = data.record;
    } catch {
      // The summary record is enough for most fields; content can stay blank if detail loading fails.
    }
    setRegulationTab("manual");
    setEditingRegulationId(target.id);
    setRegulationTopic(normalizeRegulationTopic(target.topic));
    setManualRule({
      title: target.title,
      citation: target.citation,
      focus: target.focus,
      sourceUrl: target.sourceUrl || "",
      pdfUrl: target.pdfUrl || "",
      content: target.content || ""
    });
    setRegulationStatus("");
    setRegulationError("");
    window.setTimeout(() => {
      document.getElementById("manual-regulation-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function cancelEditRegulation() {
    setEditingRegulationId("");
    setManualRule({ title: "", citation: "", focus: "", sourceUrl: "", pdfUrl: "", content: "" });
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
      void recordActivity("Delete regulation", item.title, "warning", item.citation);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete regulation.";
      setRegulationError(message);
      void recordActivity("Delete regulation", item.title, "error", message);
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
        const candidates = workbook.SheetNames.map((sheetName) => {
          const matrix = XLSX.utils.sheet_to_json<RegulationImportCell[]>(workbook.Sheets[sheetName], {
            header: 1,
            defval: "",
            raw: false
          });
          const candidateRows = regulationRowsFromMatrix(matrix);
          return { rows: candidateRows, valid: candidateRows.map(rowRegulation).filter(Boolean).length };
        });
        rows = candidates.sort((left, right) => right.valid - left.valid)[0]?.rows || [];
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
      setRegulationTab("list");
      void recordActivity("Import regulations", file.name, "success", `${data.imported || records.length} record(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import regulations.";
      setRegulationError(message);
      void recordActivity("Import regulations", file.name, "error", message);
    } finally {
      setRegulationImportLoading(false);
    }
  }

  async function enrichRegulationSources(item?: Regulation) {
    const ids = item
      ? [item.id]
      : regulationRecords
          .filter(
            (record) =>
              (regulationTopic === "all" || (record.topic || "general") === regulationTopic) &&
              regulationSourceMatches(record.sourceUrl, regulationSourceScope)
          )
          .sort((left, right) => Number(Boolean(left.pdfUrl)) - Number(Boolean(right.pdfUrl)))
          .map((record) => record.id);
    if (!ids.length) {
      setRegulationError(labels.noRulesWithSource);
      return;
    }
    if (item) setEnrichingRegulationId(item.id);
    else setSourceEnrichLoading(true);
    setRegulationStatus("");
    setRegulationError("");
    try {
      const response = await fetch("/api/regulations/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, sourceScope: regulationSourceScope, limit: item ? 1 : Math.min(3, ids.length) })
      });
      const data = (await response.json()) as {
        records?: Regulation[];
        error?: string;
        requested?: number;
        enriched?: number;
        skipped?: number;
        results?: Array<{ title: string; enriched: boolean; message: string }>;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not enrich regulation sources.");
      }
      if (Array.isArray(data.records)) setRegulationRecords(data.records);
      const failed = (data.results || []).filter((result) => !result.enriched).slice(0, 2);
      const note = failed.length ? ` ${failed.map((result) => `${result.title}: ${result.message}`).join(" | ")}` : "";
      setRegulationStatus(`${data.enriched || 0}/${data.requested || ids.length} ${labels.sourceEnriched}${note}`);
      void recordActivity("Enrich regulation", "Regulations", "success", `${data.enriched || 0}/${data.requested || ids.length} source(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not enrich regulation sources.";
      setRegulationError(message);
      void recordActivity("Enrich regulation", "Regulations", "error", message);
    } finally {
      setSourceEnrichLoading(false);
      setEnrichingRegulationId("");
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
          topic: regulationTopic === "all" ? "general" : regulationTopic,
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
    setManualRule({ title: "", citation: "", focus: "", sourceUrl: "", pdfUrl: "", content: "" });
      setEditingRegulationId("");
      setRegulationStatus(labels.regulationUpdated);
      setRegulationTab("list");
      void recordActivity(editingRegulationId ? "Update regulation" : "Create regulation", manualRule.title, "success", manualRule.citation);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save regulation.";
      setRegulationError(message);
      void recordActivity("Save regulation", manualRule.title || "Manual rule", "error", message);
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
        themeMode={themeMode}
        role={loginRole}
        username={loginUsername}
        password={loginPassword}
        error={loginError}
        onLanguageChange={changeLanguage}
        onThemeChange={changeTheme}
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
    <main className={`app-shell theme-${themeMode} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand-full">
          <RsmMark />
          <p className="caption">{APP_SHORT_NAME}</p>
        </div>
        <div className="sidebar-brand-compact" aria-label="RSM">R</div>
        <div className="sidebar-language">
          <label className="field-label" htmlFor="language">Language</label>
          <select id="language" value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>
            <option value="en">English</option>
            <option value="id">Bahasa Indonesia</option>
          </select>
        </div>
        <nav>
          {visiblePages.map(([key, title]) => (
            <button key={key} className={page === key ? "active" : ""} onClick={() => setPage(key)} aria-label={title} title={sidebarCollapsed ? title : undefined}>
              <AppIcon name={pageIcons[key]} />
              <span>{title}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="content">
        <div className="content-toolbar">
          <button
            className="toolbar-icon-button sidebar-visibility-button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? (language === "en" ? "Expand sidebar" : "Perluas sidebar") : language === "en" ? "Collapse sidebar" : "Ringkas sidebar"}
            title={sidebarCollapsed ? (language === "en" ? "Expand sidebar" : "Perluas sidebar") : language === "en" ? "Collapse sidebar" : "Ringkas sidebar"}
          >
            <AppIcon name={sidebarCollapsed ? "expand" : "collapse"} />
          </button>
          <ThemeToggle labels={labels} value={themeMode} onChange={changeTheme} compact iconOnly />
          {session.role === "admin" && (
            <label className="toolbar-tier-preview">
              <span>{language === "en" ? "Preview" : "Pratinjau"}</span>
              <select
                value={adminPreviewTier}
                onChange={(event) => changeAdminPreviewTier(event.target.value as SubscriptionTier)}
                aria-label={language === "en" ? "Preview subscription tier" : "Pratinjau tier langganan"}
              >
                <option value="silver">Silver</option>
                <option value="gold">Gold</option>
                <option value="platinum">Platinum</option>
              </select>
            </label>
          )}
          {session.role === "admin" ? (
            <button className={`toolbar-user ${page === "admin" ? "active" : ""}`} onClick={() => setPage("admin")} aria-label={labels.admin} title={labels.admin}>
              <span className="toolbar-avatar"><AppIcon name="user" /></span>
              <span className="toolbar-user-copy">
                <b>{session.name}</b>
                <small>{labels.roleAdmin} · {language === "en" ? "Preview" : "Pratinjau"} {tierLabel(effectiveTier)}</small>
              </span>
            </button>
          ) : (
            <div className="toolbar-user">
              <span className="toolbar-avatar"><AppIcon name="user" /></span>
              <span className="toolbar-user-copy">
                <b>{session.name}</b>
                <small>{labels.roleUser} · {tierLabel(session.tier)}</small>
              </span>
            </div>
          )}
          <button className="toolbar-icon-button toolbar-logout" onClick={logout} aria-label={labels.logout} title={labels.logout}>
            <AppIcon name="logout" />
          </button>
        </div>
        <header className="hero">
          <div>
            <p className="eyebrow">{page === "dashboard" ? labels.commandCenter : APP_SHORT_NAME}</p>
            <h1>{page === "dashboard" ? APP_SHORT_NAME : APP_NAME}</h1>
            <p>{page === "dashboard" ? labels.appGuidance : labels.subtitle}</p>
          </div>
        </header>

        {page === "dashboard" && (
          <>
            <section className="workspace-strip" aria-label={labels.workspace}>
              <div className="workspace-strip-item workspace-strip-main">
                <span>{labels.workspace}</span>
                <b>{session.name}</b>
              </div>
              <div className="workspace-strip-item">
                <span>{labels.activeRole}</span>
                <b>{session.role === "admin" ? labels.roleAdmin : labels.roleUser} · {tierLabel(effectiveTier)}</b>
              </div>
              <div className="workspace-strip-item">
                <span>{labels.dataMode}</span>
                <b>{dynamicDashboard.stats.indexedDecisions ? labels.liveWorkspace : labels.localWorkspace}</b>
              </div>
              <div className="workspace-strip-item">
                <span>{labels.aiRuntime}</span>
                <b>{modelRuntimeCopy(labels, modelChoice).label} · {modelRuntimeCopy(labels, modelChoice).hint}</b>
              </div>
              <div className="workspace-strip-item">
                <span>{labels.workspaceSignal}</span>
                <b>{dynamicDashboard.stats.localRegulations} {language === "en" ? "rules" : "aturan"} · {dynamicDashboard.stats.llmLabels} label</b>
              </div>
            </section>
            <section className="dashboard-command-grid">
              <div className="dashboard-primary">
                <section className="quick-actions dashboard-actions" aria-label={labels.quickStart}>
                  <article className="quick-action-card quick-action-green">
                    <div>
                      <span>{labels.quickStart}</span>
                      <b>{labels.quickChat}</b>
                      <button className="table-button" onClick={() => setPage("smartchat")}>{labels.openAction}</button>
                    </div>
                    <QuickActionIcon type="chatbot" />
                  </article>
                  {canAccessPage(effectiveAccessRole, effectiveTier, "guided", runtimeSettings.plans) ? (
                    <article className="quick-action-card quick-action-blue">
                      <div>
                        <span>{labels.quickStart}</span>
                        <b>{labels.guided}</b>
                        <button className="table-button" onClick={() => setPage("guided")}>{labels.openAction}</button>
                      </div>
                      <QuickActionIcon type="document" />
                    </article>
                  ) : (
                    <article className="quick-action-card quick-action-blue">
                      <div>
                        <span>{labels.quickStart}</span>
                        <b>{labels.reports}</b>
                        <button className="table-button" onClick={() => setPage("reports")}>{labels.openAction}</button>
                      </div>
                      <QuickActionIcon type="document" />
                    </article>
                  )}
                  {session.role === "admin" && (
                    <article className="quick-action-card quick-action-gray">
                      <div>
                        <span>{labels.quickStart}</span>
                        <b>{labels.quickAdmin}</b>
                        <button className="table-button" onClick={() => setPage("admin")}>{labels.openAction}</button>
                      </div>
                      <QuickActionIcon type="database" />
                    </article>
                  )}
                </section>
                <Panel title={labels.recentDocs} className="dashboard-recent">
                  {dynamicDashboard.recentDocuments.length ? <div className="table-wrap">
                    <table className="recent-documents-table">
                      <colgroup>
                        <col className="recent-col-decision" />
                        <col className="recent-col-type" />
                        <col className="recent-col-taxpayer" />
                        <col className="recent-col-tax" />
                        <col className="recent-col-issue" />
                        <col className="recent-col-outcome" />
                      </colgroup>
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
                            <td className="recent-decision" title={doc.decision}>{doc.decision}</td>
                            <td title={doc.documentType}>{doc.documentType}</td>
                            <td title={doc.taxpayer}>{doc.taxpayer}</td>
                            <td title={doc.tax}>{doc.tax}</td>
                            <td className="recent-issue" title={doc.issue}>{doc.issue}</td>
                            <td className="recent-outcome" title={doc.outcome}>{doc.outcome}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div> : <div className="empty-state">{labels.noDynamicDocuments}</div>}
                </Panel>
              </div>
              <aside className="dashboard-secondary" aria-label={labels.dataSummary}>
                <section className="kpi-grid dashboard-kpis">
                  <Kpi label={labels.indexed} value={dynamicDashboard.stats.indexedDecisions.toString()} tone="blue" caption={labels.indexedHelper} />
                  <Kpi label={labels.coverage} value={`${dynamicDashboard.stats.extractionCoverage}%`} tone="green" caption={labels.coverageHelper} />
                  <Kpi label={labels.vatDocs} value={dynamicDashboard.stats.vatDocuments.toString()} tone="blue" caption={labels.vatDocsHelper} />
                  <Kpi label={labels.localRules} value={dynamicDashboard.stats.localRegulations.toString()} tone="gray" caption={labels.localRulesHelper} />
                  <Kpi label={labels.llmLabels} value={dynamicDashboard.stats.llmLabels.toString()} tone="gray" caption={labels.llmLabelsHelper} />
                </section>
                <section className="dashboard-chart-grid">
                  <Panel title={labels.decisionOutcomes} className="dashboard-outcomes">
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
                  <Panel title={labels.topDisputeIssues} className="dashboard-issues">
                    {dynamicDashboard.issueDistribution.length ? dynamicDashboard.issueDistribution.map((item) => (
                      <MiniBar key={item.label} label={item.label} value={item.value} />
                    )) : <div className="empty-state">{labels.noDynamicDocuments}</div>}
                  </Panel>
                </section>
              </aside>
            </section>
          </>
        )}

        {page === "guided" && (
          <section className="guided-page">
            <section className="workbench">
                <Panel title={labels.guided}>
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
                  {reportStatus && <div className="status-banner success">{reportStatus}</div>}
                  <div className="analysis-action-row">
                    <button className="primary-button" onClick={runAnalysis} disabled={analysisLoading}>
                      {analysisLoading ? labels.analyzing : labels.startAnalysis}
                    </button>
                    {(reusableReport || activeReportId) && (
                      <button className="primary-button secondary-button" onClick={() => runAnalysisRequest({ ...form, language })} disabled={analysisLoading}>
                        {analysisLoading ? labels.analyzing : labels.updateAnalysis}
                      </button>
                    )}
                  </div>
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
          </section>
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
            tier={effectiveTier}
            question={smartQuestion}
            mode={smartMode}
            response={smartResponse}
            status={smartStatus}
            error={smartError}
            loading={smartLoading}
            onQuestionChange={setSmartQuestion}
            onModeChange={setSmartMode}
            onAsk={askSmartChat}
            caseText={caseSearchText}
            caseFileName={caseSearchFileName}
            caseExtraction={caseSearchExtraction}
            caseResults={caseSearchResults}
            caseLoading={caseSearchLoading}
            caseStatus={caseSearchStatus}
            caseError={caseSearchError}
            onCaseTextChange={updateCaseSearchText}
            onCaseFileChange={onCaseSearchFileChange}
            onCaseSearch={runCaseSearch}
          />
        )}

        {page === "regulations" && (
          <Panel title={labels.relatedRules}>
            <p className="muted lead-copy">{labels.regulationHelp}</p>
            {regulationStatus && <div className="status-banner success">{regulationStatus}</div>}
            {regulationError && <div className="status-banner error">{regulationError}</div>}
            <div className="regulation-tabs">
              <div className="regulation-tab-list" role="tablist" aria-label={labels.relatedRules}>
                {(
                  session.role === "admin"
                    ? [
                        ["bot", labels.regulationTabBot],
                        ["list", labels.regulationTabList],
                        ["update", labels.regulationTabUpdate],
                        ["manual", labels.regulationTabManual]
                      ]
                    : [
                        ["bot", labels.regulationTabBot],
                        ["list", labels.regulationTabList]
                      ]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={regulationTab === key ? "active" : ""}
                    role="tab"
                    aria-selected={regulationTab === key}
                    onClick={() => setRegulationTab(key as RegulationTabKey)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="regulation-tab-panels">
                {regulationTab === "bot" && (
                  <section className="regulation-tab-panel">
                    <div className={`regulation-bot-box compact tier-preview-${effectiveTier}`}>
                      <div className="regulation-bot-layout cotax-reg-layout">
                        <div className="reg-rag-chat">
                          <div className="reg-rag-chat-header">
                            <div className="reg-bot-heading">
                              <RsmTaxBotMark />
                              <div>
                                <span>{language === "en" ? "Indonesian tax regulatory knowledge" : "Knowledge peraturan perpajakan Indonesia"}</span>
                                <h3>{language === "en" ? "RSM Regulatory TaxBot" : "RSM TaxBot Peraturan"}</h3>
                                <p>{language === "en" ? "Ask with context and verify every source." : "Tanya dengan konteks dan verifikasi setiap sumber."}</p>
                              </div>
                            </div>
                            <div className="reg-bot-tools">
                              <button className="table-button compact" type="button" onClick={() => setRegulationBotResponse(null)}>
                                {language === "en" ? "New question" : "Pertanyaan baru"}
                              </button>
                              <details className="reg-bot-meta">
                                <summary title={language === "en" ? "Knowledge and answer controls" : "Knowledge dan kontrol jawaban"}>
                                  <AppIcon name="info" />
                                  <span>{language === "en" ? "About" : "Info"}</span>
                                </summary>
                                <div className="reg-bot-meta-popover">
                                  <b>{language === "en" ? "Knowledge coverage" : "Cakupan knowledge"}</b>
                                  <span>{regulationRecords.length} {language === "en" ? "stored regulation cards" : "kartu aturan tersimpan"}</span>
                                  <span>{language === "en" ? "Hybrid retrieval: citation, topic, and semantic similarity." : "Hybrid retrieval: sitasi, topik, dan kemiripan semantik."}</span>
                                  <span>{language === "en" ? "Answers show sources, relevance, and context limits." : "Jawaban menampilkan sumber, relevansi, dan batasan konteks."}</span>
                                  <small>{language === "en" ? "Professional review remains required." : "Review profesional tetap diperlukan."}</small>
                                </div>
                              </details>
                              {session.role === "admin" && (
                                <button className="table-button compact" type="button" onClick={() => setRegulationTab("update")}>
                                  {language === "en" ? "Update sources" : "Update sumber"}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="reg-prompt-grid">
                            {(language === "en"
                              ? [
                                  "Which regulations govern transfer pricing documentation and the arm's length principle?",
                                  "What should be checked before crediting input VAT?",
                                  "Where is a tax objection and appeal procedure regulated?",
                                  "Which source should be updated first for current VAT rules?"
                                ]
                              : [
                                  "Aturan apa saja yang mengatur dokumentasi transfer pricing dan prinsip kewajaran?",
                                  "Apa yang harus dicek sebelum mengkreditkan Pajak Masukan?",
                                  "Di mana prosedur keberatan dan banding pajak diatur?",
                                  "Sumber mana yang perlu diupdate dulu untuk aturan PPN terbaru?"
                                ]).map((prompt) => (
                              <button key={prompt} type="button" onClick={() => setRegulationQuestion(prompt)}>
                                {prompt}
                                <span>→</span>
                              </button>
                            ))}
                          </div>

                          <div className="regulation-bot-answer">
                            <div className="regulation-answer-heading">
                              <div>
                                <span>{language === "en" ? "Structured regulation review" : "Telaah peraturan terstruktur"}</span>
                                <h3>{labels.regulationBotAnswer}</h3>
                              </div>
                              <span className={`tier-answer-badge ${effectiveTier}`}>{tierLabel(effectiveTier)}</span>
                            </div>
                            {!regulationBotResponse ? (
                              <div className="reg-empty-chat">
                                <b>{labels.noRegulationBotAnswer}</b>
                                <span>
                                  {language === "en"
                                    ? "Use one of the starter questions or ask about a rule, article, tax type, effective period, or source location."
                                    : "Gunakan pertanyaan awal atau tanyakan aturan, pasal, jenis pajak, masa berlaku, atau lokasi sumber."}
                                </span>
                              </div>
                            ) : (
                              <>
                                {regulationBotStatus && <div className="status-banner success">{regulationBotStatus}</div>}
                                <MarkdownText text={regulationBotResponse.answer} structured />
                                <div className="regulation-retrieval-summary">
                                  <b>{language === "en" ? "Sources reviewed" : "Sumber ditelaah"}</b>
                                  <span>
                                    {regulationBotResponse.retrieval.usedRegulations}/{regulationBotResponse.retrieval.totalRegulations} {language === "en" ? "regulations" : "peraturan"}
                                  </span>
                                </div>
                                <h4 className="regulation-source-title">{language === "en" ? "Regulation references" : "Referensi peraturan"}</h4>
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

                          <div className="regulation-question-card">
                            <label className="control wide">
                              <span>{labels.regulationQuestion}</span>
                              <textarea
                                value={regulationQuestion}
                                onChange={(event) => setRegulationQuestion(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                    event.preventDefault();
                                    if (!regulationBotLoading && regulationQuestion.trim()) void askRegulationBot();
                                  }
                                }}
                                placeholder={labels.regulationQuestionPlaceholder}
                                rows={3}
                              />
                            </label>
                            <button className="primary-button regulation-ask-button" onClick={askRegulationBot} disabled={regulationBotLoading || !regulationQuestion.trim()}>
                              <AppIcon name="regulations" />
                              <span>{regulationBotLoading ? labels.askingRegulationBot : labels.askRegulationBot}</span>
                            </button>
                            {regulationBotError && <div className="status-banner error">{regulationBotError}</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {regulationTab === "update" && session.role === "admin" && (
                  <section className="regulation-tab-panel">
                    <div className="regulation-update-panel">
                      <div>
                        <h3>{labels.regulationUpdateTitle}</h3>
                        <p className="muted">{labels.regulationUpdateIntro}</p>
                      </div>
                      <div className="regulation-toolbar tabbed-toolbar">
                        <label className="control">
                          <span>{labels.regulationTopic}</span>
                          <select
                            value={regulationTopic}
                            onChange={(event) => {
                              setRegulationTopic(event.target.value as RegulationTopicFilter);
                              setRegulationPage(1);
                            }}
                          >
                            <option value="all">{language === "en" ? "All topics" : "Semua topik"}</option>
                            {regulationTopicOptions.map((topic) => (
                              <option key={topic.key} value={topic.key}>
                                {topic[language]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="control">
                          <span>{language === "en" ? "Official source" : "Sumber resmi"}</span>
                          <select
                            value={regulationSourceScope}
                            onChange={(event) => setRegulationSourceScope(event.target.value as RegulationSourceScope)}
                          >
                            {regulationSourceScopeOptions.map((source) => (
                              <option key={source.key} value={source.key}>
                                {source[language]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="primary-button" onClick={() => enrichRegulationSources()} disabled={sourceEnrichLoading}>
                          {sourceEnrichLoading ? labels.enrichingSources : labels.enrichSources}
                        </button>
                        <button className="table-button" onClick={() => setRegulationTab("list")}>
                          {labels.jumpToStoredRules}
                        </button>
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
                      <p className="muted import-hint">
                        {labels.bulkRegulationHint}
                        {" "}{language === "en" ? "Total stored" : "Total tersimpan"}: {regulationRecords.length} · {language === "en" ? "matched filter" : "cocok dengan filter"}: {visibleRegulations.length}.
                        {" "}{language === "en" ? "Up to 3 unindexed PDFs are processed per run." : "Maksimal 3 PDF yang belum terindeks diproses per proses."}
                      </p>
                    </div>
                  </section>
                )}

                {regulationTab === "list" && (
                  <section id="stored-regulations" className="regulation-tab-panel stored-rule-list">
                    <div className="stored-rule-header">
                      <div>
                        <h3>{labels.storedRuleList}</h3>
                        <p>
                          <strong>{language === "en" ? "Total stored" : "Total tersimpan"}: {regulationRecords.length}</strong>
                          <span>{language === "en" ? "Matched filter" : "Cocok dengan filter"}: {visibleRegulations.length}</span>
                        </p>
                      </div>
                      <div className="stored-rule-filters">
                        <label className="control compact-control">
                          <span>{labels.regulationTopic}</span>
                          <select
                            value={regulationTopic}
                            onChange={(event) => {
                              setRegulationTopic(event.target.value as RegulationTopicFilter);
                              setRegulationPage(1);
                            }}
                          >
                            <option value="all">{language === "en" ? "All topics" : "Semua topik"}</option>
                            {regulationTopicOptions.map((topic) => (
                              <option key={topic.key} value={topic.key}>{topic[language]}</option>
                            ))}
                          </select>
                        </label>
                        <label className="control compact-control">
                          <span>{language === "en" ? "Source" : "Sumber"}</span>
                          <select
                            value={regulationSourceScope}
                            onChange={(event) => {
                              setRegulationSourceScope(event.target.value as RegulationSourceScope);
                              setRegulationPage(1);
                            }}
                          >
                            {regulationSourceScopeOptions.map((source) => (
                              <option key={source.key} value={source.key}>{source[language]}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
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
                              {item.content && <p className="muted">{truncateText(item.content.replace(/\\n/g, " · "), 420)}</p>}
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
                              {item.pdfUrl ? (
                                <small>
                                  <a href={item.pdfUrl} target="_blank" rel="noreferrer">
                                    {language === "en" ? "Open official PDF" : "Buka PDF resmi"}
                                  </a>
                                </small>
                              ) : null}
                              <div className="score-pill">{item.relevance}% relevance</div>
                              <div className="reg-card-actions">
                                <a className="table-button compact" href={referenceDetailPath("regulation", item.id)}>
                                  {labels.openReference}
                                </a>
                                {session.role === "admin" && (
                                  <>
                                    <button className="table-button compact" onClick={() => startEditRegulation(item)}>
                                      {labels.editRule}
                                    </button>
                                    <button
                                      className="table-button compact"
                                      onClick={() => enrichRegulationSources(item)}
                                      disabled={!/^https?:\/\//i.test(item.sourceUrl || "") || Boolean(enrichingRegulationId || sourceEnrichLoading)}
                                    >
                                      {enrichingRegulationId === item.id ? labels.enrichingSources : labels.enrichRuleSource}
                                    </button>
                                    <button
                                      className="table-button compact danger"
                                      onClick={() => deleteRegulation(item)}
                                      disabled={deletingRegulationId === item.id}
                                    >
                                      {deletingRegulationId === item.id ? labels.deletingStored : labels.deleteRule}
                                    </button>
                                  </>
                                )}
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
                  </section>
                )}

                {regulationTab === "manual" && session.role === "admin" && (
                  <section id="manual-regulation-form" className="regulation-tab-panel manual-rule-box">
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
                      <Input label={labels.manualPdfUrl} value={manualRule.pdfUrl} onChange={(value) => setManualRule((current) => ({ ...current, pdfUrl: value }))} />
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
                  </section>
                )}
              </div>
            </div>
          </Panel>
        )}

        {page === "reports" && (
          <ReportDatabasePanel
            labels={labels}
            reports={storedReports}
            selectedReport={selectedReport}
            loadingReportId={hydratingReportId}
            exportLoading={exportLoading}
            exportError={exportError}
            canReuse={canAccessPage(effectiveAccessRole, effectiveTier, "guided", runtimeSettings.plans)}
            onSelect={selectStoredReport}
            onLoad={loadReportIntoGuided}
            onDownload={downloadReport}
          />
        )}

        {page === "admin" && session.role === "admin" && (
          <AdminPanel
            labels={labels}
            activeTab={adminTab}
            logs={activityLogs}
            users={managedUsers}
            userForm={userForm}
            editingUserId={editingUserId}
            checks={systemChecks}
            counts={systemCounts}
            checkedAt={systemCheckedAt}
            status={adminStatus}
            error={adminError}
            loading={adminLoading}
            currentSession={session}
            modelChoice={modelChoice}
            runtimeSettings={runtimeSettings}
            onTabChange={setAdminTab}
            onRefreshLogs={refreshActivityLogs}
            onRefreshUsers={refreshManagedUsers}
            onRunCheck={() => runSystemCheck(true)}
            onModelChoiceChange={changeModelChoice}
            onRuntimeSettingsChange={setRuntimeSettings}
            onSaveRuntimeSettings={saveRuntimeSettings}
            onUserFormChange={setUserForm}
            onSaveUser={saveUser}
            onResetUser={resetUserForm}
            onEditUser={startEditUser}
            onDeleteUser={deleteUser}
          />
        )}
      </section>
    </main>
  );
}

function Kpi({ label, value, tone, caption }: { label: string; value: string; tone: "blue" | "green" | "gray"; caption?: string }) {
  return (
    <article className={`kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {caption && <small>{caption}</small>}
    </article>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`.trim()}>
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

function MarkdownBlock({ block, blockKey }: { block: string; blockKey: string }) {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  const isList = lines.every((line) => /^[-•]\s+/.test(line));
  const isNumberedList = lines.every((line) => /^\d+[.)]\s+/.test(line));
  if (isList || isNumberedList) {
    const ListTag = isNumberedList ? "ol" : "ul";
    return (
      <ListTag key={blockKey}>
        {lines.map((line, lineIndex) => (
          <li key={`${blockKey}-${lineIndex}`}>
            <InlineRichText text={line.replace(isNumberedList ? /^\d+[.)]\s+/ : /^[-•]\s+/, "")} />
          </li>
        ))}
      </ListTag>
    );
  }
  return (
    <p key={blockKey}>
      <InlineRichText text={block.replace(/^#{1,6}\s*/, "")} />
    </p>
  );
}

function StructuredMarkdownText({ text }: { text: string }) {
  const blocks = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const sections: Array<{ title: string; blocks: string[] }> = [];
  const implicitSectionPattern = /^(Executive summary|Issue map|Regulatory analysis|Decision pattern|Evidence assessment|Argument strategy|Risks and counterarguments|Recommended actions|Ringkasan eksekutif|Peta isu|Analisis peraturan|Pola putusan|Penilaian bukti|Strategi argumentasi|Risiko dan kontra-argumen|Tindakan yang disarankan)\s*(?:[-–—:]|\n)\s*([\s\S]*)$/i;

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const heading = lines[0]?.match(/^#{1,6}\s+(.+)$/);
    const implicitHeading = block.match(implicitSectionPattern);
    if (heading) {
      sections.push({ title: heading[1], blocks: lines.length > 1 ? [lines.slice(1).join("\n")] : [] });
    } else if (implicitHeading) {
      sections.push({ title: implicitHeading[1], blocks: implicitHeading[2] ? [implicitHeading[2].trim()] : [] });
    } else if (sections.length) {
      sections[sections.length - 1].blocks.push(block);
    } else {
      sections.push({ title: "", blocks: [block] });
    }
  }

  return (
    <div className="rich-text answer-brief">
      {sections.map((section, sectionIndex) => (
        <section className="answer-section" key={`${section.title}-${sectionIndex}`}>
          {section.title && <h4>{section.title}</h4>}
          {section.blocks.map((block, blockIndex) => (
            <MarkdownBlock key={`${sectionIndex}-${blockIndex}`} block={block} blockKey={`${sectionIndex}-${blockIndex}`} />
          ))}
        </section>
      ))}
    </div>
  );
}

function MarkdownText({ text, structured = false }: { text: string; structured?: boolean }) {
  if (structured) return <StructuredMarkdownText text={text} />;
  const blocks = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className="rich-text">
      {blocks.map((block, index) => {
        return <MarkdownBlock key={`block-${index}`} block={block} blockKey={`block-${index}`} />;
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
  const [selectedDocumentOverride, setSelectedDocumentOverride] = useState<StoredDecisionFile | null>(null);
  const [loadingSelectedDocumentId, setLoadingSelectedDocumentId] = useState("");
  const [detailLoadError, setDetailLoadError] = useState("");
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
  const selectedDocument =
    selectedDocumentId && selectedDocumentOverride?.id === selectedDocumentId
      ? selectedDocumentOverride
      : selectedDocumentId
        ? storedDocuments.find((item) => item.id === selectedDocumentId) || null
        : null;

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

  async function viewStoredCase(item: StoredDecisionFile) {
    setSelectedDocumentId(item.id);
    setSelectedDocumentOverride(null);
    setDetailLoadError("");
    try {
      setLoadingSelectedDocumentId(item.id);
      const response = await fetch(`/api/decisions?id=${encodeURIComponent(item.id)}`);
      const data = (await response.json().catch(() => ({}))) as { record?: StoredDecisionFile; error?: string };
      if (!response.ok || !data.record) {
        throw new Error(data.error || "Could not load decision detail.");
      }
      setSelectedDocumentOverride(data.record);
    } catch (error) {
      setDetailLoadError(error instanceof Error ? error.message : "Could not load decision detail.");
    } finally {
      setLoadingSelectedDocumentId("");
    }
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
              <button
                className="table-button"
                onClick={() => {
                  setSelectedDocumentId("");
                  setSelectedDocumentOverride(null);
                  setDetailLoadError("");
                }}
              >
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
            {loadingSelectedDocumentId === selectedDocument.id && <div className="status-banner success compact-status">{labels.loadingDecisionDetail || "Loading decision detail..."}</div>}
            {detailLoadError && <div className="status-banner error compact-status">{detailLoadError}</div>}
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
                          <button className="table-button" onClick={() => viewStoredCase(item)} disabled={!item.extraction || loadingSelectedDocumentId === item.id}>
                            {loadingSelectedDocumentId === item.id ? labels.loadingDecisionDetail : labels.viewCase}
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

function formatReportDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function ReportDatabasePanel({
  labels,
  reports,
  selectedReport,
  loadingReportId,
  exportLoading,
  exportError,
  canReuse,
  onSelect,
  onLoad,
  onDownload
}: {
  labels: (typeof copy)["en"];
  reports: StoredReport[];
  selectedReport: StoredReport | null;
  loadingReportId: string;
  exportLoading: "docx" | "pdf" | "";
  exportError: string;
  canReuse: boolean;
  onSelect: (id: string) => void;
  onLoad: (report: StoredReport) => void;
  onDownload: (format: "docx" | "pdf", report?: StoredReport) => void;
}) {
  return (
    <section className="report-database-layout">
      <Panel title={labels.reportDatabaseTitle}>
        <p className="muted lead-copy">{labels.reportDatabaseIntro}</p>
        {!reports.length ? (
          <div className="empty-state">{labels.noSavedReports}</div>
        ) : (
          <div className="report-database-grid">
            <div className="report-list-panel">
              <h3>{labels.savedReports}</h3>
              <div className="report-list">
                {reports.map((report) => (
                  <button
                    key={report.id}
                    className={`report-card ${selectedReport?.id === report.id ? "active" : ""}`}
                    onClick={() => onSelect(report.id)}
                  >
                    <b>{report.title}</b>
                    <span>
                      {report.taxType || "-"} · {report.issueType || "-"}
                    </span>
                    <small>
                      {labels.reportUpdatedAt}: {formatReportDate(report.updatedAt)}
                    </small>
                  </button>
                ))}
              </div>
            </div>
            <div className="report-detail-panel">
              {selectedReport ? (
                <>
                  <div className="report-detail-head">
                    <div>
                      <span>{labels.openReportDetail}</span>
                      <h3>{selectedReport.title}</h3>
                      <p>
                        {selectedReport.caseNumber || "-"} · {selectedReport.language.toUpperCase()} ·{" "}
                        {formatReportDate(selectedReport.updatedAt)}
                      </p>
                    </div>
                    <div className="report-detail-actions">
                      {canReuse && (
                        <button className="table-button" onClick={() => onLoad(selectedReport)}>
                          {labels.updateAnalysis}
                        </button>
                      )}
                      <button className="table-button" onClick={() => onDownload("docx", selectedReport)} disabled={Boolean(exportLoading)}>
                        {exportLoading === "docx" ? labels.exporting : labels.exportWord}
                      </button>
                      <button className="table-button" onClick={() => onDownload("pdf", selectedReport)} disabled={Boolean(exportLoading)}>
                        {exportLoading === "pdf" ? labels.exporting : labels.exportPdf}
                      </button>
                    </div>
                  </div>
                  {exportError && <div className="status-banner error">{exportError}</div>}
                  {loadingReportId === selectedReport.id || typeof selectedReport.analysis?.score === "undefined" ? (
                    <div className="empty-state">{labels.loadingReportDetail || "Loading report detail..."}</div>
                  ) : (
                    <AnalysisResult
                      labels={labels}
                      analysis={selectedReport.analysis}
                      expanded
                      canExport={false}
                    />
                  )}
                </>
              ) : (
                <div className="empty-state">{labels.noSavedReports}</div>
              )}
            </div>
          </div>
        )}
      </Panel>
    </section>
  );
}

function AdminPanel({
  labels,
  activeTab,
  logs,
  users,
  userForm,
  editingUserId,
  checks,
  counts,
  checkedAt,
  status,
  error,
  loading,
  currentSession,
  modelChoice,
  runtimeSettings,
  onTabChange,
  onRefreshLogs,
  onRefreshUsers,
  onRunCheck,
  onModelChoiceChange,
  onRuntimeSettingsChange,
  onSaveRuntimeSettings,
  onUserFormChange,
  onSaveUser,
  onResetUser,
  onEditUser,
  onDeleteUser
}: {
  labels: (typeof copy)["en"];
  activeTab: AdminTabKey;
  logs: ActivityLog[];
  users: ManagedUser[];
  userForm: ManagedUser;
  editingUserId: string;
  checks: SystemCheck[];
  counts: Record<string, number>;
  checkedAt: string;
  status: string;
  error: string;
  loading: boolean;
  currentSession: AppSession;
  modelChoice: LlmModelChoice;
  runtimeSettings: AdminRuntimeSettings;
  onTabChange: (tab: AdminTabKey) => void;
  onRefreshLogs: () => void;
  onRefreshUsers: () => void;
  onRunCheck: () => void;
  onModelChoiceChange: (value: LlmModelChoice) => void;
  onRuntimeSettingsChange: (value: AdminRuntimeSettings) => void;
  onSaveRuntimeSettings: (value: AdminRuntimeSettings) => void;
  onUserFormChange: (user: ManagedUser) => void;
  onSaveUser: () => void;
  onResetUser: () => void;
  onEditUser: (user: ManagedUser) => void;
  onDeleteUser: (user: ManagedUser) => void;
}) {
  const [settingsTab, setSettingsTab] = useState<"access" | "ai" | "prompts">("access");
  const [selectedPlanTier, setSelectedPlanTier] = useState<SubscriptionTier>("platinum");
  const [selectedPromptFeature, setSelectedPromptFeature] = useState<PromptFeatureKey>("extraction");
  const [selectedPromptLanguage, setSelectedPromptLanguage] = useState<PromptLanguage>("id");
  const tabs: Array<[AdminTabKey, string]> = [
    ["logs", labels.adminLogs],
    ["users", labels.adminUsers],
    ["privacy", labels.adminPrivacy],
    ["api", labels.adminCheckApi]
  ];
  const countsEntries = Object.entries(counts || {});
  const logRows = logs.slice(0, 120);
  const isEnglish = labels.signIn === "Sign in";
  const tierDescriptions: Record<SubscriptionTier, string> = {
    silver: labels.privacySilverDesc,
    gold: labels.privacyGoldDesc,
    platinum: labels.privacyPlatinumDesc
  };
  const tierNames: Record<SubscriptionTier, string> = {
    silver: labels.tierSilver,
    gold: labels.tierGold,
    platinum: labels.tierPlatinum
  };
  const tierList: SubscriptionTier[] = ["silver", "gold", "platinum"];
  const featureRows: Array<{ key: TierFeatureKey; label: string }> = [
    { key: "dashboard", label: labels.dashboard },
    { key: "guided", label: labels.guided },
    { key: "databaseRead", label: isEnglish ? "Read decision database" : "Baca database putusan" },
    { key: "databaseWrite", label: isEnglish ? "Upload / extract decision database" : "Upload / ekstraksi database putusan" },
    { key: "disputeBot", label: labels.smartchat },
    { key: "regulationRead", label: isEnglish ? "Read regulation knowledge" : "Baca knowledge peraturan" },
    { key: "regulationWrite", label: isEnglish ? "Update regulation knowledge" : "Update knowledge peraturan" },
    { key: "reports", label: labels.reports }
  ];
  const securityControls = isEnglish
    ? [
        "Secure session cookies.",
        "Passwords use scrypt hashes.",
        "Admin APIs require server-side role checks.",
        "Activity logs track key actions.",
        "List APIs paginate; detail loads on demand.",
        "PDF files stay separate from metadata and extraction JSON."
      ]
    : [
        "Cookie session aman.",
        "Password memakai hash scrypt.",
        "API admin memakai role guard server-side.",
        "Activity log mencatat aksi penting.",
        "List API memakai pagination; detail dimuat saat dibuka.",
        "PDF dipisah dari metadata dan JSON ekstraksi."
      ];
  const productionSteps = isEnglish
    ? [
        "Isolate matters, users, blobs, reports, and logs by tenant.",
        "Connect SSO/MFA.",
        "Add case, report, and folder RBAC.",
        "Set retention, legal hold, delete, and export policies.",
        "Meter documents, chats, exports, storage, and API use.",
        "Add audit export and approval workflows."
      ]
    : [
        "Pisahkan perkara, user, blob, report, dan log per tenant.",
        "Hubungkan SSO/MFA.",
        "Tambah RBAC untuk kasus, report, dan folder.",
        "Atur retensi, legal hold, hapus, dan export.",
        "Metering dokumen, chat, export, storage, dan API.",
        "Tambah audit export dan approval workflow."
      ];

  const promptNames: Record<PromptFeatureKey, string> = isEnglish
    ? {
        extraction: "Document extraction",
        advancedAnalysis: "Advanced analysis",
        disputeBot: "Dispute Analysis",
        regulationBot: "Regulation RAG",
        referenceAssistant: "Reference assistant"
      }
    : {
        extraction: "Ekstraksi dokumen",
        advancedAnalysis: "Analisis tingkat lanjut",
        disputeBot: "Dispute Analysis",
        regulationBot: "RAG peraturan",
        referenceAssistant: "Asisten referensi"
      };
  const selectedPlan = runtimeSettings.plans[selectedPlanTier];
  const selectedPrompt = runtimeSettings.prompts[selectedPromptFeature][selectedPromptLanguage];

  function updateSelectedPlan(patch: Partial<(typeof runtimeSettings.plans)[SubscriptionTier]>) {
    onRuntimeSettingsChange({
      ...runtimeSettings,
      plans: {
        ...runtimeSettings.plans,
        [selectedPlanTier]: { ...selectedPlan, ...patch, tier: selectedPlanTier }
      }
    });
  }

  function togglePlanFeature(feature: TierFeatureKey) {
    const features = selectedPlan.features.includes(feature)
      ? selectedPlan.features.filter((item) => item !== feature)
      : [...selectedPlan.features, feature];
    updateSelectedPlan({ features });
  }

  function updateSelectedPrompt(field: "system" | "instruction", value: string) {
    onRuntimeSettingsChange({
      ...runtimeSettings,
      prompts: {
        ...runtimeSettings.prompts,
        [selectedPromptFeature]: {
          ...runtimeSettings.prompts[selectedPromptFeature],
          [selectedPromptLanguage]: { ...selectedPrompt, [field]: value }
        }
      }
    });
  }

  return (
    <section className="admin-page">
      <Panel title={labels.adminTitle}>
        <p className="muted lead-copy">{labels.adminIntro}</p>
        {status && <div className="status-banner success">{status}</div>}
        {error && <div className="status-banner error">{error}</div>}
        <div className="regulation-tab-list admin-tab-list" role="tablist" aria-label={labels.adminTitle}>
          {tabs.map(([key, title]) => (
            <button key={key} className={activeTab === key ? "active" : ""} onClick={() => onTabChange(key)}>
              {title}
            </button>
          ))}
        </div>

        {activeTab === "logs" && (
          <section className="admin-section">
            <div className="admin-section-head">
              <div>
                <h3>{labels.activityLogs}</h3>
                <p className="muted">{labels.totalRecords}: {logs.length}</p>
              </div>
              <button className="table-button" onClick={onRefreshLogs}>
                {labels.refresh}
              </button>
            </div>
            {logRows.length === 0 ? (
              <div className="empty-state">{labels.noActivityLogs}</div>
            ) : (
              <div className="admin-log-list">
                {logRows.map((log) => (
                  <article key={log.id} className={`admin-log-card ${log.status}`}>
                    <div>
                      <b>{log.action}</b>
                      <span>{log.target || "-"}</span>
                    </div>
                    <p>{log.detail || "-"}</p>
                    <div className="admin-log-meta">
                      <span>{log.actor} · {log.role}</span>
                      <span>{new Date(log.createdAt).toLocaleString()}</span>
                      <i>{log.status}</i>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "users" && (
          <section className="admin-section">
            <div className="admin-section-head">
              <div>
                <h3>{labels.userManagement}</h3>
                <p className="muted">{labels.totalRecords}: {users.length}</p>
              </div>
              <button className="table-button" onClick={onRefreshUsers}>
                {labels.refresh}
              </button>
            </div>
            <div className="admin-user-layout">
              <div className="admin-user-form">
                <h3>{labels.addOrUpdateUser}</h3>
                <div className="form-grid">
                  <Input label={labels.username} value={userForm.username} onChange={(value) => onUserFormChange({ ...userForm, username: normalizeUsername(value) })} />
                  <Input label={labels.password} value={userForm.password} onChange={(value) => onUserFormChange({ ...userForm, password: value })} />
                  <Input label={labels.displayName} value={userForm.name} onChange={(value) => onUserFormChange({ ...userForm, name: value })} />
                  <label className="control">
                    <span>{labels.adminLogin}</span>
                    <select
                      value={userForm.role}
                      onChange={(event) => {
                        const role = event.target.value as UserRole;
                        onUserFormChange({ ...userForm, role, tier: normalizeSubscriptionTier(userForm.tier, role) });
                      }}
                    >
                      <option value="admin">{labels.roleAdmin}</option>
                      <option value="user">{labels.roleUser}</option>
                    </select>
                  </label>
                  <label className="control">
                    <span>{labels.subscriptionTier}</span>
                    <select
                      value={userForm.tier}
                      onChange={(event) => onUserFormChange({ ...userForm, tier: normalizeSubscriptionTier(event.target.value, userForm.role) })}
                    >
                      <option value="silver">{labels.tierSilver}</option>
                      <option value="gold">{labels.tierGold}</option>
                      <option value="platinum">{labels.tierPlatinum}</option>
                    </select>
                  </label>
                  <label className="control">
                    <span>{labels.userStatus}</span>
                    <select value={userForm.status} onChange={(event) => onUserFormChange({ ...userForm, status: event.target.value as ManagedUser["status"] })}>
                      <option value="active">{labels.active}</option>
                      <option value="inactive">{labels.inactive}</option>
                    </select>
                  </label>
                </div>
                <div className="admin-actions">
                  <button className="primary-button" onClick={onSaveUser} disabled={loading}>
                    {labels.saveUser}
                  </button>
                  <button className="table-button" onClick={onResetUser} disabled={loading}>
                    {labels.resetForm}
                  </button>
                  {editingUserId && <span className="admin-edit-pill">{labels.editUser}</span>}
                </div>
              </div>
              <div className="admin-user-table table-wrap">
                <h3>{labels.managedUsers}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>{labels.username}</th>
                      <th>{labels.displayName}</th>
                      <th>Role</th>
                      <th>{labels.subscriptionTier}</th>
                      <th>{labels.userStatus}</th>
                      <th>{labels.lastChecked}</th>
                      <th>{labels.action}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => {
                      const isCurrent = user.name === currentSession.name || normalizeUsername(user.username) === normalizeUsername(currentSession.username || "");
                      return (
                        <tr key={user.id}>
                          <td>{user.username}</td>
                          <td>{user.name}</td>
                          <td>
                            <span className={`db-status ${user.role === "admin" ? "extracted" : ""}`}>{user.role}</span>
                          </td>
                          <td>
                            <span className={`tier-pill ${user.tier}`}>{tierLabel(user.tier)}</span>
                          </td>
                          <td>
                            <span className={`confidence-pill ${user.status === "active" ? "high" : "low"}`}>
                              {user.status === "active" ? labels.active : labels.inactive}
                            </span>
                          </td>
                          <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "-"}</td>
                          <td className="action-cell">
                            <button className="table-button" onClick={() => onEditUser(user)}>
                              {labels.editUser}
                            </button>
                            <button className="table-button danger" onClick={() => onDeleteUser(user)} disabled={isCurrent || user.id === "user-admin-rsm"}>
                              {labels.deleteUser}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === "privacy" && (
          <section className="admin-section">
            <div className="admin-section-head">
              <div>
                <h3>{labels.privacyTitle}</h3>
                <p className="muted">{labels.privacyIntro}</p>
              </div>
              <span className="admin-edit-pill">{isEnglish ? "Access model" : "Model akses"}</span>
            </div>

            <div className="privacy-grid">
              <section className="privacy-card">
                <h3>{labels.securityControls}</h3>
                <ul className="privacy-check-list">
                  {securityControls.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="privacy-card wide">
                <h3>{labels.saasReadiness}</h3>
                <div className="production-step-grid">
                  {productionSteps.map((item, index) => (
                    <article key={item}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <p>{item}</p>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </section>
        )}

        {activeTab === "api" && (
          <section className="admin-section">
            <div className="settings-subtabs" role="tablist" aria-label={isEnglish ? "Application settings" : "Pengaturan aplikasi"}>
              <button className={settingsTab === "access" ? "active" : ""} onClick={() => setSettingsTab("access")}>
                {isEnglish ? "Access plans" : "Paket akses"}
              </button>
              <button className={settingsTab === "ai" ? "active" : ""} onClick={() => setSettingsTab("ai")}>
                {isEnglish ? "AI & system" : "AI & sistem"}
              </button>
              <button className={settingsTab === "prompts" ? "active" : ""} onClick={() => setSettingsTab("prompts")}>
                {isEnglish ? "Prompt management" : "Prompt management"}
              </button>
            </div>

            {settingsTab === "access" && (
              <section className="settings-workspace compact-settings">
                <div className="settings-heading-row">
                  <div>
                    <h3>{isEnglish ? "Plan access and limits" : "Akses dan limit paket"}</h3>
                    <p className="muted">{isEnglish ? "Choose a plan, adjust limits and feature access, then save once." : "Pilih paket, atur limit dan akses fitur, lalu simpan sekali."}</p>
                  </div>
                  <button className="primary-button" onClick={() => onSaveRuntimeSettings(runtimeSettings)} disabled={loading}>
                    {loading ? (isEnglish ? "Saving..." : "Menyimpan...") : (isEnglish ? "Save settings" : "Simpan pengaturan")}
                  </button>
                </div>
                <div className="plan-selector" role="tablist">
                  {tierList.map((tier) => (
                    <button key={tier} className={selectedPlanTier === tier ? "active" : ""} onClick={() => setSelectedPlanTier(tier)}>
                      {tierNames[tier]}
                    </button>
                  ))}
                </div>
                <div className="settings-limit-grid">
                  <label className="control">
                    <span>{labels.tierDocuments}</span>
                    <input
                      type="number"
                      min="0"
                      placeholder={labels.unlimited}
                      value={selectedPlan.monthlyDocumentLimit ?? ""}
                      onChange={(event) => updateSelectedPlan({ monthlyDocumentLimit: event.target.value === "" ? null : Number(event.target.value) })}
                    />
                  </label>
                  <label className="control">
                    <span>{labels.tierChats}</span>
                    <input
                      type="number"
                      min="0"
                      placeholder={labels.unlimited}
                      value={selectedPlan.monthlyChatLimit ?? ""}
                      onChange={(event) => updateSelectedPlan({ monthlyChatLimit: event.target.value === "" ? null : Number(event.target.value) })}
                    />
                  </label>
                  <div className="settings-plan-note">
                    <b>{tierNames[selectedPlanTier]}</b>
                    <span>{tierDescriptions[selectedPlanTier]}</span>
                  </div>
                </div>
                <div className="feature-toggle-grid">
                  {featureRows.map((feature) => {
                    const enabled = selectedPlan.features.includes(feature.key);
                    return (
                      <button
                        key={feature.key}
                        type="button"
                        className={enabled ? "enabled" : ""}
                        onClick={() => togglePlanFeature(feature.key)}
                        aria-pressed={enabled}
                      >
                        <span>{feature.label}</span>
                        <b>{enabled ? labels.allowed : labels.blocked}</b>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {settingsTab === "prompts" && (
              <section className="settings-workspace prompt-settings">
                <div className="settings-heading-row">
                  <div>
                    <h3>{isEnglish ? "Feature prompt management" : "Prompt management per fitur"}</h3>
                    <p className="muted">{isEnglish ? "Prompts are server-side, versioned by the settings update time, and never shown to regular users." : "Prompt tersimpan di server, mengikuti waktu update pengaturan, dan tidak ditampilkan ke user biasa."}</p>
                  </div>
                  <button className="primary-button" onClick={() => onSaveRuntimeSettings(runtimeSettings)} disabled={loading}>
                    {loading ? (isEnglish ? "Saving..." : "Menyimpan...") : (isEnglish ? "Save prompts" : "Simpan prompt")}
                  </button>
                </div>
                <div className="prompt-feature-tabs" role="tablist">
                  {promptFeatureKeys.map((feature) => (
                    <button key={feature} className={selectedPromptFeature === feature ? "active" : ""} onClick={() => setSelectedPromptFeature(feature)}>
                      {promptNames[feature]}
                    </button>
                  ))}
                </div>
                <div className="prompt-language-toggle" role="group">
                  <button className={selectedPromptLanguage === "id" ? "active" : ""} onClick={() => setSelectedPromptLanguage("id")}>Bahasa Indonesia</button>
                  <button className={selectedPromptLanguage === "en" ? "active" : ""} onClick={() => setSelectedPromptLanguage("en")}>English</button>
                </div>
                <label className="control prompt-editor-field">
                  <span>{isEnglish ? "System instruction" : "Instruksi sistem"}</span>
                  <textarea value={selectedPrompt.system} onChange={(event) => updateSelectedPrompt("system", event.target.value)} />
                  <small>{isEnglish ? "Defines the role, grounding, and non-negotiable guardrails." : "Menetapkan peran, grounding, dan guardrail utama."}</small>
                </label>
                <label className="control prompt-editor-field">
                  <span>{isEnglish ? "Task instruction" : "Instruksi tugas"}</span>
                  <textarea value={selectedPrompt.instruction} onChange={(event) => updateSelectedPrompt("instruction", event.target.value)} />
                  <small>{isEnglish ? "Appended to the feature-specific data contract and output schema." : "Ditambahkan pada kontrak data dan skema output khusus fitur."}</small>
                </label>
              </section>
            )}

            {settingsTab === "ai" && (
              <section className="settings-workspace">
                <ModelRuntimePanel labels={labels} value={modelChoice} onChange={onModelChoiceChange} />
                <div className="admin-section-head settings-health-head">
                  <div>
                    <h3>{labels.apiCheck}</h3>
                    <p className="muted">{labels.apiCheckIntro}{checkedAt ? ` ${labels.lastChecked}: ${new Date(checkedAt).toLocaleString()}` : ""}</p>
                  </div>
                  <div className="admin-actions">
                    <button className="primary-button secondary-button" onClick={onRunCheck} disabled={loading}>
                      {loading ? labels.updatingRules : labels.runApiCheck}
                    </button>
                    <a className="table-button" href="/api/health" target="_blank" rel="noreferrer">{labels.openHealthPage}</a>
                  </div>
                </div>
                <div className="admin-check-grid compact-check-grid">
                  {checks.map((item) => (
                    <article key={item.name} className={`admin-check-card ${item.status}`}>
                      <span>{item.name}</span>
                      <b>{item.status === "ok" ? labels.okStatus : item.status === "warning" ? labels.warningStatus : labels.errorStatus}</b>
                      <p>{item.detail}</p>
                      {item.metric && <small>{item.metric}</small>}
                    </article>
                  ))}
                  {!checks.length && <div className="empty-state">{labels.apiCheckIntro}</div>}
                </div>
                {countsEntries.length > 0 && (
                  <div className="admin-count-grid">
                    {countsEntries.map(([key, value]) => (
                      <article key={key} className="kpi gray"><span>{key.replace(/_/g, " ")}</span><strong>{value}</strong></article>
                    ))}
                  </div>
                )}
              </section>
            )}
          </section>
        )}
      </Panel>
    </section>
  );
}

function SmartChatPanel({
  labels,
  tier,
  question,
  mode,
  response,
  status,
  error,
  loading,
  onQuestionChange,
  onModeChange,
  onAsk,
  caseText,
  caseFileName,
  caseExtraction,
  caseResults,
  caseLoading,
  caseStatus,
  caseError,
  onCaseTextChange,
  onCaseFileChange,
  onCaseSearch
}: {
  labels: (typeof copy)["en"];
  tier: SubscriptionTier;
  question: string;
  mode: SmartChatSourceMode;
  response: SmartChatResponse | null;
  status: string;
  error: string;
  loading: boolean;
  onQuestionChange: (value: string) => void;
  onModeChange: (value: SmartChatSourceMode) => void;
  onAsk: () => void;
  caseText: string;
  caseFileName: string;
  caseExtraction: ExtractionResult | null;
  caseResults: SimilarCaseResult[];
  caseLoading: boolean;
  caseStatus: string;
  caseError: string;
  onCaseTextChange: (value: string) => void;
  onCaseFileChange: (fileList: FileList | null) => void;
  onCaseSearch: () => void;
}) {
  const [activeTab, setActiveTab] = useState<DisputeTabKey>("chat");
  const [captureMode, setCaptureMode] = useState(false);
  const isEnglish = labels.signIn === "Sign in";
  const tierGuide = {
    silver: {
      title: isEnglish ? "Concise rules" : "Aturan ringkas",
      description: isEnglish ? "Closest regulations and one clear next step." : "Peraturan terdekat dan satu langkah lanjut."
    },
    gold: {
      title: isEnglish ? "Rules + decisions" : "Aturan + putusan",
      description: isEnglish ? "Advisor guidance with relevant rules and comparable decisions." : "Panduan advisor dengan aturan dan putusan pembanding."
    },
    platinum: {
      title: isEnglish ? "Deep analysis" : "Analisis mendalam",
      description: isEnglish ? "Issues, rules, decisions, evidence, risks, and strategy." : "Isu, aturan, putusan, bukti, risiko, dan strategi."
    }
  }[tier];
  const starterQuestions = isEnglish
    ? [
        { label: "Rules and first checks", question: "Which rules govern this tax issue and what should I check first?" },
        { label: "Comparable decisions", question: "Which decisions are most comparable and how do their outcomes differ?" },
        { label: "Evidence and strategy", question: "What evidence gaps and argument strategy should the advisor prioritize?" }
      ]
    : [
        { label: "Aturan dan cek awal", question: "Aturan apa yang mengatur isu pajak ini dan apa yang perlu dicek terlebih dahulu?" },
        { label: "Putusan pembanding", question: "Putusan mana yang paling sebanding dan bagaimana perbedaan hasilnya?" },
        { label: "Bukti dan strategi", question: "Celah bukti dan strategi argumentasi apa yang perlu diprioritaskan advisor?" }
      ];
  const scopeCopy = tier === "silver"
    ? (isEnglish ? "Regulations only for concise rule guidance" : "Khusus peraturan untuk panduan aturan ringkas")
    : (isEnglish ? "Regulations and decisions are reviewed together" : "Peraturan dan putusan ditelaah bersama");
  const compactScopeCopy = tier === "silver"
    ? (isEnglish ? "Rules only" : "Aturan saja")
    : (isEnglish ? "Rules + decisions" : "Aturan + putusan");
  const scopeOptions: Array<[SmartChatSourceMode, string, AppIconName, string]> = [
    ["all", labels.smartModeAll, "smartchat", isEnglish ? "Search decisions and regulations" : "Cari putusan dan peraturan"],
    ["decisions", labels.smartModeDecisions, "database", isEnglish ? "Search comparable decisions only" : "Cari putusan pembanding saja"],
    ["regulations", labels.smartModeRegulations, "regulations", isEnglish ? "Search regulations only" : "Cari peraturan saja"]
  ];

  return (
    <section className="dispute-analysis-page">
      <div className="regulation-tab-list dispute-tab-list" role="tablist" aria-label={labels.smartChatTitle}>
        <button className={activeTab === "chat" ? "active" : ""} onClick={() => setActiveTab("chat")}>
          <AppIcon name="smartchat" />
          <span>{labels.disputeTabChat}</span>
        </button>
        <button className={activeTab === "similar" ? "active" : ""} onClick={() => setActiveTab("similar")}>
          <AppIcon name="database" />
          <span>{labels.disputeTabSimilar}</span>
        </button>
      </div>

      {activeTab === "chat" ? (
        <section className={`smart-chat-layout ${captureMode ? "answer-focus-mode" : ""}`}>
          <Panel title={labels.smartChatTitle} className="smart-question-panel">
            <div className="ask-entry-heading">
              <span className="ask-entry-icon"><AppIcon name="smartchat" /></span>
              <div>
                <b>{isEnglish ? "Ask your tax dispute question" : "Tanyakan sengketa pajak Anda"}</b>
                <p>{isEnglish ? "Write naturally. The assistant will retrieve the most relevant sources." : "Tulis dengan bahasa biasa. Asisten akan mengambil sumber yang paling relevan."}</p>
              </div>
            </div>
            <div className={`tier-answer-guide ${tier}`}>
              <span className="tier-answer-badge">{tierLabel(tier)}</span>
              <div>
                <b>{tierGuide.title}</b>
                <p>{tierGuide.description}</p>
              </div>
            </div>
            <div className="starter-question-block">
              <span>{isEnglish ? "Try a starter question" : "Coba pertanyaan awal"}</span>
              <div className="starter-question-list">
                {starterQuestions.map((starter, index) => (
                  <button key={starter.label} type="button" onClick={() => onQuestionChange(starter.question)} title={starter.question}>
                    <span>{index + 1}</span>
                    {starter.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="smart-chat-form">
              <label className="control wide">
                <span className="composer-label-row">
                  <span>{isEnglish ? "Your question" : "Pertanyaan Anda"}</span>
                  <small>{isEnglish ? "Enter to ask · Shift+Enter for a new line" : "Enter untuk bertanya · Shift+Enter untuk baris baru"}</small>
                </span>
                <textarea
                  value={question}
                  onChange={(event) => onQuestionChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      if (!loading && question.trim()) onAsk();
                    }
                  }}
                  placeholder={labels.smartQuestionPlaceholder}
                  rows={3}
                />
              </label>
              <div className="smart-composer-footer">
                <div className="smart-scope-control">
                  <span>{isEnglish ? "Research scope" : "Cakupan riset"}</span>
                {tier === "platinum" ? (
                  <div className="mode-segment scope-icon-segment">
                    {scopeOptions.map(([value, title, icon, description]) => (
                      <button
                        key={value}
                        type="button"
                        className={`scope-icon-button ${mode === value ? "active" : ""}`}
                        onClick={() => onModeChange(value)}
                        aria-label={title}
                        aria-pressed={mode === value}
                        title={description}
                        data-tooltip={description}
                      >
                        <AppIcon name={icon} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="smart-scope-locked compact" title={scopeCopy}>
                    <AppIcon name={tier === "silver" ? "regulations" : "smartchat"} />
                    <span>{compactScopeCopy}</span>
                  </div>
                )}
                </div>
                <button className="primary-button ask-chat-button" type="button" onClick={onAsk} disabled={loading || !question.trim()}>
                  <AppIcon name="smartchat" />
                  <span>{loading ? labels.askingSmartChat : (isEnglish ? "Ask the advisor" : "Tanya advisor")}</span>
                </button>
              </div>
            </div>
            {error && <div className="status-banner error">{error}</div>}
          </Panel>

          <Panel title={labels.smartAnswer} className="smart-answer-panel">
            {!response ? (
              <div className="smart-answer-empty">
                <span><AppIcon name="smartchat" /></span>
                <b>{isEnglish ? "Your structured answer will appear here" : "Jawaban terstruktur akan tampil di sini"}</b>
                <p>{tierGuide.description}</p>
              </div>
            ) : (
              <>
                <div className="answer-brief-header">
                  <div>
                    <span>{isEnglish ? "Tiered advisory answer" : "Jawaban advisor sesuai tier"}</span>
                    <b>{tierLabel(response.retrieval.tier as SubscriptionTier)} · {tierGuide.title}</b>
                  </div>
                  <button className="table-button answer-capture-button" type="button" onClick={() => setCaptureMode((current) => !current)}>
                    <AppIcon name={captureMode ? "collapse" : "expand"} />
                    <span>{captureMode ? (isEnglish ? "Exit screenshot view" : "Keluar tampilan screenshot") : (isEnglish ? "Screenshot view" : "Tampilan screenshot")}</span>
                  </button>
                </div>
                {status && <div className="status-banner success">{status}</div>}
                <MarkdownText text={response.answer} structured />
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
      ) : (
        <CaseSearchPanel
          labels={labels}
          text={caseText}
          fileName={caseFileName}
          extraction={caseExtraction}
          results={caseResults}
          loading={caseLoading}
          status={caseStatus}
          error={caseError}
          onTextChange={onCaseTextChange}
          onFileChange={onCaseFileChange}
          onSearch={onCaseSearch}
        />
      )}
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
