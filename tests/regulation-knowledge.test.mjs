import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-regulation-test-"));
const require = createRequire(import.meta.url);

execFileSync(
  path.join(repoRoot, "node_modules", ".bin", "tsc"),
  [
    "lib/mock-data.ts",
    "lib/essential-regulations.ts",
    "lib/regulation-knowledge.ts",
    "lib/regulation-sources.ts",
    "--outDir",
    compileDir,
    "--module",
    "commonjs",
    "--target",
    "ES2020",
    "--esModuleInterop",
    "--skipLibCheck",
    "--moduleResolution",
    "node"
  ],
  { cwd: repoRoot, stdio: "pipe" }
);

const { canonicalRegulationKey, deriveRegulationRelations } = require(path.join(compileDir, "regulation-knowledge.js"));
process.on("exit", () => fs.rmSync(compileDir, { recursive: true, force: true }));

test("canonical keys preserve the leading number in legacy PMK citations", () => {
  assert.equal(
    canonicalRegulationKey({ citation: "PMK No. 141/PMK.03/2015", title: "Ketentuan Pajak" }),
    "pmk-141-2015"
  );
  assert.equal(
    canonicalRegulationKey({ citation: "Peraturan Menteri Keuangan Nomor 177/PMK.04/2022", title: "Kepabeanan" }),
    "pmk-177-2022"
  );
});

test("relation detection does not turn ordinary Indonesian words into citations", () => {
  const record = {
    id: "test-rule",
    title: "Aturan Pengujian",
    citation: "PMK No. 1 Tahun 2026",
    focus: "Perubahan perpajakan dilaksanakan sejak periode berikutnya.",
    content: "Pelaksanaan ini berdasarkan kebijakan perpajakan yang berlaku sejak masa pajak berikutnya.",
    relevance: 1
  };
  assert.deepEqual(deriveRegulationRelations(record), []);
});

test("relation detection still captures an explicit numbered citation", () => {
  const record = {
    id: "test-rule",
    title: "Aturan Pengujian",
    citation: "PMK No. 1 Tahun 2026",
    focus: "",
    content: "Menggantikan PP No. 44 Tahun 2022. Ketentuan baru berlaku segera.",
    relevance: 1
  };
  assert.deepEqual(
    deriveRegulationRelations(record).map(({ type, citation }) => ({ type, citation })),
    [{ type: "revokes", citation: "PP No 44 Tahun 2022" }]
  );
});

test("relation detection removes self edges and trailing citation punctuation", () => {
  const record = {
    id: "uu-19",
    title: "Perubahan UU Penagihan Pajak",
    citation: "UU No. 19 Tahun 1997",
    focus: "",
    content: "Mengubah UU No. 19 Tahun 1997. Juga mengubah PP No. 55 Tahun 2022.",
    relevance: 1
  };
  assert.deepEqual(
    deriveRegulationRelations(record).map(({ type, citation }) => ({ type, citation })),
    [{ type: "amends", citation: "PP No 55 Tahun 2022" }]
  );
});
