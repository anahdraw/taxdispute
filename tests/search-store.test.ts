import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { loadSearchStore, SearchStoreConfigurationError, searchStoreModeFromEnv } from "../lib/search-store";

test("search store defaults to local even when a database URL exists", () => {
  const env: Record<string, string | undefined> = { DATABASE_URL: "postgres://must-not-be-used" };
  assert.equal(searchStoreModeFromEnv(env), "local");
  assert.equal(searchStoreModeFromEnv({ TDP_SEARCH_STORE: "unexpected" }), "local");
  assert.equal(searchStoreModeFromEnv({ TDP_SEARCH_STORE: "DATABASE" }), "database");
});

test("local mode never evaluates or invokes database loaders", async () => {
  let databaseCalls = 0;
  const result = await loadSearchStore({
    tenantId: "tenant-local",
    wantsDecisions: true,
    wantsRegulations: true,
    includeLegacyDatabaseDecisions: true,
    mode: "local",
    database: {
      configured: () => {
        databaseCalls += 1;
        throw new Error("database configuration must not be inspected");
      },
      decisions: async () => {
        databaseCalls += 1;
        throw new Error("database decision loader must not run");
      },
      regulations: async () => {
        databaseCalls += 1;
        throw new Error("database regulation loader must not run");
      }
    }
  });

  assert.equal(databaseCalls, 0);
  assert.equal(result.diagnostics.mode, "local");
  assert.equal(result.diagnostics.databaseAccessed, false);
  assert.equal(result.diagnostics.decisionSource, "local-demo");
  assert.equal(result.diagnostics.regulationSource, "local-seed");
  const demoDecisions = result.documents.filter((document) => document.corpus === "decision");
  assert.ok(demoDecisions.length > 0);
  assert.ok(demoDecisions.every((document) => document.status === "review_required"));
  assert.ok(demoDecisions.every((document) => !document.sourceHash && !document.sourceUrl && !document.locator));
});

test("database mode is explicit and fails without configuration", async () => {
  await assert.rejects(
    loadSearchStore({
      tenantId: "tenant-local",
      wantsDecisions: true,
      wantsRegulations: false,
      includeLegacyDatabaseDecisions: true,
      mode: "database",
      database: {
        configured: () => false,
        decisions: async () => [],
        regulations: async () => []
      }
    }),
    SearchStoreConfigurationError
  );
});

test("database mode invokes only requested read loaders", async () => {
  let decisionCalls = 0;
  let regulationCalls = 0;
  const result = await loadSearchStore({
    tenantId: "tenant-default",
    wantsDecisions: false,
    wantsRegulations: true,
    includeLegacyDatabaseDecisions: true,
    mode: "database",
    database: {
      configured: () => true,
      decisions: async () => {
        decisionCalls += 1;
        return [];
      },
      regulations: async () => {
        regulationCalls += 1;
        return [];
      }
    }
  });
  assert.equal(decisionCalls, 0);
  assert.equal(regulationCalls, 1);
  assert.equal(result.diagnostics.databaseAccessed, true);
  assert.equal(result.diagnostics.decisionSource, "disabled");
  assert.equal(result.diagnostics.regulationSource, "database-and-seed");
});

test("local regulation snapshot is opt-in and remains database-free", async () => {
  const previous = process.env.TDP_LOCAL_REGULATION_SNAPSHOT;
  const temp = mkdtempSync(path.join(os.tmpdir(), "aa-jurist-snapshot-test-"));
  const snapshot = path.join(temp, "next-regulations.jsonl.gz");
  writeFileSync(snapshot, gzipSync(Buffer.from(JSON.stringify({
    id: "pipeline:uu-test",
    topic: "vat",
    title: "Test VAT Regulation",
    citation: "UU 99 TAHUN 2099",
    focus: "Test regulation focus",
    relevance: 90,
    source: "official",
    sourceUrl: "https://www.pajak.go.id/id/peraturan/test",
    sourceLanguage: "id",
    content: "Ketentuan pajak masukan.",
    ingestionStatus: "ready",
    fileHash: "a".repeat(64),
    extraction: {
      schemaVersion: "regulation-extraction-v1",
      summary: "Test regulation focus",
      scope: ["PPN"],
      keyProvisions: [{ article: "Pasal 1", text: "Ketentuan pajak masukan." }],
      legalStatus: "active",
      relations: [],
      keywords: ["PPN"],
      verificationNotes: [],
      extractedAt: "2099-01-01T00:00:00Z",
      model: "test",
      sourcePdfUrl: "https://www.pajak.go.id/id/peraturan/test"
    },
    relations: []
  }) + "\n")));
  process.env.TDP_LOCAL_REGULATION_SNAPSHOT = snapshot;
  try {
    const result = await loadSearchStore({
      tenantId: "tenant-local",
      wantsDecisions: false,
      wantsRegulations: true,
      includeLegacyDatabaseDecisions: false,
      mode: "local",
      database: {
        configured: () => { throw new Error("database must not be inspected"); },
        decisions: async () => { throw new Error("database must not be called"); },
        regulations: async () => { throw new Error("database must not be called"); }
      }
    });
    assert.equal(result.diagnostics.databaseAccessed, false);
    assert.equal(result.diagnostics.regulationSource, "local-snapshot");
    assert.ok(result.documents.some((document) => document.id.startsWith("regulation:uu-99-2099")));
  } finally {
    if (previous === undefined) delete process.env.TDP_LOCAL_REGULATION_SNAPSHOT;
    else process.env.TDP_LOCAL_REGULATION_SNAPSHOT = previous;
    rmSync(temp, { recursive: true, force: true });
  }
});
