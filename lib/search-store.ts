import { comparableDecisions, type ComparableDecision } from "./mock-data";
import { mergeRegulationRecords } from "./regulation-knowledge";
import { buildSearchCorpus, regulationToSearchDocuments } from "./search-corpus";
import type { SearchDocument } from "./search-contracts";
import type { StoredDecisionFile } from "./stored-decisions";
import type { Regulation } from "./mock-data";
import { loadLocalRegulationSnapshot } from "./regulation-snapshot";

export type SearchStoreMode = "local" | "database";

export type SearchStoreDiagnostics = {
  mode: SearchStoreMode;
  databaseAccessed: boolean;
  decisionSource: "disabled" | "local-demo" | "database-legacy" | "tenant-isolated-empty";
  regulationSource: "disabled" | "local-seed" | "local-snapshot" | "database-and-seed";
  documentCount: number;
};

export type DatabaseSearchLoaders = {
  configured: () => boolean;
  decisions: () => Promise<StoredDecisionFile[]>;
  regulations: () => Promise<Regulation[]>;
};

export class SearchStoreConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchStoreConfigurationError";
  }
}

let cachedLocalSnapshot: Regulation[] | null = null;
let cachedLocalRegulationDocuments: SearchDocument[] = [];
const cachedLocalStores = new Map<string, { regulationDocuments: SearchDocument[]; documents: SearchDocument[] }>();

function localRegulationDocuments() {
  const snapshot = loadLocalRegulationSnapshot();
  if (cachedLocalSnapshot === snapshot) return cachedLocalRegulationDocuments;
  cachedLocalSnapshot = snapshot;
  cachedLocalRegulationDocuments = mergeRegulationRecords(snapshot).flatMap(regulationToSearchDocuments);
  return cachedLocalRegulationDocuments;
}

/** Any unset or unknown value remains local; database access is explicit opt-in. */
export function searchStoreModeFromEnv(env: Record<string, string | undefined> = process.env): SearchStoreMode {
  return String(env.TDP_SEARCH_STORE || "").trim().toLowerCase() === "database" ? "database" : "local";
}

function localComparableToSearchDocument(record: ComparableDecision, tenantId: string): SearchDocument {
  return {
    id: `decision:demo:${record.id}:summary`,
    corpus: "decision",
    title: record.number,
    citation: record.number,
    body: [record.taxType, record.issue, record.amount, record.reasoning, record.implication, ...record.matchPoints].join("\n"),
    sourceUrl: "",
    sourceHash: "",
    authority: "",
    visibility: "tenant",
    tenantId,
    // These are useful local retrieval fixtures, not verified primary sources.
    status: "review_required",
    metadata: {
      demo: true,
      outcome: record.outcome,
      legacyScore: record.score
    }
  };
}

export async function loadSearchStore({
  tenantId,
  wantsDecisions,
  wantsRegulations,
  includeLegacyDatabaseDecisions,
  mode = searchStoreModeFromEnv(),
  database
}: {
  tenantId: string;
  wantsDecisions: boolean;
  wantsRegulations: boolean;
  includeLegacyDatabaseDecisions: boolean;
  mode?: SearchStoreMode;
  /** Dependency injection exists so local-mode no-DB behavior is testable. */
  database?: DatabaseSearchLoaders;
}): Promise<{ documents: SearchDocument[]; diagnostics: SearchStoreDiagnostics }> {
  if (!tenantId.trim()) throw new SearchStoreConfigurationError("tenantId is required for search-store isolation.");

  if (mode === "local") {
    // Keep this branch free of all database loader calls, including configured().
    const localSnapshot = wantsRegulations ? loadLocalRegulationSnapshot() : [];
    const regulationDocuments = wantsRegulations ? localRegulationDocuments() : [];
    const decisionDocuments = wantsDecisions
      ? comparableDecisions.map((record) => localComparableToSearchDocument(record, tenantId))
      : [];
    const cacheKey = `${tenantId}:${wantsDecisions}:${wantsRegulations}`;
    const cached = cachedLocalStores.get(cacheKey);
    const documents = cached?.regulationDocuments === regulationDocuments
      ? cached.documents
      : [...regulationDocuments, ...decisionDocuments];
    if (!cached || cached.regulationDocuments !== regulationDocuments) cachedLocalStores.set(cacheKey, { regulationDocuments, documents });
    return {
      documents,
      diagnostics: {
        mode,
        databaseAccessed: false,
        decisionSource: wantsDecisions ? "local-demo" : "disabled",
        regulationSource: wantsRegulations ? (localSnapshot.length ? "local-snapshot" : "local-seed") : "disabled",
        documentCount: documents.length
      }
    };
  }

  if (!database) {
    throw new SearchStoreConfigurationError("Database search mode requires explicit read-only loaders.");
  }

  if (!database.configured()) {
    throw new SearchStoreConfigurationError(
      "TDP_SEARCH_STORE=database requires DATABASE_URL or POSTGRES_URL. Search migrations are never run automatically."
    );
  }

  const [decisions, storedRegulations] = await Promise.all([
    wantsDecisions && includeLegacyDatabaseDecisions ? database.decisions() : Promise.resolve([]),
    wantsRegulations ? database.regulations() : Promise.resolve([])
  ]);
  const regulations = wantsRegulations ? mergeRegulationRecords(storedRegulations) : [];
  const documents = buildSearchCorpus({ decisions, regulations, tenantId });
  return {
    documents,
    diagnostics: {
      mode,
      databaseAccessed: true,
      decisionSource: wantsDecisions
        ? includeLegacyDatabaseDecisions
          ? "database-legacy"
          : "tenant-isolated-empty"
        : "disabled",
      regulationSource: wantsRegulations ? "database-and-seed" : "disabled",
      documentCount: documents.length
    }
  };
}
