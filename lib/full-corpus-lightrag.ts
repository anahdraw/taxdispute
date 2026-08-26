import { createHash } from "node:crypto";
import type { Regulation } from "./mock-data";

export const FULL_CORPUS_LIGHTRAG_SCHEMA = "aa-jurist-lightrag-full-corpus-v1" as const;

export type FullCorpusLightRagEntry = {
  id: string;
  canonicalKey: string;
  citation: string;
  textHash: string;
  sourceHash: string;
  legalStatus: string;
  relationCount: number;
  locatorCount: number;
};

export type FullCorpusLightRagManifest = {
  schema: typeof FULL_CORPUS_LIGHTRAG_SCHEMA;
  generatedAt: string;
  documentCount: number;
  corpusHash: string;
  citationReadyCount: number;
  graphRelationCount: number;
  entries: FullCorpusLightRagEntry[];
};

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function renderFullCorpusLightRagDocument(record: Regulation) {
  const extraction = record.extraction;
  const provisions = (extraction?.keyProvisions || []).map((item) => `${item.article || "Bagian"}${item.page ? ` (hal. ${item.page})` : ""}: ${clean(item.text)}`);
  const relations = (record.relations || extraction?.relations || []).map((item) => `${item.type}: ${clean(item.citation)}${item.note ? ` — ${clean(item.note)}` : ""}`);
  return [
    "DOKUMEN PERATURAN AA-JURIST — FULL CORPUS",
    `AAJ-CANONICAL-ID: ${clean(record.canonicalKey || record.id)}`,
    `Judul: ${clean(record.title)}`,
    `Sitasi: ${clean(record.citation)}`,
    `Topik: ${clean(record.topic || "general")}`,
    `Status hukum: ${clean(extraction?.legalStatus || "unknown")}`,
    `Mulai berlaku: ${clean(extraction?.effectiveDate || "")}`,
    `Fokus: ${clean(record.focus)}`,
    `Ringkasan: ${clean(extraction?.summary || record.content || "")}`,
    `Sumber resmi: ${clean(record.sourceUrl)}`,
    `PDF resmi/tersimpan: ${clean(record.storedPdfUrl || record.officialPdfUrl || record.pdfUrl)}`,
    "",
    "KETENTUAN TERSTRUKTUR",
    ...provisions,
    "",
    "RELASI HUKUM TERVERIFIKASI/TEREKAM",
    ...relations
  ].join("\n").trim();
}

export function buildFullCorpusLightRagManifest(records: readonly Regulation[], generatedAt = new Date().toISOString()): FullCorpusLightRagManifest {
  const unique = new Map<string, Regulation>();
  for (const record of records) unique.set(record.canonicalKey || record.id, record);
  const entries = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([canonicalKey, record]) => {
    const text = renderFullCorpusLightRagDocument(record);
    const locators = record.extraction?.keyProvisions?.filter((item) => item.article || item.page).length || 0;
    const relations = record.relations || record.extraction?.relations || [];
    return {
      id: record.id,
      canonicalKey,
      citation: clean(record.citation),
      textHash: createHash("sha256").update(text).digest("hex"),
      sourceHash: clean(record.fileHash),
      legalStatus: clean(record.extraction?.legalStatus || "unknown"),
      relationCount: relations.length,
      locatorCount: locators
    };
  });
  const digest = createHash("sha256");
  for (const entry of entries) digest.update(`${entry.canonicalKey}\0${entry.textHash}\n`);
  return {
    schema: FULL_CORPUS_LIGHTRAG_SCHEMA,
    generatedAt,
    documentCount: entries.length,
    corpusHash: digest.digest("hex"),
    citationReadyCount: entries.filter((entry) => entry.sourceHash && entry.locatorCount > 0 && entry.legalStatus !== "unknown").length,
    graphRelationCount: entries.reduce((sum, entry) => sum + entry.relationCount, 0),
    entries
  };
}

export function compareLightRagIndex(manifest: FullCorpusLightRagManifest, active: { documentsProcessed?: number; corpusHash?: string } | null) {
  if (!active) return { ready: false, status: "not_indexed" as const, reason: "No active full-corpus LightRAG manifest is configured." };
  if (active.documentsProcessed !== manifest.documentCount) return { ready: false, status: "stale" as const, reason: `Active index has ${active.documentsProcessed || 0}/${manifest.documentCount} documents.` };
  if (!active.corpusHash || active.corpusHash !== manifest.corpusHash) return { ready: false, status: "stale" as const, reason: "Active index hash does not match the current full corpus." };
  return { ready: true, status: "ready" as const, reason: "Active index count and corpus hash match." };
}
