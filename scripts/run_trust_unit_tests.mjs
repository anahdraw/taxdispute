import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-trust-tests-"));

try {
  execFileSync(
    path.join(repoRoot, "node_modules", ".bin", "tsc"),
    [
      "tests/hybrid-search.test.ts",
      "tests/citation-trust.test.ts",
      "tests/search-store.test.ts",
      "tests/search-api-policy.test.ts",
      "tests/wave1-trust.test.ts",
      "lib/search-contracts.ts",
      "lib/hybrid-search.ts",
      "lib/citation-trust.ts",
      "lib/query-domain.ts",
      "lib/temporal-validation.ts",
      "lib/chat-trust.ts",
      "lib/document-readiness.ts",
      "lib/search-corpus.ts",
      "lib/search-store.ts",
      "lib/regulation-snapshot.ts",
      "lib/search-api-policy.ts",
      "lib/regulation-sources.ts",
      "lib/mock-data.ts",
      "lib/essential-regulations.ts",
      "lib/extraction.ts",
      "lib/analyze.ts",
      "lib/model-options.ts",
      "lib/openai.ts",
      "lib/text-presentation.ts",
      "lib/stored-decisions.ts",
      "--outDir",
      compileDir,
      "--module",
      "commonjs",
      "--target",
      "ES2020",
      "--esModuleInterop",
      "--skipLibCheck",
      "--strict",
      "--moduleResolution",
      "node"
    ],
    { cwd: repoRoot, stdio: "pipe" }
  );
  execFileSync(
    process.execPath,
    [
      "--test",
      path.join(compileDir, "tests", "hybrid-search.test.js"),
      path.join(compileDir, "tests", "citation-trust.test.js"),
      path.join(compileDir, "tests", "search-store.test.js"),
      path.join(compileDir, "tests", "search-api-policy.test.js"),
      path.join(compileDir, "tests", "wave1-trust.test.js")
    ],
    { cwd: repoRoot, stdio: "inherit" }
  );
} finally {
  fs.rmSync(compileDir, { recursive: true, force: true });
}
