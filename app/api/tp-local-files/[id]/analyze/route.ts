import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import { getTpLocalFileProjectById, hasDatabase, listTaxRegulations, upsertTpLocalFileProject } from "@/lib/db";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { callOpenAIText, extractJsonObject } from "@/lib/openai";
import { getManagedPrompt } from "@/lib/server-settings";
import { normalizeTpProjectState, tpGenerationReadiness, tpProjectCompleteness } from "@/lib/tp-local-file";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireFeature(request, "tpLocalFile");
  if ("response" in auth) return auth.response;
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    const language = body.language === "en" ? "en" : "id";
    const project = await getTpLocalFileProjectById(id);
    if (!project) return NextResponse.json({ error: "TP project not found." }, { status: 404 });
    if (auth.session.role !== "admin" && project.ownerUsername !== auth.session.username) {
      return NextResponse.json({ error: "You do not have access to this TP project." }, { status: 403 });
    }
    const regulations = (await listTaxRegulations().catch(() => []))
      .filter((record) => record.topic === "transfer_pricing" || /transfer pricing|hubungan istimewa|kewajaran/i.test(`${record.title} ${record.focus}`))
      .slice(0, 10)
      .map((record) => ({ title: record.title, citation: record.citation, focus: record.focus, sourceUrl: record.sourceUrl }));
    const managed = await getManagedPrompt("tpLocalFile", language);
    const readiness = tpGenerationReadiness(project.state);
    const prompt = `${managed.instruction}\n\nPrepare a cautious TP Local File advisor review from the project data below. Return JSON only with this exact shape:
{
  "executiveSummary":"", "industryAnalysis":"", "businessCharacterization":"", "functionalAnalysis":"",
  "methodSelectionJustification":"", "pliSelectionRationale":"", "comparabilityAnalysis":"", "conclusion":"",
  "riskFlags":[""], "requiredEvidence":[""], "regulatoryReferences":[""]
}
Rules: distinguish document facts from advisor inference; never invent amounts, counterparties, ratios, or regulations; explain why the selected method, PLI, and tested party are or are not supportable; state material gaps; cite only regulations in the supplied regulation context. Write concise professional paragraphs with descriptive headings embedded in the appropriate fields, not raw Markdown tables. Treat the readiness blockers as unresolved review items, not as facts. Use ${language === "en" ? "English" : "Bahasa Indonesia"}.

PROJECT DATA:\n${JSON.stringify(project.state)}

GENERATION READINESS AND UNRESOLVED ITEMS:\n${JSON.stringify({ summary: readiness.summary, blockers: readiness.blockers })}

REGULATION CONTEXT:\n${JSON.stringify(regulations)}`;
    const raw = await callOpenAIText(prompt, managed.system, modelChoiceFromRequest(request));
    const analysis = extractJsonObject(raw);
    const state = normalizeTpProjectState({ ...project.state, analysis });
    const completeness = tpProjectCompleteness(state);
    const updatedProject = {
      ...project,
      state,
      status: completeness >= 80 ? "ready" as const : "analyzed" as const,
      updatedAt: new Date().toISOString()
    };
    await upsertTpLocalFileProject(updatedProject);
    return NextResponse.json({ project: updatedProject, completeness });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "TP Local File analysis failed." }, { status: 500 });
  }
}
