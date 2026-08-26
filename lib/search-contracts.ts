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
  facets?: SearchFacetFilters;
};

export type SearchFacetFilters = {
  topics?: string[];
  authorities?: string[];
  statuses?: Array<"verified" | "review_required" | "unknown">;
  legalStatuses?: string[];
  years?: number[];
};

export type SearchFacetBucket = {
  value: string;
  label: string;
  count: number;
};

export type SearchFacetSummary = {
  corpora: SearchFacetBucket[];
  topics: SearchFacetBucket[];
  authorities: SearchFacetBucket[];
  statuses: SearchFacetBucket[];
  legalStatuses: SearchFacetBucket[];
  years: SearchFacetBucket[];
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
  effectiveFrom?: string;
  effectiveTo?: string;
  status: "verified" | "review_required" | "unknown";
  score: number;
  lexicalScore: number;
  semanticScore: number | null;
  exactMatch: boolean;
  matchedTerms: string[];
  metadata: Record<string, string | number | boolean | null>;
  /** Internal catalogue page. External provenance remains in sourceUrl. */
  detailUrl?: string;
};

export type HybridSearchResult = {
  query: string;
  hits: SearchHit[];
  totalCandidates: number;
  hasMore: boolean;
  facets: SearchFacetSummary;
  diagnostics: {
    lexicalEnabled: true;
    semanticEnabled: boolean;
    tenantFiltered: true;
    elapsedMs: number;
    persistentIndex?: boolean;
    indexedDocuments?: number;
    candidateDocuments?: number;
    corpusHash?: string;
  };
};
