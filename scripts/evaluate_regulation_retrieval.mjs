import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultGold = path.join(repoRoot, "tests", "evaluation", "regulation_retrieval_gold.json");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.resolve(filename), "utf8"));
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil((percentileValue / 100) * ordered.length) - 1);
  return ordered[Math.max(0, index)];
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function retrievedIds(resultCase) {
  return (resultCase?.retrieved || []).map((item) => {
    if (typeof item === "string") return item;
    return String(item.document_id || item.id || item.canonical_key || "");
  }).filter(Boolean);
}

function dcg(grades) {
  return grades.reduce((score, grade, index) => score + (2 ** grade - 1) / Math.log2(index + 2), 0);
}

function evaluateCase(goldCase, resultCase, k) {
  const ids = retrievedIds(resultCase);
  const top = ids.slice(0, k);
  const required = goldCase.required_document_ids || [];
  const supporting = goldCase.supporting_document_ids || [];
  const forbidden = goldCase.forbidden_document_ids || [];

  if (goldCase.kind === "negative") {
    return {
      id: goldCase.id,
      kind: goldCase.kind,
      language: goldCase.language,
      false_positive: top.length ? 1 : 0,
      returned: top.length,
      latency_ms: Number(resultCase?.latency_ms || 0)
    };
  }

  const requiredSet = new Set(required);
  const supportingSet = new Set(supporting);
  const firstRequiredIndex = ids.findIndex((id) => requiredSet.has(id));
  const grades = top.map((id) => requiredSet.has(id) ? 2 : supportingSet.has(id) ? 1 : 0);
  const idealGrades = [...required.map(() => 2), ...supporting.map(() => 1)].slice(0, k);
  const idealDcg = dcg(idealGrades);
  const foundRequired = required.filter((id) => top.includes(id));
  const forbiddenFound = forbidden.filter((id) => top.includes(id));

  return {
    id: goldCase.id,
    kind: goldCase.kind,
    language: goldCase.language,
    hit_at_k: foundRequired.length ? 1 : 0,
    recall_required_at_k: required.length ? foundRequired.length / required.length : 0,
    all_required_at_k: foundRequired.length === required.length ? 1 : 0,
    reciprocal_rank: firstRequiredIndex >= 0 ? 1 / (firstRequiredIndex + 1) : 0,
    ndcg_at_k: idealDcg ? dcg(grades) / idealDcg : 0,
    forbidden_at_k: forbiddenFound.length,
    top_1_correct: ids[0] && requiredSet.has(ids[0]) ? 1 : 0,
    missing_required: required.filter((id) => !top.includes(id)),
    latency_ms: Number(resultCase?.latency_ms || 0)
  };
}

function summarize(gold, results, k) {
  const resultMap = new Map((results.cases || []).map((item) => [item.id, item]));
  const rows = gold.cases.map((goldCase) => evaluateCase(goldCase, resultMap.get(goldCase.id), k));
  const positiveRows = rows.filter((row) => row.kind !== "negative");
  const negativeRows = rows.filter((row) => row.kind === "negative");
  const lookupRows = positiveRows.filter((row) => row.kind === "lookup");
  const latencies = rows.map((row) => row.latency_ms).filter((value) => value > 0);

  const metricBlock = (items) => ({
    cases: items.length,
    hit_at_k: round(mean(items.map((row) => row.hit_at_k || 0))),
    recall_required_at_k: round(mean(items.map((row) => row.recall_required_at_k || 0))),
    all_required_at_k: round(mean(items.map((row) => row.all_required_at_k || 0))),
    mrr: round(mean(items.map((row) => row.reciprocal_rank || 0))),
    ndcg_at_k: round(mean(items.map((row) => row.ndcg_at_k || 0)))
  });

  const byKind = Object.fromEntries(
    [...new Set(positiveRows.map((row) => row.kind))].sort().map((kind) => [kind, metricBlock(positiveRows.filter((row) => row.kind === kind))])
  );
  const byLanguage = Object.fromEntries(
    [...new Set(positiveRows.map((row) => row.language))].sort().map((language) => [language, metricBlock(positiveRows.filter((row) => row.language === language))])
  );

  return {
    engine: results.engine || path.basename(results.source || "results"),
    corpus: results.corpus || gold.corpus,
    k,
    positive: metricBlock(positiveRows),
    exact_lookup_top_1_accuracy: round(mean(lookupRows.map((row) => row.top_1_correct || 0))),
    negative_false_positive_rate_at_k: round(mean(negativeRows.map((row) => row.false_positive || 0))),
    by_kind: byKind,
    by_language: byLanguage,
    latency_ms: {
      samples: latencies.length,
      mean: round(mean(latencies), 2),
      p95: round(percentile(latencies, 95), 2)
    },
    failed_cases: rows.filter((row) => row.kind !== "negative" && !row.all_required_at_k).map((row) => ({
      id: row.id,
      missing_required: row.missing_required
    })),
    negative_false_positives: rows.filter((row) => row.kind === "negative" && row.false_positive).map((row) => row.id)
  };
}

function metricDelta(candidate, baseline) {
  return {
    hit_at_k: round(candidate.positive.hit_at_k - baseline.positive.hit_at_k),
    recall_required_at_k: round(candidate.positive.recall_required_at_k - baseline.positive.recall_required_at_k),
    all_required_at_k: round(candidate.positive.all_required_at_k - baseline.positive.all_required_at_k),
    mrr: round(candidate.positive.mrr - baseline.positive.mrr),
    ndcg_at_k: round(candidate.positive.ndcg_at_k - baseline.positive.ndcg_at_k),
    exact_lookup_top_1_accuracy: round(candidate.exact_lookup_top_1_accuracy - baseline.exact_lookup_top_1_accuracy),
    negative_false_positive_rate_at_k: round(candidate.negative_false_positive_rate_at_k - baseline.negative_false_positive_rate_at_k),
    latency_p95_ms: round(candidate.latency_ms.p95 - baseline.latency_ms.p95, 2)
  };
}

const resultsPath = argument("--results");
if (!resultsPath) {
  console.error("Usage: node scripts/evaluate_regulation_retrieval.mjs --results <engine-results.json> [--compare <candidate-results.json>] [--gold <gold.json>] [--k 5]");
  process.exit(2);
}

const gold = readJson(argument("--gold", defaultGold));
const k = Math.max(1, Number(argument("--k", String(gold.default_k || 5))));
const baselineSummary = summarize(gold, readJson(resultsPath), k);
const comparePath = argument("--compare");

if (!comparePath) {
  console.log(JSON.stringify(baselineSummary, null, 2));
} else {
  const candidateSummary = summarize(gold, readJson(comparePath), k);
  console.log(JSON.stringify({
    baseline: baselineSummary,
    candidate: candidateSummary,
    delta_candidate_minus_baseline: metricDelta(candidateSummary, baselineSummary)
  }, null, 2));
}
