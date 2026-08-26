import fs from "node:fs";
import path from "node:path";
import { graphEdgeEligibleForAnswer } from "./regulation-answer";
import { canonicalRegulationKey } from "./regulation-knowledge";
import type { Regulation, RegulationProvision } from "./mock-data";

export type TimelineEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  effectiveDate?: string;
  confidence: number | null;
  eligibleForAnswer: boolean;
  flags: string[];
};

export type TimelineNode = {
  canonicalKey: string;
  title: string;
  citation: string;
  legalStatus: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceUrl: string;
  pdfUrl: string;
  sourceHash: string;
  selected: boolean;
  applicableAsOf: boolean;
};

export type ConsolidatedProvision = RegulationProvision & {
  sourceCanonicalKey: string;
  sourceCitation: string;
  change: "base" | "amendment";
};

export type RegulationResearchView = {
  selected: Regulation;
  asOf: string;
  applicableVersion: TimelineNode | null;
  timeline: TimelineNode[];
  edges: TimelineEdge[];
  pendingEdgeCount: number;
  consolidation: {
    official: false;
    warning: string;
    contributingSources: string[];
    provisions: ConsolidatedProvision[];
  };
};

type GraphPayload = {
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
};

let graphCache: { file: string; stamp: string; graph: GraphPayload } | null = null;

function graphKey(value: unknown) {
  return String(value || "").replace(/^law:/i, "").trim().toLowerCase();
}

export function loadRegulationGraphSnapshot(): GraphPayload {
  const root = process.env.TDP_REGULATION_QUALITY_ROOT || path.resolve(/* turbopackIgnore: true */ "outputs/regulation-quality");
  const file = path.resolve(/* turbopackIgnore: true */ root, "regulation-graph.json");
  try {
    const stat = fs.statSync(file);
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    if (graphCache?.file === file && graphCache.stamp === stamp) return graphCache.graph;
    const graph = JSON.parse(fs.readFileSync(file, "utf8")) as GraphPayload;
    graphCache = { file, stamp, graph };
    return graph;
  } catch {
    return { nodes: [], edges: [] };
  }
}

function dateValue(value?: string, fallback = Number.NaN) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nodeValidity(node: Record<string, unknown> | undefined, record: Regulation) {
  const validity = node?.validity && typeof node.validity === "object" ? node.validity as Record<string, unknown> : {};
  const effectiveFrom = String(validity.validFrom || record.extraction?.effectiveDate || "") || undefined;
  const revoked = [...(record.extraction?.relations || []), ...(record.relations || [])]
    .find((relation) => relation.type === "revoked_by" && relation.effectiveDate)?.effectiveDate;
  const effectiveTo = String(validity.validTo || revoked || "") || undefined;
  return { effectiveFrom, effectiveTo };
}

function applicable(asOf: string, from?: string, to?: string) {
  const target = dateValue(asOf, Date.now());
  return target >= dateValue(from, Number.NEGATIVE_INFINITY) && target <= dateValue(to, Number.POSITIVE_INFINITY);
}

function timelineNode(record: Regulation, selectedKey: string, asOf: string, node?: Record<string, unknown>): TimelineNode {
  const { effectiveFrom, effectiveTo } = nodeValidity(node, record);
  return {
    canonicalKey: record.canonicalKey || canonicalRegulationKey(record),
    title: record.title,
    citation: record.citation,
    legalStatus: String((node?.validity as Record<string, unknown> | undefined)?.statusDerived || record.extraction?.legalStatus || "unknown"),
    effectiveFrom,
    effectiveTo,
    sourceUrl: record.sourceUrl || "",
    pdfUrl: record.storedPdfUrl || record.officialPdfUrl || record.pdfUrl || "",
    sourceHash: record.fileHash || "",
    selected: (record.canonicalKey || canonicalRegulationKey(record)) === selectedKey,
    applicableAsOf: applicable(asOf, effectiveFrom, effectiveTo)
  };
}

function relatedKeys(start: string, edges: TimelineEdge[]) {
  const keys = new Set([start]);
  for (let depth = 0; depth < 3; depth += 1) {
    for (const edge of edges) {
      if (!edge.eligibleForAnswer) continue;
      if (keys.has(edge.source)) keys.add(edge.target);
      if (keys.has(edge.target)) keys.add(edge.source);
    }
  }
  return keys;
}

function provisions(record: Regulation, change: ConsolidatedProvision["change"]): ConsolidatedProvision[] {
  const canonical = record.canonicalKey || canonicalRegulationKey(record);
  const extracted = record.extraction?.keyProvisions || [];
  if (extracted.length) return extracted.map((provision) => ({ ...provision, sourceCanonicalKey: canonical, sourceCitation: record.citation, change }));
  const fallback = String(record.extraction?.summary || record.focus || record.content || "").trim();
  return fallback ? [{ text: fallback, sourceCanonicalKey: canonical, sourceCitation: record.citation, change }] : [];
}

export function buildRegulationResearchView(
  records: Regulation[],
  selectedCanonicalKey: string,
  options: { asOf?: string; graph?: GraphPayload } = {}
): RegulationResearchView | null {
  const recordMap = new Map(records.map((record) => [record.canonicalKey || canonicalRegulationKey(record), record]));
  const selected = recordMap.get(selectedCanonicalKey);
  if (!selected) return null;
  const graph = options.graph || loadRegulationGraphSnapshot();
  const graphNodes = new Map((graph.nodes || []).map((node) => [graphKey(node.canonicalKey || node.id), node]));
  const edges: TimelineEdge[] = (graph.edges || []).map((edge, index) => ({
    id: String(edge.id || `edge-${index + 1}`),
    source: graphKey(edge.source),
    target: graphKey(edge.target),
    type: String(edge.type || "related"),
    effectiveDate: String(edge.effectiveDate || "") || undefined,
    confidence: Number.isFinite(edge.confidence) ? Number(edge.confidence) : null,
    eligibleForAnswer: graphEdgeEligibleForAnswer({
      verified: edge.verified === true,
      eligibleForAnswer: edge.eligibleForAnswer === true,
      flags: Array.isArray(edge.flags) ? edge.flags.map(String) : []
    }),
    flags: Array.isArray(edge.flags) ? edge.flags.map(String) : []
  })).filter((edge) => edge.source && edge.target);
  const connected = relatedKeys(selectedCanonicalKey, edges);
  const relevantEdges = edges.filter((edge) => connected.has(edge.source) && connected.has(edge.target));
  const asOf = options.asOf && Number.isFinite(Date.parse(options.asOf)) ? options.asOf : new Date().toISOString().slice(0, 10);
  const timeline = [...connected]
    .map((key) => recordMap.get(key))
    .filter((record): record is Regulation => Boolean(record))
    .map((record) => timelineNode(record, selectedCanonicalKey, asOf, graphNodes.get(record.canonicalKey || canonicalRegulationKey(record))))
    .sort((a, b) => dateValue(a.effectiveFrom, 0) - dateValue(b.effectiveFrom, 0) || a.citation.localeCompare(b.citation));
  const applicableCandidates = timeline.filter((node) => node.applicableAsOf && node.legalStatus !== "revoked");
  const applicableVersion = applicableCandidates.sort((a, b) => dateValue(b.effectiveFrom, 0) - dateValue(a.effectiveFrom, 0))[0] || null;
  const eligibleConnectedKeys = new Set(relevantEdges.filter((edge) => edge.eligibleForAnswer).flatMap((edge) => [edge.source, edge.target]));
  eligibleConnectedKeys.add(selectedCanonicalKey);
  const contributing = timeline
    .filter((node) => node.applicableAsOf && eligibleConnectedKeys.has(node.canonicalKey))
    .map((node) => recordMap.get(node.canonicalKey))
    .filter((record): record is Regulation => Boolean(record))
    .sort((left, right) => dateValue(left.extraction?.effectiveDate, 0) - dateValue(right.extraction?.effectiveDate, 0));
  // Materialize the latest reviewed text for each identified article. A later
  // amendment replaces the same article key; unnumbered summaries remain
  // separate so the UI never silently discards unmatched content.
  const materialized = new Map<string, ConsolidatedProvision>();
  let unnumbered = 0;
  for (const record of contributing) {
    const change = (record.canonicalKey || canonicalRegulationKey(record)) === selectedCanonicalKey ? "base" : "amendment";
    for (const provision of provisions(record, change)) {
      const key = provision.article?.trim().toLowerCase() || `unnumbered:${unnumbered++}`;
      materialized.set(key, provision);
    }
  }
  const consolidationProvisions = [...materialized.values()];
  return {
    selected,
    asOf,
    applicableVersion,
    timeline,
    edges: relevantEdges,
    pendingEdgeCount: relevantEdges.filter((edge) => !edge.eligibleForAnswer).length,
    consolidation: {
      official: false,
      warning: "Konsolidasi riset ini disusun dari relasi graph yang telah diverifikasi; naskah resmi dan ketentuan transisi tetap harus diperiksa.",
      contributingSources: contributing.map((record) => record.canonicalKey || canonicalRegulationKey(record)),
      provisions: consolidationProvisions
    }
  };
}

export type VersionDifference = {
  article: string;
  kind: "added" | "removed" | "changed" | "unchanged";
  before: string;
  after: string;
};

export function compareRegulationVersions(left: Regulation, right: Regulation): VersionDifference[] {
  const leftItems = provisions(left, "base");
  const rightItems = provisions(right, "base");
  const key = (item: ConsolidatedProvision, index: number) => String(item.article || `Bagian ${index + 1}`).trim().toLowerCase();
  const leftMap = new Map(leftItems.map((item, index) => [key(item, index), item]));
  const rightMap = new Map(rightItems.map((item, index) => [key(item, index), item]));
  const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])];
  return keys.map((itemKey) => {
    const before = leftMap.get(itemKey)?.text || "";
    const after = rightMap.get(itemKey)?.text || "";
    const kind = !before ? "added" : !after ? "removed" : before.replace(/\s+/g, " ").trim() === after.replace(/\s+/g, " ").trim() ? "unchanged" : "changed";
    return { article: leftMap.get(itemKey)?.article || rightMap.get(itemKey)?.article || itemKey, kind, before, after };
  });
}
