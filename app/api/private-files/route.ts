import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireWorkspaceScope } from "@/lib/workspace-access";
import { listPrivateObjects, registerPrivateObject, writePrivateObject, type PrivateObjectDescriptor } from "@/lib/private-storage";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "text/plain", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

function contentMatchesDeclaredType(bytes: Uint8Array, contentType: string) {
  if (contentType === "application/pdf") return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46]);
  if (contentType === "application/msword") return hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0]);
  if (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (contentType === "text/plain" || contentType === "text/csv") {
    return !bytes.slice(0, 4_096).some((value) => value === 0);
  }
  return false;
}

export async function GET(request: Request) {
  const access = await requireWorkspaceScope(request, { requireClient: true, requireMatter: true });
  if ("response" in access) return access.response;
  return NextResponse.json({ records: await listPrivateObjects(access.scope) });
}

export async function POST(request: Request) {
  const access = await requireWorkspaceScope(request, { write: true, requireClient: true, requireMatter: true });
  if ("response" in access) return access.response;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "File is required." }, { status: 400 });
    const configuredLimit = Number(process.env.TDP_PRIVATE_UPLOAD_MAX_MB || 50);
    const maxMb = Number.isFinite(configuredLimit) ? Math.min(100, Math.max(1, configuredLimit)) : 50;
    const maxBytes = maxMb * 1024 * 1024;
    if (!file.size) return NextResponse.json({ error: "Empty files are not accepted." }, { status: 400 });
    if (file.size > maxBytes) return NextResponse.json({ error: "File exceeds private upload limit." }, { status: 413 });
    if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "File type is not allowed for private storage." }, { status: 415 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!contentMatchesDeclaredType(bytes, file.type)) {
      return NextResponse.json({ error: "File content does not match its declared type." }, { status: 415 });
    }
    const objectId = `file-${randomUUID()}`;
    const stored = await writePrivateObject(access.scope, objectId, file.name, bytes);
    const record: PrivateObjectDescriptor = { id: objectId, key: stored.key, filename: file.name, contentType: file.type, size: stored.size, tenantId: access.scope.tenantId, clientId: access.scope.clientId, matterId: access.scope.matterId, ownerUserId: access.scope.userId, createdAt: new Date().toISOString() };
    try { await registerPrivateObject(record); }
    catch (error) { await import("@/lib/private-storage").then(({ deletePrivateObject }) => deletePrivateObject(access.scope, stored.key)).catch(() => undefined); throw error; }
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Private upload failed." }, { status: 400 });
  }
}
