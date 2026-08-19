import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const repo = "/Users/sintzu/TaxDisputeC";
const qualityDir = path.join(repo, "outputs/regulation-quality");
const outputDir = path.join(repo, "outputs/review-required-audit");
const outputPath = path.join(outputDir, "aa-jurist-review-required.xlsx");

const report = JSON.parse(await fs.readFile(path.join(qualityDir, "regulation-quality-report.json"), "utf8"));
const graph = JSON.parse(await fs.readFile(path.join(qualityDir, "regulation-graph.json"), "utf8"));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.filter((r) => r.some((v) => v !== "")).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}

function trunc(value, max = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function joinFlags(value) { return Array.isArray(value) ? value.join(", ") : String(value || ""); }
function severityFromFlags(flags) {
  const value = Array.isArray(flags) ? flags : String(flags || "").split(",").filter(Boolean);
  if (value.some((x) => ["status_site_conflict", "metadata_body_identity_mismatch", "contradictory_relation_types", "hierarchy_violation", "source_conflict"].includes(x))) return "High";
  if (value.some((x) => ["unresolved_target", "self_reference", "self_relation", "unparsed_reference", "unparsed_canonical_identity"].includes(x))) return "High";
  return "Medium";
}
function asRows(headers, rows) { return [headers, ...rows]; }

const queue = parseCsv(await fs.readFile(path.join(qualityDir, "regulation-review-queue.csv"), "utf8"));
const flaggedNodes = graph.nodes.filter((node) => Array.isArray(node.qualityFlags) && node.qualityFlags.length);
const allFlaggedEdges = graph.edges.filter((edge) => !edge.eligibleForAnswer || (Array.isArray(edge.flags) && edge.flags.length));
const allFlaggedCitations = (await fs.readFile(path.join(qualityDir, "regulation-citations.jsonl"), "utf8"))
  .split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((item) => Array.isArray(item.flags) && item.flags.length);
const detailLimit = 5000;
const flagWeight = { unresolved_target: 100, contradictory_relation_types: 95, hierarchy_violation: 90, source_conflict: 85, unverified: 70, below_auto_review_threshold: 60, low_confidence: 55, missing_source: 50, temporal_inconsistency: 45, self_relation: 40, missing_evidence: 35 };
const reviewPriority = (flags) => (Array.isArray(flags) ? flags : []).reduce((sum, flag) => sum + (flagWeight[flag] || 10), 0);
const flaggedEdges = [...allFlaggedEdges].sort((a, b) => reviewPriority(b.flags) - reviewPriority(a.flags) || String(a.id).localeCompare(String(b.id))).slice(0, detailLimit);
const citations = [...allFlaggedCitations].sort((a, b) => reviewPriority(b.flags) - reviewPriority(a.flags) || String(a.id).localeCompare(String(b.id))).slice(0, detailLimit);

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Ringkasan");
const source = workbook.worksheets.add("Source Metrics");
const action = workbook.worksheets.add("Action Plan");
const nodeSheet = workbook.worksheets.add("Node Review");
const edgeSheet = workbook.worksheets.add("Edge Review");
const citationSheet = workbook.worksheets.add("Citation Review");
const queueSheet = workbook.worksheets.add("Queue Sample");

const navy = "#16324F";
const blue = "#1E6FA8";
const paleBlue = "#EAF4FB";
const paleRed = "#FCE8E6";
const paleAmber = "#FFF4D6";
const gray = "#667085";
const border = "#D8DEE8";

function styleTitle(sheet, range, fill = navy) {
  range.format = { fill, font: { bold: true, color: "#FFFFFF", size: 15 }, horizontalAlignment: "left", verticalAlignment: "center" };
  range.format.rowHeight = 28;
}
function styleHeader(range) {
  range.format = { fill: blue, font: { bold: true, color: "#FFFFFF" }, wrapText: true, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "all", style: "thin", color: border } };
  range.format.rowHeight = 30;
}
function styleBody(range) {
  range.format = { font: { color: "#243447", size: 10 }, verticalAlignment: "top", wrapText: true, borders: { insideHorizontal: { style: "thin", color: border } } };
}
function addTable(sheet, range, name) {
  const table = sheet.tables.add(range, true, name);
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;
  table.showBandedRows = true;
  return table;
}
function setWidths(sheet, widths) {
  for (const [col, width] of Object.entries(widths)) sheet.getRange(`${col}:${col}`).format.columnWidth = width;
}
function addStatusValidation(sheet, range) {
  sheet.getRange(range).dataValidation = { rule: { type: "list", values: ["Not Started", "In Review", "Verified", "Rejected", "Needs Source"] } };
}

summary.showGridLines = false;
summary.mergeCells("A1:H1"); summary.getRange("A1").values = [["AA-JURIST · REVIEW REQUIRED AUDIT"]]; styleTitle(summary, summary.getRange("A1:H1"));
summary.mergeCells("A2:H2"); summary.getRange("A2").values = [["Daftar isu kualitas peraturan, sitasi, dan graph yang masih harus diverifikasi sebelum dipakai sebagai evidence jawaban."]]; summary.getRange("A2:H2").format = { font: { color: gray, italic: true, size: 10 }, wrapText: true }; summary.getRange("A2:H2").format.rowHeight = 28;
summary.getRange("A4:B10").values = [
  ["Quality gate", report.summary.qualityGate], ["Generated", new Date()], ["Source", report.source?.database || report.source?.id || "peraturan-pipeline"],
  ["Regulation source rows", report.summary.sourceRegulationRows], ["Graph nodes", report.summary.nodes], ["Graph edges", report.summary.edges], ["Eligible graph edges", report.summary.eligibleEdges],
];
summary.getRange("A4:A10").format = { fill: paleBlue, font: { bold: true, color: navy } }; summary.getRange("B4:B10").format = { font: { bold: true, color: navy } }; summary.getRange("B5").setNumberFormat("yyyy-mm-dd hh:mm");
summary.getRange("A12:B19").values = [["Review items", "Count"], ["Flagged nodes", flaggedNodes.length], ["Flagged edges / not answer-eligible (full)", allFlaggedEdges.length], ["Edge detail rows shown", flaggedEdges.length], ["Flagged citations (full)", allFlaggedCitations.length], ["Citation detail rows shown", citations.length], ["Queue sample rows", queue.length], ["Quarantined edges", report.summary.quarantinedEdges]];
styleHeader(summary.getRange("A12:B12")); styleBody(summary.getRange("A13:B19")); summary.getRange("B13:B19").setNumberFormat("#,##0");
summary.getRange("A21:D27").values = [
  ["Key ratio", "Value", "Interpretation", "Formula/source"], ["Graph serving eligibility", null, "Eligible edges / all graph edges", "'=B10/B9"], ["Citation flag rate", null, "Flagged citations / total citations", "'=B16/'Source Metrics'!B9"], ["Resolved citation rate", null, "Resolved citations / total citations", "'='Source Metrics'!B10/'Source Metrics'!B9"], ["Gold coverage (benchmark)", 0.9714, "34 of 35 unique required IDs present", "pipeline benchmark artifact"], ["Quality status", "REVIEW_REQUIRED", "Do not promote graph evidence automatically", "quality report"], ["Negative FP status", "100%", "Abstention/routing still required", "benchmark artifact"],
];
styleHeader(summary.getRange("A21:D21")); styleBody(summary.getRange("A22:D27")); summary.getRange("B22:B24").formulas = [["=B10/B9"], ["=B16/'Source Metrics'!B8"], ["='Source Metrics'!B9/'Source Metrics'!B8"]]; summary.getRange("B22:B24").setNumberFormat("0.0%");
summary.mergeCells("A29:H31"); summary.getRange("A29").values = [["Prioritas: (1) status/identity conflict, (2) unresolved citation targets, (3) contradictory or low-confidence graph edges, (4) source/provenance gaps, (5) human sign-off sebelum serving. Detail sheet dibatasi 5.000 item prioritas; artefak JSONL/graph menyimpan seluruh item."]]; summary.getRange("A29:H31").format = { fill: paleAmber, font: { color: "#6B4E00", bold: true }, wrapText: true, verticalAlignment: "center" }; summary.getRange("A29:H31").format.rowHeight = 24;
setWidths(summary, { A: 30, B: 22, C: 42, D: 28, E: 16, F: 16, G: 16, H: 16 }); summary.freezePanes.freezeRows(3);

source.showGridLines = false; source.mergeCells("A1:D1"); source.getRange("A1").values = [["SOURCE METRICS · QUALITY REPORT"]]; styleTitle(source, source.getRange("A1:D1"));
const metricRows = [["Metric", "Value", "Category", "Definition"], ["sourceRegulationRows", report.summary.sourceRegulationRows, "Corpus", "Rows read from the pipeline source"], ["nodes", report.summary.nodes, "Graph", "Canonical law nodes"], ["edges", report.summary.edges, "Graph", "Collapsed relation edges"], ["eligibleEdges", report.summary.eligibleEdges, "Graph", "Eligible for answer serving"], ["relationRows", report.summary.relationRows, "Graph", "Raw relation rows before collapse"], ["citations", report.summary.citations, "Citations", "Parsed citation references"], ["resolvedCitations", report.summary.resolvedCitations, "Citations", "Citations mapped to a canonical target"], ["quarantinedCitations", report.summary.quarantinedCitations, "Citations", "Citations held out by quality gate"], ["quarantinedEdges", report.summary.quarantinedEdges, "Graph", "Edges held out by quality gate"], ["orphans", report.summary.orphans, "Graph", "Orphan relation endpoints"], ["duplicateSourceRows", report.summary.duplicateSourceRows, "Identity", "Duplicate source rows"], ["canonicalNodesWithMultipleRows", report.summary.duplicates.canonicalNodesWithMultipleRows, "Identity", "Canonical IDs with multiple rows"], ["relationRowsCollapsed", report.summary.duplicates.relationRowsCollapsed, "Identity", "Duplicate relation rows collapsed"], ["conflictEdges", report.summary.conflicts.edges, "Conflict", "Edges with conflicts"], ["conflictNodes", report.summary.conflicts.nodes, "Conflict", "Nodes with conflicts"], ["status_site_conflict", report.summary.nodeFlags.status_site_conflict, "Node flags", "Site status conflicts"], ["metadata_body_identity_mismatch", report.summary.nodeFlags.metadata_body_identity_mismatch, "Node flags", "Metadata/body identity mismatch"], ["unresolved_target_edges", report.summary.relationFlags.unresolved_target, "Relation flags", "Relation target not resolved"], ["unverified_edges", report.summary.relationFlags.unverified, "Relation flags", "Relation is not verified"], ["below_auto_review_threshold", report.summary.relationFlags.below_auto_review_threshold, "Relation flags", "Confidence below auto-review threshold"], ["contradictory_relation_types", report.summary.relationFlags.contradictory_relation_types, "Relation flags", "Contradictory relation types"]];
source.getRangeByIndexes(2, 0, metricRows.length, 4).values = metricRows; styleHeader(source.getRange("A3:D3")); styleBody(source.getRange(`A4:D${metricRows.length + 2}`)); source.getRange(`B4:B${metricRows.length + 2}`).setNumberFormat("#,##0"); addTable(source, `A3:D${metricRows.length + 2}`, "SourceMetricsTable"); setWidths(source, { A: 34, B: 16, C: 18, D: 62 }); source.freezePanes.freezeRows(3);

action.showGridLines = false; action.mergeCells("A1:F1"); action.getRange("A1").values = [["ACTION PLAN · REVIEW QUEUE PRIORITAS"]]; styleTitle(action, action.getRange("A1:F1"));
const actionRows = [["Priority", "Issue code", "Count", "Suggested owner", "Recommended check", "Release gate"], ["P0", "status_site_conflict", report.summary.nodeFlags.status_site_conflict, "Legal + Data QA", "Compare official status, effective period, and consolidated text.", "No unresolved conflict for answer-eligible node"], ["P0", "unresolved_target", report.summary.relationFlags.unresolved_target, "Data Engineering", "Resolve target citation to canonical ID; retain raw target when ambiguous.", "Target canonical ID + locator present"], ["P0", "metadata_body_identity_mismatch", report.summary.nodeFlags.metadata_body_identity_mismatch, "Data Engineering + Legal", "Check title/number against body and source PDF.", "Identity match or quarantine"], ["P0", "contradictory_relation_types", report.summary.relationFlags.contradictory_relation_types, "Legal Reviewer", "Determine whether relation is amendment, repeal, implementation, or conflict.", "One approved relation type"], ["P1", "unverified", report.summary.relationFlags.unverified, "Legal Reviewer", "Review evidence passage and official source provenance.", "Verified=true + evidence"], ["P1", "below_auto_review_threshold", report.summary.relationFlags.below_auto_review_threshold, "Legal Reviewer", "Manually review low-confidence relation extraction.", "Confidence meets policy"], ["P1", "source_conflict", report.summary.relationFlags.source_conflict, "Data QA", "Compare source URL/hash/body versions.", "Immutable source selected"], ["P1", "hierarchy_violation", report.summary.relationFlags.hierarchy_violation, "Legal Reviewer", "Check instrument hierarchy and direction of relation.", "Hierarchy-consistent edge"], ["P2", "self_reference / self_relation", report.summary.citationFlags.self_reference + report.summary.relationFlags.self_relation, "Data Engineering", "Remove accidental self edges; retain legitimate self-amendment only with evidence.", "No false self-edge"], ["P2", "unparsed_reference", report.summary.citationFlags.unparsed_reference, "Parser QA", "Improve citation parser and preserve locator context.", "Parsed or quarantined"], ["P2", "temporal_inconsistency", report.summary.relationFlags.temporal_inconsistency, "Legal Reviewer", "Check effective dates and repeal/amendment chronology.", "Temporal path consistent"], ["P2", "missing_source / missing_evidence", report.summary.relationFlags.missing_source + report.summary.relationFlags.missing_evidence, "Data QA", "Attach official URL/hash and evidence paragraph.", "Provenance complete"]];
action.getRangeByIndexes(2, 0, actionRows.length, 6).values = actionRows; styleHeader(action.getRange("A3:F3")); styleBody(action.getRange(`A4:F${actionRows.length + 2}`)); action.getRange(`C4:C${actionRows.length + 2}`).setNumberFormat("#,##0"); addTable(action, `A3:F${actionRows.length + 2}`, "ActionPlanTable"); action.getRange(`C4:C${actionRows.length + 2}`).conditionalFormats.add("dataBar", { color: "#F97316" }); setWidths(action, { A: 12, B: 34, C: 14, D: 25, E: 62, F: 38 }); action.freezePanes.freezeRows(3);

nodeSheet.showGridLines = false; nodeSheet.mergeCells("A1:P1"); nodeSheet.getRange("A1").values = [["NODE REVIEW · FLAGGED CANONICAL REGULATIONS"]]; styleTitle(nodeSheet, nodeSheet.getRange("A1:P1"));
const nodeHeaders = ["Review Status", "Severity", "Law ID", "Canonical", "Type", "Year", "Title", "Source", "Source URL", "Site Status", "Has Body", "Identity Mismatch", "Quality Flags", "Duplicate Rows", "Source Hash", "Validity Reason"];
const nodeRows = flaggedNodes.map((n) => ["Not Started", severityFromFlags(n.qualityFlags), n.id, n.canonical, n.typeCode, n.year || "", trunc(n.title, 220), n.source, n.sourceUrl, n.statusSiteRaw || n.statusSite, n.hasBody ? "Yes" : "No", n.identityMismatch ? "Yes" : "No", joinFlags(n.qualityFlags), n.duplicateSourceRows, n.sourceHash, trunc(n.validity?.reason, 180)]);
nodeSheet.getRangeByIndexes(2, 0, nodeRows.length + 1, nodeHeaders.length).values = asRows(nodeHeaders, nodeRows); styleHeader(nodeSheet.getRange("A3:P3")); styleBody(nodeSheet.getRange(`A4:P${nodeRows.length + 3}`)); addTable(nodeSheet, `A3:P${nodeRows.length + 3}`, "NodeReviewTable"); addStatusValidation(nodeSheet, `A4:A${nodeRows.length + 3}`); nodeSheet.getRange(`B4:B${nodeRows.length + 3}`).conditionalFormats.add("containsText", { text: "High", format: { fill: paleRed, font: { color: "#9B1C1C", bold: true } } }); setWidths(nodeSheet, { A: 16, B: 12, C: 28, D: 24, E: 12, F: 10, G: 58, H: 16, I: 48, J: 24, K: 11, L: 16, M: 38, N: 14, O: 68, P: 36 }); nodeSheet.freezePanes.freezeRows(3);

edgeSheet.showGridLines = false; edgeSheet.mergeCells("A1:Q1"); edgeSheet.getRange("A1").values = [["EDGE REVIEW · RELATIONS NOT ELIGIBLE FOR ANSWER SERVING"]]; styleTitle(edgeSheet, edgeSheet.getRange("A1:Q1"));
const edgeHeaders = ["Review Status", "Severity", "Edge ID", "Source Law", "Target Law", "Target Raw", "Relation Type", "Confidence", "Verified", "Eligible", "Flags", "Method", "Evidence Pasal ID", "Evidence", "Scope", "Duplicate Rows", "Serving Reason"];
const edgeRows = flaggedEdges.map((e) => ["Not Started", severityFromFlags(e.flags), e.id, e.source, e.target || "", e.targetRaw || "", e.type, e.confidence ?? "", e.verified ? "Yes" : "No", e.eligibleForAnswer ? "Yes" : "No", joinFlags(e.flags), e.method, e.evidencePasalId || "", trunc(e.evidence, 650), e.scope || "", e.duplicateRows, e.servingEligibility?.reason || "review_required"]);
edgeSheet.getRangeByIndexes(2, 0, edgeRows.length + 1, edgeHeaders.length).values = asRows(edgeHeaders, edgeRows); styleHeader(edgeSheet.getRange("A3:Q3")); styleBody(edgeSheet.getRange(`A4:Q${edgeRows.length + 3}`)); addTable(edgeSheet, `A3:Q${edgeRows.length + 3}`, "EdgeReviewTable"); addStatusValidation(edgeSheet, `A4:A${edgeRows.length + 3}`); edgeSheet.getRange(`H4:H${edgeRows.length + 3}`).setNumberFormat("0.00"); edgeSheet.getRange(`B4:B${edgeRows.length + 3}`).conditionalFormats.add("containsText", { text: "High", format: { fill: paleRed, font: { color: "#9B1C1C", bold: true } } }); setWidths(edgeSheet, { A: 16, B: 12, C: 28, D: 28, E: 28, F: 28, G: 22, H: 12, I: 11, J: 11, K: 38, L: 14, M: 35, N: 76, O: 18, P: 14, Q: 24 }); edgeSheet.freezePanes.freezeRows(3);

citationSheet.showGridLines = false; citationSheet.mergeCells("A1:L1"); citationSheet.getRange("A1").values = [["CITATION REVIEW · FLAGGED REFERENCES"]]; styleTitle(citationSheet, citationSheet.getRange("A1:L1"));
const citationHeaders = ["Review Status", "Severity", "Citation ID", "Source Law", "Target Law", "Canonical Key", "Raw Reference", "Flags", "Resolved", "Locator Path", "Section", "Context"];
const citationRows = citations.map((c) => ["Not Started", severityFromFlags(c.flags), c.id, c.source, c.target || "", c.canonicalKey || "", c.raw || "", joinFlags(c.flags), c.resolved ? "Yes" : "No", c.locator?.path || "", c.locator?.section || "", trunc(c.context, 650)]);
citationSheet.getRangeByIndexes(2, 0, citationRows.length + 1, citationHeaders.length).values = asRows(citationHeaders, citationRows); styleHeader(citationSheet.getRange("A3:L3")); styleBody(citationSheet.getRange(`A4:L${citationRows.length + 3}`)); addTable(citationSheet, `A3:L${citationRows.length + 3}`, "CitationReviewTable"); addStatusValidation(citationSheet, `A4:A${citationRows.length + 3}`); citationSheet.getRange(`B4:B${citationRows.length + 3}`).conditionalFormats.add("containsText", { text: "High", format: { fill: paleRed, font: { color: "#9B1C1C", bold: true } } }); setWidths(citationSheet, { A: 16, B: 12, C: 28, D: 30, E: 28, F: 28, G: 32, H: 32, I: 11, J: 35, K: 18, L: 80 }); citationSheet.freezePanes.freezeRows(3);

queueSheet.showGridLines = false; queueSheet.mergeCells("A1:J1"); queueSheet.getRange("A1").values = [["QUEUE SAMPLE · TOP 200 HIGH-SEVERITY ITEMS"]]; styleTitle(queueSheet, queueSheet.getRange("A1:J1"));
const queueHeaders = ["Review Status", "Severity", "Kind", "Issue Code", "ID", "Source", "Target", "Relation Type", "Raw", "Canonical"];
const queueRows = queue.map((q) => ["Not Started", q.severity, q.kind, q.code, q.id, q.source, q.target, q.type, trunc(q.raw, 450), q.canonical]);
queueSheet.getRangeByIndexes(2, 0, queueRows.length + 1, queueHeaders.length).values = asRows(queueHeaders, queueRows); styleHeader(queueSheet.getRange("A3:J3")); styleBody(queueSheet.getRange(`A4:J${queueRows.length + 3}`)); addTable(queueSheet, `A3:J${queueRows.length + 3}`, "QueueSampleTable"); addStatusValidation(queueSheet, `A4:A${queueRows.length + 3}`); setWidths(queueSheet, { A: 16, B: 12, C: 14, D: 38, E: 32, F: 28, G: 28, H: 24, I: 72, J: 38 }); queueSheet.freezePanes.freezeRows(3);

await fs.mkdir(outputDir, { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(JSON.stringify({ outputPath, counts: { flaggedNodes: flaggedNodes.length, flaggedEdgesFull: allFlaggedEdges.length, flaggedEdgesShown: flaggedEdges.length, flaggedCitationsFull: allFlaggedCitations.length, flaggedCitationsShown: citations.length, queueSample: queue.length } }));
