import type { ExtractionResult, PpnComponents } from "./extraction";

const CORE_FIELDS: Array<keyof ExtractionResult> = [
  "putusanNumber",
  "putusanYear",
  "courtPanel",
  "decisionDate",
  "taxpayerName",
  "taxType",
  "taxPeriod",
  "issueType",
  "correctionAmount",
  "correctionObject",
  "taxAuthorityPosition",
  "taxpayerPosition",
  "courtReasoning",
  "outcome"
];

const SUPPORTING_FIELDS: Array<keyof ExtractionResult> = [
  "clerkName",
  "taxpayerNpwp",
  "taxpayerAddress",
  "legalCounselName",
  "djpUnit",
  "skpNumber",
  "djpDecisionNumber"
];

const PPN_VALUE_FIELDS: Array<keyof PpnComponents> = [
  "ppn_dpp",
  "ppn_pajak_keluaran",
  "ppn_pajak_masukan",
  "ppn_kb_lb",
  "ppn_kompensasi",
  "ppn_masih_harus_bayar",
  "ppn_dpp_djp",
  "ppn_pm_djp",
  "ppn_sanksi_pasal_13",
  "ppn_koreksi_dpp",
  "ppn_koreksi_pm",
  "ppn_tarif"
];

function present(value: unknown) {
  return Boolean(String(value ?? "").trim());
}

export function isPpnExtraction(extraction: ExtractionResult | null | undefined) {
  if (!extraction) return false;
  return /\b(?:ppn|vat|pajak pertambahan nilai|pajak masukan|pajak keluaran|dpp)\b/i.test(
    [extraction.taxType, extraction.issueType, extraction.issueSubtype, extraction.correctionObject].filter(Boolean).join(" ")
  );
}

export function ppnExtractionCoverage(extraction: ExtractionResult | null | undefined) {
  if (!extraction?.ppnComponents) return 0;
  const values = PPN_VALUE_FIELDS.filter((field) => present(extraction.ppnComponents[field])).length;
  const classification = [
    extraction.ppnComponents.ppn_jenis_penyerahan,
    extraction.ppnComponents.ppn_objek_sengketa,
    extraction.ppnComponents.ppn_is_lb === null ? "" : String(extraction.ppnComponents.ppn_is_lb)
  ].filter(present).length;
  return Math.round(((values + classification) / (PPN_VALUE_FIELDS.length + 3)) * 100);
}

export type ExtractionQuality = {
  score: number;
  label: "complete" | "review" | "reextract";
  warnings: string[];
  ppnCase: boolean;
  ppnCoverage: number;
};

/**
 * Deterministic extraction completeness. This deliberately does not claim
 * statistical confidence: a fully populated JSON object can still be wrong.
 */
export function extractionQuality(extraction: ExtractionResult | null | undefined): ExtractionQuality {
  if (!extraction) return { score: 0, label: "reextract", warnings: ["Belum ada hasil ekstraksi."], ppnCase: false, ppnCoverage: 0 };

  const coreCoverage = CORE_FIELDS.filter((field) => present(extraction[field])).length / CORE_FIELDS.length;
  const supportingCoverage = SUPPORTING_FIELDS.filter((field) => present(extraction[field])).length / SUPPORTING_FIELDS.length;
  const arraysCoverage = [extraction.judgeNames, extraction.evidence, extraction.legalReferences].filter(
    (items) => Array.isArray(items) && items.some(present)
  ).length / 3;
  const ppnCase = isPpnExtraction(extraction);
  const ppnCoverage = ppnExtractionCoverage(extraction);
  const domainCoverage = ppnCase ? ppnCoverage / 100 : 1;

  let score = Math.round((coreCoverage * 0.58 + supportingCoverage * 0.17 + arraysCoverage * 0.15 + domainCoverage * 0.1) * 100);
  const warnings: string[] = [];

  if (ppnCase && ppnCoverage === 0) {
    score = Math.min(score, 74);
    warnings.push("Perkara terindikasi PPN, tetapi seluruh komponen nilai PPN masih kosong.");
  } else if (ppnCase && ppnCoverage < 20) {
    score = Math.min(score, 84);
    warnings.push("Komponen nilai PPN baru terisi sebagian dan perlu diverifikasi pada tabel perhitungan.");
  }
  if (!extraction.evidence?.length) warnings.push("Daftar bukti belum terstruktur.");
  if (!extraction.legalReferences?.length) warnings.push("Daftar dasar hukum belum terstruktur.");
  if (!present(extraction.correctionAmount)) warnings.push("Nilai sengketa/koreksi belum terbaca.");
  if (!present(extraction.outcome)) warnings.push("Amar atau hasil putusan belum terbaca.");
  if (/[\u0980-\u09ff]/.test(JSON.stringify(extraction))) warnings.push("Terdapat karakter asing yang perlu dibersihkan dari hasil OCR/LLM.");

  return {
    score: Math.max(0, Math.min(100, score)),
    label: score >= 90 && warnings.length === 0 ? "complete" : score >= 70 ? "review" : "reextract",
    warnings,
    ppnCase,
    ppnCoverage
  };
}

export function extractionCompleteness(extraction: ExtractionResult | null | undefined) {
  return extractionQuality(extraction).score;
}
