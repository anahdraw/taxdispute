import assert from "node:assert/strict";
import test from "node:test";
import {
  missingSearchCorpusFeature,
  normalizeRequestedSearchCorpora,
  rejectClientManagedSearchFields,
  requestedCorpusFlags,
  searchAsksCurrentLaw
} from "../lib/search-api-policy";
import { InvalidSearchRequestError } from "../lib/hybrid-search";

test("client embeddings are rejected even when empty or undefined", () => {
  assert.throws(() => rejectClientManagedSearchFields({ queryEmbedding: [] }), InvalidSearchRequestError);
  assert.throws(() => rejectClientManagedSearchFields({ queryEmbedding: undefined }), InvalidSearchRequestError);
  assert.doesNotThrow(() => rejectClientManagedSearchFields({ query: "PPN" }));
});

test("corpora policy is strict and deduplicated", () => {
  assert.deepEqual(normalizeRequestedSearchCorpora(["decision", "decision", "regulation"]), ["decision", "regulation"]);
  assert.throws(() => normalizeRequestedSearchCorpora([]), InvalidSearchRequestError);
  assert.throws(() => normalizeRequestedSearchCorpora(["private"]), InvalidSearchRequestError);
});

test("tier entitlement applies independently to each requested corpus", () => {
  assert.equal(
    missingSearchCorpusFeature("user", "silver", requestedCorpusFlags(["decision"])),
    "databaseRead"
  );
  assert.equal(
    missingSearchCorpusFeature("user", "silver", requestedCorpusFlags(["regulation"])),
    "regulationRead"
  );
  assert.equal(missingSearchCorpusFeature("user", "gold", requestedCorpusFlags()), null);
  assert.equal(missingSearchCorpusFeature("admin", "silver", requestedCorpusFlags()), null);
});

test("current-law intent includes Indonesian recency wording", () => {
  assert.equal(searchAsksCurrentLaw("Aturan mana yang berlaku saat ini?"), true);
  assert.equal(searchAsksCurrentLaw("Apa aturan PPN terbaru sekarang?"), true);
  assert.equal(searchAsksCurrentLaw("Ringkas pokok sengketa PPN"), false);
});
