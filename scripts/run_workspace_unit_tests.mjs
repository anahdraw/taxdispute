import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-workspace-tests-"));

try {
  execFileSync(
    path.join(repoRoot, "node_modules", ".bin", "tsc"),
    [
      "tests/research-workspace.test.ts",
      "tests/tenant-storage.test.ts",
      "lib/research-workspace.ts",
      "lib/research-workspace-store.ts",
      "lib/local-json-store.ts",
      "lib/workspace.ts",
      "lib/workspace-store.ts",
      "lib/private-storage.ts",
      "lib/db.ts",
      "--outDir", compileDir,
      "--module", "commonjs",
      "--target", "ES2022",
      "--esModuleInterop",
      "--skipLibCheck",
      "--strict",
      "--moduleResolution", "node",
      "--jsx", "react-jsx"
    ],
    { cwd: repoRoot, stdio: "pipe" }
  );
  const runtimeEnv = {
    ...process.env,
    NODE_PATH: [path.join(repoRoot, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
  };
  execFileSync(process.execPath, ["--test",
    path.join(compileDir, "tests", "research-workspace.test.js"),
    path.join(compileDir, "tests", "tenant-storage.test.js")
  ], {
    cwd: repoRoot,
    stdio: "inherit",
    env: runtimeEnv
  });
} finally {
  fs.rmSync(compileDir, { recursive: true, force: true });
}
