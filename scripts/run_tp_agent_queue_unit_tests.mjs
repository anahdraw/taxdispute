import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "tp-agent-queue-tests-"));

try {
  execFileSync(
    path.join(repoRoot, "node_modules", ".bin", "tsc"),
    [
      "tests/tp-agent-queue.test.ts",
      "lib/tp-agent-queue.ts",
      "lib/tp-agent-workflow.ts",
      "lib/tp-local-file.ts",
      "lib/db.ts",
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
  execFileSync(process.execPath, ["--test", path.join(compileDir, "tests", "tp-agent-queue.test.js")], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_PATH: [path.join(repoRoot, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
    }
  });
} finally {
  fs.rmSync(compileDir, { recursive: true, force: true });
}
