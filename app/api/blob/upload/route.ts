import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";

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

        return {
          allowedContentTypes: decisionPdf
            ? ["application/pdf"]
            : ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"],
          maximumSizeInBytes: 250 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: clientPayload || null
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
