import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { requireFeature } from "@/lib/auth";
import { deleteTpLocalFileProject, getTpLocalFileProjectById, hasDatabase, updateTpLocalFileProjectIfUnchanged } from "@/lib/db";
import { cancelTpAgentRunsForProject } from "@/lib/tp-agent-queue";
import {
  normalizeTpProjectState,
  tpDocumentKinds,
  tpExtractionScopes,
  tpProjectCompleteness,
  tpProjectStatusAfterAnalysis,
  type TpLocalFileProject,
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
  const allowedScopes = new Set<string>(tpExtractionScopes.map((scope) => scope.id));
  const additions = value.flatMap((raw): TpSourceDocument[] => {
    const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const documentId = String(source.id || "").trim().slice(0, 120);
    if (!documentId) throw new Error("A source document ID is required.");
    const currentDocument = existing.get(documentId);
    if (currentDocument) return [];
    if (!trustedProjectBlob(source.url, projectId) || !trustedProjectBlob(source.downloadUrl || source.url, projectId)) {
      throw new Error("The source document must be an uploaded TP Local File Blob.");
    }
    const kind = String(source.kind || "other") as TpSourceDocument["kind"];
    const requestedScopes = Array.isArray(source.requestedScopes)
      ? source.requestedScopes.map(String).filter((scope) => allowedScopes.has(scope)) as TpSourceDocument["requestedScopes"]
      : [];
    return [{
      id: documentId,
      filename: String(source.filename || "source-document").slice(0, 240),
      kind: allowedKinds.has(kind) ? kind : "other",
      url: String(source.url),
      downloadUrl: String(source.downloadUrl || source.url),
      size: Math.max(0, Math.min(Number(source.size || 0), 250 * 1024 * 1024)),
      status: "uploaded" as const,
      extractionMessage: "",
      uploadedAt: new Date().toISOString(),
      requestedScopes,
      detectedScopes: [],
      coverage: [],
      evidence: []
    }];
  });
  additions.forEach((document) => {
    if (!existing.has(document.id)) existing.set(document.id, document);
  });
  return Array.from(existing.values());
}

function serverProjectStatus(project: TpLocalFileProject) {
  const hasAdvisorAnalysis = project.status === "analyzed"
    || project.status === "ready"
    || Boolean(project.state.analysis.executiveSummary.trim() || project.state.analysis.conclusion.trim());
  if (hasAdvisorAnalysis) return tpProjectStatusAfterAnalysis(project.state);
  if (project.documents.some((document) => document.status === "extracted") || tpProjectCompleteness(project.state) > 0) return "extracted" as const;
  return "draft" as const;
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
    if (!body.updatedAt || String(body.updatedAt) !== access.project.updatedAt) {
      return NextResponse.json({ error: "This TP project changed after it was opened. Reload it before saving." }, { status: 409 });
    }
    const state = body.state ? normalizeTpProjectState(body.state) : access.project.state;
    const documents = mergeProjectDocuments(body.documents, access.project.documents, access.project.id);
    const project: TpLocalFileProject = {
      ...access.project,
      name: String(body.name || access.project.name).trim().slice(0, 180) || access.project.name,
      status: access.project.status,
      state,
      documents,
      updatedAt: new Date().toISOString()
    };
    project.status = serverProjectStatus(project);
    const unchanged = project.name === access.project.name
      && project.status === access.project.status
      && JSON.stringify(project.state) === JSON.stringify(access.project.state)
      && JSON.stringify(project.documents) === JSON.stringify(access.project.documents);
    if (unchanged) return NextResponse.json({ project: access.project });
    const updated = await updateTpLocalFileProjectIfUnchanged(project, access.project.updatedAt);
    if (!updated) {
      return NextResponse.json({ error: "This TP project changed while it was being saved. Reload it and review the newer version." }, { status: 409 });
    }
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
  await cancelTpAgentRunsForProject({
    projectId: access.project.id,
    cancelledBy: access.project.ownerUsername,
    reason: "TP project was deleted."
  });
  const urls = access.project.documents.map((document) => document.url).filter((url) => url.startsWith("https://"));
  if (urls.length && process.env.BLOB_READ_WRITE_TOKEN) await Promise.allSettled(urls.map((url) => del(url)));
  await deleteTpLocalFileProject(id);
  return NextResponse.json({ ok: true });
}
