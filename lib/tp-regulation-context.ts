import type { Regulation } from "./mock-data";

export type TpRegulationContextItem = {
  title: string;
  citation: string;
  focus: string;
  sourceUrl: string;
  sourceAuthority: string;
  legalStatus: "active" | "amended" | "partially_revoked" | "revoked" | "unknown";
  effectiveDate: string;
  keyProvisions: Array<{ article?: string; page?: number; text: string }>;
};

function isTransferPricing(record: Regulation) {
  return record.topic === "transfer_pricing"
    || /transfer pricing|hubungan istimewa|kewajaran|kelaziman usaha|dokumentasi penentuan harga transfer/i.test(`${record.title} ${record.citation} ${record.focus}`);
}

function score(record: Regulation) {
  const legalStatus = record.extraction?.legalStatus || "unknown";
  return Number(record.relevance || 0)
    + (/PMK\s*(?:NOMOR\s*)?172\b|172\s*TAHUN\s*2023/i.test(`${record.title} ${record.citation}`) ? 1_000 : 0)
    + (record.source === "official" ? 220 : 0)
    + (record.sourceUrl ? 60 : 0)
    + (legalStatus === "active" ? 180 : legalStatus === "revoked" ? -300 : 0)
    + (record.ingestionStatus === "ready" ? 40 : 0)
    + (record.extraction?.keyProvisions?.length ? 30 : 0);
}

export function selectTpRegulationContext(records: Regulation[], limit = 15): TpRegulationContextItem[] {
  const selected = records.filter(isTransferPricing).sort((left, right) => score(right) - score(left));
  const seen = new Set<string>();
  const result: TpRegulationContextItem[] = [];
  for (const record of selected) {
    const key = String(record.canonicalKey || record.citation || record.title).toLocaleLowerCase("id-ID").replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      title: record.title,
      citation: record.citation,
      focus: record.focus,
      sourceUrl: record.sourceUrl || record.officialPdfUrl || record.pdfUrl || "",
      sourceAuthority: record.sourceAuthority || "",
      legalStatus: record.extraction?.legalStatus || "unknown",
      effectiveDate: record.extraction?.effectiveDate || "",
      keyProvisions: (record.extraction?.keyProvisions || []).slice(0, 12)
    });
    if (result.length >= Math.max(1, Math.min(30, limit))) break;
  }
  return result;
}
