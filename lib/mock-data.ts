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

export type Regulation = {
  id: string;
  title: string;
  citation: string;
  focus: string;
  relevance: number;
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
  }
];

export const regulations: Regulation[] = [
  {
    id: "uu-ppn",
    title: "VAT Law",
    citation: "Law No. 8/1983 as amended",
    focus: "Taxable delivery, VAT object, input VAT creditability, and formal VAT documentation.",
    relevance: 94
  },
  {
    id: "pp-ppn",
    title: "VAT Implementing Regulation",
    citation: "Government Regulation on VAT implementation",
    focus: "Transaction treatment, tax base, and timing of VAT payable.",
    relevance: 82
  },
  {
    id: "per-faktur",
    title: "Tax Invoice Regulation",
    citation: "DGT regulation on tax invoices",
    focus: "Invoice validity, correction, replacement, and administrative evidence.",
    relevance: 79
  }
];

export const recentDocuments = [
  { decision: "PUT-012093.16.2023.PP.M.XIIIA", documentType: "Tax Court decision", taxpayer: "PT SARI LEMBAH SUBUR", tax: "VAT", issue: "Input VAT", outcome: "Taxpayer fully prevailed" },
  { decision: "PUT-011254.16/2021/PP/M.XIB", documentType: "Tax Court decision", taxpayer: "PT SINGA TERBANG DUNIA", tax: "VAT", issue: "VAT tax base", outcome: "Tax authority prevailed" },
  { decision: "PUT-003113.16/2022/PP/M.XIA", documentType: "Tax Court decision", taxpayer: "PT DEMO WAJIB PAJAK", tax: "VAT", issue: "Input VAT", outcome: "Taxpayer partially prevailed" }
];
