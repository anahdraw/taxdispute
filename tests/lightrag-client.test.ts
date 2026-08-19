import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLightRagQueryPayload,
  canonicalIdFromLightRagReference,
  lightRagConfigFromEnv,
  matchLightRagReferencesToRegulations,
  normalizeLightRagResponse,
  queryLightRag,
  regulationToLightRagDocument
} from "../lib/lightrag-client";
import type { Regulation } from "../lib/mock-data";

const config = lightRagConfigFromEnv({
  LIGHTRAG_BASE_URL: "http://127.0.0.1:9621/",
  LIGHTRAG_QUERY_MODE: "mix",
  LIGHTRAG_TIMEOUT_MS: "5000",
  LIGHTRAG_TOP_K: "9",
  LIGHTRAG_CHUNK_TOP_K: "14",
  LIGHTRAG_API_KEY: "test-secret"
});

assert.ok(config);

test("query payload requests retrievable chunks for independent AA-Jurist synthesis", () => {
  assert.deepEqual(buildLightRagQueryPayload({ query: "Apa syarat kredit Pajak Masukan?" }, config), {
    query: "Apa syarat kredit Pajak Masukan?",
    mode: "mix",
    only_need_context: true,
    include_references: true,
    include_chunk_content: true,
    enable_rerank: true,
    top_k: 9,
    chunk_top_k: 14
  });
});

test("response normalizer supports current content-array contract", () => {
  const result = normalizeLightRagResponse(
    {
      response: "retrieved context",
      response_time: 0.25,
      references: [
        {
          reference_id: "1",
          file_path: "aaj-regulation--uu-8-1983.md",
          content: ["AAJ-CANONICAL-ID: uu-8-1983\nPasal 9 mengatur Pajak Masukan."]
        }
      ]
    },
    "mix",
    300
  );
  assert.equal(result.references[0].canonicalId, "uu-8-1983");
  assert.equal(result.serverLatencyMs, 250);
  assert.equal(result.clientLatencyMs, 300);
  assert.equal(result.hasContext, true);
  assert.match(result.context, /Pasal 9/);
});

test("canonical id falls back to deterministic source filename", () => {
  assert.equal(canonicalIdFromLightRagReference("/inputs/aaj-regulation--pmk-172-2023.md"), "pmk-172-2023");
  assert.equal(
    canonicalIdFromLightRagReference("aa-jurist://regulation/essential-01-uu-no-6-tahun-1983-tentang-kup"),
    "essential-01-uu-no-6-tahun-1983-tentang-kup"
  );
  assert.equal(
    canonicalIdFromLightRagReference("essential-01-uu-no-6-tahun-1983-tentang-kup"),
    "essential-01-uu-no-6-tahun-1983-tentang-kup"
  );
  assert.equal(canonicalIdFromLightRagReference("unknown.md", ["ID dokumen: legacy-rule-id"]), "legacy-rule-id");
});

test("regulation serializer and reference matcher preserve the canonical record", () => {
  const record: Regulation = {
    id: "vat-law",
    canonicalKey: "uu-8-1983",
    sourceLanguage: "id",
    title: "Undang-Undang Pajak Pertambahan Nilai",
    citation: "UU No. 8 Tahun 1983",
    focus: "Pajak Masukan dan faktur pajak",
    relevance: 100,
    content: "Ketentuan Pajak Masukan.",
    relations: [{ type: "references", citation: "PMK Heuristik Beracun", source: "seed" }],
    extraction: {
      schemaVersion: "regulation-extraction-v1",
      summary: "Mengatur PPN.",
      scope: ["Pajak Masukan"],
      keyProvisions: [{ article: "Pasal 9", page: 10, text: "Syarat pengkreditan." }],
      legalStatus: "amended",
      relations: [
        { type: "implements", citation: "PP No. 44 Tahun 2022", source: "pdf" },
        { type: "references", citation: "PMK Seed Tidak Terverifikasi", source: "seed" }
      ],
      keywords: ["PPN"],
      verificationNotes: [],
      extractedAt: "2026-08-05T00:00:00.000Z",
      model: "test",
      sourcePdfUrl: "https://jdih.kemenkeu.go.id/test.pdf"
    }
  };
  const document = regulationToLightRagDocument(record);
  assert.equal(document.fileSource, "aaj-regulation--uu-8-1983.md");
  assert.match(document.text, /AAJ-CANONICAL-ID: uu-8-1983/);
  assert.match(document.text, /\[Pasal 9\] \(halaman 10\)/);
  assert.match(document.text, /IMPLEMENTS — PP No\. 44 Tahun 2022/);
  assert.doesNotMatch(document.text, /PMK Heuristik Beracun/);
  assert.doesNotMatch(document.text, /PMK Seed Tidak Terverifikasi/);
  const response = normalizeLightRagResponse(
    { response: "context", references: [{ reference_id: "1", file_path: document.fileSource, content: [document.text] }] },
    "mix"
  );
  assert.deepEqual(matchLightRagReferencesToRegulations(response.references, [record]), [record]);
});

test("reference matching never attributes a document by citation substring", () => {
  const record: Regulation = {
    id: "vat-law",
    canonicalKey: "uu-8-1983",
    title: "Undang-Undang PPN",
    citation: "UU No. 8 Tahun 1983",
    focus: "PPN",
    relevance: 100
  };
  const response = normalizeLightRagResponse(
    {
      response: "context",
      references: [
        {
          reference_id: "1",
          file_path: "another-rule",
          content: ["Aturan lain ini merujuk UU No. 8 Tahun 1983."]
        }
      ]
    },
    "mix"
  );
  assert.deepEqual(matchLightRagReferencesToRegulations(response.references, [record]), []);
});

test("query client sends API key without exposing it in the result", async () => {
  let requestHeaders: Headers | undefined;
  const result = await queryLightRag(
    config,
    { query: "Apakah Pajak Masukan dapat dikreditkan?" },
    {
      now: (() => {
        let value = 100;
        return () => (value += 10);
      })(),
      fetch: async (_input, init) => {
        requestHeaders = new Headers(init?.headers);
        return Response.json({
          response: "Pasal 9",
          references: [{ reference_id: "1", file_path: "aaj-regulation--uu-8-1983.md", content: ["Pasal 9"] }]
        });
      }
    }
  );
  assert.equal(requestHeaders?.get("X-API-Key"), "test-secret");
  assert.equal(result.hasContext, true);
  assert.equal("apiKey" in result, false);
});
