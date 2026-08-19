import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-rag-tests-"));

try {
  execFileSync(
    path.join(repoRoot, "node_modules", ".bin", "tsc"),
    [
      "tests/lightrag-client.test.ts",
      "tests/rag-provider.test.ts",
      "lib/lightrag-client.ts",
      "lib/rag-provider.ts",
      "lib/mock-data.ts",
      "lib/essential-regulations.ts",
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
      path.join(compileDir, "tests", "lightrag-client.test.js"),
      path.join(compileDir, "tests", "rag-provider.test.js"),
      path.join(repoRoot, "tests", "regulation-knowledge.test.mjs")
    ],
    { cwd: repoRoot, stdio: "inherit" }
  );
} finally {
  fs.rmSync(compileDir, { recursive: true, force: true });
}
