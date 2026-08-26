import fs from "node:fs";
import path from "node:path";
import type { KnowledgeDomain, KnowledgeEvidenceStatus, KnowledgeItem } from "./knowledge-hub";

type OfficialKnowledgePayload = {
  schemaVersion?: string;
  generatedAt?: string;
  items?: unknown[];
};

export type OfficialKnowledgeSnapshot = {
  path: string;
  stamp: string;
  generatedAt: string;
  items: KnowledgeItem[];
};

export type OfficialKnowledgeChunk = {
  id: string;
  parentId: string;
  domain: "guides";
  subtype: "Coretax";
  title: string;
  page: number;
  text: string;
  officialUrl: string;
  pdfUrl: string;
  sourceHash: string;
};

const domains = new Set<KnowledgeDomain>(["treaty", "guides", "manual", "changes", "glossary", "forms", "rates"]);
const statuses = new Set<KnowledgeEvidenceStatus>(["verified", "review_required", "reference_only"]);
const kinds = new Set<KnowledgeItem["sourceKind"]>(["primary_law", "official_guidance", "manual", "reviewed_graph", "editorial_glossary", "editorial_guide"]);
let cache: OfficialKnowledgeSnapshot | null = null;
let chunkCache: { path: string; stamp: string; chunks: OfficialKnowledgeChunk[] } | null = null;

function text(value: unknown, limit = 20_000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function trustedUrl(value: unknown) {
  const raw = text(value, 4_000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "pajak.go.id" || host.endsWith(".pajak.go.id") || host === "kemenkeu.go.id" || host.endsWith(".kemenkeu.go.id") || host === "oecd.org" || host.endsWith(".oecd.org")) ? url.toString() : "";
  } catch {
    return "";
  }
}

function validItem(value: unknown): KnowledgeItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<KnowledgeItem>;
  if (!text(item.id) || !text(item.title) || !domains.has(item.domain as KnowledgeDomain) || !statuses.has(item.evidenceStatus as KnowledgeEvidenceStatus) || !kinds.has(item.sourceKind as KnowledgeItem["sourceKind"])) return null;
  const sourceHash = text(item.sourceHash, 100).replace(/^sha256:/i, "");
  const officialUrl = trustedUrl(item.officialUrl);
  const pdfUrl = trustedUrl(item.pdfUrl);
  const locator = item.locator && typeof item.locator === "object" ? { article: text(item.locator.article, 300) || undefined, page: Number.isInteger(item.locator.page) && Number(item.locator.page) > 0 ? Number(item.locator.page) : undefined } : undefined;
  const verified = item.evidenceStatus === "verified" && /^[a-f0-9]{64}$/i.test(sourceHash) && Boolean(officialUrl || pdfUrl) && Boolean(locator?.article || locator?.page);
  const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
    ? Object.fromEntries(Object.entries(item.metadata).filter(([key, entry]) => !/path|secret|token|password/i.test(key) && ["string", "number", "boolean"].includes(typeof entry)))
    : undefined;
  return {
    id: text(item.id, 300),
    domain: item.domain as KnowledgeDomain,
    subtype: text(item.subtype, 200),
    title: text(item.title, 1_000),
    citation: text(item.citation, 1_000),
    summary: text(item.summary, 8_000),
    tags: Array.isArray(item.tags) ? [...new Set(item.tags.map((tag) => text(tag, 200)).filter(Boolean))].slice(0, 20) : [],
    evidenceStatus: verified ? "verified" : item.evidenceStatus === "reference_only" ? "reference_only" : "review_required",
    legalStatus: text(item.legalStatus, 100) || "unknown",
    effectiveFrom: text(item.effectiveFrom, 50) || undefined,
    officialUrl,
    pdfUrl,
    internalUrl: text(item.internalUrl, 1_000).startsWith("/") ? text(item.internalUrl, 1_000) : "",
    sourceHash,
    locator,
    sourceKind: item.sourceKind as KnowledgeItem["sourceKind"],
    metadata
  };
}

export function loadOfficialKnowledgeSnapshot(snapshotPath = process.env.TDP_OFFICIAL_KNOWLEDGE_SNAPSHOT || "content/official-knowledge/official-knowledge.json"): OfficialKnowledgeSnapshot {
  const resolved = path.resolve(snapshotPath);
  try {
    const stat = fs.statSync(resolved);
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    if (cache?.path === resolved && cache.stamp === stamp) return cache;
    const payload = JSON.parse(fs.readFileSync(resolved, "utf8")) as OfficialKnowledgePayload;
    const items = (payload.items || []).map(validItem).filter((item): item is KnowledgeItem => Boolean(item));
    cache = { path: resolved, stamp, generatedAt: text(payload.generatedAt, 100), items };
    return cache;
  } catch {
    return { path: resolved, stamp: "missing", generatedAt: "", items: [] };
  }
}

export function loadOfficialKnowledgeChunks(chunkPath = process.env.TDP_OFFICIAL_KNOWLEDGE_CHUNKS || "content/official-knowledge/coretax-chunks.json") {
  const resolved = path.resolve(chunkPath);
  try {
    const stat = fs.statSync(resolved);
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    if (chunkCache?.path === resolved && chunkCache.stamp === stamp) return chunkCache;
    const payload = JSON.parse(fs.readFileSync(resolved, "utf8")) as { chunks?: unknown[] };
    const chunks: OfficialKnowledgeChunk[] = [];
    for (const value of payload.chunks || []) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const item = value as Partial<OfficialKnowledgeChunk>;
      const officialUrl = trustedUrl(item.officialUrl);
      const pdfUrl = trustedUrl(item.pdfUrl);
      const sourceHash = text(item.sourceHash, 100).replace(/^sha256:/i, "");
      const page = Number(item.page);
      if (!text(item.id) || !text(item.parentId) || !text(item.title) || !text(item.text) || !officialUrl || !pdfUrl || !/^[a-f0-9]{64}$/i.test(sourceHash) || !Number.isInteger(page) || page < 1) continue;
      chunks.push({ id: text(item.id, 400), parentId: text(item.parentId, 300), domain: "guides", subtype: "Coretax", title: text(item.title, 1_000), page, text: text(item.text, 20_000), officialUrl, pdfUrl, sourceHash });
    }
    chunkCache = { path: resolved, stamp, chunks };
    return chunkCache;
  } catch {
    return { path: resolved, stamp: "missing", chunks: [] as OfficialKnowledgeChunk[] };
  }
}
