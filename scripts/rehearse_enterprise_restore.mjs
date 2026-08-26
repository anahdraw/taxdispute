import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const backupRoot = path.resolve(process.env.TDP_BACKUP_ROOT || "outputs/enterprise-backups");
const status = JSON.parse(fs.readFileSync(path.join(backupRoot, "latest-status.json"), "utf8"));
const source = path.dirname(path.resolve(status.manifestPath));
const target = fs.mkdtempSync(path.join(os.tmpdir(), "aa-jurist-dr-rehearsal-"));
for (const name of fs.readdirSync(source)) {
  if (name === "manifest.json") continue;
  fs.cpSync(path.join(source, name), path.join(target, name), { recursive: true, errorOnExist: true, dereference: false });
}
const restoredFiles = [];
function walk(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const item = path.join(directory, entry.name); if (entry.isDirectory()) walk(item); else if (entry.isFile()) restoredFiles.push(path.relative(target, item)); else throw new Error(`Unsafe restore entry: ${item}`); } }
walk(target);
process.stdout.write(`${JSON.stringify({ ok: true, backupId: status.backupId, rehearsalTarget: target, restoredFileCount: restoredFiles.length, productionDataOverwritten: false }, null, 2)}\n`);
