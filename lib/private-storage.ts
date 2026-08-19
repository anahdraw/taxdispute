import { constants } from "fs";
import { chmod, lstat, mkdir, open, realpath, unlink } from "fs/promises";
import path from "path";
import { readLocalJson, updateLocalJson } from "./local-json-store";
import { normalizeWorkspaceId, type WorkspaceScope } from "./workspace";

export type PrivateObjectDescriptor = {
  id: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  tenantId: string;
  clientId?: string;
  matterId?: string;
  ownerUserId: string;
  createdAt: string;
};

const SAFE_FILENAME = /[^a-zA-Z0-9._()-]+/g;
const LOCAL_PRIVATE_METADATA_FILE = "private-objects.json";

type PrivateObjectState = { version: 1; records: PrivateObjectDescriptor[] };
const emptyPrivateObjectState = (): PrivateObjectState => ({ version: 1, records: [] });

const DEFAULT_PRIVATE_STORAGE_ROOT = path.resolve("data/private-storage");

function rootPath() {
  return process.env.TDP_PRIVATE_STORAGE_ROOT
    ? path.resolve(process.env.TDP_PRIVATE_STORAGE_ROOT)
    : DEFAULT_PRIVATE_STORAGE_ROOT;
}

function safeSegment(value: string) {
  return normalizeWorkspaceId(value).replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function privateObjectPrefix(scope: WorkspaceScope) {
  const segments = ["tenants", safeSegment(scope.tenantId)];
  if (scope.clientId) segments.push("clients", safeSegment(scope.clientId));
  if (scope.matterId) segments.push("matters", safeSegment(scope.matterId));
  segments.push("users", safeSegment(scope.userId));
  return segments.join("/");
}

export function buildPrivateObjectKey(scope: WorkspaceScope, objectId: string, filename: string) {
  const safeName = path.basename(filename).replace(SAFE_FILENAME, "-").replace(/^\.+/, "").slice(0, 180) || "document.bin";
  return `${privateObjectPrefix(scope)}/${safeSegment(objectId)}/${safeName}`;
}

function resolvePrivateKey(key: string) {
  if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid private object key.");
  const root = rootPath();
  const target = path.resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Private object path escaped its configured root.");
  return { root, target };
}

async function assertResolvedPrivateTarget(scope: WorkspaceScope, key: string) {
  const target = assertPrivateObjectAccess(scope, key);
  const root = rootPath();
  const [resolvedRoot, resolvedParent] = await Promise.all([realpath(root), realpath(path.dirname(target))]);
  if (resolvedParent !== resolvedRoot && !resolvedParent.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Private object path escaped its resolved storage root.");
  }
  const details = await lstat(target);
  if (details.isSymbolicLink() || !details.isFile()) throw new Error("Private object is not a regular file.");
  return { target, details };
}

export function assertPrivateObjectAccess(scope: WorkspaceScope, key: string) {
  const prefix = `${privateObjectPrefix(scope)}/`;
  if (!key.startsWith(prefix)) throw new Error("Private object access denied.");
  return resolvePrivateKey(key).target;
}

export async function writePrivateObject(scope: WorkspaceScope, objectId: string, filename: string, bytes: Uint8Array) {
  const key = buildPrivateObjectKey(scope, objectId, filename);
  const { root, target } = resolvePrivateKey(key);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const [resolvedRoot, resolvedParent] = await Promise.all([realpath(root), realpath(path.dirname(target))]);
  if (resolvedParent !== resolvedRoot && !resolvedParent.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Private object path escaped its resolved storage root.");
  }
  const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return { key, size: bytes.byteLength };
}

export async function privateObjectStat(scope: WorkspaceScope, key: string) {
  return (await assertResolvedPrivateTarget(scope, key)).details;
}

export async function readPrivateObject(scope: WorkspaceScope, key: string) {
  const { target } = await assertResolvedPrivateTarget(scope, key);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await handle.readFile(); } finally { await handle.close(); }
}

export async function privateObjectStream(scope: WorkspaceScope, key: string) {
  const { target } = await assertResolvedPrivateTarget(scope, key);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  return handle.createReadStream();
}

export async function deletePrivateObject(scope: WorkspaceScope, key: string) {
  const { target } = await assertResolvedPrivateTarget(scope, key);
  await unlink(target);
}

export async function registerPrivateObject(record: PrivateObjectDescriptor) {
  await updateLocalJson(LOCAL_PRIVATE_METADATA_FILE, emptyPrivateObjectState(), (state) => {
    if (state.records.some((item) => item.key === record.key)) throw new Error("Private object metadata already exists.");
    return { ...state, records: [...state.records, record] };
  });
}

export async function listPrivateObjects(scope: WorkspaceScope) {
  const prefix = `${privateObjectPrefix(scope)}/`;
  const state = await readLocalJson(LOCAL_PRIVATE_METADATA_FILE, emptyPrivateObjectState());
  return state.records.filter((record) => record.key.startsWith(prefix));
}

export async function getPrivateObject(scope: WorkspaceScope, objectId: string) {
  const records = await listPrivateObjects(scope);
  return records.find((record) => record.id === objectId) || null;
}

export async function unregisterPrivateObject(scope: WorkspaceScope, objectId: string) {
  let removed: PrivateObjectDescriptor | null = null;
  await updateLocalJson(LOCAL_PRIVATE_METADATA_FILE, emptyPrivateObjectState(), (state) => ({
    ...state,
    records: state.records.filter((record) => {
      const match = record.key.startsWith(`${privateObjectPrefix(scope)}/`) && record.id === objectId;
      if (match) removed = record;
      return !match;
    })
  }));
  return removed;
}
