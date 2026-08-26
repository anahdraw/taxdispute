import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import { getTpLocalFileProjectById, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireFeature(request, "tpLocalFile");
  if ("response" in auth) return auth.response;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN is not configured. Add Vercel Blob storage to this project and pull the env vars again." },
      { status: 500 }
    );
  }

  const body = (await request.json()) as HandleUploadBody;
  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const normalized = pathname.toLowerCase();
        const decisionPdf = normalized.startsWith("decisions/") && normalized.endsWith(".pdf");
        const tpDocument = normalized.startsWith("tp-local-files/") && /\.(pdf|docx?)$/i.test(normalized);
        if (!decisionPdf && !tpDocument) {
          throw new Error("Only decision PDFs or TP Local File PDF/Word documents are allowed.");
        }
        if (decisionPdf && auth.session.role !== "admin") {
          throw new Error("Only administrators can upload decision database documents.");
        }

        let safeTokenPayload: string | null = null;
        if (tpDocument) {
          if (!hasDatabase()) throw new Error("Database is not configured.");
          let payload: Record<string, unknown> = {};
          try {
            payload = clientPayload ? JSON.parse(clientPayload) as Record<string, unknown> : {};
          } catch {
            throw new Error("Invalid TP upload metadata.");
          }
          const projectId = String(payload.projectId || "").trim();
          if (!projectId || !pathname.startsWith(`tp-local-files/${projectId}/`)) {
            throw new Error("TP upload path does not match the authorized project.");
          }
          const project = await getTpLocalFileProjectById(projectId);
          if (!project) throw new Error("TP project not found.");
          if (auth.session.role !== "admin" && project.ownerUsername !== auth.session.username) {
            throw new Error("You do not have access to this TP project.");
          }
          safeTokenPayload = JSON.stringify({
            projectId,
            kind: String(payload.kind || "auto_mixed").slice(0, 80),
            filename: String(payload.filename || "source-document").slice(0, 240),
            ownerUsername: auth.session.username
          });
        }

        return {
          allowedContentTypes: decisionPdf
            ? ["application/pdf"]
            : ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"],
          maximumSizeInBytes: tpDocument ? 30 * 1024 * 1024 : 250 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: tpDocument ? safeTokenPayload : clientPayload || null
        };
      }
    });

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Blob upload token request failed." },
      { status: 400 }
    );
  }
}
