import { essentialRegulationSeeds } from "./essential-regulations";

export type OutcomeKey = "WP_FULL_WIN" | "WP_PARTIAL_WIN" | "DJP_WIN" | "FORMAL_REJECTED" | "UNKNOWN";

export type ComparableDecision = {
  id: string;
  number: string;
  taxType: string;
  issue: string;
  outcome: OutcomeKey;
  score: number;
  amount: string;
  reasoning: string;
  implication: string;
  matchPoints: string[];
};

export type RegulationIngestionStatus =
  | "seed"
  | "resolving"
  | "downloading"
  | "downloaded"
  | "extracting"
  | "ready"
  | "review_required"
  | "failed";

export type RegulationRelationType = "amends" | "amended_by" | "revokes" | "revoked_by" | "implements" | "references" | "related";

export type RegulationRelation = {
  type: RegulationRelationType;
  citation: string;
  title?: string;
  effectiveDate?: string;
  note?: string;
  source?: "pdf" | "official_page" | "seed";
};

export type RegulationProvision = {
  article?: string;
  page?: number;
  text: string;
};

export type RegulationExtraction = {
  schemaVersion: "regulation-extraction-v1";
  summary: string;
  scope: string[];
  keyProvisions: RegulationProvision[];
  effectiveDate?: string;
  legalStatus: "active" | "amended" | "partially_revoked" | "revoked" | "unknown";
  statusNote?: string;
  relations: RegulationRelation[];
  keywords: string[];
  verificationNotes: string[];
  extractedAt: string;
  model: string;
  sourcePdfUrl: string;
};

export type RegulationTranslation = {
  title?: string;
  focus?: string;
  content?: string;
};

export type Regulation = {
  id: string;
  topic?: "vat" | "transfer_pricing" | "general";
  title: string;
  citation: string;
  focus: string;
  relevance: number;
  source?: "seed" | "official" | "manual";
  sourceUrl?: string;
  pdfUrl?: string;
  officialPdfUrl?: string;
  storedPdfUrl?: string;
  sourceAuthority?: string;
  canonicalKey?: string;
  sourceLanguage?: "id" | "en";
  translations?: Partial<Record<"id" | "en", RegulationTranslation>>;
  content?: string;
  ingestionStatus?: RegulationIngestionStatus;
  ingestionMessage?: string;
  fileHash?: string;
  extraction?: RegulationExtraction | null;
  relations?: RegulationRelation[];
  extractedAt?: string;
  updatedAt?: string;
};

export const outcomeLabels: Record<OutcomeKey, { id: string; en: string }> = {
  WP_FULL_WIN: { id: "WP dikabulkan seluruhnya", en: "Taxpayer fully prevailed" },
  WP_PARTIAL_WIN: { id: "WP dikabulkan sebagian", en: "Taxpayer partially prevailed" },
  DJP_WIN: { id: "DJP menang / banding ditolak", en: "Tax authority prevailed / appeal rejected" },
  FORMAL_REJECTED: { id: "Tidak dapat diterima / gugur", en: "Dismissed on formal grounds" },
  UNKNOWN: { id: "Belum terklasifikasi", en: "Unclassified" }
};

export const dashboardStats = {
  indexedDecisions: 115,
  extractionCoverage: 100,
  vatDocuments: 66,
  localRegulations: 24,
  llmLabels: 43
};

export const outcomeDistribution = [
  { label: "Tax authority prevailed", value: 42, color: "#54585A" },
  { label: "Taxpayer partially prevailed", value: 38, color: "#43A047" },
  { label: "Taxpayer fully prevailed", value: 25, color: "#66C7EE" },
  { label: "Formal dismissal", value: 10, color: "#8A8F93" }
];

export const issueDistribution = [
  { label: "Formal", value: 35 },
  { label: "Income Tax", value: 26 },
  { label: "Input VAT", value: 19 },
  { label: "Penalty", value: 16 },
  { label: "VAT Tax Base", value: 12 }
];

export const comparableDecisions: ComparableDecision[] = [
  {
    id: "put-011254",
    number: "PUT-011254.16/2021/PP/M.XIB Tahun 2023",
    taxType: "VAT",
    issue: "VAT tax base",
    outcome: "DJP_WIN",
    score: 62.6,
    amount: "Rp674,560,719",
    reasoning:
      "The panel tested whether the disputed delivery still had a sufficient link with taxable business activity and whether the taxpayer rebuttal was supported by reconciled evidence.",
    implication:
      "Use this decision as a risk comparator. Distinguish the current case with stronger transaction chronology, payment flow, and VAT reporting reconciliation.",
    matchPoints: ["same tax type", "similar VAT tax base issue", "appeal-stage dispute", "evidence sufficiency matters"]
  },
  {
    id: "put-003113",
    number: "PUT-003113.16/2022/PP/M.XIA Tahun 2023",
    taxType: "VAT",
    issue: "Input VAT",
    outcome: "WP_PARTIAL_WIN",
    score: 58.8,
    amount: "Rp965,529,378",
    reasoning:
      "The panel gave weight to documentary consistency where invoices, payments, and reporting records could be tied back to the taxpayer position.",
    implication:
      "Useful as a supporting comparator if the taxpayer can show the same evidentiary chain and avoid relying on outcome alone.",
    matchPoints: ["VAT issue", "evidence reconciliation", "partial taxpayer success", "documentary consistency"]
  },
  {
    id: "put-012093",
    number: "PUT-012093.16.2023.PP.M.XIIIA Tahun 2025",
    taxType: "VAT",
    issue: "Input VAT",
    outcome: "WP_FULL_WIN",
    score: 67.4,
    amount: "Rp421,860,000",
    reasoning:
      "The panel focused on whether input VAT was supported by valid tax invoices, reporting consistency, and counterparty confirmation that tied the purchase to taxable business activity.",
    implication:
      "Useful as a positive comparator when the taxpayer has complete invoices, VAT return reconciliation, and third-party confirmation.",
    matchPoints: ["input VAT", "tax invoice validity", "VAT return reconciliation", "counterparty confirmation"]
  },
  {
    id: "put-012088",
    number: "PUT-012088.16.2023.PP.M.XIIIA Tahun 2025",
    taxType: "VAT",
    issue: "Input VAT",
    outcome: "WP_FULL_WIN",
    score: 66.9,
    amount: "Rp279,259,144",
    reasoning:
      "The taxpayer succeeded because the disputed input VAT could be traced through invoices, payments, bookkeeping, and VAT reporting records.",
    implication:
      "Use as a comparator for evidence-chain arguments, especially where the tax authority questions whether documents reflect real transactions.",
    matchPoints: ["input VAT", "payment evidence", "bookkeeping", "transaction reality"]
  },
  {
    id: "put-011729",
    number: "PUT-011729.16.2021.PP.M.XVIA Tahun 2025",
    taxType: "VAT",
    issue: "VAT tax base",
    outcome: "WP_PARTIAL_WIN",
    score: 61.2,
    amount: "Rp580,000,000",
    reasoning:
      "The panel partially maintained the correction where only part of the tax base was supported by a coherent sales ledger, payment trail, and delivery evidence.",
    implication:
      "Helpful for partial-grant strategy: concede weak transaction lines and defend the portion supported by complete reconciliation.",
    matchPoints: ["VAT tax base", "partial correction", "sales ledger", "payment trail"]
  },
  {
    id: "put-011803",
    number: "PUT-011803.19.2024.PP.M.VIIB Tahun 2025",
    taxType: "Income Tax",
    issue: "Formal appeal requirement",
    outcome: "FORMAL_REJECTED",
    score: 48.5,
    amount: "-",
    reasoning:
      "The panel did not proceed to substance because formal requirements, authority documents, and appeal timing were not sufficiently established.",
    implication:
      "Use only as a procedural risk comparator when the uploaded case mentions power of attorney, filing deadline, or incomplete appeal documentation.",
    matchPoints: ["formal requirement", "power of attorney", "appeal timing", "procedural risk"]
  },
  {
    id: "put-011884",
    number: "PUT-011884.16.2023.PP.M.XIVA Tahun 2025",
    taxType: "VAT",
    issue: "Tax invoice administration",
    outcome: "DJP_WIN",
    score: 55.3,
    amount: "Rp338,750,000",
    reasoning:
      "The panel emphasized that administrative defects in VAT invoices can defeat the taxpayer position when not cured by replacement invoices or reliable transaction evidence.",
    implication:
      "Treat as a risk comparator for cases involving invoice defects, late correction, or incomplete formal VAT documentation.",
    matchPoints: ["VAT invoice", "administrative defect", "replacement invoice", "formal documentation"]
  }
];

const coreRegulations: Regulation[] = [
  {
    id: "per-faktur",
    topic: "vat",
    title: "Tax Invoice Regulation",
    citation: "DGT regulation on tax invoices",
    focus: "Invoice validity, correction, replacement, and administrative evidence.",
    relevance: 79,
    source: "seed",
    sourceUrl: ""
  },
  {
    id: "pmk-213-tp-doc",
    topic: "transfer_pricing",
    title: "Transfer Pricing Documentation",
    citation: "Minister of Finance Regulation No. 213/2016",
    focus:
      "Master file, local file, and country-by-country report obligations, including timing, thresholds, and documentation readiness for related-party taxpayers.",
    relevance: 90,
    source: "seed",
    sourceUrl: ""
  },
  {
    id: "per-22-tp-audit",
    topic: "transfer_pricing",
    title: "Transfer Pricing Audit Guidance",
    citation: "DGT Regulation No. PER-22/PJ/2013",
    focus:
      "Audit approach for taxpayers with related-party transactions, including functional analysis, comparability review, tested party selection, method review, and evidence expectations.",
    relevance: 88,
    source: "seed",
    sourceUrl: ""
  },
  {
    id: "per-32-alp",
    topic: "transfer_pricing",
    title: "Arm's Length Principle Application",
    citation: "DGT Regulation No. PER-32/PJ/2011",
    focus:
      "Operational guidance for applying arm's length principles to related-party transactions, including comparability factors and transfer pricing methods.",
    relevance: 82,
    source: "seed",
    sourceUrl: ""
  },
  {
    id: "pmk-22-apa",
    topic: "transfer_pricing",
    title: "Advance Pricing Agreement",
    citation: "Minister of Finance Regulation No. 22/2020",
    focus:
      "Procedure and governance for unilateral or bilateral advance pricing agreements, useful for forward-looking TP risk management and dispute prevention.",
    relevance: 76,
    source: "seed",
    sourceUrl: ""
  }
];

export const regulations: Regulation[] = [...coreRegulations, ...essentialRegulationSeeds];

export const recentDocuments = [
  { decision: "PUT-012093.16.2023.PP.M.XIIIA", documentType: "Tax Court decision", taxpayer: "PT SARI LEMBAH SUBUR", tax: "VAT", issue: "Input VAT", outcome: "Taxpayer fully prevailed" },
  { decision: "PUT-011254.16/2021/PP/M.XIB", documentType: "Tax Court decision", taxpayer: "PT SINGA TERBANG DUNIA", tax: "VAT", issue: "VAT tax base", outcome: "Tax authority prevailed" },
  { decision: "PUT-003113.16/2022/PP/M.XIA", documentType: "Tax Court decision", taxpayer: "PT DEMO WAJIB PAJAK", tax: "VAT", issue: "Input VAT", outcome: "Taxpayer partially prevailed" }
];
