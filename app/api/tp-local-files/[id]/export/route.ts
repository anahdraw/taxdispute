import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import { getTpLocalFileProjectById, hasDatabase } from "@/lib/db";
import { buildTpLocalFileDocx } from "@/lib/tp-local-file-report";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

function safeName(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "TP-Local-File";
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireFeature(request, "tpLocalFile");
  if ("response" in auth) return auth.response;
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const { id } = await context.params;
  try {
    const project = await getTpLocalFileProjectById(id);
    if (!project) return NextResponse.json({ error: "TP project not found." }, { status: 404 });
    if (auth.session.role !== "admin" && project.ownerUsername !== auth.session.username) {
      return NextResponse.json({ error: "You do not have access to this TP project." }, { status: 403 });
    }
    const language = new URL(request.url).searchParams.get("language") === "en" ? "en" : "id";
    const bytes = await buildTpLocalFileDocx(project, language);
    const filename = `${safeName(project.state.companyName || project.name)}_${safeName(project.state.fiscalYear || "Local-File")}.docx`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not export TP Local File." }, { status: 500 });
  }
}
