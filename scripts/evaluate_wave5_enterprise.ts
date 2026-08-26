import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readPersistentHybridIndex, searchHydratedPersistentIndex } from "../lib/persistent-hybrid-index";
import { loadSearchStore } from "../lib/search-store";
import { defaultWorkspaceTenantId } from "../lib/workspace";
import { compareLightRagIndex, type FullCorpusLightRagManifest } from "../lib/full-corpus-lightrag";

function percentile(values: number[], value: number) { const ordered = [...values].sort((a, b) => a - b); return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(value * ordered.length) - 1))] || 0; }
async function main() {
  const outputPath = path.resolve(process.argv[2] || "tests/evaluation/results/wave5-enterprise.json"); const tenantId = defaultWorkspaceTenantId();
  const started = performance.now(); const store = await loadSearchStore({ tenantId, wantsDecisions: true, wantsRegulations: true, includeLegacyDatabaseDecisions: true, mode: "local" }); const loadMs = performance.now() - started;
  const index = await readPersistentHybridIndex(tenantId); if (!index) throw new Error("Build the persistent search index before running Wave 5 evaluation.");
  const unique = new Map<string, typeof index.documents[number]>();
  for (const document of index.documents) if (document.corpus === "regulation" && document.citation && !unique.has(String(document.metadata?.canonicalKey || document.id))) unique.set(String(document.metadata?.canonicalKey || document.id), document);
  const candidates = [...unique.entries()].filter(([, document]) => /\b(?:UU|PP|PMK|KMK|PER|SE|KEP|PERPRES|PERPU)\b/i.test(document.citation || "")); const stride = Math.max(1, Math.floor(candidates.length / 120));
  const selected = Array.from({ length: 120 }, (_, index) => candidates[index * stride]).filter(Boolean);
  const cases = selected.map(([expected, document], caseIndex) => {
    const before = performance.now(); const result = searchHydratedPersistentIndex(index, store.documents, { query: document.citation || document.title, tenantId, corpora: ["regulation"], limit: 5, minimumScore: 1 }); const latencyMs = performance.now() - before;
    const retrieved = result.hits.map((hit) => String(hit.metadata?.canonicalKey || hit.id)); const rank = retrieved.indexOf(expected) + 1;
    return { id: `lookup-${caseIndex + 1}`, query: document.citation, expected, retrieved, rank, top1: rank === 1, hitAt5: rank > 0 && rank <= 5, latencyMs: Math.round(latencyMs * 100) / 100, candidateDocuments: result.diagnostics.candidateDocuments || 0 };
  });
  const manifest = JSON.parse(fs.readFileSync(path.resolve(process.env.TDP_LIGHTRAG_FULL_MANIFEST || "outputs/lightrag/full-corpus-manifest.json"), "utf8")) as FullCorpusLightRagManifest;
  const pilot = compareLightRagIndex(manifest, { documentsProcessed: 58, corpusHash: "pilot-58-corpus" });
  const latencies = cases.map((item) => item.latencyMs); const indexBytes = fs.statSync(path.resolve(process.env.TDP_PERSISTENT_SEARCH_ROOT || "data/local-search-index", `${createHash("sha256").update(tenantId).digest("hex").slice(0, 24)}.json`)).size;
  const summary = {
    cases: cases.length,
    exactLookupTop1: cases.filter((item) => item.top1).length / cases.length,
    hitAt5: cases.filter((item) => item.hitAt5).length / cases.length,
    p50LatencyMs: Math.round(percentile(latencies, .5) * 100) / 100,
    p95LatencyMs: Math.round(percentile(latencies, .95) * 100) / 100,
    maxHydratedCandidateDocuments: Math.max(...cases.map((item) => item.candidateDocuments)),
    sourceDocumentCount: store.documents.length,
    persistentProjectionCount: index.documentCount,
    sourceLoadMs: Math.round(loadMs * 100) / 100,
    indexBytes,
    lightRagManifestDocuments: manifest.documentCount,
    lightRagCitationReady: manifest.citationReadyCount,
    lightRagGraphRelations: manifest.graphRelationCount
  };
  const gates = { benchmarkSize: cases.length >= 100, exactLookupTop1: summary.exactLookupTop1 >= .95, hitAt5: summary.hitAt5 >= .99, candidateBound: summary.maxHydratedCandidateDocuments < 10_000, fullManifestLargerThanPilot: manifest.documentCount > 58, stalePilotRejected: pilot.ready === false };
  const output = { schemaVersion: "aa-jurist-wave5-enterprise-v1", generatedAt: new Date().toISOString(), summary, gates, implementationPassed: Object.values(gates).every(Boolean), claims: { persistentSearch: "Local durable candidate index with full-corpus hydration; not a distributed production backend.", lightrag: "Full-corpus manifest/export contract built; 58-document pilot is rejected and full ingestion is not claimed.", queue: "Local durable queue; not a multi-node broker.", dr: "Local backup verification/rehearsal; not cross-region failover." }, cases };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: path.relative(process.cwd(), outputPath), summary, gates, implementationPassed: output.implementationPassed }, null, 2)}\n`); if (!output.implementationPassed) process.exitCode = 1;
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : error}\n`); process.exit(1); });
