import type { Regulation } from "./mock-data";
import { isAllowedOfficialRegulationUrl, isAllowedPdfReferenceUrl } from "./regulation-sources";

export type DocumentReadinessFlag =
  | "missing_official_url"
  | "missing_pdf"
  | "missing_source_hash"
  | "missing_locator"
  | "unknown_legal_status"
  | "missing_effective_date"
  | "missing_extracted_text";

export type RegulationDocumentReadiness = {
  id: string;
  canonical: string;
  title: string;
  citation: string;
  sourceUrl: string;
  pdfUrl: string;
  sourceHash: string;
  legalStatus: string;
  effectiveDate: string;
  locator: { page?: number; section?: string } | null;
  flags: DocumentReadinessFlag[];
  score: number;
  answerEligible: boolean;
};

const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/i;

export function assessRegulationDocumentReadiness(record: Regulation): RegulationDocumentReadiness {
  const sourceUrl = isAllowedOfficialRegulationUrl(record.sourceUrl)
    ? String(record.sourceUrl)
    : isAllowedOfficialRegulationUrl(record.officialPdfUrl) ? String(record.officialPdfUrl) : "";
  const pdfCandidates = [record.storedPdfUrl, record.pdfUrl, record.officialPdfUrl, ...(record.pdfUrls || [])];
  const pdfUrl = pdfCandidates.map((value) => String(value || "")).find((value) => isAllowedPdfReferenceUrl(value)) || "";
  const sourceHash = String(record.fileHash || "").trim();
  const provisions = record.extraction?.keyProvisions?.filter((provision) => provision.text.trim()) || [];
  const located = provisions.find((provision) => (Number.isInteger(provision.page) && Number(provision.page) > 0) || String(provision.article || "").trim());
  const legalStatus = String(record.extraction?.legalStatus || "unknown");
  const effectiveDate = String(record.extraction?.effectiveDate || "").trim();
  const flags: DocumentReadinessFlag[] = [];
  if (!sourceUrl) flags.push("missing_official_url");
  if (!pdfUrl) flags.push("missing_pdf");
  if (!SHA256.test(sourceHash)) flags.push("missing_source_hash");
  if (!located) flags.push("missing_locator");
  if (legalStatus === "unknown") flags.push("unknown_legal_status");
  if (!effectiveDate) flags.push("missing_effective_date");
  if (!record.content?.trim() && !record.extraction?.summary?.trim() && !provisions.length) flags.push("missing_extracted_text");

  const passed = 7 - flags.length;
  return {
    id: record.id,
    canonical: record.canonicalKey || record.id,
    title: record.title,
    citation: record.citation,
    sourceUrl,
    pdfUrl,
    sourceHash,
    legalStatus,
    effectiveDate,
    locator: located ? { page: located.page, section: located.article } : null,
    flags,
    score: Math.round((passed / 7) * 100),
    answerEligible: !flags.some((flag) => ["missing_official_url", "missing_source_hash", "missing_locator", "unknown_legal_status"].includes(flag))
  };
}

export function buildDocumentReadinessQueue(records: readonly Regulation[]) {
  return records.map(assessRegulationDocumentReadiness).filter((item) => item.flags.length > 0);
}

export function summarizeDocumentReadiness(records: readonly Regulation[]) {
  const assessed = records.map(assessRegulationDocumentReadiness);
  const flagCounts: Record<string, number> = {};
  for (const item of assessed) for (const flag of item.flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
  return {
    total: assessed.length,
    complete: assessed.filter((item) => item.flags.length === 0).length,
    answerEligible: assessed.filter((item) => item.answerEligible).length,
    reviewRequired: assessed.filter((item) => item.flags.length > 0).length,
    averageScore: assessed.length ? Math.round(assessed.reduce((sum, item) => sum + item.score, 0) / assessed.length) : 0,
    flagCounts
  };
}
