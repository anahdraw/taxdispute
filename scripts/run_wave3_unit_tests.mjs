import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-wave3-tests-"));
try {
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), [
    "tests/wave3-knowledge.test.ts", "lib/knowledge-hub.ts", "lib/official-knowledge.ts", "lib/regulation-answer.ts", "lib/regulation-knowledge.ts", "lib/regulation-sources.ts", "lib/mock-data.ts", "lib/essential-regulations.ts",
    "--outDir", compileDir, "--module", "commonjs", "--target", "ES2022", "--esModuleInterop", "--skipLibCheck", "--strict", "--moduleResolution", "node"
  ], { cwd: repoRoot, stdio: "pipe" });
  execFileSync(process.execPath, ["--test", path.join(compileDir, "tests", "wave3-knowledge.test.js")], { cwd: repoRoot, stdio: "inherit" });
} finally { fs.rmSync(compileDir, { recursive: true, force: true }); }
