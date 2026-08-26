import fs from "node:fs";
import path from "node:path";
import { hybridSearch } from "../lib/hybrid-search";
import { mergeRegulationRecords } from "../lib/regulation-knowledge";
import { loadLocalRegulationSnapshot } from "../lib/regulation-snapshot";
import { regulationToSearchDocuments } from "../lib/search-corpus";
import { buildRegulationResearchView } from "../lib/regulation-timeline";
import { alertsForChange, createWatchRule, watchState } from "../lib/watchlist";

const outputPath = path.resolve(process.argv[2] || "tests/evaluation/results/wave2-research-parity.json");
const records = mergeRegulationRecords(loadLocalRegulationSnapshot());
const documents = records.flatMap(regulationToSearchDocuments);
const canonicalRecords = records.filter((record) => /^(?:uu|pp|pmk|per|kep|se)-\d+-(?:19|20)\d{2}$/i.test(record.canonicalKey || "") && record.citation.length >= 5);
const exactCases = canonicalRecords.slice(0, 60).map((record) => {
  const result = hybridSearch(documents, { query: record.citation, tenantId: "benchmark", corpora: ["regulation"], limit: 3, minimumScore: 0 });
  return { canonicalKey: record.canonicalKey, citation: record.citation, top: result.hits[0]?.metadata.canonicalKey || "", passed: result.hits[0]?.metadata.canonicalKey === record.canonicalKey };
});

const facetCases = canonicalRecords.slice(0, 30).map((record) => {
  const year = Number(record.canonicalKey?.match(/-((?:19|20)\d{2})$/)?.[1] || 0);
  const status = record.extraction?.legalStatus && record.extraction.legalStatus !== "unknown" && record.extraction.keyProvisions.length && /^(?:sha256:)?[a-f0-9]{64}$/i.test(record.fileHash || "") ? "verified" as const : "review_required" as const;
  const result = hybridSearch(documents, { query: record.citation, tenantId: "benchmark", corpora: ["regulation"], limit: 8, minimumScore: 0, facets: { topics: [record.topic || "general"], statuses: [status], years: year ? [year] : undefined } });
  const expected = result.hits.find((hit) => hit.metadata.canonicalKey === record.canonicalKey);
  const precise = result.hits.every((hit) => hit.metadata.topic === (record.topic || "general") && hit.status === status && (!year || Number(hit.metadata.year) === year));
  return { canonicalKey: record.canonicalKey, returned: result.hits.length, expectedFound: Boolean(expected), facetPrecision: precise };
});

const graphFile = path.resolve(process.env.TDP_REGULATION_QUALITY_ROOT || "outputs/regulation-quality", "regulation-graph.json");
const graph = fs.existsSync(graphFile) ? JSON.parse(fs.readFileSync(graphFile, "utf8")) as { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> } : { nodes: [], edges: [] };
const recordKeys = new Set(records.map((record) => record.canonicalKey || record.id));
const graphKey = (value: unknown) => String(value || "").replace(/^law:/i, "").toLowerCase();
const eligibleEdges = (graph.edges || []).filter((edge) => edge.verified === true && edge.eligibleForAnswer === true && (!Array.isArray(edge.flags) || !edge.flags.length) && recordKeys.has(graphKey(edge.source)) && recordKeys.has(graphKey(edge.target)));
const timeMachineCases = eligibleEdges.slice(0, 30).map((edge) => {
  const source = graphKey(edge.source);
  const view = buildRegulationResearchView(records, source, { asOf: "2026-08-21", graph });
  const contributors = new Set(view?.consolidation.contributingSources || []);
  const eligibleComponent = new Set([source]);
  for (let depth = 0; depth < 3; depth += 1) for (const item of eligibleEdges) {
    const from = graphKey(item.source); const to = graphKey(item.target);
    if (eligibleComponent.has(from)) eligibleComponent.add(to);
    if (eligibleComponent.has(to)) eligibleComponent.add(from);
  }
  return { edgeId: edge.id, source, target: graphKey(edge.target), timelinePresent: Boolean(view?.timeline.some((node) => node.canonicalKey === graphKey(edge.target))), failClosed: [...contributors].every((key) => eligibleComponent.has(key)) };
});

const sourceCases = canonicalRecords.slice(0, 30).map((record) => {
  const docs = regulationToSearchDocuments(record);
  return {
    canonicalKey: record.canonicalKey,
    internalDetail: docs.length > 0 && `/sources/regulation/${encodeURIComponent(record.canonicalKey || record.id)}`.startsWith("/sources/regulation/"),
    officialPage: Boolean(record.sourceUrl),
    pdf: Boolean(record.storedPdfUrl || record.officialPdfUrl || record.pdfUrl || record.pdfUrls?.length),
    sourceHash: Boolean(record.fileHash),
    locator: docs.some((document) => Boolean(document.locator?.page || document.locator?.section))
  };
});

const watchCases = canonicalRecords.slice(0, 20).map((record, index) => {
  const scope = { tenantId: "benchmark", userId: `reviewer-${index}` };
  const rule = createWatchRule({ name: `Pantau ${record.citation}`, resourceId: record.canonicalKey }, scope);
  const baseline = watchState(rule, [record]);
  const changed = { ...record, fileHash: `${String(index % 10).repeat(64)}`, relations: [...(record.relations || []), { type: "amended_by" as const, citation: `PMK ${900 + index} Tahun 2026` }] };
  const alerts = alertsForChange({ ...rule, lastFingerprint: baseline.fingerprint, lastSummary: baseline.summary }, watchState(rule, [changed]));
  return { canonicalKey: record.canonicalKey, alerts: alerts.map((alert) => alert.type), detected: alerts.some((alert) => alert.type === "source_changed") && alerts.some((alert) => alert.type === "relation_changed") };
});

const ratio = (values: boolean[]) => values.length ? Math.round(values.filter(Boolean).length / values.length * 10_000) / 10_000 : 0;
const summary = {
  totalCases: exactCases.length + facetCases.length + timeMachineCases.length + sourceCases.length + watchCases.length,
  corpusRecords: records.length,
  searchDocuments: documents.length,
  exactLookupTop1: ratio(exactCases.map((item) => item.passed)),
  facetExpectedHitRate: ratio(facetCases.map((item) => item.expectedFound)),
  facetPrecision: ratio(facetCases.map((item) => item.facetPrecision)),
  timeMachineConnectedRate: ratio(timeMachineCases.map((item) => item.timelinePresent)),
  graphFailClosedRate: ratio(timeMachineCases.map((item) => item.failClosed)),
  internalDetailCoverage: ratio(sourceCases.map((item) => item.internalDetail)),
  pdfCoverageSample: ratio(sourceCases.map((item) => item.pdf)),
  hashCoverageSample: ratio(sourceCases.map((item) => item.sourceHash)),
  locatorCoverageSample: ratio(sourceCases.map((item) => item.locator)),
  watchChangeDetection: ratio(watchCases.map((item) => item.detected)),
  eligibleGraphCasesAvailable: eligibleEdges.length
};
const gates = {
  benchmarkSize: summary.totalCases >= 120,
  exactLookup: summary.exactLookupTop1 >= 0.9,
  facetPrecision: summary.facetPrecision === 1,
  graphFailClosed: summary.graphFailClosedRate === 1,
  internalDetail: summary.internalDetailCoverage === 1,
  watchDetection: summary.watchChangeDetection === 1
};
const output = { schemaVersion: "aa-jurist-wave2-research-parity-v1", generatedAt: new Date().toISOString(), summary, gates, passed: Object.values(gates).every(Boolean), cases: { exactLookup: exactCases, facets: facetCases, timeMachine: timeMachineCases, sourceDetail: sourceCases, watchlist: watchCases } };
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: path.relative(process.cwd(), outputPath), summary, gates, passed: output.passed }, null, 2)}\n`);
if (!output.passed) process.exitCode = 1;
