import assert from "node:assert/strict";
import test from "node:test";
import { selectTpRegulationContext } from "../lib/tp-regulation-context";
import type { Regulation } from "../lib/mock-data";

function regulation(overrides: Partial<Regulation>): Regulation {
  return {
    id: "regulation",
    topic: "transfer_pricing",
    title: "Transfer Pricing Regulation",
    citation: "TEST",
    focus: "Arm's-length principle",
    relevance: 80,
    source: "manual",
    sourceUrl: "",
    ...overrides
  };
}

test("TP regulation context prioritizes current official PMK 172 and retains legal status", () => {
  const records: Regulation[] = [
    regulation({ id: "old", title: "PMK 213 Tahun 2016", citation: "PMK 213/2016", relevance: 99, extraction: { schemaVersion: "regulation-extraction-v1", summary: "", scope: [], keyProvisions: [], legalStatus: "revoked", relations: [], keywords: [], verificationNotes: [], extractedAt: "2026-01-01", model: "test", sourcePdfUrl: "" } }),
    regulation({ id: "current", title: "PMK Nomor 172 Tahun 2023", citation: "PMK 172/2023", source: "official", sourceUrl: "https://jdih.kemenkeu.go.id/", extraction: { schemaVersion: "regulation-extraction-v1", summary: "", scope: [], keyProvisions: [{ article: "Pasal 16", text: "Dokumen penentuan harga transfer" }], legalStatus: "active", relations: [], keywords: [], verificationNotes: [], extractedAt: "2026-01-01", model: "test", sourcePdfUrl: "" } }),
    regulation({ id: "vat", topic: "vat", title: "VAT regulation", citation: "VAT", focus: "Input tax", relevance: 100 })
  ];
  const selected = selectTpRegulationContext(records);
  assert.equal(selected[0]?.citation, "PMK 172/2023");
  assert.equal(selected[0]?.legalStatus, "active");
  assert.equal(selected.some((entry) => entry.citation === "VAT"), false);
  assert.equal(selected.find((entry) => entry.citation === "PMK 213/2016")?.legalStatus, "revoked");
});
