import { readFile } from "fs/promises";
import path from "path";
import { readLocalJson, updateLocalJson } from "./local-json-store";

export const REVIEW_STATUSES = ["Not Started", "In Review", "Verified", "Rejected", "Needs Source"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type ReviewKind = "node" | "edge" | "citation" | "queue";

export type ReviewDecision = {
  key: string;
  kind: ReviewKind;
  id: string;
  status: ReviewStatus;
  note: string;
  reviewer: string;
  updatedAt: string;
};

export type ReviewItem = {
  key: string;
  kind: ReviewKind;
  id: string;
  severity: string;
  flags: string[];
  source?: string;
  target?: string;
  type?: string;
  canonical?: string;
  title?: string;
  sourceUrl?: string;
  statusSite?: string;
  confidence?: number | null;
  verified?: boolean;
  eligibleForAnswer?: boolean;
  raw?: string;
  evidence?: string;
  context?: string;
  locator?: Record<string, unknown> | null;
  details: Record<string, unknown>;
  decision: ReviewDecision;
};

type QualityReport = {
  findingsSample?: Array<Record<string, unknown>>;
  summary: Record<string, any>;
  source?: Record<string, unknown>;
};

type GraphNode = Record<string, any> & { qualityFlags?: string[] };
type GraphEdge = Record<string, any> & { flags?: string[] };

type DecisionMap = Record<string, ReviewDecision>;

const qualityRoot = path.resolve(process.env.TDP_REGULATION_QUALITY_ROOT || "outputs/regulation-quality");
const decisionFile = "regulation-review-decisions.json";
let reportPromise: Promise<QualityReport> | null = null;
let graphPromise: Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> | null = null;
let citationsPromise: Promise<Array<Record<string, any>>> | null = null;

function filePath(name: string) {
  return path.join(qualityRoot, name);
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(filePath(name), "utf8")) as T;
}

function normalizeSeverity(flags: string[], supplied?: string) {
  if (String(supplied || "").toLowerCase() === "high") return "High";
  if (flags.some((flag) => ["status_site_conflict", "metadata_body_identity_mismatch", "contradictory_relation_types", "hierarchy_violation", "source_conflict", "unresolved_target", "self_reference", "self_relation", "unparsed_reference"].includes(flag))) return "High";
  return "Medium";
}

function reviewKey(kind: ReviewKind, id: string) { return `${kind}:${id}`; }

async function getDecisions(): Promise<DecisionMap> {
  return readLocalJson<DecisionMap>(decisionFile, {});
}

function defaultDecision(kind: ReviewKind, id: string): ReviewDecision {
  return { key: reviewKey(kind, id), kind, id, status: "Not Started", note: "", reviewer: "", updatedAt: "" };
}

async function getReport() {
  reportPromise ||= readJson<QualityReport>("regulation-quality-report.json");
  return reportPromise;
}

async function getGraph() {
  graphPromise ||= readJson<{ nodes: GraphNode[]; edges: GraphEdge[] }>("regulation-graph.json");
  return graphPromise;
}

async function getCitations() {
  citationsPromise ||= readFile(filePath("regulation-citations.jsonl"), "utf8").then((text) => text.split("\n").filter(Boolean).map((line) => JSON.parse(line)));
  return citationsPromise;
}

function baseItem(kind: ReviewKind, id: string, source: Record<string, any>, decisions: DecisionMap): ReviewItem {
  const flags = Array.isArray(source.flags) ? source.flags.map(String) : Array.isArray(source.qualityFlags) ? source.qualityFlags.map(String) : [];
  const decision = decisions[reviewKey(kind, id)] || defaultDecision(kind, id);
  return {
    key: reviewKey(kind, id),
    kind,
    id,
    severity: normalizeSeverity(flags, source.severity),
    flags,
    source: source.source || source.id,
    target: source.target || source.targetRaw || "",
    type: source.type || source.typeCode || "",
    canonical: source.canonical || source.canonicalKey || "",
    title: source.title || "",
    sourceUrl: source.sourceUrl || source.url || "",
    statusSite: source.statusSiteRaw || source.statusSite || "",
    confidence: typeof source.confidence === "number" ? source.confidence : null,
    verified: typeof source.verified === "boolean" ? source.verified : undefined,
    eligibleForAnswer: typeof source.eligibleForAnswer === "boolean" ? source.eligibleForAnswer : undefined,
    raw: source.raw || source.targetRaw || "",
    evidence: source.evidence || "",
    context: source.context || "",
    locator: source.locator || null,
    details: source,
    decision
  };
}

export async function reviewSummary() {
  const [report, graph, citations, decisions] = await Promise.all([getReport(), getGraph(), getCitations(), getDecisions()]);
  const nodes = graph.nodes.filter((node) => node.qualityFlags?.length);
  const edges = graph.edges.filter((edge) => !edge.eligibleForAnswer || edge.flags?.length);
  const flaggedCitations = citations.filter((item) => item.flags?.length);
  const allItems = [
    ...nodes.map((node) => baseItem("node", String(node.id), node, decisions)),
    ...edges.map((edge) => baseItem("edge", String(edge.id), edge, decisions)),
    ...flaggedCitations.map((citation) => baseItem("citation", String(citation.id), citation, decisions)),
    ...(report.findingsSample || []).map((finding) => baseItem("queue", String(finding.id), finding, decisions))
  ];
  const flagCounts: Record<string, number> = {};
  for (const item of allItems) for (const flag of item.flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
  const statusCounts: Record<string, number> = {};
  for (const item of allItems) statusCounts[item.decision.status] = (statusCounts[item.decision.status] || 0) + 1;
  return {
    qualityGate: report.summary.qualityGate || "review_required",
    source: report.source || {},
    summary: report.summary,
    counts: { nodes: nodes.length, edges: edges.length, citations: flaggedCitations.length, queue: (report.findingsSample || []).length },
    flagCounts,
    statusCounts,
    fullArtifacts: { graph: "outputs/regulation-quality/regulation-graph.json", citations: "outputs/regulation-quality/regulation-citations.jsonl", report: "outputs/regulation-quality/regulation-quality-report.json" }
  };
}

function searchText(item: ReviewItem) {
  return [item.id, item.source, item.target, item.canonical, item.title, item.type, item.raw, item.evidence, item.context, item.flags.join(" ")].join(" ").toLowerCase();
}

export async function reviewItems(options: { kind?: ReviewKind | "all"; query?: string; flag?: string; severity?: string; status?: string; page?: number; pageSize?: number }) {
  const [graph, citations, report, decisions] = await Promise.all([getGraph(), getCitations(), getReport(), getDecisions()]);
  const kinds: ReviewKind[] = options.kind && options.kind !== "all" ? [options.kind] : ["node", "edge", "citation", "queue"];
  const rows: ReviewItem[] = [];
  if (kinds.includes("node")) for (const node of graph.nodes.filter((item) => item.qualityFlags?.length)) rows.push(baseItem("node", String(node.id), node, decisions));
  if (kinds.includes("edge")) for (const edge of graph.edges.filter((item) => !item.eligibleForAnswer || item.flags?.length)) rows.push(baseItem("edge", String(edge.id), edge, decisions));
  if (kinds.includes("citation")) for (const citation of citations.filter((item) => item.flags?.length)) rows.push(baseItem("citation", String(citation.id), citation, decisions));
  if (kinds.includes("queue")) for (const finding of report.findingsSample || []) rows.push(baseItem("queue", String(finding.id), finding, decisions));
  const query = String(options.query || "").trim().toLowerCase();
  const filtered = rows.filter((item) => (!query || searchText(item).includes(query)) && (!options.flag || item.flags.includes(options.flag)) && (!options.severity || item.severity === options.severity) && (!options.status || item.decision.status === options.status));
  const priority = (item: ReviewItem) => (item.severity === "High" ? 100 : 10) + item.flags.reduce((sum, flag) => sum + (flag === "unresolved_target" ? 20 : flag === "status_site_conflict" ? 18 : 5), 0);
  filtered.sort((a, b) => priority(b) - priority(a) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const pageSize = Math.min(100, Math.max(10, Number(options.pageSize) || 50));
  const page = Math.max(1, Number(options.page) || 1);
  const start = (page - 1) * pageSize;
  return { rows: filtered.slice(start, start + pageSize), pagination: { page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) } };
}

/** Return one flagged review item without exposing the full corpus to the client. */
export async function reviewItem(kind: ReviewKind, id: string): Promise<ReviewItem | null> {
  const [graph, citations, report, decisions] = await Promise.all([getGraph(), getCitations(), getReport(), getDecisions()]);
  if (kind === "node") {
    const source = graph.nodes.find((item) => String(item.id) === id && item.qualityFlags?.length);
    return source ? baseItem(kind, id, source, decisions) : null;
  }
  if (kind === "edge") {
    const source = graph.edges.find((item) => String(item.id) === id && (!item.eligibleForAnswer || item.flags?.length));
    return source ? baseItem(kind, id, source, decisions) : null;
  }
  if (kind === "citation") {
    const source = citations.find((item) => String(item.id) === id && item.flags?.length);
    return source ? baseItem(kind, id, source, decisions) : null;
  }
  const source = (report.findingsSample || []).find((item) => String(item.id) === id);
  return source ? baseItem(kind, id, source, decisions) : null;
}

export async function saveReviewDecision(input: { kind: ReviewKind; id: string; status: ReviewStatus; note?: string; reviewer: string }) {
  const key = reviewKey(input.kind, input.id);
  const decision: ReviewDecision = { key, kind: input.kind, id: input.id, status: input.status, note: String(input.note || "").slice(0, 4000), reviewer: String(input.reviewer || "").slice(0, 180), updatedAt: new Date().toISOString() };
  await updateLocalJson<DecisionMap>(decisionFile, {}, (current) => ({ ...current, [key]: decision }));
  return decision;
}
