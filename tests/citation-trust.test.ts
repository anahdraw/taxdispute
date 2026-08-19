import assert from "node:assert/strict";
import test from "node:test";
import { assessTrust, citationMarker, validateCitations } from "../lib/citation-trust";
import { regulationToSearchDocuments } from "../lib/search-corpus";
import type { Regulation } from "../lib/mock-data";
import type { SearchHit } from "../lib/search-contracts";

const verifiedRule: SearchHit = {
  id: "regulation:uu-8:1",
  corpus: "regulation",
  title: "Undang-Undang Pajak Pertambahan Nilai",
  citation: "UU No. 8 Tahun 1983",
  snippet: "Pasal 9 mengatur pengkreditan Pajak Masukan yang didukung Faktur Pajak.",
  sourceUrl: "https://jdih.kemenkeu.go.id/dok/uu-8-1983",
  sourceHash: "a".repeat(64),
  authority: "JDIH Kementerian Keuangan",
  locator: { page: 10, section: "Pasal 9" },
  status: "verified",
  score: 92,
  lexicalScore: 0.9,
  semanticScore: 0.88,
  exactMatch: false,
  matchedTerms: ["inputvat", "taxinvoice"],
  metadata: { legalStatus: "active" }
};

test("citation validator accepts a supported machine-readable citation", () => {
  const marker = citationMarker(verifiedRule.id);
  const result = validateCitations(`Pajak Masukan dapat dikreditkan apabila didukung Faktur Pajak. ${marker}`, [verifiedRule]);
  assert.equal(result.valid, true);
  assert.equal(result.coverage, 1);
  assert.deepEqual(result.citedIds, [verifiedRule.id]);
});

test("citation validator rejects unknown and uncited claims", () => {
  const result = validateCitations(
    "Pajak Masukan selalu dapat dikreditkan. [[cite:regulation:unknown:1]]\nTarif pajak pasti lima persen untuk semua transaksi.",
    [verifiedRule]
  );
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "UNKNOWN_CITATION"));
  assert.ok(result.issues.some((issue) => issue.code === "UNSUPPORTED_CLAIM"));
});

test("trust layer allows a verified located official source", () => {
  const answer = `Pajak Masukan dapat dikreditkan apabila didukung Faktur Pajak. ${citationMarker(verifiedRule.id)}`;
  const trust = assessTrust([verifiedRule], { answer, asksCurrentLaw: true });
  assert.equal(trust.allowAnswer, true);
  assert.equal(trust.abstain, false);
  assert.equal(trust.evidence.officialRegulations, 1);
  assert.equal(trust.citationValidation?.valid, true);
  assert.equal(trust.citationValidation?.coverage, 1);
});

test("citation validator requires every cited source to meet the complete eligibility gate", () => {
  const variants: Array<{ label: string; source: SearchHit }> = [
    { label: "review status", source: { ...verifiedRule, status: "review_required" } },
    { label: "missing locator", source: { ...verifiedRule, locator: undefined } },
    { label: "missing immutable hash", source: { ...verifiedRule, sourceHash: "" } },
    { label: "non-official regulation URL", source: { ...verifiedRule, sourceUrl: "https://example.com/rule" } },
    { label: "retrieval below threshold", source: { ...verifiedRule, score: 29.9 } }
  ];

  for (const { label, source } of variants) {
    const answer = `Pajak Masukan dapat dikreditkan apabila didukung Faktur Pajak. ${citationMarker(source.id)}`;
    const validation = validateCitations(answer, [source]);
    assert.equal(validation.valid, false, label);
    assert.ok(validation.issues.some((issue) => issue.code === "INELIGIBLE_CITATION"), label);
  }
});

test("an uncited eligible source cannot launder an ineligible cited source", () => {
  const weakSource: SearchHit = {
    ...verifiedRule,
    id: "regulation:weak:1",
    snippet: "Kompensasi pajak tersedia apabila syarat dokumen dipenuhi.",
    status: "review_required"
  };
  const answer = `Kompensasi pajak tersedia apabila syarat dokumen dipenuhi. ${citationMarker(weakSource.id)}`;
  const trust = assessTrust([verifiedRule, weakSource], { answer });

  assert.equal(trust.allowAnswer, false);
  assert.equal(trust.abstain, true);
  assert.equal(trust.citationValidation?.valid, false);
  assert.ok(trust.citationValidation?.issues.some((issue) => issue.code === "INELIGIBLE_CITATION"));
});

test("short legal and numeric claims are substantive and numeric mismatches are unsupported", () => {
  const supported = `Pajak Masukan dapat dikreditkan apabila didukung Faktur Pajak. ${citationMarker(verifiedRule.id)}`;
  const uncited = validateCitations(`${supported}\nTarif PPN 77%.`, [verifiedRule]);
  const falselyCited = validateCitations(`Tarif PPN 77%. ${citationMarker(verifiedRule.id)}`, [verifiedRule]);

  assert.equal(uncited.substantiveClaims, 2);
  assert.equal(uncited.valid, false);
  assert.ok(uncited.issues.some((issue) => issue.code === "UNSUPPORTED_CLAIM" && issue.claim?.includes("77%")));
  assert.equal(falselyCited.valid, false);
  assert.ok(falselyCited.issues.some((issue) => issue.code === "UNSUPPORTED_CLAIM"));
});

test("trust layer abstains for high-scoring but unverified source summaries", () => {
  const weakSource: SearchHit = {
    ...verifiedRule,
    id: "regulation:seed:summary",
    sourceUrl: "",
    sourceHash: "",
    locator: undefined,
    status: "review_required"
  };
  const trust = assessTrust([weakSource]);
  assert.equal(trust.allowAnswer, false);
  assert.ok(trust.reasons.some((reason) => reason.code === "NO_VERIFIED_SOURCE"));
  assert.ok(trust.reasons.some((reason) => reason.code === "MISSING_LOCATOR"));
});

test("decision URL alone is never treated as verified provenance", () => {
  const decision: SearchHit = {
    ...verifiedRule,
    id: "decision:1:summary",
    corpus: "decision",
    sourceUrl: "https://example.public.blob.vercel-storage.com/decision.pdf",
    sourceHash: "",
    locator: undefined
  };
  const trust = assessTrust([decision]);
  assert.equal(trust.abstain, true);
  assert.ok(trust.reasons.some((reason) => reason.code === "NO_VERIFIED_SOURCE"));
});

test("current-law answers abstain when official legal status is unknown", () => {
  const unknownStatus = { ...verifiedRule, metadata: {} };
  const answer = `Pajak Masukan dapat dikreditkan apabila didukung Faktur Pajak. ${citationMarker(unknownStatus.id)}`;
  const trust = assessTrust([unknownStatus], { answer, asksCurrentLaw: true });
  assert.equal(trust.abstain, true);
  assert.equal(trust.allowAnswer, false);
  assert.ok(trust.reasons.some((reason) => reason.code === "UNKNOWN_LEGAL_STATUS"));
});

test("a revoked regulation cannot satisfy a current-law answer", () => {
  const revoked = { ...verifiedRule, metadata: { legalStatus: "revoked" } };
  const answer = `Pajak Masukan dapat dikreditkan apabila didukung Faktur Pajak. ${citationMarker(revoked.id)}`;
  const trust = assessTrust([revoked], { answer, asksCurrentLaw: true });

  assert.equal(trust.allowAnswer, false);
  assert.equal(trust.abstain, true);
  assert.ok(trust.reasons.some((reason) => reason.code === "UNKNOWN_LEGAL_STATUS"));
  assert.ok(trust.citationValidation?.issues.some((issue) => issue.code === "INELIGIBLE_CITATION"));
});

test("regulation corpus requires an immutable file hash before marking a provision verified", () => {
  const regulation: Regulation = {
    id: "uu-8-test",
    topic: "vat",
    title: "Undang-Undang Pajak Pertambahan Nilai",
    citation: "UU No. 8 Tahun 1983",
    focus: "Pajak Masukan",
    relevance: 95,
    source: "official",
    officialPdfUrl: "https://jdih.kemenkeu.go.id/dok/uu-8-test.pdf",
    fileHash: "",
    extraction: {
      schemaVersion: "regulation-extraction-v1",
      summary: "Mengatur pengkreditan Pajak Masukan.",
      scope: ["PPN"],
      keyProvisions: [{ article: "Pasal 9", page: 10, text: "Pajak Masukan dapat dikreditkan dengan Faktur Pajak." }],
      legalStatus: "active",
      relations: [],
      keywords: ["Pajak Masukan"],
      verificationNotes: [],
      extractedAt: "2026-08-13T00:00:00.000Z",
      model: "test",
      sourcePdfUrl: "https://jdih.kemenkeu.go.id/dok/uu-8-test.pdf"
    }
  };

  assert.equal(regulationToSearchDocuments(regulation)[0]?.status, "review_required");
  assert.equal(regulationToSearchDocuments({ ...regulation, fileHash: "b".repeat(64) })[0]?.status, "verified");
});

test("a verified retrieval still abstains when the answer leaves a substantive claim uncited", () => {
  const trust = assessTrust([verifiedRule], {
    answer: "Pajak Masukan dapat dikreditkan apabila didukung Faktur Pajak.",
    asksCurrentLaw: false
  });
  assert.equal(trust.abstain, true);
  assert.ok(trust.reasons.some((reason) => reason.code === "UNSUPPORTED_CLAIM"));
});
