import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import { getTpLocalFileProjectById, hasDatabase, listTaxRegulations, updateTpLocalFileProjectIfUnchanged } from "@/lib/db";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { callOpenAIText, canUseConfidentialLlm, extractJsonObject } from "@/lib/openai";
import { getManagedPrompt } from "@/lib/server-settings";
import { normalizeTpProjectState, tpGenerationReadiness, tpProjectCompleteness, tpProjectStatusAfterAnalysis } from "@/lib/tp-local-file";
import { runTpExternalResearch, type TpExternalResearchBundle } from "@/lib/tavily";
import { selectTpRegulationContext } from "@/lib/tp-regulation-context";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

function comparableUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim().replace(/\/$/, "");
  }
}

function sourceSupportsCandidateName(sourceText: string, candidateName: unknown) {
  const ignored = new Set(["pt", "tbk", "ltd", "limited", "inc", "corporation", "corp", "company", "plc"]);
  const tokens = String(candidateName || "").toLocaleLowerCase("en-US")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !ignored.has(token));
  const normalizedSource = sourceText.toLocaleLowerCase("en-US");
  return tokens.length > 0 && tokens.every((token) => normalizedSource.includes(token));
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireFeature(request, "tpLocalFile");
  if ("response" in auth) return auth.response;
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    const language = body.language === "en" ? "en" : "id";
    const useExternalResearch = body.useExternalResearch === true;
    const project = await getTpLocalFileProjectById(id);
    if (!project) return NextResponse.json({ error: "TP project not found." }, { status: 404 });
    if (auth.session.role !== "admin" && project.ownerUsername !== auth.session.username) {
      return NextResponse.json({ error: "You do not have access to this TP project." }, { status: 403 });
    }
    const modelChoice = modelChoiceFromRequest(request);
    if (!canUseConfidentialLlm(modelChoice)) {
      return NextResponse.json({ error: "Confidential TP analysis requires an available on-prem model or TDP_CONFIDENTIAL_LLM_POLICY=allow_openai after documented approval." }, { status: 409 });
    }
    const regulations = selectTpRegulationContext(await listTaxRegulations().catch(() => []), 15);
    const managed = await getManagedPrompt("tpLocalFile", language);
    const readiness = tpGenerationReadiness(project.state);
    const research: TpExternalResearchBundle = useExternalResearch
      ? await runTpExternalResearch(project.state)
      : { status: "not_configured", sources: [], warnings: [], queries: [] };
    const externalContext = (["official", "industry", "comparable_candidate"] as const)
      .flatMap((sourceType) => research.sources
        .filter((source) => source.sourceType === sourceType)
        .slice(0, sourceType === "comparable_candidate" ? 10 : 4))
      .map((source) => ({
        title: source.title,
        url: source.url,
        domain: source.domain,
        sourceType: source.sourceType,
        score: source.score,
        qualityTier: source.qualityTier,
        qualityReason: source.qualityReason,
        snippet: source.snippet.slice(0, 1100),
        publishedDate: source.publishedDate
      }));
    const prompt = `${managed.instruction}\n\nPrepare a cautious TP Local File advisor review from the project data below. Return JSON only with this exact shape:
{
  "executiveSummary":"", "industryAnalysis":"", "businessCharacterization":"", "functionalAnalysis":"",
  "methodSelectionJustification":"", "pliSelectionRationale":"", "comparabilityAnalysis":"", "conclusion":"",
  "riskFlags":[""], "requiredEvidence":[""], "regulatoryReferences":[""],
  "assumptions":[""], "counterarguments":[""], "actionPlan":[""],
  "externalResearchSummary":"",
  "externalComparableCandidates":[{
    "name":"", "country":"", "businessDescription":"", "matchRationale":"",
    "keyDifferences":[""], "sourceTitle":"", "sourceUrl":"", "sourceScore":0,
    "sourceQuality":"discovery_only", "screeningStatus":"preliminary", "limitation":""
  }]
}
Rules:
1. Separate source facts, advisor inference, assumptions, and unresolved evidence. Never invent amounts, counterparties, ratios, regulations, company names, or financial results.
2. Explain why the selected method, PLI, tested party, and analysis period are or are not supportable. Explicitly test alternative methods and the strongest likely tax-authority counterarguments.
3. Treat readiness blockers as unresolved review items, not as facts. Make the action plan sequenced and evidence-specific.
4. Cite only regulations in REGULATION CONTEXT. Treat revoked or temporally uncertain records as historical context, not current authority. External official sources may support research direction but are not a substitute for verified legal text.
5. EXTERNAL WEB RESEARCH is discovery evidence only. Derive a comparable candidate only from a sourceType "comparable_candidate" source that explicitly names an entity and describes relevant business activity. Preserve the exact supplied source URL and title. Prefer exchange_or_filing evidence over discovery_only sources.
6. A web candidate is never a final accepted comparable. Use screeningStatus "preliminary" or "needs_financial_screening" unless the source clearly proves it should be excluded. State missing independence, ownership, financial-period, geographic, product, FAR, loss-making, and data-availability checks in limitation/keyDifferences.
7. Do not provide a profitability ratio unless it appears explicitly in a supplied source for a clear period. Do not calculate an arm's-length range from web search results.
8. Write concise professional paragraphs; use ${language === "en" ? "English" : "Bahasa Indonesia"}. Do not use raw Markdown tables.

PROJECT DATA:\n${JSON.stringify(project.state)}

GENERATION READINESS AND UNRESOLVED ITEMS:\n${JSON.stringify({ summary: readiness.summary, blockers: readiness.blockers, dataConflicts: readiness.dataConflicts })}

REGULATION CONTEXT:\n${JSON.stringify(regulations)}

EXTERNAL WEB RESEARCH STATUS:\n${JSON.stringify({ status: research.status, warnings: research.warnings, queries: research.queries })}

EXTERNAL WEB RESEARCH SOURCES:\n${JSON.stringify(externalContext)}`;
    const raw = await callOpenAIText(prompt, managed.system, modelChoice, { reasoningEffort: "high", textVerbosity: "high" });
    const parsedAnalysis = extractJsonObject(raw);
    const candidateEntries = Array.isArray(parsedAnalysis.externalComparableCandidates)
      ? parsedAnalysis.externalComparableCandidates
      : [];
    const canonicalCandidates = candidateEntries.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Record<string, unknown>;
      const source = research.sources.find((item) =>
        item.sourceType === "comparable_candidate" && comparableUrl(item.url) === comparableUrl(candidate.sourceUrl)
      );
      if (!source || !sourceSupportsCandidateName(`${source.title} ${source.snippet}`, candidate.name)) return [];
      return [{
        ...candidate,
        sourceTitle: source.title,
        sourceUrl: source.url,
        sourceScore: source.score,
        sourceQuality: source.qualityTier
      }];
    });
    const analysis = {
      ...parsedAnalysis,
      externalComparableCandidates: canonicalCandidates,
      externalResearchStatus: useExternalResearch ? research.status : "not_requested",
      externalResearchWarnings: useExternalResearch ? research.warnings : [],
      externalResearchSources: research.sources
    };
    const state = normalizeTpProjectState({ ...project.state, analysis });
    const completeness = tpProjectCompleteness(state);
    const updatedProject = {
      ...project,
      state,
      status: tpProjectStatusAfterAnalysis(state),
      updatedAt: new Date().toISOString()
    };
    const updated = await updateTpLocalFileProjectIfUnchanged(updatedProject, project.updatedAt);
    if (!updated) {
      return NextResponse.json({ error: "The TP project changed during analysis. The generated draft was not applied; reload and run again." }, { status: 409 });
    }
    return NextResponse.json({
      project: updatedProject,
      completeness,
      research: { status: research.status, sourceCount: research.sources.length, warnings: research.warnings }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "TP Local File analysis failed." }, { status: 500 });
  }
}
