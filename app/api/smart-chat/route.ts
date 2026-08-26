import { NextResponse } from "next/server";
import { hasDatabase, listDecisionDocuments, listTaxRegulations } from "@/lib/db";
import { regulations as seedRegulations } from "@/lib/mock-data";
import { mergeRegulationRecords } from "@/lib/regulation-knowledge";
import { answerSmartChat, rankDecisionDocuments, rankRegulations, type SmartChatSourceMode } from "@/lib/smart-chat";
import { requireAuth } from "@/lib/auth";
import { getActiveTierWorkProfile } from "@/lib/tier-profiles";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { resolveRequestTier, TIER_PREVIEW_HEADER } from "@/lib/tier-preview";
import { getManagedPrompt } from "@/lib/server-settings";
import { resolveWorkspaceScope } from "@/lib/workspace-access";
import { createResearchWorkspaceRecord } from "@/lib/research-workspace";
import { saveResearchWorkspaceRecord } from "@/lib/research-workspace-store";
import { loadLocalRegulationSnapshot } from "@/lib/regulation-snapshot";
import { assessTaxQueryDomain } from "@/lib/query-domain";
import { assessRegulationChatTrust, chatAbstentionAnswer } from "@/lib/chat-trust";
import { rerankRegulationContext } from "@/lib/regulation-answer";
import { assessTrust } from "@/lib/citation-trust";
import { configuredModel, hasRemoteLlm } from "@/lib/openai";
import { assertEnterpriseAiBudget, estimateTokens, recordEnterpriseMetric } from "@/lib/enterprise-observability";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = Date.now();
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
    const domain = assessTaxQueryDomain(question);
    if (!domain.inScope) {
      const trust = assessRegulationChatTrust(question, [], { language });
      return NextResponse.json({
        answer: chatAbstentionAnswer(language, trust),
        decisionHits: [],
        ruleHits: [],
        charts: [],
        llmStatus: { used: false, model: "trust-gate", message: language === "id" ? "Jawaban ditahan oleh negative-query gate." : "Answer withheld by the negative-query gate." },
        retrieval: { mode, totalDecisions: 0, totalRegulations: 0, usedDecisions: 0, usedRegulations: 0, tier: auth.session.tier, analysisDepth: "trust-gate", regulationDepth: "trust-gate", modelChoice },
        trust: { ...trust, validationStage: "preflight" }
      });
    }

    const documents = hasDatabase() ? await listDecisionDocuments().catch(() => []) : [];
    const storedRegulations = hasDatabase() ? await listTaxRegulations().catch(() => []) : [];
    // Local pipeline snapshots are opt-in and read-only.  They allow the
    // ordinary Smart Chat route to benefit from the audited regulation corpus
    // without requiring a cloud database or importing the source SQLite file
    // into the browser bundle.
    const localRegulations = loadLocalRegulationSnapshot();
    const regulationRecords = mergeRegulationRecords([...seedRegulations, ...storedRegulations, ...localRegulations]);
    const tierProfile = getActiveTierWorkProfile(resolveRequestTier(auth.session, request.headers.get(TIER_PREVIEW_HEADER)));
    const trustContext = rerankRegulationContext(regulationRecords, question, 8);
    const scoreByCanonical = new Map(trustContext.diagnostics.topScores.map((entry) => [entry.canonicalKey, entry.score]));
    const trust = mode === "decisions"
      ? assessTrust([], { question, language })
      : assessRegulationChatTrust(question, trustContext.records, { language, scoreByCanonical });
    if (mode !== "decisions" && trust.abstain) {
      const decisionHits = mode === "all" ? rankDecisionDocuments(question, documents, tierProfile.smartDecisionLimit) : [];
      const ruleHits = rankRegulations(question, trustContext.records, tierProfile.smartRegulationLimit);
      return NextResponse.json({
        answer: chatAbstentionAnswer(language, trust),
        decisionHits,
        ruleHits,
        charts: [],
        llmStatus: { used: false, model: "trust-gate", message: language === "id" ? "Jawaban ditahan sampai sumber lolos trust gate." : "Answer withheld until the evidence passes the trust gate." },
        retrieval: { mode, totalDecisions: documents.filter((item) => item.extraction).length, totalRegulations: regulationRecords.length, usedDecisions: decisionHits.length, usedRegulations: ruleHits.length, tier: tierProfile.tier, analysisDepth: tierProfile.analysisDepth, regulationDepth: tierProfile.regulationDepth, modelChoice },
        trust: { ...trust, validationStage: "preflight" }
      });
    }

    const workspace = await resolveWorkspaceScope(request, auth.session).catch(() => null);
    if (workspace && hasRemoteLlm(modelChoice)) await assertEnterpriseAiBudget(workspace.tenantId);
    const result = await answerSmartChat({
        question,
        language,
        documents,
        regulations: regulationRecords,
        mode,
        tierProfile,
        modelChoice,
        managedPrompt: await getManagedPrompt("disputeBot", language)
      });
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
      await recordEnterpriseMetric({
        tenantId: workspace.tenantId,
        operation: "smart_chat",
        provider: hasRemoteLlm(modelChoice) ? "openai" : "local",
        model: configuredModel(modelChoice),
        ok: true,
        latencyMs: Date.now() - startedAt,
        inputTokensEstimate: estimateTokens(question) + (result.retrieval.usedDecisions + result.retrieval.usedRegulations) * 600,
        outputTokensEstimate: estimateTokens(result.answer)
      }).catch(() => undefined);
    }
    return NextResponse.json({ ...result, trust: { ...trust, validationStage: "preflight" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid smart chat request" },
      { status: 400 }
    );
  }
}
