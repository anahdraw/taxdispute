import { chmod, mkdir, open, readFile, rename } from "fs/promises";
import path from "path";

declare global {
  // eslint-disable-next-line no-var
  var taxDisputeLocalJsonQueues: Map<string, Promise<unknown>> | undefined;
}

const DEFAULT_LOCAL_WORKSPACE_ROOT = path.resolve("data/local-workspace");

function localWorkspaceRoot() {
  return process.env.TDP_LOCAL_WORKSPACE_ROOT
    ? path.resolve(process.env.TDP_LOCAL_WORKSPACE_ROOT)
    : DEFAULT_LOCAL_WORKSPACE_ROOT;
}

function safeJsonPath(name: string) {
  if (!/^[a-z0-9][a-z0-9._-]*\.json$/i.test(name)) throw new Error("Invalid local metadata filename.");
  const root = localWorkspaceRoot();
  const target = path.resolve(root, name);
  if (path.dirname(target) !== root) throw new Error("Local metadata path escaped its configured root.");
  return { root, target };
}

async function parseJsonFile<T>(name: string, fallback: T): Promise<T> {
  const { target } = safeJsonPath(name);
  try {
    const raw = await readFile(target, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function readLocalJson<T>(name: string, fallback: T): Promise<T> {
  const queues = global.taxDisputeLocalJsonQueues;
  const pending = queues?.get(name);
  if (pending) await pending.catch(() => undefined);
  return parseJsonFile(name, fallback);
}

export async function updateLocalJson<T>(name: string, fallback: T, update: (current: T) => T | Promise<T>): Promise<T> {
  const queues = global.taxDisputeLocalJsonQueues || new Map<string, Promise<unknown>>();
  global.taxDisputeLocalJsonQueues = queues;
  const prior = queues.get(name) || Promise.resolve();
  const queued = prior.catch(() => undefined).then(async () => {
    const current = await parseJsonFile(name, fallback);
    const next = await update(current);
    const { root, target } = safeJsonPath(name);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    return next;
  });
  queues.set(name, queued);
  try {
    return await queued;
  } finally {
    if (queues.get(name) === queued) queues.delete(name);
  }
}
