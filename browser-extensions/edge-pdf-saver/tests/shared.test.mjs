import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeHttpUrl,
  dedupeCandidates,
  derivePdfFilename,
  isLikelyPdfUrl,
  resolvePdfDownloadUrl,
  sanitizeFilename
} from "../shared.js";

test("canonicalizeHttpUrl accepts only HTTP(S) and removes fragments", () => {
  assert.equal(
    canonicalizeHttpUrl("/docs/file.pdf#page=2", "https://example.com/app"),
    "https://example.com/docs/file.pdf"
  );
  assert.equal(canonicalizeHttpUrl("blob:https://example.com/id"), null);
  assert.equal(canonicalizeHttpUrl("file:///tmp/file.pdf"), null);
});

test("isLikelyPdfUrl detects paths and common filename query parameters", () => {
  assert.equal(isLikelyPdfUrl("https://example.com/REPORT.PDF?token=abc"), true);
  assert.equal(isLikelyPdfUrl("https://example.com/download?filename=report.pdf"), true);
  assert.equal(isLikelyPdfUrl("https://example.com/download?id=12"), false);
});

test("resolvePdfDownloadUrl unwraps a PDF viewer but preserves download endpoints", () => {
  assert.equal(
    resolvePdfDownloadUrl("https://example.com/viewer?file=%2Fdocs%2Freport.pdf"),
    "https://example.com/docs/report.pdf"
  );
  assert.equal(
    resolvePdfDownloadUrl("https://example.com/download?file=report.pdf"),
    "https://example.com/download?file=report.pdf"
  );
});

test("sanitizeFilename removes unsafe path characters", () => {
  assert.equal(sanitizeFilename('  laporan: pajak/2026?  '), "laporan- pajak-2026-");
});

test("derivePdfFilename prefers a PDF query filename", () => {
  assert.equal(
    derivePdfFilename({ url: "https://example.com/download?filename=putusan%202026.pdf" }),
    "putusan 2026.pdf"
  );
});

test("dedupeCandidates keeps one canonical HTTP URL", () => {
  assert.deepEqual(
    dedupeCandidates([
      { url: "https://example.com/a.pdf#page=1", source: "Tautan" },
      { url: "https://example.com/a.pdf#page=2", source: "Iframe" },
      { url: "data:application/pdf;base64,abc", source: "Data" }
    ]),
    [{ url: "https://example.com/a.pdf", title: "", source: "Tautan" }]
  );
});
