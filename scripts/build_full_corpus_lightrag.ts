import fs from "node:fs";
import path from "node:path";
import { buildFullCorpusLightRagManifest, renderFullCorpusLightRagDocument } from "../lib/full-corpus-lightrag";
import { mergeRegulationRecords } from "../lib/regulation-knowledge";
import { loadLocalRegulationSnapshot } from "../lib/regulation-snapshot";

const manifestPath = path.resolve(process.argv[2] || "outputs/lightrag/full-corpus-manifest.json");
const jsonlPath = process.argv.includes("--with-jsonl") ? path.resolve("outputs/lightrag/full-corpus.jsonl") : "";
const records = mergeRegulationRecords(loadLocalRegulationSnapshot());
if (!records.length) throw new Error("TDP_LOCAL_REGULATION_SNAPSHOT did not produce any records.");
const manifest = buildFullCorpusLightRagManifest(records);
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
if (jsonlPath) {
  const byKey = new Map(records.map((record) => [record.canonicalKey || record.id, record]));
  const lines = manifest.entries.map((entry) => JSON.stringify({
    id: entry.canonicalKey,
    file_source: `aaj-regulation--${entry.canonicalKey}.md`,
    text_sha256: entry.textHash,
    text: renderFullCorpusLightRagDocument(byKey.get(entry.canonicalKey)!)
  }));
  fs.writeFileSync(jsonlPath, `${lines.join("\n")}\n`);
}
process.stdout.write(`${JSON.stringify({ manifestPath, jsonlPath: jsonlPath || null, documentCount: manifest.documentCount, corpusHash: manifest.corpusHash, citationReadyCount: manifest.citationReadyCount, graphRelationCount: manifest.graphRelationCount }, null, 2)}\n`);
