import assert from "node:assert/strict";
import test from "node:test";
import { assessRegulationChatTrust } from "../lib/chat-trust";
import { assessRegulationDocumentReadiness } from "../lib/document-readiness";
import type { Regulation } from "../lib/mock-data";
import { assessTaxQueryDomain } from "../lib/query-domain";
import type { SearchHit } from "../lib/search-contracts";
import { resolveTemporalIntent, validateTemporalSources } from "../lib/temporal-validation";

const completeRule: Regulation = {
  id: "pmk-131-2024",
  canonicalKey: "pmk-131-2024",
  topic: "vat",
  title: "Perlakuan Pajak Pertambahan Nilai atas Penyerahan Tertentu",
  citation: "PMK 131 Tahun 2024",
  focus: "Tarif PPN dan DPP nilai lain 11/12",
  content: "PPN dihitung dengan tarif 12 persen atas DPP nilai lain sebesar 11/12.",
  relevance: 99,
  source: "official",
  sourceUrl: "https://jdih.kemenkeu.go.id/dok/pmk-131-2024",
  officialPdfUrl: "https://jdih.kemenkeu.go.id/api/download/pmk-131-2024.pdf",
  fileHash: "c".repeat(64),
  ingestionStatus: "ready",
  extraction: {
    schemaVersion: "regulation-extraction-v1",
    summary: "Mengatur tarif PPN dan DPP nilai lain.",
    scope: ["PPN"],
    keyProvisions: [{ article: "Pasal 3 ayat (2)", page: 4, text: "DPP nilai lain sebesar 11/12 dari harga jual." }],
    effectiveDate: "2025-01-01",
    legalStatus: "active",
    relations: [],
    keywords: ["PPN", "DPP", "11/12"],
    verificationNotes: [],
    extractedAt: "2026-08-21T00:00:00.000Z",
    model: "test",
    sourcePdfUrl: "https://jdih.kemenkeu.go.id/api/download/pmk-131-2024.pdf"
  }
};

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    id: "regulation:pmk-131-2024:1",
    corpus: "regulation",
    title: completeRule.title,
    citation: completeRule.citation,
    snippet: "DPP nilai lain sebesar 11/12 dari harga jual.",
    sourceUrl: completeRule.sourceUrl || "",
    sourceHash: completeRule.fileHash || "",
    authority: "JDIH Kementerian Keuangan",
    locator: { page: 4, section: "Pasal 3 ayat (2)" },
    effectiveFrom: "2025-01-01",
    status: "verified",
    score: 91,
    lexicalScore: 0.9,
    semanticScore: null,
    exactMatch: false,
    matchedTerms: ["vat", "taxbase"],
    metadata: { legalStatus: "active", effectiveDate: "2025-01-01" },
    ...overrides
  };
}

test("negative-query gate rejects non-tax and specialised unsupported questions", () => {
  const negatives = [
    "Berapa upah minimum provinsi dan pesangon PHK?",
    "What is the procedure for filing a divorce petition?",
    "Tentukan klasifikasi HS code untuk mesin turbin.",
    "Bagaimana cuaca di Jakarta besok?"
  ];
  for (const question of negatives) assert.equal(assessTaxQueryDomain(question).inScope, false, question);
});

test("negative-query gate accepts Indonesian tax questions and tax-dispute framing", () => {
  const positives = [
    "Bagaimana cara menghitung PPN non-mewah?",
    "Berapa tarif PPh Pasal 23 atas jasa konsultan?",
    "Cari PMK Nomor 172 Tahun 2023.",
    "Dalam sengketa pajak, bagaimana klasifikasi HS dipersoalkan di Pengadilan Pajak?"
  ];
  for (const question of positives) assert.equal(assessTaxQueryDomain(question).inScope, true, question);
});

test("temporal intent distinguishes regulation number from a tax period", () => {
  assert.equal(resolveTemporalIntent("Cari PMK 131 Tahun 2024").required, false);
  const historical = resolveTemporalIntent("Aturan PPN untuk masa pajak 2024");
  assert.equal(historical.required, true);
  assert.equal(historical.asOf, "2024-12-31");
  const current = resolveTemporalIntent("Bagaimana cara menghitung PPN sekarang?", undefined, new Date("2026-08-21T00:00:00Z"));
  assert.equal(current.asOf, "2026-08-21");
});

test("temporal validator accepts an active in-period source and rejects a future source", () => {
  const valid = validateTemporalSources("Bagaimana cara menghitung PPN sekarang?", [hit()], { now: new Date("2026-08-21T00:00:00Z") });
  assert.equal(valid.valid, true);
  const future = validateTemporalSources("Bagaimana cara menghitung PPN pada masa pajak 2024?", [hit()]);
  assert.equal(future.valid, false);
  assert.deepEqual(future.excludedSourceIds, ["regulation:pmk-131-2024:1"]);
});

test("temporal validator requires a known end date for revoked historical rules", () => {
  const uncertain = validateTemporalSources("Aturan untuk masa pajak 2023", [hit({ metadata: { legalStatus: "revoked", effectiveDate: "2020-01-01" }, effectiveFrom: "2020-01-01", effectiveTo: undefined })]);
  assert.equal(uncertain.valid, false);
  assert.equal(uncertain.uncertainSourceIds.length, 1);
  const historical = validateTemporalSources("Aturan untuk masa pajak 2023", [hit({ metadata: { legalStatus: "revoked", effectiveDate: "2020-01-01" }, effectiveFrom: "2020-01-01", effectiveTo: "2024-12-31" })]);
  assert.equal(historical.valid, true);
});

test("document readiness requires official URL, PDF, hash, locator, status, date and text", () => {
  const complete = assessRegulationDocumentReadiness(completeRule);
  assert.equal(complete.score, 100);
  assert.equal(complete.answerEligible, true);
  assert.deepEqual(complete.flags, []);

  const incomplete = assessRegulationDocumentReadiness({ ...completeRule, sourceUrl: "", officialPdfUrl: "", pdfUrl: "", fileHash: "", content: "", extraction: null });
  assert.equal(incomplete.answerEligible, false);
  assert.ok(incomplete.flags.includes("missing_official_url"));
  assert.ok(incomplete.flags.includes("missing_pdf"));
  assert.ok(incomplete.flags.includes("missing_source_hash"));
  assert.ok(incomplete.flags.includes("missing_locator"));
});

test("regulation chatbot trust passes complete current evidence and blocks a negative query", () => {
  const scores = new Map([["pmk-131-2024", 94]]);
  const allowed = assessRegulationChatTrust("Bagaimana cara menghitung PPN non-mewah?", [completeRule], { language: "id", scoreByCanonical: scores });
  assert.equal(allowed.allowAnswer, true);
  assert.equal(allowed.temporal?.valid, true);

  const blocked = assessRegulationChatTrust("Bagaimana prosedur mengajukan perceraian?", [completeRule], { language: "id", scoreByCanonical: scores });
  assert.equal(blocked.abstain, true);
  assert.ok(blocked.reasons.some((reason) => reason.code === "OUT_OF_SCOPE"));
});
