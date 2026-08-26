import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-lightrag-full-"));
const childEnv = { ...process.env };
for (const filename of [".env", ".env.local"]) {
  const candidate = path.join(repoRoot, filename); if (!fs.existsSync(candidate)) continue;
  for (const line of fs.readFileSync(candidate, "utf8").split(/\r?\n/)) { const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (match && childEnv[match[1]] === undefined) childEnv[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); }
}
try {
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), [
    "scripts/build_full_corpus_lightrag.ts", "lib/full-corpus-lightrag.ts", "lib/regulation-snapshot.ts", "lib/regulation-knowledge.ts", "lib/regulation-sources.ts", "lib/mock-data.ts", "lib/essential-regulations.ts",
    "--outDir", compileDir, "--module", "commonjs", "--target", "ES2022", "--esModuleInterop", "--skipLibCheck", "--strict", "--moduleResolution", "node"
  ], { cwd: repoRoot, stdio: "pipe" });
  execFileSync(process.execPath, [path.join(compileDir, "scripts", "build_full_corpus_lightrag.js"), ...process.argv.slice(2)], { cwd: repoRoot, stdio: "inherit", env: childEnv });
} finally { fs.rmSync(compileDir, { recursive: true, force: true }); }
