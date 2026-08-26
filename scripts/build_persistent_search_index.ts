import { buildPersistentHybridIndex, compactSearchProjection, writePersistentHybridIndex } from "../lib/persistent-hybrid-index";
import { loadSearchStore } from "../lib/search-store";
import { defaultWorkspaceTenantId } from "../lib/workspace";

async function main() {
  const tenantId = process.argv[2] || defaultWorkspaceTenantId();
  const store = await loadSearchStore({ tenantId, wantsDecisions: true, wantsRegulations: true, includeLegacyDatabaseDecisions: true, mode: "local" });
  process.stderr.write(`${JSON.stringify({ stage: "corpus_loaded", documentCount: store.documents.length, bodyCharacters: store.documents.reduce((sum, document) => sum + document.body.length, 0) })}\n`);
  const projection = compactSearchProjection(store.documents);
  process.stderr.write(`${JSON.stringify({ stage: "projection_built", documentCount: projection.length, bodyCharacters: projection.reduce((sum, document) => sum + document.body.length, 0) })}\n`);
  const index = buildPersistentHybridIndex(projection, tenantId);
  const target = await writePersistentHybridIndex(index);
  process.stdout.write(`${JSON.stringify({ target, tenantId, documentCount: index.documentCount, corpusHash: index.corpusHash, embeddingDimensions: index.embeddingDimensions, source: store.diagnostics }, null, 2)}\n`);
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exit(1); });
