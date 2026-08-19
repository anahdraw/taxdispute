import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const goldPath = path.join(repoRoot, "tests", "evaluation", "regulation_retrieval_gold.json");
const strategyIndex = process.argv.indexOf("--strategy");
const strategy = strategyIndex >= 0 ? process.argv[strategyIndex + 1] : "smart-chat";
const positionalOutput = process.argv.slice(2).find((value, index, values) => !value.startsWith("--") && values[index - 1] !== "--strategy");
const outputPath = path.resolve(positionalOutput || path.join(os.tmpdir(), `aa-jurist-baseline-regulation-${strategy}.json`));
const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-reg-baseline-"));
const require = createRequire(import.meta.url);

if (!["smart-chat", "regulation-bot"].includes(strategy)) {
  console.error("--strategy must be smart-chat or regulation-bot");
  process.exit(2);
}

try {
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), [
    "lib/smart-chat.ts",
    "lib/mock-data.ts",
    "lib/essential-regulations.ts",
    "lib/regulation-knowledge.ts",
    "lib/regulation-sources.ts",
    "lib/openai.ts",
    "lib/model-options.ts",
    "lib/tier-profiles.ts",
    "lib/answer-format.ts",
    "lib/stored-decisions.ts",
    "--outDir", compileDir,
    "--module", "commonjs",
    "--target", "ES2020",
    "--esModuleInterop",
    "--skipLibCheck",
    "--moduleResolution", "node"
  ], { cwd: repoRoot, stdio: "pipe" });

  const { regulations } = require(path.join(compileDir, "mock-data.js"));
  const { chooseRegulationContext, mergeRegulationRecords } = require(path.join(compileDir, "regulation-knowledge.js"));
  const { rankRegulations } = require(path.join(compileDir, "smart-chat.js"));
  const gold = JSON.parse(fs.readFileSync(goldPath, "utf8"));
  const corpus = mergeRegulationRecords(regulations);
  const goldSha256 = createHash("sha256").update(fs.readFileSync(goldPath)).digest("hex");
  const corpusSha256 = createHash("sha256")
    .update(JSON.stringify([...corpus]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        title: item.title,
        citation: item.citation,
        focus: item.focus,
        content: item.content || "",
        canonicalKey: item.canonicalKey || "",
        relations: item.relations || []
      }))))
    .digest("hex");

  const cases = gold.cases.map((testCase) => {
    const started = performance.now();
    const hits = strategy === "smart-chat"
      ? rankRegulations(testCase.query, corpus, 8)
      : chooseRegulationContext(corpus, testCase.query).map((item) => ({
          id: item.id,
          score: null,
          citation: item.citation,
          title: item.title
        }));
    const latency = performance.now() - started;
    return {
      id: testCase.id,
      latency_ms: Math.round(latency * 1000) / 1000,
      retrieved: hits.map((hit, index) => ({
        rank: index + 1,
        document_id: hit.id,
        score: hit.score,
        citation: hit.citation,
        title: hit.title
      }))
    };
  });

  fs.writeFileSync(outputPath, `${JSON.stringify({
    schema_version: "regulation-retrieval-results-v1",
    engine: strategy === "smart-chat"
      ? "aa-jurist-baseline-smart-chat-hybrid-token-cosine"
      : "aa-jurist-baseline-regulation-bot-keyword-topic",
    corpus: gold.corpus,
    corpus_document_count: corpus.length,
    gold_sha256: goldSha256,
    corpus_sha256: corpusSha256,
    generated_at: new Date().toISOString(),
    cases
  }, null, 2)}\n`);
  console.log(outputPath);
} finally {
  fs.rmSync(compileDir, { recursive: true, force: true });
}
