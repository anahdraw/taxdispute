import type { HybridSearchResult, SearchDocument, SearchHit, SearchRequest } from "./search-contracts";

const STOP_WORDS = new Set([
  "yang", "dan", "atau", "dengan", "untuk", "pada", "dalam", "atas", "dari", "oleh", "karena", "bahwa", "ini", "itu",
  "the", "and", "or", "with", "for", "from", "that", "this", "tax", "pajak", "putusan", "peraturan", "aturan"
]);

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_OFFSET = 10_000;
const tokenCache = new WeakMap<object, string[]>();

export class InvalidSearchRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSearchRequestError";
  }
}

export function normalizeSearchText(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/pajak pertambahan nilai|\bppn\b/g, " vat ")
    .replace(/pajak masukan/g, " inputvat ")
    .replace(/dasar pengenaan pajak|\bdpp\b/g, " taxbase ")
    .replace(/faktur pajak/g, " taxinvoice ")
    .replace(/transfer pricing|harga transfer|penentuan harga transfer/g, " transferpricing ")
    .replace(/hubungan istimewa|pihak afiliasi/g, " relatedparty ")
    .replace(/prinsip kewajaran dan kelaziman usaha|arm'?s length/g, " armslength ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchTokens(value: unknown) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function citationSignals(value: unknown) {
  const text = normalizeSearchText(value);
  const signals = new Set<string>();
  // Covers the common Indonesian citation form (`UU Nomor 8 Tahun 1983`) and
  // the compact form used by pipeline metadata (`UU 8/1983`).  This signal is
  // deliberately separate from BM25 so a legal identifier cannot be drowned
  // out by thousands of documents that merely repeat words such as "nomor" or
  // "tahun" in their body text.
  const pattern = /\b(uu|perpu|pp|perpres|pmk|kmk|kep|per|se)\s*(?:nomor|no)?\s*([0-9]+)(?:\s*\/\s*(?:pmk|pj|03|\w+))?(?:\s*(?:tahun|th)\s*)?((?:19|20)\d{2})\b/gi;
  for (const match of text.matchAll(pattern)) signals.add(`${match[1].toLowerCase()}-${Number(match[2])}-${match[3]}`);
  return signals;
}

function validateRequest(request: SearchRequest) {
  const query = String(request.query || "").trim();
  const tenantId = String(request.tenantId || "").trim();
  if (query.length < 3) throw new InvalidSearchRequestError("Search query must contain at least 3 characters.");
  if (query.length > 1_000) throw new InvalidSearchRequestError("Search query exceeds 1,000 characters.");
  if (!tenantId) throw new InvalidSearchRequestError("tenantId is required for fail-closed search isolation.");
  if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_LIMIT)) {
    throw new InvalidSearchRequestError(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
  }
  if (request.offset !== undefined && (!Number.isInteger(request.offset) || request.offset < 0 || request.offset > MAX_OFFSET)) {
    throw new InvalidSearchRequestError(`offset must be an integer between 0 and ${MAX_OFFSET}.`);
  }
  if (request.queryEmbedding !== undefined && (
    !Array.isArray(request.queryEmbedding)
    || !request.queryEmbedding.length
    || request.queryEmbedding.length > 8_192
    || request.queryEmbedding.some((value) => !Number.isFinite(value))
  )) {
    throw new InvalidSearchRequestError("queryEmbedding must contain only finite numbers.");
  }
  if (request.minimumScore !== undefined && (
    !Number.isFinite(request.minimumScore)
    || request.minimumScore < 0
    || request.minimumScore > 100
  )) {
    throw new InvalidSearchRequestError("minimumScore must be a finite number between 0 and 100.");
  }
  return { query, tenantId, limit: request.limit || DEFAULT_LIMIT, offset: request.offset || 0 };
}

function isVisible(document: SearchDocument, tenantId: string) {
  if (document.visibility === "public") return true;
  return Boolean(document.tenantId) && document.tenantId === tenantId;
}

function validAsOf(document: SearchDocument, asOf?: string) {
  if (!asOf) return true;
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) throw new InvalidSearchRequestError("asOf must be a valid ISO date.");
  const from = document.effectiveFrom ? Date.parse(document.effectiveFrom) : Number.NEGATIVE_INFINITY;
  const to = document.effectiveTo ? Date.parse(document.effectiveTo) : Number.POSITIVE_INFINITY;
  return timestamp >= from && timestamp <= to;
}

function termFrequency(tokens: string[]) {
  const frequency = new Map<string, number>();
  for (const token of tokens) frequency.set(token, (frequency.get(token) || 0) + 1);
  return frequency;
}

function documentTokens(document: SearchDocument) {
  const cached = tokenCache.get(document);
  if (cached) return cached;
  const tokens = searchTokens([document.title, document.citation, document.body].filter(Boolean).join(" "));
  tokenCache.set(document, tokens);
  return tokens;
}

function dot(left: number[], right: number[]) {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result += left[index] * right[index];
  return result;
}

function cosineSimilarity(left?: number[], right?: number[]) {
  if (!left?.length || !right?.length || left.length !== right.length) return null;
  const denominator = Math.sqrt(dot(left, left)) * Math.sqrt(dot(right, right));
  if (!denominator) return null;
  return Math.max(-1, Math.min(1, dot(left, right) / denominator));
}

function snippetFor(document: SearchDocument, queryTerms: string[], maxLength = 460) {
  const clean = document.body.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const normalized = normalizeSearchText(clean);
  const firstHit = queryTerms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (firstHit === undefined || firstHit < 100) return clean.slice(0, maxLength);
  const start = Math.max(0, firstHit - 120);
  return `${start ? "… " : ""}${clean.slice(start, start + maxLength)}`;
}

type ScoredDocument = {
  document: SearchDocument;
  lexicalScore: number;
  semanticScore: number | null;
  exactMatch: boolean;
  exactCitationMatch: boolean;
  matchedTerms: string[];
};

/**
 * Deterministic BM25 + optional vector fusion for local development.
 *
 * Production indexes can implement the same SearchDocument/SearchHit contract
 * with PostgreSQL FTS/OpenSearch and pgvector without changing trust validation.
 */
export function hybridSearch(documents: readonly SearchDocument[], request: SearchRequest): HybridSearchResult {
  const started = Date.now();
  const { query, tenantId, limit, offset } = validateRequest(request);
  const corpora = new Set(request.corpora?.length ? request.corpora : ["decision", "regulation"]);
  const visible = documents.filter(
    (document) => document.id && document.title && document.body && corpora.has(document.corpus) && isVisible(document, tenantId) && validAsOf(document, request.asOf)
  );
  const queryTerms = Array.from(new Set(searchTokens(query)));
  if (!queryTerms.length) {
    return {
      query,
      hits: [],
      totalCandidates: 0,
      hasMore: false,
      diagnostics: { lexicalEnabled: true, semanticEnabled: Boolean(request.queryEmbedding), tenantFiltered: true, elapsedMs: Date.now() - started }
    };
  }

  const queryCitationSignals = citationSignals(query);
  const citationCandidates = queryCitationSignals.size
    ? visible.filter((document) => Array.from(queryCitationSignals).some((signal) => citationSignals(`${document.citation} ${document.title}`).has(signal)))
    : [];
  // A citation-shaped query is a direct lookup. Restrict its expensive body
  // ranking to matching instruments instead of scanning every provision.
  const rankingDocuments = citationCandidates.length ? citationCandidates : visible;
  const tokenized = rankingDocuments.map((document) => ({
    document,
    tokens: documentTokens(document)
  }));
  const averageLength = tokenized.length ? tokenized.reduce((sum, item) => sum + item.tokens.length, 0) / tokenized.length : 1;
  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    documentFrequency.set(term, tokenized.filter((item) => new Set(item.tokens).has(term)).length);
  }

  const queryNormalized = normalizeSearchText(query);
  const scored: ScoredDocument[] = tokenized.map(({ document, tokens }) => {
    const frequency = termFrequency(tokens);
    let bm25 = 0;
    for (const term of queryTerms) {
      const tf = frequency.get(term) || 0;
      if (!tf) continue;
      const df = documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (rankingDocuments.length - df + 0.5) / (df + 0.5));
      const lengthNormalization = tf + 1.2 * (1 - 0.75 + 0.75 * (tokens.length / Math.max(1, averageLength)));
      bm25 += idf * ((tf * 2.2) / lengthNormalization);
    }
    const title = normalizeSearchText([document.title, document.citation].filter(Boolean).join(" "));
    const exactCitationMatch = Array.from(queryCitationSignals).some((signal) => citationSignals(`${document.citation} ${document.title}`).has(signal));
    const exactMatch = title.includes(queryNormalized) || queryNormalized.includes(title) || exactCitationMatch;
    const matchedTerms = queryTerms.filter((term) => frequency.has(term));
    const coverage = matchedTerms.length / queryTerms.length;
    const lexicalScore = Math.min(1, bm25 / Math.max(2, queryTerms.length * 1.7)) * 0.7 + coverage * 0.3;
    const semanticScore = cosineSimilarity(request.queryEmbedding, document.embedding);
    return { document, lexicalScore, semanticScore, exactMatch, exactCitationMatch, matchedTerms };
  });

  const lexicalRanking = [...scored].sort((a, b) => b.lexicalScore - a.lexicalScore || a.document.id.localeCompare(b.document.id));
  const semanticRanking = scored.filter((item) => item.semanticScore !== null).sort((a, b) => (b.semanticScore || 0) - (a.semanticScore || 0));
  const lexicalRank = new Map(lexicalRanking.map((item, index) => [item.document.id, index + 1]));
  const semanticRank = new Map(semanticRanking.map((item, index) => [item.document.id, index + 1]));
  const hasSemantic = semanticRanking.length > 0;

  const rankedDocuments = scored
    .map((item) => {
      const lexicalRrf = 1 / (60 + (lexicalRank.get(item.document.id) || rankingDocuments.length + 1));
      const semanticRrf = hasSemantic ? 1 / (60 + (semanticRank.get(item.document.id) || rankingDocuments.length + 1)) : 0;
      const rrf = hasSemantic ? lexicalRrf * 0.58 + semanticRrf * 0.42 : lexicalRrf;
      let score = Math.min(100, rrf * 6_100);
      score *= 0.45 + item.lexicalScore * 0.55;
      if (item.semanticScore !== null) score *= 0.72 + Math.max(0, item.semanticScore) * 0.28;
      if (item.exactCitationMatch) score = Math.min(100, score + 72);
      else if (item.exactMatch) score = Math.min(100, score + 18);
      return { ...item, score };
    })
    // A semantic-only match is allowed, but a lexical-only zero-score record is not.
    .filter((item) => item.lexicalScore > 0 || (item.semanticScore !== null && item.semanticScore >= 0.55))
    .filter((item) => item.score >= (request.minimumScore ?? 8))
    .sort((a, b) => b.score - a.score || a.document.id.localeCompare(b.document.id));

  // Provision-level indexing is useful for citation locators, but a search
  // result should not show the same regulation five times just because five
  // pasal chunks matched. Keep the strongest chunk per canonical regulation;
  // decision chunks remain independent because their IDs are matter-scoped.
  const seenCanonical = new Set<string>();
  const ranked = rankedDocuments.filter((item) => {
    if (item.document.corpus !== "regulation") return true;
    const key = String(item.document.metadata?.canonicalKey || item.document.id);
    if (seenCanonical.has(key)) return false;
    seenCanonical.add(key);
    return true;
  });

  const hits: SearchHit[] = ranked.slice(offset, offset + limit).map(({ document, score, lexicalScore, semanticScore, exactMatch, matchedTerms }) => ({
    id: document.id,
    corpus: document.corpus,
    title: document.title,
    citation: document.citation || "",
    snippet: snippetFor(document, queryTerms),
    sourceUrl: document.sourceUrl || "",
    sourceHash: document.sourceHash || "",
    authority: document.authority || "",
    locator: document.locator,
    status: document.status || "unknown",
    score: Math.round(score * 10) / 10,
    lexicalScore: Math.round(lexicalScore * 1_000) / 1_000,
    semanticScore: semanticScore === null ? null : Math.round(semanticScore * 1_000) / 1_000,
    exactMatch,
    matchedTerms,
    metadata: document.metadata || {}
  }));

  return {
    query,
    hits,
    totalCandidates: ranked.length,
    hasMore: offset + hits.length < ranked.length,
    diagnostics: { lexicalEnabled: true, semanticEnabled: hasSemantic, tenantFiltered: true, elapsedMs: Date.now() - started }
  };
}
