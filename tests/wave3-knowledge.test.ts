import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeHub, queryKnowledgeHub } from "../lib/knowledge-hub";
import type { Regulation } from "../lib/mock-data";

function regulation(id: string, title: string, options: Partial<Regulation> = {}): Regulation {
  return {
    id,
    canonicalKey: id,
    title,
    citation: options.citation || id.toUpperCase(),
    focus: options.focus || title,
    relevance: 90,
    sourceUrl: options.sourceUrl === undefined ? "https://jdih.kemenkeu.go.id/test" : options.sourceUrl,
    fileHash: options.fileHash === undefined ? "a".repeat(64) : options.fileHash,
    extraction: options.extraction === undefined ? {
      schemaVersion: "regulation-extraction-v1", summary: title, scope: [], keyProvisions: [{ article: "Pasal 1", page: 1, text: title }],
      effectiveDate: "2025-01-01", legalStatus: "active", relations: [], keywords: [], verificationNotes: [], extractedAt: "2025-01-01", model: "test", sourcePdfUrl: ""
    } : options.extraction,
    ...options
  };
}

test("knowledge hub classifies every Wave 3 domain without treating a manual as law", () => {
  const records = [
    regulation("keppres-1-2020", "Persetujuan Penghindaran Pajak Berganda Indonesia dan Negara A"),
    regulation("perpres-2-2020", "Pengesahan Konvensi Multilateral Instrument"),
    regulation("kep-3-2025", "Implementasi Sistem Inti Administrasi Perpajakan Coretax"),
    regulation("per-4-2025", "Bentuk Isi dan Tata Cara Pengisian Formulir SPT Tahunan"),
    regulation("kmk-5-2025", "Nilai Kurs sebagai Dasar Pelunasan Pajak"),
    regulation("book:manual:test:001", "Bagaimana menghitung PPh 21?", { canonicalKey: "book:manual:test:001", source: "manual", sourceUrl: "", storedPdfUrl: "/api/reference-pdfs/test", citation: "Tax Manual hlm. 1" })
  ];
  const hub = buildKnowledgeHub(records);
  assert.ok(hub.items.some((item) => item.domain === "treaty" && item.subtype === "P3B"));
  assert.ok(hub.items.some((item) => item.domain === "treaty" && item.subtype === "MLI"));
  assert.ok(hub.items.some((item) => item.domain === "guides" && item.subtype === "Coretax"));
  assert.ok(hub.items.some((item) => item.domain === "forms"));
  assert.ok(hub.items.some((item) => item.domain === "rates"));
  const manual = hub.items.find((item) => item.domain === "manual");
  assert.equal(manual?.evidenceStatus, "reference_only");
  assert.equal(manual?.sourceKind, "manual");
});

test("change recap includes only verified graph edges that are eligible for answers", () => {
  const first = regulation("pmk-1-2024", "Aturan Lama", { citation: "PMK 1 Tahun 2024" });
  const second = regulation("pmk-2-2025", "Aturan Baru", { citation: "PMK 2 Tahun 2025" });
  const third = regulation("pmk-3-2025", "Aturan Belum Direview", { citation: "PMK 3 Tahun 2025" });
  const hub = buildKnowledgeHub([first, second, third], { edges: [
    { id: "good", source: "pmk-1-2024", target: "pmk-2-2025", type: "amended_by", verified: true, eligibleForAnswer: true, flags: [] },
    { id: "bad", source: "pmk-2-2025", target: "pmk-3-2025", type: "revoked_by", verified: false, eligibleForAnswer: false, flags: ["ambiguous"] }
  ] });
  const changes = hub.items.filter((item) => item.domain === "changes");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].evidenceStatus, "verified");
  assert.equal(changes[0].metadata?.targetKey, "pmk-2-2025");
});

test("glossary definitions retain source provenance and fail closed when evidence is incomplete", () => {
  const verifiedPpn = regulation("uu-8-1983", "Undang-Undang Pajak Pertambahan Nilai", { citation: "UU 8 Tahun 1983" });
  const hub = buildKnowledgeHub([verifiedPpn]);
  const ppn = hub.items.find((item) => item.domain === "glossary" && item.title.includes("Pertambahan"));
  const p3b = hub.items.find((item) => item.domain === "glossary" && item.title.includes("Penghindaran"));
  assert.equal(ppn?.evidenceStatus, "verified");
  assert.equal(ppn?.metadata?.sourceCanonicalKey, "uu-8-1983");
  assert.equal(p3b?.evidenceStatus, "review_required");
});

test("knowledge query applies domain, evidence, subtype, search, and pagination", () => {
  const records = Array.from({ length: 25 }, (_, index) => regulation(`kmk-${index + 1}-2025`, `Nilai Kurs sebagai Dasar Pelunasan Pajak periode ${index + 1}`));
  const hub = buildKnowledgeHub(records);
  const page = queryKnowledgeHub(hub, { domain: "rates", subtype: "KMK kurs", status: "verified", query: "pelunasan", limit: 10, offset: 10 });
  assert.equal(page.items.length, 10);
  assert.equal(page.total, 25);
  assert.equal(page.hasMore, true);
  assert.ok(page.items.every((item) => item.domain === "rates" && item.evidenceStatus === "verified"));
});

test("dynamic knowledge domains are reported as partial rather than falsely production-ready", () => {
  const hub = buildKnowledgeHub([
    regulation("form-1", "Formulir SPT Tahunan"),
    regulation("rate-1", "Nilai Kurs sebagai Dasar Pelunasan Pajak")
  ]);
  assert.equal(hub.readiness.find((item) => item.domain === "forms")?.status, "partial");
  assert.equal(hub.readiness.find((item) => item.domain === "rates")?.status, "partial");
  assert.ok(hub.connectors.some((item) => item.domain === "rates" && item.updateCadence === "weekly"));
});

test("official manual page chunks make operational Coretax details searchable with a page locator", () => {
  const manual = {
    id: "official:coretax:registration",
    domain: "guides" as const,
    subtype: "Coretax",
    title: "Pendaftaran wajib pajak orang pribadi",
    citation: "DJP Buku Panduan Coretax",
    summary: "Panduan registrasi.",
    tags: ["Coretax"],
    evidenceStatus: "verified" as const,
    legalStatus: "official_guidance",
    officialUrl: "https://www.pajak.go.id/coretaxpedia/buku-panduan-coretax-djp",
    pdfUrl: "https://www.pajak.go.id/sites/default/files/manual.pdf",
    internalUrl: "",
    sourceHash: "b".repeat(64),
    locator: { page: 1 },
    sourceKind: "official_guidance" as const
  };
  const hub = buildKnowledgeHub([], {}, [manual], [{
    id: "official:coretax:registration:p12", parentId: manual.id, domain: "guides", subtype: "Coretax", title: manual.title,
    page: 12, text: "Klik menu Portal Saya kemudian pilih Perubahan Data untuk memperbarui alamat email.",
    officialUrl: manual.officialUrl, pdfUrl: manual.pdfUrl, sourceHash: manual.sourceHash
  }]);
  const result = queryKnowledgeHub(hub, { domain: "guides", query: "memperbarui alamat email" });
  assert.equal(result.items[0]?.id, manual.id);
  assert.equal(result.items[0]?.locator?.page, 12);
  assert.match(result.items[0]?.summary || "", /Perubahan Data/);
});
