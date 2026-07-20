import { NextResponse } from "next/server";
import { buildAnalysis, decisionDocumentsToComparables, type AnalyzeInput } from "@/lib/analyze";
import { hasDatabase, listDecisionDocuments, listTaxRegulations } from "@/lib/db";
import type { ExtractionResult } from "@/lib/extraction";
import { mergeRegulationRecords } from "@/lib/regulation-knowledge";
import { buildLlmAnalysis } from "@/lib/openai";
import { requireFeature } from "@/lib/auth";
import { getActiveTierWorkProfile } from "@/lib/tier-profiles";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { resolveRequestTier, TIER_PREVIEW_HEADER } from "@/lib/tier-preview";
import { getManagedPrompt } from "@/lib/server-settings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireFeature(request, "guided");
  if ("response" in auth) return auth.response;
  const modelChoice = modelChoiceFromRequest(request);
  try {
    const body = await request.json();
    const input = ("input" in body ? body.input : body) as AnalyzeInput;
    const extraction = ("extraction" in body ? body.extraction : null) as ExtractionResult | null;
    const storedDocuments = hasDatabase() ? await listDecisionDocuments().catch(() => []) : [];
    const decisionContext = decisionDocumentsToComparables(storedDocuments);
    const localAnalysis = buildAnalysis(input, extraction, decisionContext.length ? decisionContext : undefined);
    const storedRegulations = hasDatabase() ? await listTaxRegulations().catch(() => []) : [];
    return NextResponse.json(
      await buildLlmAnalysis(
        input,
        localAnalysis,
        extraction,
        mergeRegulationRecords(storedRegulations),
        getActiveTierWorkProfile(resolveRequestTier(auth.session, request.headers.get(TIER_PREVIEW_HEADER))),
        modelChoice,
        await getManagedPrompt("advancedAnalysis", input.language === "id" ? "id" : "en")
      )
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid analysis request" },
      { status: 400 }
    );
  }
}
