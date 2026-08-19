import assert from "node:assert/strict";
import test from "node:test";
import { hybridSearch, InvalidSearchRequestError } from "../lib/hybrid-search";
import type { SearchDocument } from "../lib/search-contracts";

const documents: SearchDocument[] = [
  {
    id: "regulation:uu-8:1",
    corpus: "regulation",
    title: "Undang-Undang Pajak Pertambahan Nilai",
    citation: "UU No. 8 Tahun 1983",
    body: "Pasal 9 mengatur pengkreditan Pajak Masukan yang didukung Faktur Pajak.",
    sourceUrl: "https://jdih.kemenkeu.go.id/dok/uu-8-1983",
    locator: { page: 10, section: "Pasal 9" },
    visibility: "public",
    status: "verified",
    embedding: [1, 0]
  },
  {
    id: "decision:a:1",
    corpus: "decision",
    title: "PUT-001",
    body: "Sengketa Pajak Masukan dan rekonsiliasi faktur.",
    visibility: "tenant",
    tenantId: "tenant-a",
    status: "verified",
    sourceHash: "sha256:a",
    locator: { page: 4 },
    embedding: [0.9, 0.1]
  },
  {
    id: "decision:b:1",
    corpus: "decision",
    title: "PUT-SECRET-B",
    body: "Sengketa Pajak Masukan rahasia tenant lain.",
    visibility: "tenant",
    tenantId: "tenant-b",
    status: "verified",
    sourceHash: "sha256:b",
    locator: { page: 3 },
    embedding: [1, 0]
  }
];

test("hybrid search fails closed without tenant scope", () => {
  assert.throws(() => hybridSearch(documents, { query: "Pajak Masukan", tenantId: "" }), InvalidSearchRequestError);
});

test("hybrid search includes public records but never crosses tenant boundary", () => {
  const result = hybridSearch(documents, { query: "Pajak Masukan", tenantId: "tenant-a", limit: 10 });
  assert.deepEqual(result.hits.map((hit) => hit.id).sort(), ["decision:a:1", "regulation:uu-8:1"]);
  assert.equal(result.diagnostics.tenantFiltered, true);
});

test("Indonesian PPN query matches VAT-normalized content and optional vector fusion", () => {
  const result = hybridSearch(documents, { query: "syarat kredit PPN", tenantId: "tenant-a", queryEmbedding: [1, 0] });
  assert.equal(result.hits[0]?.id, "regulation:uu-8:1");
  assert.equal(result.diagnostics.semanticEnabled, true);
  assert.ok(result.hits[0].matchedTerms.includes("vat"));
});

test("citation identifier outranks noisy body mentions", () => {
  const distractor: SearchDocument = {
    id: "regulation:se-23:1",
    corpus: "regulation",
    title: "Surat Edaran PPN 1995",
    citation: "SE-23/PJ.52/1995",
    body: "UU nomor dan tahun sering disebut dalam penjelasan PPN.",
    visibility: "public",
    status: "review_required"
  };
  const result = hybridSearch([...documents, distractor], {
    query: "UU Nomor 8 Tahun 1983 PPN",
    tenantId: "tenant-a",
    corpora: ["regulation"],
    limit: 1
  });
  assert.equal(result.hits[0]?.citation, "UU No. 8 Tahun 1983");
  assert.equal(result.hits[0]?.exactMatch, true);
});

test("invalid dates and unbounded limits are rejected", () => {
  assert.throws(() => hybridSearch(documents, { query: "PPN", tenantId: "tenant-a", asOf: "not-a-date" }), InvalidSearchRequestError);
  assert.throws(() => hybridSearch(documents, { query: "PPN", tenantId: "tenant-a", limit: 500 }), InvalidSearchRequestError);
});

test("runtime vector and score inputs are validated before ranking", () => {
  assert.throws(
    () => hybridSearch(documents, { query: "PPN", tenantId: "tenant-a", queryEmbedding: "not-a-vector" as unknown as number[] }),
    InvalidSearchRequestError
  );
  assert.throws(() => hybridSearch(documents, { query: "PPN", tenantId: "tenant-a", minimumScore: Number.NaN }), InvalidSearchRequestError);
  assert.throws(() => hybridSearch(documents, { query: "PPN", tenantId: "tenant-a", minimumScore: 101 }), InvalidSearchRequestError);
});
