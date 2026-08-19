export type SearchCorpus = "decision" | "regulation";

export type SearchVisibility = "public" | "tenant";

export type SearchLocator = {
  page?: number;
  paragraph?: string;
  section?: string;
};
export type SearchDocument = {
  /** Stable, corpus-wide identifier. It must not contain secrets or signed URLs. */
  id: string;
  corpus: SearchCorpus;
  title: string;
  body: string;
  citation?: string;
  sourceUrl?: string;
  sourceHash?: string;
  authority?: string;
  locator?: SearchLocator;
  visibility: SearchVisibility;
  /** Required for tenant documents and ignored for public documents. */
  tenantId?: string;
  status?: "verified" | "review_required" | "unknown";
  effectiveFrom?: string;
  effectiveTo?: string;
  metadata?: Record<string, string | number | boolean | null>;
  /** Optional normalized embedding supplied by an external/vector index. */
  embedding?: number[];
};

export type SearchRequest = {
  query: string;
  tenantId: string;
  corpora?: SearchCorpus[];
  limit?: number;
  offset?: number;
  asOf?: string;
  queryEmbedding?: number[];
  minimumScore?: number;
};

export type SearchHit = {
  id: string;
  corpus: SearchCorpus;
  title: string;
  citation: string;
  snippet: string;
  sourceUrl: string;
  sourceHash: string;
  authority: string;
  locator?: SearchLocator;
  status: "verified" | "review_required" | "unknown";
  score: number;
  lexicalScore: number;
  semanticScore: number | null;
  exactMatch: boolean;
  matchedTerms: string[];
  metadata: Record<string, string | number | boolean | null>;
};

export type HybridSearchResult = {
  query: string;
  hits: SearchHit[];
  totalCandidates: number;
  hasMore: boolean;
  diagnostics: {
    lexicalEnabled: true;
    semanticEnabled: boolean;
    tenantFiltered: true;
    elapsedMs: number;
  };
};
