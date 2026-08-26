import type { ExtractionResult } from "./extraction";
import type { Regulation } from "./mock-data";
import { isAllowedOfficialRegulationUrl, officialRegulationSourceLabel } from "./regulation-sources";
import type { SearchDocument } from "./search-contracts";
import type { StoredDecisionFile } from "./stored-decisions";

export type DecisionPageChunk = {
  page: number;
  text: string;
  paragraph?: string;
};

function compact(values: unknown[]) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
}

function decisionBody(extraction: ExtractionResult) {
  return compact([
    extraction.taxpayerName,
    extraction.taxType,
    extraction.taxPeriod,
    extraction.issueType,
    extraction.issueSubtype,
    extraction.correctionObject,
    extraction.correctionReason,
    extraction.taxAuthorityPosition,
    extraction.taxpayerPosition,
    extraction.taxpayerRebuttal,
    extraction.evidence,
    extraction.legalReferences,
    extraction.courtReasoning,
    extraction.outcome,
    extraction.summary
  ]);
}

/**
 * Converts existing decision records without pretending summary extraction has
 * page-level provenance. It only becomes `verified` when immutable source hash
 * and page chunks are supplied by the ingestion pipeline.
 */
export function decisionToSearchDocuments(
  record: StoredDecisionFile,
  options: { tenantId: string; sourceHash?: string; pageChunks?: DecisionPageChunk[] }
): SearchDocument[] {
  if (!options.tenantId.trim()) throw new Error("tenantId is required when indexing a private decision.");
  if (!record.extraction) return [];
  const extraction = record.extraction;
  const citation = extraction.putusanNumber || record.filename;
  const base = {
    corpus: "decision" as const,
    title: citation,
    citation,
    sourceUrl: record.downloadUrl || record.url || "",
    sourceHash: options.sourceHash || "",
    authority: "Pengadilan Pajak",
    visibility: "tenant" as const,
    tenantId: options.tenantId,
    metadata: {
      taxpayer: extraction.taxpayerName,
      taxType: extraction.taxType,
      taxPeriod: extraction.taxPeriod,
      outcome: extraction.outcome,
      documentId: record.id
    }
  };
  const chunks = (options.pageChunks || []).filter((chunk) => Number.isInteger(chunk.page) && chunk.page > 0 && chunk.text.trim());
  if (chunks.length && options.sourceHash) {
    return chunks.map((chunk, index) => ({
      ...base,
      id: `decision:${record.id}:p${chunk.page}:${index + 1}`,
      body: chunk.text.trim(),
      locator: { page: chunk.page, paragraph: chunk.paragraph },
      status: "verified" as const
    }));
  }
  return [
    {
      ...base,
      id: `decision:${record.id}:summary`,
      body: decisionBody(extraction),
      status: "review_required"
    }
  ];
}

export function regulationToSearchDocuments(record: Regulation): SearchDocument[] {
  const canonicalId = record.canonicalKey || record.id;
  const sourceUrl = record.officialPdfUrl || record.sourceUrl || record.pdfUrl || "";
  const official = isAllowedOfficialRegulationUrl(sourceUrl);
  const extraction = record.extraction;
  const effectiveTo = [...(extraction?.relations || []), ...(record.relations || [])]
    .find((relation) => relation.type === "revoked_by" && relation.effectiveDate)?.effectiveDate;
  const knownStatus = extraction?.legalStatus && extraction.legalStatus !== "unknown";
  const base = {
    corpus: "regulation" as const,
    title: record.title,
    citation: record.citation,
    sourceUrl,
    sourceHash: record.fileHash || "",
    authority: record.sourceAuthority || officialRegulationSourceLabel(sourceUrl),
    visibility: "public" as const,
    metadata: {
      topic: record.topic || "general",
      topicLabel: record.topic === "vat" ? "PPN" : record.topic === "income_tax" ? "PPh" : record.topic === "transfer_pricing" ? "Transfer pricing" : "Umum",
      canonicalKey: canonicalId,
      legalStatus: extraction?.legalStatus || "unknown",
      effectiveDate: extraction?.effectiveDate || "",
      year: Number(String(record.citation || record.title).match(/\b((?:19|20)\d{2})\b/)?.[1] || 0),
      sourcePageUrl: record.sourceUrl || "",
      pdfUrl: record.storedPdfUrl || record.officialPdfUrl || record.pdfUrl || ""
    }
  };
  const provisions = extraction?.keyProvisions?.filter((provision) => provision.text.trim()) || [];
  const hasImmutableHash = /^(?:sha256:)?[a-f0-9]{64}$/i.test(String(record.fileHash || "").trim());
  if (official && knownStatus && provisions.length) {
    return provisions.map((provision, index) => ({
      ...base,
      id: `regulation:${canonicalId}:${index + 1}`,
      body: compact([extraction?.summary, provision.text]),
      locator: { page: provision.page, section: provision.article },
      status: hasImmutableHash && (provision.page || provision.article) ? "verified" as const : "review_required" as const,
      effectiveFrom: extraction?.effectiveDate,
      effectiveTo
    }));
  }
  return [
    {
      ...base,
      id: `regulation:${canonicalId}:summary`,
      body: compact([record.focus, record.content, extraction?.summary]),
      status: "review_required",
      effectiveFrom: extraction?.effectiveDate,
      effectiveTo
    }
  ];
}

export function buildSearchCorpus({
  decisions,
  regulations,
  tenantId
}: {
  decisions: StoredDecisionFile[];
  regulations: Regulation[];
  tenantId: string;
}) {
  return [
    ...regulations.flatMap(regulationToSearchDocuments),
    ...decisions.flatMap((decision) => decisionToSearchDocuments(decision, { tenantId }))
  ];
}
