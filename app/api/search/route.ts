import { NextResponse } from "next/server";
import { assessTrust } from "@/lib/citation-trust";
import { hybridSearch, InvalidSearchRequestError } from "@/lib/hybrid-search";
import {
  missingSearchCorpusFeature,
  normalizeRequestedSearchCorpora,
  rejectClientManagedSearchFields,
  requestedCorpusFlags,
  searchAsksCurrentLaw
} from "@/lib/search-api-policy";
import type { SearchCorpus, SearchFacetFilters } from "@/lib/search-contracts";
import {
  loadSearchStore,
  SearchStoreConfigurationError,
  searchStoreModeFromEnv,
  type DatabaseSearchLoaders
} from "@/lib/search-store";
import { requireWorkspaceScope } from "@/lib/workspace-access";
import { defaultWorkspaceTenantId } from "@/lib/workspace";
import { assessTaxQueryDomain } from "@/lib/query-domain";
import {
  persistentIndexFreshness,
  persistentSearchModeFromEnv,
  readPersistentHybridIndex,
  searchHydratedPersistentIndex,
  compactSearchProjection
} from "@/lib/persistent-hybrid-index";

export const runtime = "nodejs";

type SearchBody = {
  query?: string;
  corpora?: SearchCorpus[];
  limit?: number;
  offset?: number;
  asOf?: string;
  queryEmbedding?: unknown;
  minimumScore?: number;
  answer?: string;
  language?: "id" | "en";
  facets?: SearchFacetFilters;
};

function databaseSearchLoaders(): DatabaseSearchLoaders {
  return {
    configured: () => Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
    decisions: async () => {
      const { listDecisionDocumentsReadOnly } = await import("@/lib/db");
      return listDecisionDocumentsReadOnly();
    },
    regulations: async () => {
      const { listTaxRegulationsReadOnly } = await import("@/lib/db");
      return listTaxRegulationsReadOnly();
    }
  };
}

/**
 * Local read-only search endpoint. Workspace scope is derived exclusively from
 * the authenticated session; callers cannot submit or override a tenant id.
 */
export async function POST(request: Request) {
  const access = await requireWorkspaceScope(request);
  if ("response" in access) return access.response;

  try {
    const rawBody = await request.json();
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      throw new InvalidSearchRequestError("Request body must be a JSON object.");
    }
    const body = rawBody as SearchBody;
    rejectClientManagedSearchFields(body as Record<string, unknown>);
    const query = String(body.query || "").trim();
    const domain = assessTaxQueryDomain(query);
    if (!domain.inScope) {
      const trust = assessTrust([], { question: query, language: body.language });
      return NextResponse.json({
        query,
        hits: [],
        totalCandidates: 0,
        hasMore: false,
        facets: { corpora: [], topics: [], authorities: [], statuses: [], legalStatuses: [], years: [] },
        diagnostics: { lexicalEnabled: true, semanticEnabled: false, tenantFiltered: true, elapsedMs: 0 },
        trust,
        domain,
        scope: { workspaceId: access.scope.tenantId, clientId: access.scope.clientId || null, matterId: access.scope.matterId || null, derivedFromSession: true, readOnly: true }
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const corpora = normalizeRequestedSearchCorpora(body.corpora);
    const { wantsDecisions, wantsRegulations } = requestedCorpusFlags(corpora);
    const missingFeature = missingSearchCorpusFeature(
      access.session.role,
      access.session.tier,
      { wantsDecisions, wantsRegulations }
    );
    if (missingFeature) {
      return NextResponse.json(
        { error: `This subscription tier does not include ${missingFeature}.`, missingFeature },
        { status: 403, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    const workspaceId = access.scope.tenantId;
    // Existing decision rows predate tenant ownership. They belong only to the
    // bootstrapped default workspace; never copy them into a newly-created
    // tenant merely because its member submitted a search request.
    const mayReadLegacyDecisionCorpus = workspaceId === defaultWorkspaceTenantId();
    const storeMode = searchStoreModeFromEnv();
    const store = await loadSearchStore({
      tenantId: workspaceId,
      wantsDecisions,
      wantsRegulations,
      includeLegacyDatabaseDecisions: mayReadLegacyDecisionCorpus,
      mode: storeMode,
      // Dynamic loaders ensure local mode never imports the DB module or
      // creates a connection merely because DATABASE_URL exists.
      database: storeMode === "database" ? databaseSearchLoaders() : undefined
    });
    const searchRequest = {
      query,
      tenantId: workspaceId,
      corpora,
      limit: body.limit,
      offset: body.offset,
      asOf: body.asOf,
      minimumScore: body.minimumScore,
      facets: body.facets
    };
    const persistentMode = persistentSearchModeFromEnv();
    const persistentIndex = persistentMode === "off" ? null : await readPersistentHybridIndex(workspaceId);
    const freshness = persistentIndex ? persistentIndexFreshness(persistentIndex, compactSearchProjection(store.documents)) : null;
    if (persistentMode === "required" && (!persistentIndex || !freshness?.fresh)) {
      throw new SearchStoreConfigurationError("Persistent search is required, but its index is missing or stale. Rebuild it from Enterprise Readiness.");
    }
    const result = persistentIndex && freshness?.fresh
      ? searchHydratedPersistentIndex(persistentIndex, store.documents, searchRequest)
      : hybridSearch(store.documents, searchRequest);
    const trust = assessTrust(result.hits, {
      answer: typeof body.answer === "string" ? body.answer : undefined,
      asksCurrentLaw: searchAsksCurrentLaw(query) || Boolean(body.asOf),
      asOf: body.asOf,
      question: query,
      language: body.language
    });

    return NextResponse.json({
      ...result,
      source: { ...store.diagnostics, persistentMode, persistentIndexUsed: Boolean(result.diagnostics.persistentIndex), persistentIndexFresh: freshness?.fresh ?? null },
      trust,
      scope: {
        workspaceId,
        clientId: access.scope.clientId || null,
        matterId: access.scope.matterId || null,
        derivedFromSession: true,
        readOnly: true,
        legacyDecisionCorpusIncluded: store.diagnostics.decisionSource === "database-legacy"
      }
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status =
      error instanceof InvalidSearchRequestError || error instanceof SyntaxError
        ? 400
        : error instanceof SearchStoreConfigurationError
          ? 503
          : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not search the current corpus." },
      { status }
    );
  }
}
