import assert from "node:assert/strict";
import test from "node:test";
import { hybridSearch } from "../lib/hybrid-search";
import type { Regulation } from "../lib/mock-data";
import { buildRegulationResearchView, compareRegulationVersions } from "../lib/regulation-timeline";
import type { SearchDocument } from "../lib/search-contracts";
import { alertsForChange, createWatchRule, watchState } from "../lib/watchlist";

const documents: SearchDocument[] = [
  { id: "regulation:pmk-1-2024:1", corpus: "regulation", title: "PPN barang", citation: "PMK 1 Tahun 2024", body: "PPN dan faktur pajak", authority: "Kemenkeu", visibility: "public", status: "verified", effectiveFrom: "2024-01-01", metadata: { canonicalKey: "pmk-1-2024", topic: "vat", topicLabel: "PPN", year: 2024 } },
  { id: "regulation:pmk-2-2025:1", corpus: "regulation", title: "PPN jasa", citation: "PMK 2 Tahun 2025", body: "PPN jasa dan faktur pajak", authority: "Kemenkeu", visibility: "public", status: "review_required", effectiveFrom: "2025-01-01", metadata: { canonicalKey: "pmk-2-2025", topic: "vat", topicLabel: "PPN", year: 2025 } },
  { id: "decision:one", corpus: "decision", title: "Putusan PPN", body: "Sengketa PPN dan faktur", authority: "Pengadilan Pajak", visibility: "tenant", tenantId: "tenant-a", status: "verified", metadata: { year: 2024 } }
];

test("universal search returns facets and applies filters after relevance ranking", () => {
  const unfiltered = hybridSearch(documents, { query: "PPN faktur", tenantId: "tenant-a" });
  assert.equal(unfiltered.facets.corpora.find((item) => item.value === "regulation")?.count, 2);
  assert.equal(unfiltered.facets.statuses.find((item) => item.value === "verified")?.count, 2);
  const filtered = hybridSearch(documents, { query: "PPN faktur", tenantId: "tenant-a", facets: { statuses: ["review_required"], years: [2025] } });
  assert.deepEqual(filtered.hits.map((hit) => hit.id), ["regulation:pmk-2-2025:1"]);
  assert.equal(filtered.hits[0].detailUrl, "/sources/regulation/pmk-2-2025");
});

function regulation(id: string, citation: string, status: "active" | "amended" | "revoked", date: string, provisions: Array<{ article: string; text: string }>): Regulation {
  return {
    id, canonicalKey: id, title: citation, citation, focus: provisions.map((item) => item.text).join(" "), relevance: 90, fileHash: "a".repeat(64), sourceUrl: "https://jdih.kemenkeu.go.id/",
    extraction: { schemaVersion: "regulation-extraction-v1", summary: citation, scope: [], keyProvisions: provisions, effectiveDate: date, legalStatus: status, relations: [], keywords: [], verificationNotes: [], extractedAt: date, model: "test", sourcePdfUrl: "https://jdih.kemenkeu.go.id/test.pdf" }
  };
}

test("time machine and consolidation use only verified answer-eligible graph edges", () => {
  const oldRule = regulation("pmk-1-2024", "PMK 1 Tahun 2024", "amended", "2024-01-01", [{ article: "Pasal 1", text: "Tarif lama." }]);
  const newRule = regulation("pmk-2-2025", "PMK 2 Tahun 2025", "active", "2025-01-01", [{ article: "Pasal 1", text: "Tarif baru." }]);
  const quarantined = regulation("pmk-3-2025", "PMK 3 Tahun 2025", "active", "2025-02-01", [{ article: "Pasal X", text: "Tidak boleh ikut." }]);
  const graph = { edges: [
    { id: "good", source: "pmk-1-2024", target: "pmk-2-2025", type: "amended_by", verified: true, eligibleForAnswer: true, flags: [] },
    { id: "bad", source: "pmk-2-2025", target: "pmk-3-2025", type: "related", verified: false, eligibleForAnswer: false, flags: ["unresolved_target"] }
  ] };
  const view = buildRegulationResearchView([oldRule, newRule, quarantined], "pmk-1-2024", { asOf: "2025-06-01", graph });
  assert.ok(view);
  assert.equal(view!.pendingEdgeCount, 0, "quarantined edge outside the verified component must not enter the timeline");
  assert.ok(view!.consolidation.contributingSources.includes("pmk-2-2025"));
  assert.ok(!view!.consolidation.contributingSources.includes("pmk-3-2025"));
});

test("version comparison classifies changed and added provisions", () => {
  const left = regulation("pmk-1-2024", "PMK 1 Tahun 2024", "amended", "2024-01-01", [{ article: "Pasal 1", text: "Tarif lama." }]);
  const right = regulation("pmk-2-2025", "PMK 2 Tahun 2025", "active", "2025-01-01", [{ article: "Pasal 1", text: "Tarif baru." }, { article: "Pasal 2", text: "Ketentuan tambahan." }]);
  const differences = compareRegulationVersions(left, right);
  assert.equal(differences.find((item) => item.article === "Pasal 1")?.kind, "changed");
  assert.equal(differences.find((item) => item.article === "Pasal 2")?.kind, "added");
});

test("watchlist detects status, relation and source changes without false first-run alerts", () => {
  const scope = { tenantId: "tenant-a", userId: "user-a" };
  const original = regulation("pmk-2-2025", "PMK 2 Tahun 2025", "active", "2025-01-01", [{ article: "Pasal 1", text: "Tarif baru." }]);
  const rule = createWatchRule({ name: "Pantau PMK 2", resourceId: "pmk-2-2025" }, scope, "2026-01-01T00:00:00.000Z");
  const baseline = watchState(rule, [original]);
  assert.deepEqual(alertsForChange(rule, baseline), []);
  const changed = { ...original, fileHash: "b".repeat(64), relations: [{ type: "revoked_by" as const, citation: "PMK 4 Tahun 2026" }], extraction: { ...original.extraction!, legalStatus: "revoked" as const } };
  const established = { ...rule, lastFingerprint: baseline.fingerprint, lastSummary: baseline.summary };
  const alerts = alertsForChange(established, watchState(established, [changed]));
  assert.ok(alerts.some((alert) => alert.type === "status_changed" && alert.severity === "critical"));
  assert.ok(alerts.some((alert) => alert.type === "relation_changed"));
  assert.ok(alerts.some((alert) => alert.type === "source_changed"));
});
