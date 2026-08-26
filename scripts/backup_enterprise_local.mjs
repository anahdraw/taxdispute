import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repo = process.cwd();
const backupRoot = path.resolve(process.env.TDP_BACKUP_ROOT || "outputs/enterprise-backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(backupRoot, stamp);
const configured = [
  ["workspace", process.env.TDP_LOCAL_WORKSPACE_ROOT || "data/local-workspace"],
  ["private-storage", process.env.TDP_PRIVATE_STORAGE_ROOT || "data/private-storage"],
  ["search-index", process.env.TDP_PERSISTENT_SEARCH_ROOT || "data/local-search-index"],
  ["lightrag-manifest", process.env.TDP_LIGHTRAG_FULL_MANIFEST || "outputs/lightrag/full-corpus-manifest.json"]
];

function hashFile(file) { const digest = crypto.createHash("sha256"); digest.update(fs.readFileSync(file)); return digest.digest("hex"); }
function copy(source, target, logical, entries) {
  if (!fs.existsSync(source)) return;
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link in backup source: ${source}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(source).sort()) copy(path.join(source, name), path.join(target, name), `${logical}/${name}`, entries);
    return;
  }
  if (!stat.isFile()) return;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o600);
  entries.push({ path: logical, bytes: stat.size, sha256: hashFile(target) });
}

fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
const entries = [];
for (const [label, value] of configured) copy(path.resolve(value), path.join(destination, label), label, entries);
const manifest = { schema: "aa-jurist-local-backup-v1", createdAt: new Date().toISOString(), backupId: stamp, fileCount: entries.length, totalBytes: entries.reduce((sum, item) => sum + item.bytes, 0), entries };
fs.writeFileSync(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
const status = { createdAt: manifest.createdAt, backupId: stamp, fileCount: manifest.fileCount, totalBytes: manifest.totalBytes, manifestPath: path.relative(repo, path.join(destination, "manifest.json")), verifiedAt: null };
fs.writeFileSync(path.join(backupRoot, "latest-status.json"), `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
