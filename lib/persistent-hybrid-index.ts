import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { hybridSearch, searchTokens } from "./hybrid-search";
import type { HybridSearchResult, SearchDocument, SearchRequest } from "./search-contracts";

export const PERSISTENT_SEARCH_SCHEMA = "aa-jurist-persistent-hybrid-v1" as const;

export type PersistentHybridIndex = {
  schema: typeof PERSISTENT_SEARCH_SCHEMA;
  tenantId: string;
  builtAt: string;
  corpusHash: string;
  documentCount: number;
  embeddingDimensions: number;
  documents: SearchDocument[];
  postings: Record<string, number[]>;
};

export type PersistentSearchMode = "off" | "prefer" | "required";

const DEFAULT_ROOT = path.resolve("data/local-search-index");
const corpusHashCache = new WeakMap<object, string>();
const compactProjectionCache = new WeakMap<object, SearchDocument[]>();

function searchIndexRoot() {
  return path.resolve(process.env.TDP_PERSISTENT_SEARCH_ROOT || DEFAULT_ROOT);
}

function tenantFilename(tenantId: string) {
  if (!tenantId.trim()) throw new Error("tenantId is required for persistent search.");
  return `${createHash("sha256").update(tenantId).digest("hex").slice(0, 24)}.json`;
}

function indexPath(tenantId: string) {
  const root = searchIndexRoot();
  return { root, target: path.resolve(root, tenantFilename(tenantId)) };
}

export function persistentSearchModeFromEnv(env: Record<string, string | undefined> = process.env): PersistentSearchMode {
  const value = String(env.TDP_PERSISTENT_SEARCH || "").trim().toLowerCase();
  return value === "required" ? "required" : value === "prefer" || value === "true" ? "prefer" : "off";
}

export function searchCorpusHash(documents: readonly SearchDocument[]) {
  const cached = corpusHashCache.get(documents as object);
  if (cached) return cached;
  const digest = createHash("sha256");
  const ordered = [...documents].sort((a, b) => a.id.localeCompare(b.id));
  for (const document of ordered) {
    digest.update(JSON.stringify({
      id: document.id,
      corpus: document.corpus,
      body: document.body,
      citation: document.citation || "",
      sourceHash: document.sourceHash || "",
      status: document.status || "unknown",
      effectiveFrom: document.effectiveFrom || "",
      effectiveTo: document.effectiveTo || "",
      tenantId: document.visibility === "tenant" ? document.tenantId || "" : "public",
      embedding: document.embedding || []
    }));
    digest.update("\n");
  }
  const result = digest.digest("hex");
  corpusHashCache.set(documents as object, result);
  return result;
}

/**
 * Persistent local storage indexes one compact candidate document per legal
 * instrument. The request path then hydrates matching candidates from the
 * full provision corpus, so page/article locators are never invented by this
 * compact projection.
 */
export function compactSearchProjection(documents: readonly SearchDocument[], maxBodyCharacters = 6_000) {
  if (maxBodyCharacters === 6_000) {
    const cached = compactProjectionCache.get(documents as object);
    if (cached) return cached;
  }
  const decisions: SearchDocument[] = [];
  const regulations = new Map<string, SearchDocument[]>();
  for (const document of documents) {
    if (document.corpus === "decision") { decisions.push({ ...document, body: document.body.slice(0, maxBodyCharacters) }); continue; }
    const key = String(document.metadata?.canonicalKey || document.id);
    const group = regulations.get(key);
    if (group) group.push(document);
    else regulations.set(key, [document]);
  }
  const projected = [...regulations.entries()].map(([canonicalKey, items]) => {
    const first = items[0]; const fragments: string[] = []; let length = 0;
    for (const item of items) {
      const fragment = item.body.trim();
      if (!fragment || fragments.includes(fragment)) continue;
      if (length + fragment.length > maxBodyCharacters) { fragments.push(fragment.slice(0, Math.max(0, maxBodyCharacters - length))); break; }
      fragments.push(fragment); length += fragment.length + 1;
    }
    return {
      ...first,
      id: `persistent:${canonicalKey}`,
      body: fragments.join("\n").slice(0, maxBodyCharacters),
      locator: undefined,
      status: "review_required" as const,
      metadata: { ...(first.metadata || {}), canonicalKey, persistentProjection: true, sourceChunkCount: items.length }
    };
  });
  const result = [...projected, ...decisions].sort((a, b) => a.id.localeCompare(b.id));
  if (maxBodyCharacters === 6_000) compactProjectionCache.set(documents as object, result);
  return result;
}

export function buildPersistentHybridIndex(documents: readonly SearchDocument[], tenantId: string): PersistentHybridIndex {
  const seen = new Set<string>();
  const scoped = documents
    .filter((document) => {
      if (document.visibility !== "public" && document.tenantId !== tenantId) return false;
      if (seen.has(document.id)) return false;
      seen.add(document.id);
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const postings = new Map<string, number[]>();
  let embeddingDimensions = 0;
  scoped.forEach((document, index) => {
    const unique = new Set(searchTokens([document.title, document.citation, document.body].filter(Boolean).join(" ")));
    for (const token of unique) {
      const posting = postings.get(token);
      if (posting) posting.push(index);
      else postings.set(token, [index]);
    }
    if (document.embedding?.length) embeddingDimensions = Math.max(embeddingDimensions, document.embedding.length);
  });
  return {
    schema: PERSISTENT_SEARCH_SCHEMA,
    tenantId,
    builtAt: new Date().toISOString(),
    corpusHash: searchCorpusHash(scoped),
    documentCount: scoped.length,
    embeddingDimensions,
    documents: scoped,
    postings: Object.fromEntries([...postings.entries()].sort(([a], [b]) => a.localeCompare(b)))
  };
}

export async function writePersistentHybridIndex(index: PersistentHybridIndex) {
  const { root, target } = indexPath(index.tenantId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(index)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  return target;
}

export async function readPersistentHybridIndex(tenantId: string): Promise<PersistentHybridIndex | null> {
  const { target } = indexPath(tenantId);
  try {
    const value = JSON.parse(await readFile(target, "utf8")) as PersistentHybridIndex;
    if (value.schema !== PERSISTENT_SEARCH_SCHEMA || value.tenantId !== tenantId || !Array.isArray(value.documents)) {
      throw new Error("Persistent search index schema or tenant does not match.");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function persistentIndexFreshness(index: PersistentHybridIndex, documents: readonly SearchDocument[]) {
  const corpusHash = searchCorpusHash(documents.filter((document) => document.visibility === "public" || document.tenantId === index.tenantId));
  return { fresh: corpusHash === index.corpusHash, expectedHash: corpusHash, indexedHash: index.corpusHash };
}

export function searchPersistentHybridIndex(index: PersistentHybridIndex, request: SearchRequest): HybridSearchResult {
  if (request.tenantId !== index.tenantId) throw new Error("Persistent search tenant mismatch.");
  const terms = [...new Set(searchTokens(request.query))];
  const counts = new Map<number, number>();
  for (const term of terms) {
    for (const documentIndex of index.postings[term] || []) counts.set(documentIndex, (counts.get(documentIndex) || 0) + 1);
  }
  const targetSize = Math.max(600, (request.offset || 0) + (request.limit || 10) * 40);
  const candidates = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, targetSize)
    .map(([documentIndex]) => index.documents[documentIndex])
    .filter(Boolean);
  const result = hybridSearch(candidates, request);
  return {
    ...result,
    diagnostics: {
      ...result.diagnostics,
      persistentIndex: true,
      indexedDocuments: index.documentCount,
      candidateDocuments: candidates.length,
      corpusHash: index.corpusHash
    }
  };
}

export function searchHydratedPersistentIndex(index: PersistentHybridIndex, fullDocuments: readonly SearchDocument[], request: SearchRequest) {
  const candidateResult = searchPersistentHybridIndex(index, { ...request, limit: 50, offset: 0, minimumScore: Math.min(request.minimumScore ?? 8, 8) });
  const regulationKeys = new Set(candidateResult.hits.filter((hit) => hit.corpus === "regulation").map((hit) => String(hit.metadata?.canonicalKey || "")));
  const decisionIds = new Set(candidateResult.hits.filter((hit) => hit.corpus === "decision").map((hit) => hit.id));
  const hydrated = fullDocuments.filter((document) => document.corpus === "regulation"
    ? regulationKeys.has(String(document.metadata?.canonicalKey || document.id))
    : decisionIds.has(document.id));
  const result = hybridSearch(hydrated, request);
  return { ...result, diagnostics: { ...result.diagnostics, persistentIndex: true, indexedDocuments: index.documentCount, candidateDocuments: hydrated.length, corpusHash: index.corpusHash } };
}
