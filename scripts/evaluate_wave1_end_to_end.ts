import fs from "node:fs";
import path from "node:path";
import { assessRegulationChatTrust } from "../lib/chat-trust";
import { summarizeDocumentReadiness } from "../lib/document-readiness";
import { assessTaxQueryDomain } from "../lib/query-domain";
import { rerankRegulationContext } from "../lib/regulation-answer";
import { mergeRegulationRecords } from "../lib/regulation-knowledge";
import { loadLocalRegulationSnapshot } from "../lib/regulation-snapshot";
import { resolveTemporalIntent } from "../lib/temporal-validation";

type Case = {
  id: string;
  query: string;
  expectedDomain: boolean;
  expectedTemporal?: boolean;
  expectedAsOf?: string;
  expectedCanonical?: string[];
};

const specPath = path.resolve(process.argv[2] || "tests/evaluation/wave1_end_to_end_benchmark.json");
const outputPath = path.resolve(process.argv[3] || "tests/evaluation/results/wave1-end-to-end.json");
const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as { schema_version: string; cases: Case[] };
const records = mergeRegulationRecords(loadLocalRegulationSnapshot());
const documentReadiness = summarizeDocumentReadiness(records);
const graphFile = path.resolve(process.env.TDP_REGULATION_QUALITY_ROOT || "outputs/regulation-quality", "regulation-graph.json");
const graphPayload = fs.existsSync(graphFile) ? JSON.parse(fs.readFileSync(graphFile, "utf8")) as { edges?: Array<{ type?: string; eligibleForAnswer?: boolean; verified?: boolean; flags?: string[] }> } : { edges: [] };
const importantRelation = (value: unknown) => /revok|cabut|ganti|amend|ubah|implement|laksana|effective|berlaku/i.test(String(value || ""));
const importantEdges = (graphPayload.edges || []).filter((edge) => importantRelation(edge.type));
const graphReview = {
  graphAvailable: fs.existsSync(graphFile),
  importantEdges: importantEdges.length,
  answerEligible: importantEdges.filter((edge) => edge.eligibleForAnswer === true && edge.verified === true && !(edge.flags || []).length).length,
  reviewRequired: importantEdges.filter((edge) => edge.eligibleForAnswer !== true || edge.verified !== true || (edge.flags || []).length > 0).length
};
const rows = spec.cases.map((item) => {
  const domain = assessTaxQueryDomain(item.query);
  const temporal = resolveTemporalIntent(item.query, undefined, new Date("2026-08-21T00:00:00.000Z"));
  const context = domain.inScope ? rerankRegulationContext(records, item.query, 8) : { records: [], diagnostics: { topScores: [] as Array<{ canonicalKey: string; score: number }> } };
  const scores = new Map(context.diagnostics.topScores.map((entry) => [entry.canonicalKey, entry.score]));
  const trust = assessRegulationChatTrust(item.query, context.records, { language: /\b(?:what|which|how)\b/i.test(item.query) ? "en" : "id", scoreByCanonical: scores });
  const retrieved = context.records.map((record) => record.canonicalKey || record.id);
  const expected = item.expectedCanonical || [];
  return {
    id: item.id,
    query: item.query,
    expectedDomain: item.expectedDomain,
    actualDomain: domain.inScope,
    domainCorrect: domain.inScope === item.expectedDomain,
    expectedTemporal: item.expectedTemporal,
    actualTemporal: temporal.required,
    temporalCorrect: item.expectedTemporal === undefined || temporal.required === item.expectedTemporal,
    expectedAsOf: item.expectedAsOf,
    actualAsOf: temporal.asOf,
    asOfCorrect: item.expectedAsOf === undefined || temporal.asOf === item.expectedAsOf,
    expectedCanonical: expected,
    retrieved,
    retrievalHit: expected.length === 0 || expected.some((id) => retrieved.includes(id)),
    abstained: trust.abstain,
    trustLevel: trust.level,
    trustScore: trust.score,
    trustReasons: trust.reasons.map((reason) => reason.code),
    evidence: trust.evidence
  };
});

const ratio = (passed: number, total: number) => total ? Math.round((passed / total) * 10_000) / 10_000 : 1;
const negatives = rows.filter((row) => !row.expectedDomain);
const temporalCases = rows.filter((row) => row.expectedTemporal !== undefined);
const retrievalCases = rows.filter((row) => row.expectedCanonical.length > 0);
const positives = rows.filter((row) => row.expectedDomain);
const summary = {
  cases: rows.length,
  corpusRecords: records.length,
  domainAccuracy: ratio(rows.filter((row) => row.domainCorrect).length, rows.length),
  negativeAbstentionRate: ratio(negatives.filter((row) => row.abstained).length, negatives.length),
  temporalIntentAccuracy: ratio(temporalCases.filter((row) => row.temporalCorrect && row.asOfCorrect).length, temporalCases.length),
  retrievalHitAt8: ratio(retrievalCases.filter((row) => row.retrievalHit).length, retrievalCases.length),
  trustedPositiveAnswerRate: ratio(positives.filter((row) => !row.abstained).length, positives.length),
  failedDomain: rows.filter((row) => !row.domainCorrect).map((row) => row.id),
  failedTemporal: temporalCases.filter((row) => !row.temporalCorrect || !row.asOfCorrect).map((row) => row.id),
  failedRetrieval: retrievalCases.filter((row) => !row.retrievalHit).map((row) => row.id)
};
const gates = {
  domainAccuracy: summary.domainAccuracy >= 0.95,
  negativeAbstention: summary.negativeAbstentionRate === 1,
  temporalIntent: summary.temporalIntentAccuracy >= 0.95,
  retrievalHitAt8: summary.retrievalHitAt8 >= 0.8
};
const output = { schema_version: "aa-jurist-wave1-e2e-results-v1", generatedAt: new Date().toISOString(), inputs: { spec: path.relative(process.cwd(), specPath), snapshotConfigured: Boolean(process.env.TDP_LOCAL_REGULATION_SNAPSHOT) }, summary, documentReadiness, graphReview, gates, passed: Object.values(gates).every(Boolean), cases: rows };
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: path.relative(process.cwd(), outputPath), summary, documentReadiness, graphReview, gates, passed: output.passed }, null, 2)}\n`);
if (!output.passed) process.exitCode = 1;
