export type RegulationSourceScope = "all" | "bpk" | "kemenkeu" | "djp" | "other";

export const regulationSourceScopeOptions: Array<{ key: RegulationSourceScope; id: string; en: string }> = [
  { key: "all", id: "Semua sumber resmi", en: "All official links" },
  { key: "bpk", id: "JDIH BPK", en: "JDIH BPK" },
  { key: "kemenkeu", id: "JDIH Kemenkeu", en: "JDIH Kemenkeu" },
  { key: "djp", id: "DJP / Pajak.go.id", en: "DGT / Pajak.go.id" },
  { key: "other", id: "Repository resmi lain", en: "Other official repositories" }
];

export function normalizeRegulationSourceScope(value: string | null | undefined): RegulationSourceScope {
  const normalized = String(value || "all").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (["bpk", "jdih_bpk", "peraturan_bpk"].includes(normalized)) return "bpk";
  if (["kemenkeu", "jdih_kemenkeu", "kemenkeu_jdih"].includes(normalized)) return "kemenkeu";
  if (["djp", "pajak", "pajak_go_id", "dgt"].includes(normalized)) return "djp";
  if (["other", "lain", "sumber_lain"].includes(normalized)) return "other";
  return "all";
}

export function regulationSourceBucket(sourceUrl: string | null | undefined): Exclude<RegulationSourceScope, "all"> {
  try {
    const hostname = new URL(String(sourceUrl || "")).hostname.replace(/^www\./, "").toLowerCase();
    if (hostname.includes("peraturan.bpk.go.id")) return "bpk";
    if (hostname.includes("jdih.kemenkeu.go.id")) return "kemenkeu";
    if (hostname.includes("pajak.go.id")) return "djp";
  } catch {
    return "other";
  }
  return "other";
}

export function regulationSourceMatches(sourceUrl: string | null | undefined, scope: RegulationSourceScope) {
  if (scope === "all") return isAllowedOfficialRegulationUrl(sourceUrl);
  return isAllowedOfficialRegulationUrl(sourceUrl) && regulationSourceBucket(sourceUrl) === scope;
}

export function isAllowedOfficialRegulationUrl(sourceUrl: string | null | undefined) {
  try {
    const hostname = new URL(String(sourceUrl || "")).hostname.replace(/^www\./, "").toLowerCase();
    return hostname.endsWith(".go.id") || hostname === "go.id";
  } catch {
    return false;
  }
}

/** Internal PDF routes are safe to expose in the local catalog but are not
 * treated as government provenance.  They let supplied reference books and
 * locally stored PDFs remain clickable without weakening the official URL
 * allow-list used by citations. */
export function isAllowedLocalPdfReference(sourceUrl: string | null | undefined) {
  const value = String(sourceUrl || "").trim();
  return /^\/(?:api\/reference-pdfs|reference-pdfs)\/[a-z0-9._/-]+(?:#.*)?$/i.test(value);
}

export function isAllowedPdfReferenceUrl(sourceUrl: string | null | undefined) {
  return isAllowedOfficialRegulationUrl(sourceUrl) || isAllowedLocalPdfReference(sourceUrl);
}

export function officialRegulationSourceLabel(sourceUrl: string | null | undefined) {
  const bucket = regulationSourceBucket(sourceUrl);
  if (bucket === "bpk") return "JDIH BPK";
  if (bucket === "kemenkeu") return "JDIH Kementerian Keuangan";
  if (bucket === "djp") return "Direktorat Jenderal Pajak";
  return isAllowedOfficialRegulationUrl(sourceUrl) ? "Situs resmi pemerintah" : "";
}
