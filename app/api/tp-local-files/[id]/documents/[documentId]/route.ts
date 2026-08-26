import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import { getTpLocalFileProjectById, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; documentId: string }> };

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

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireFeature(request, "tpLocalFile");
  if ("response" in auth) return auth.response;
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const { id, documentId } = await context.params;
  const project = await getTpLocalFileProjectById(id);
  if (!project) return NextResponse.json({ error: "TP project not found." }, { status: 404 });
  if (auth.session.role !== "admin" && project.ownerUsername !== auth.session.username) {
    return NextResponse.json({ error: "You do not have access to this TP project." }, { status: 403 });
  }
  const document = project.documents.find((entry) => entry.id === documentId);
  if (!document || !trustedProjectBlob(document.url, project.id)) {
    return NextResponse.json({ error: "Private source document not found." }, { status: 404 });
  }
  const blob = await get(document.url, { access: "private", useCache: false });
  if (!blob || blob.statusCode !== 200) return NextResponse.json({ error: "Private source content not found." }, { status: 404 });
  const disposition = document.filename.toLowerCase().endsWith(".pdf") ? "inline" : "attachment";
  return new Response(blob.stream, {
    headers: {
      "content-type": blob.blob.contentType || "application/octet-stream",
      "content-length": String(blob.blob.size),
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
