import { NextResponse } from "next/server";
import { Readable } from "stream";
import { requireWorkspaceScope } from "@/lib/workspace-access";
import { deletePrivateObject, getPrivateObject, privateObjectStat, privateObjectStream, unregisterPrivateObject } from "@/lib/private-storage";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const access = await requireWorkspaceScope(request, { requireClient: true, requireMatter: true });
  if ("response" in access) return access.response;
  const { id } = await context.params;
  const record = await getPrivateObject(access.scope, id);
  if (!record) return NextResponse.json({ error: "Private file not found." }, { status: 404 });
  try {
    const details = await privateObjectStat(access.scope, record.key);
    const stream = Readable.toWeb(await privateObjectStream(access.scope, record.key)) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, { headers: { "content-type": record.contentType || "application/octet-stream", "content-length": String(details.size), "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(record.filename)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ error: "Private file content not found." }, { status: 404 });
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const access = await requireWorkspaceScope(request, { write: true, requireClient: true, requireMatter: true });
  if ("response" in access) return access.response;
  const { id } = await context.params;
  const record = await getPrivateObject(access.scope, id);
  if (!record) return NextResponse.json({ error: "Private file not found." }, { status: 404 });
  await deletePrivateObject(access.scope, record.key).catch((error) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
  await unregisterPrivateObject(access.scope, id);
  return NextResponse.json({ ok: true });
}
