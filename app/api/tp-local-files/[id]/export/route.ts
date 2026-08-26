import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import { getTpLocalFileProjectById, hasDatabase } from "@/lib/db";
import { listTpAgentRuns } from "@/lib/tp-agent-queue";
import { buildTpLocalFileDocx } from "@/lib/tp-local-file-report";
import type { TpLocalFileProject } from "@/lib/tp-local-file";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

function safeName(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "TP-Local-File";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
    const params = new URL(request.url).searchParams;
    const language = params.get("language") === "en" ? "en" : "id";
    const requestedVersion = String(params.get("version") || "").trim();
    let exportProject = project;
    if (requestedVersion) {
      const runs = await listTpAgentRuns({ projectId: id, limit: 500 });
      const assemblyRun = runs.find((run) => {
        if (run.stage !== "assembly" || run.status !== "succeeded") return false;
        const output = record(run.output);
        const result = record(output.result);
        return result.documentVersion === requestedVersion;
      });
      const snapshot = record(record(assemblyRun?.output).artifactSnapshot);
      if (!assemblyRun || snapshot.id !== project.id || !snapshot.state || !snapshot.documents) {
        return NextResponse.json({ error: "The requested immutable TP assembly version was not found." }, { status: 404 });
      }
      exportProject = snapshot as unknown as TpLocalFileProject;
    }
    const bytes = await buildTpLocalFileDocx(exportProject, language);
    const versionSuffix = requestedVersion ? `_${safeName(requestedVersion)}` : "_working-draft";
    const filename = `${safeName(exportProject.state.companyName || exportProject.name)}_${safeName(exportProject.state.fiscalYear || "Local-File")}${versionSuffix}.docx`;
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
