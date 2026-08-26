import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node scripts/run_python.mjs <script.py> [args...]");
  process.exit(2);
}

const configured = (process.env.PYTHON || "").trim();
const candidates = configured
  ? [[configured]]
  : process.platform === "win32"
    ? [["py", "-3.11"], ["py", "-3"], ["python"]]
    : [["python3"], ["python"]];

for (const [command, ...prefix] of candidates) {
  const probe = spawnSync(command, [...prefix, "--version"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") continue;
  if (probe.status !== 0) continue;

  const result = spawnSync(command, [...prefix, ...args], { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error("Python 3 tidak ditemukan. Instal Python 3.11+ atau set variabel PYTHON.");
process.exit(127);
