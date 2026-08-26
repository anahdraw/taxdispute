import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "tp-agent-runtime-tests-"));

try {
  execFileSync(
    path.join(repoRoot, "node_modules", ".bin", "tsc"),
    [
      "tests/tp-agent-runtime.test.ts",
      "tests/tp-regulation-context.test.ts",
      "lib/tp-agent-runtime.ts",
      "lib/tp-regulation-context.ts",
      "lib/mock-data.ts",
      "lib/essential-regulations.ts",
      "lib/tp-agent-workflow.ts",
      "lib/tp-local-file.ts",
      "lib/tavily.ts",
      "--outDir", compileDir,
      "--module", "commonjs",
      "--target", "ES2022",
      "--esModuleInterop",
      "--skipLibCheck",
      "--strict",
      "--moduleResolution", "node"
    ],
    { cwd: repoRoot, stdio: "pipe" }
  );
  execFileSync(process.execPath, ["--test",
    path.join(compileDir, "tests", "tp-agent-runtime.test.js"),
    path.join(compileDir, "tests", "tp-regulation-context.test.js")
  ], {
    cwd: repoRoot,
    stdio: "inherit"
  });
} finally {
  fs.rmSync(compileDir, { recursive: true, force: true });
}
