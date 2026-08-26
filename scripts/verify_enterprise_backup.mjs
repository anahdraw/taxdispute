import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const backupRoot = path.resolve(process.env.TDP_BACKUP_ROOT || "outputs/enterprise-backups");
const statusPath = path.join(backupRoot, "latest-status.json");
const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
const manifestPath = path.resolve(status.manifestPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const backupDir = path.dirname(manifestPath);
function digest(file) { const hash = crypto.createHash("sha256"); hash.update(fs.readFileSync(file)); return hash.digest("hex"); }
const failures = [];
for (const entry of manifest.entries) {
  const target = path.resolve(backupDir, entry.path);
  if (target !== backupDir && !target.startsWith(`${backupDir}${path.sep}`)) failures.push({ path: entry.path, reason: "path_escape" });
  else if (!fs.existsSync(target)) failures.push({ path: entry.path, reason: "missing" });
  else if (digest(target) !== entry.sha256) failures.push({ path: entry.path, reason: "hash_mismatch" });
}
if (failures.length) { process.stderr.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`); process.exit(1); }
status.verifiedAt = new Date().toISOString();
fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ ok: true, backupId: status.backupId, verifiedAt: status.verifiedAt, fileCount: manifest.fileCount, totalBytes: manifest.totalBytes }, null, 2)}\n`);
