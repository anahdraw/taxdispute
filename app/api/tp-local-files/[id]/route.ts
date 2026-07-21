import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { requireFeature } from "@/lib/auth";
import { deleteTpLocalFileProject, getTpLocalFileProjectById, hasDatabase, upsertTpLocalFileProject } from "@/lib/db";
import {
  normalizeTpProjectState,
  tpDocumentKinds,
  type TpLocalFileProject,
  type TpProjectStatus,
  type TpSourceDocument
} from "@/lib/tp-local-file";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
type ProjectAccess =
  | { ok: true; project: TpLocalFileProject }
  | { ok: false; response: NextResponse };

function trustedProjectBlob(value: unknown, projectId: string) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:"
      && url.hostname.endsWith(".blob.vercel-storage.com")
      && url.pathname.startsWith(`/tp-local-files/${projectId}/`);
  } catch {
    return false;
  }
}

function mergeProjectDocuments(value: unknown, current: TpSourceDocument[], projectId: string) {
  if (!Array.isArray(value)) return current;
  const existing = new Map(current.map((document) => [document.id, document]));
  const allowedKinds = new Set(tpDocumentKinds.map((kind) => kind.id));
  return value.map((raw) => {
    const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const currentDocument = existing.get(String(source.id || ""));
    if (currentDocument) return currentDocument;
    if (!trustedProjectBlob(source.url, projectId) || !trustedProjectBlob(source.downloadUrl || source.url, projectId)) {
      throw new Error("The source document must be an uploaded TP Local File Blob.");
    }
    const kind = String(source.kind || "other") as TpSourceDocument["kind"];
    return {
      id: String(source.id || "").slice(0, 120),
      filename: String(source.filename || "source-document").slice(0, 240),
      kind: allowedKinds.has(kind) ? kind : "other",
      url: String(source.url),
      downloadUrl: String(source.downloadUrl || source.url),
      size: Math.max(0, Math.min(Number(source.size || 0), 250 * 1024 * 1024)),
      status: "uploaded" as const,
      extractionMessage: "",
      uploadedAt: new Date().toISOString()
    };
  });
}

async function authorizedProject(request: Request, id: string): Promise<ProjectAccess> {
  const auth = await requireFeature(request, "tpLocalFile");
  if ("response" in auth && auth.response) return { ok: false, response: auth.response };
  const project = await getTpLocalFileProjectById(id);
  if (!project) return { ok: false, response: NextResponse.json({ error: "TP project not found." }, { status: 404 }) };
  if (auth.session.role !== "admin" && project.ownerUsername !== auth.session.username) {
    return { ok: false, response: NextResponse.json({ error: "You do not have access to this TP project." }, { status: 403 }) };
  }
  return { ok: true, project };
}

export async function GET(request: Request, context: RouteContext) {
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const { id } = await context.params;
  const access = await authorizedProject(request, id);
  if (!access.ok) return access.response;
  return NextResponse.json({ project: access.project });
}

export async function PUT(request: Request, context: RouteContext) {
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const { id } = await context.params;
  const access = await authorizedProject(request, id);
  if (!access.ok) return access.response;
  try {
    const body = await request.json();
    const status = String(body.status || access.project.status) as TpProjectStatus;
    const project: TpLocalFileProject = {
      ...access.project,
      name: String(body.name || access.project.name).trim().slice(0, 180) || access.project.name,
      status: status === "ready" || status === "analyzed" || status === "extracted" ? status : "draft",
      state: body.state ? normalizeTpProjectState(body.state) : access.project.state,
      documents: mergeProjectDocuments(body.documents, access.project.documents, access.project.id),
      updatedAt: new Date().toISOString()
    };
    await upsertTpLocalFileProject(project);
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save TP project." }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const { id } = await context.params;
  const access = await authorizedProject(request, id);
  if (!access.ok) return access.response;
  const urls = access.project.documents.map((document) => document.url).filter((url) => url.startsWith("https://"));
  if (urls.length && process.env.BLOB_READ_WRITE_TOKEN) await Promise.allSettled(urls.map((url) => del(url)));
  await deleteTpLocalFileProject(id);
  return NextResponse.json({ ok: true });
}
