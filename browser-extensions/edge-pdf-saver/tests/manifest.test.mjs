import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));

test("manifest uses Manifest V3 and minimal on-demand page access", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "downloads", "scripting", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
});

test("all files referenced by the manifest exist", async () => {
  const referencedFiles = [
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];

  await Promise.all(referencedFiles.map((filename) => access(path.join(extensionRoot, filename))));
});

test("popup offers a native print-to-PDF fallback for HTML ebooks", async () => {
  const popup = await readFile(path.join(extensionRoot, "popup.html"), "utf8");
  const popupScript = await readFile(path.join(extensionRoot, "popup.js"), "utf8");

  assert.match(popup, /id="print-button"/);
  assert.match(popupScript, /window\.print\(\)/);
});
