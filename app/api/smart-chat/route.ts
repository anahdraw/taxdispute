import { NextResponse } from "next/server";
import { hasDatabase, listDecisionDocuments, listTaxRegulations } from "@/lib/db";
import { regulations as seedRegulations } from "@/lib/mock-data";
import { mergeRegulationRecords } from "@/lib/regulation-knowledge";
import { answerSmartChat, type SmartChatSourceMode } from "@/lib/smart-chat";
import { requireAuth } from "@/lib/auth";
import { getActiveTierWorkProfile } from "@/lib/tier-profiles";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { resolveRequestTier, TIER_PREVIEW_HEADER } from "@/lib/tier-preview";
import { getManagedPrompt } from "@/lib/server-settings";
import { resolveWorkspaceScope } from "@/lib/workspace-access";
import { createResearchWorkspaceRecord } from "@/lib/research-workspace";
import { saveResearchWorkspaceRecord } from "@/lib/research-workspace-store";
import { loadLocalRegulationSnapshot } from "@/lib/regulation-snapshot";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
  const modelChoice = modelChoiceFromRequest(request);
  try {
    const body = (await request.json()) as {
      question?: string;
      language?: "id" | "en";
      mode?: SmartChatSourceMode;
      sessionId?: string;
    };
    const question = String(body.question || "").trim();
    const language = body.language === "id" ? "id" : "en";
    const mode: SmartChatSourceMode =
      body.mode === "decisions" || body.mode === "regulations" || body.mode === "all" ? body.mode : "all";
    if (!question) {
      return NextResponse.json({ error: language === "id" ? "Pertanyaan belum diisi." : "Question is required." }, { status: 400 });
    }

    const documents = hasDatabase() ? await listDecisionDocuments().catch(() => []) : [];
    const storedRegulations = hasDatabase() ? await listTaxRegulations().catch(() => []) : [];
    // Local pipeline snapshots are opt-in and read-only.  They allow the
    // ordinary Smart Chat route to benefit from the audited regulation corpus
    // without requiring a cloud database or importing the source SQLite file
    // into the browser bundle.
    const localRegulations = loadLocalRegulationSnapshot();
    const regulationRecords = mergeRegulationRecords([...seedRegulations, ...storedRegulations, ...localRegulations]);

    const result = await answerSmartChat({
        question,
        language,
        documents,
        regulations: regulationRecords,
        mode,
        tierProfile: getActiveTierWorkProfile(resolveRequestTier(auth.session, request.headers.get(TIER_PREVIEW_HEADER))),
        modelChoice,
        managedPrompt: await getManagedPrompt("disputeBot", language)
      });
    const workspace = await resolveWorkspaceScope(request, auth.session).catch(() => null);
    if (workspace) {
      const record = createResearchWorkspaceRecord("history", {
        action: "chat",
        resourceType: "chat",
        resourceId: String(body.sessionId || `smart-chat-${Date.now()}`),
        title: question.slice(0, 180),
        query: question,
        responseExcerpt: result.answer.slice(0, 12_000),
        sessionId: String(body.sessionId || ""),
        metadata: { mode: result.retrieval.mode, usedDecisions: result.retrieval.usedDecisions, usedRegulations: result.retrieval.usedRegulations }
      }, { tenantId: workspace.tenantId, userId: workspace.userId, clientId: workspace.clientId, matterId: workspace.matterId });
      await saveResearchWorkspaceRecord("history", record).catch(() => undefined);
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid smart chat request" },
      { status: 400 }
    );
  }
}
