import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-wave1-eval-"));
const envFile = path.join(repoRoot, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(TDP_(?:LOCAL_REGULATION|BOOK_GROUND_TRUTH)_SNAPSHOT)=(.*)$/);
    if (!match) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

try {
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), [
    "scripts/evaluate_wave1_end_to_end.ts",
    "lib/chat-trust.ts",
    "lib/citation-trust.ts",
    "lib/query-domain.ts",
    "lib/temporal-validation.ts",
    "lib/document-readiness.ts",
    "lib/search-contracts.ts",
    "lib/search-corpus.ts",
    "lib/hybrid-search.ts",
    "lib/regulation-answer.ts",
    "lib/regulation-knowledge.ts",
    "lib/regulation-snapshot.ts",
    "lib/regulation-sources.ts",
    "lib/mock-data.ts",
    "lib/essential-regulations.ts",
    "--outDir", compileDir,
    "--module", "commonjs",
    "--target", "ES2022",
    "--esModuleInterop",
    "--skipLibCheck",
    "--strict",
    "--moduleResolution", "node"
  ], { cwd: repoRoot, stdio: "pipe" });
  execFileSync(process.execPath, [path.join(compileDir, "scripts", "evaluate_wave1_end_to_end.js")], { cwd: repoRoot, stdio: "inherit", env: process.env });
} finally {
  fs.rmSync(compileDir, { recursive: true, force: true });
}
