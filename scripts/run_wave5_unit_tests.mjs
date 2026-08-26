import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname); const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-wave5-tests-"));
try {
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), [
    "tests/wave5-enterprise.test.ts", "lib/persistent-hybrid-index.ts", "lib/hybrid-search.ts", "lib/search-contracts.ts", "lib/enterprise-job-queue.ts", "lib/local-json-store.ts", "lib/full-corpus-lightrag.ts", "lib/enterprise-governance.ts", "lib/enterprise-observability.ts", "lib/enterprise-object-storage.ts", "lib/auth.ts", "lib/admin.ts", "lib/server-settings.ts", "lib/settings-schema.ts", "lib/model-options.ts",
    "--outDir", compileDir, "--module", "commonjs", "--target", "ES2022", "--esModuleInterop", "--skipLibCheck", "--strict", "--moduleResolution", "node", "--jsx", "react-jsx"
  ], { cwd: repoRoot, stdio: "pipe" });
  execFileSync(process.execPath, ["--test", path.join(compileDir, "tests", "wave5-enterprise.test.js")], { cwd: repoRoot, stdio: "inherit" });
} finally { fs.rmSync(compileDir, { recursive: true, force: true }); }
