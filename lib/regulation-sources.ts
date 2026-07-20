export type RegulationSourceScope = "all" | "bpk" | "kemenkeu" | "djp" | "ortax" | "other";

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
  if (["ortax", "datacenter_ortax"].includes(normalized)) return "ortax";
  if (["other", "lain", "sumber_lain"].includes(normalized)) return "other";
  return "all";
}

export function regulationSourceBucket(sourceUrl: string | null | undefined): Exclude<RegulationSourceScope, "all"> {
  try {
    const hostname = new URL(String(sourceUrl || "")).hostname.replace(/^www\./, "").toLowerCase();
    if (hostname.includes("peraturan.bpk.go.id")) return "bpk";
    if (hostname.includes("jdih.kemenkeu.go.id")) return "kemenkeu";
    if (hostname.includes("pajak.go.id")) return "djp";
    if (hostname.includes("datacenter.ortax.org") || hostname.includes("ortax.org")) return "ortax";
  } catch {
    return "other";
  }
  return "other";
}

export function regulationSourceMatches(sourceUrl: string | null | undefined, scope: RegulationSourceScope) {
  if (scope === "all") return /^https?:\/\//i.test(String(sourceUrl || ""));
  return regulationSourceBucket(sourceUrl) === scope;
}
