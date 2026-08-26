import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const runners = [
  "run_tp_unit_tests.mjs",
  "run_tp_agent_unit_tests.mjs",
  "run_tp_agent_queue_unit_tests.mjs",
  "run_tp_agent_runtime_unit_tests.mjs"
];

for (const runner of runners) {
  execFileSync(process.execPath, [path.join(scriptDir, runner)], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });
}
