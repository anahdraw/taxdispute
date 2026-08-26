import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname); const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-wave4-eval-"));
try {
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["scripts/evaluate_wave4_differentiation.ts", "lib/dispute-workbench.ts", "lib/case-search.ts", "lib/mock-data.ts", "lib/essential-regulations.ts", "lib/extraction.ts", "--outDir", compileDir, "--module", "commonjs", "--target", "ES2022", "--esModuleInterop", "--skipLibCheck", "--strict", "--moduleResolution", "node"], { cwd: repoRoot, stdio: "pipe" });
  execFileSync(process.execPath, [path.join(compileDir, "scripts", "evaluate_wave4_differentiation.js"), path.join(repoRoot, "tests/evaluation/results/wave4-differentiation.json")], { cwd: repoRoot, stdio: "inherit" });
} finally { fs.rmSync(compileDir, { recursive: true, force: true }); }
