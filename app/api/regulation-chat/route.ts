import { NextResponse } from "next/server";
import { hasDatabase, listTaxRegulations } from "@/lib/db";
import { answerRegulationQuestion, hasRemoteLlm, missingKeyStatus } from "@/lib/openai";
import { mergeRegulationRecords } from "@/lib/regulation-knowledge";
import { rerankRegulationContext } from "@/lib/regulation-answer";
import { requireAuth } from "@/lib/auth";
import { getActiveTierWorkProfile } from "@/lib/tier-profiles";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { resolveRequestTier, TIER_PREVIEW_HEADER } from "@/lib/tier-preview";
import { getManagedPrompt } from "@/lib/server-settings";
import {
  lightRagConfigFromEnv,
  matchLightRagReferencesToRegulations,
  queryLightRag
} from "@/lib/lightrag-client";
import { ragProviderModeFromEnv, runRagProvider, type RagProviderAttempt } from "@/lib/rag-provider";
import type { Regulation } from "@/lib/mock-data";
import { loadLocalRegulationSnapshot } from "@/lib/regulation-snapshot";
import { generateLocalRegulationAnswer } from "@/lib/regulation-answer";
import { assessTaxQueryDomain } from "@/lib/query-domain";
import { assessRegulationChatTrust, chatAbstentionAnswer } from "@/lib/chat-trust";
import { resolveWorkspaceScope } from "@/lib/workspace-access";
import { createResearchWorkspaceRecord } from "@/lib/research-workspace";
import { saveResearchWorkspaceRecord } from "@/lib/research-workspace-store";
import { assertEnterpriseAiBudget, estimateTokens, recordEnterpriseMetric } from "@/lib/enterprise-observability";
import { configuredModel } from "@/lib/openai";

export const runtime = "nodejs";

type RegulationRetrieval = {
  records: Regulation[];
  canonicalIds: string[];
  engine: "baseline" | "lightrag";
  queryMode?: string;
  referenceCount?: number;
  retrievalLatencyMs?: number;
};

function canonicalIds(records: Regulation[]) {
  return records.map((record) => record.canonicalKey || record.id);
}

function compareRetrieval(baseline: RegulationRetrieval, lightrag: RegulationRetrieval) {
  const baselineIds = baseline.canonicalIds;
  const lightRagIds = lightrag.canonicalIds;
  const lightRagSet = new Set(lightRagIds);
  const commonIds = baselineIds.filter((id) => lightRagSet.has(id));
  return {
    baselineIds,
    lightRagIds,
    commonIds,
    retrievalJaccardAt8:
      baselineIds.length || lightRagIds.length ? commonIds.length / new Set([...baselineIds, ...lightRagIds]).size : 1,
    sameTop1: Boolean(baselineIds[0] && baselineIds[0] === lightRagIds[0])
  };
}

function attemptTelemetry(attempt: RagProviderAttempt<RegulationRetrieval> | undefined) {
  if (!attempt) return undefined;
  return attempt.ok
    ? { provider: attempt.provider, ok: true, latencyMs: attempt.latencyMs, resultCount: attempt.value.records.length }
    : { provider: attempt.provider, ok: false, latencyMs: attempt.latencyMs, errorCode: "provider_failed" };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
  const modelChoice = modelChoiceFromRequest(request);
  let body: { question?: string; language?: "id" | "en"; topic?: string };
  try {
    const rawBody: unknown = await request.json();
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
    }
    body = rawBody as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const language = body.language === "id" ? "id" : "en";
  if (!question) {
    return NextResponse.json({ error: language === "id" ? "Pertanyaan belum diisi." : "Question is required." }, { status: 400 });
  }
  const domain = assessTaxQueryDomain(question);
  if (!domain.inScope) {
    const trust = assessRegulationChatTrust(question, [], { language });
    return NextResponse.json({
      answer: chatAbstentionAnswer(language, trust),
      citations: [],
      answerMeta: { abstained: true, matchedProvisions: [] },
      trust: { ...trust, validationStage: "preflight" },
      retrieval: { requestedProvider: "baseline", servedBy: "baseline", fallbackUsed: false, totalCorpus: 0, resultCount: 0, canonicalIds: [] },
      reranking: { answerable: false, bestScore: 0, abstentionReason: domain.reason },
      graphPaths: []
    });
  }
  try {
    const stored = hasDatabase() ? await listTaxRegulations().catch(() => []) : [];
    const localSnapshot = loadLocalRegulationSnapshot();
    const records = mergeRegulationRecords([...localSnapshot, ...stored]);
    const providerMode = ragProviderModeFromEnv();
    const baselineContext = rerankRegulationContext(records, question, 12);
    const baselineRecords = baselineContext.records;
    const retrieval = await runRagProvider<RegulationRetrieval, ReturnType<typeof compareRetrieval>>({
      mode: providerMode,
      baseline: async () => ({
        records: baselineRecords,
        canonicalIds: canonicalIds(baselineRecords),
        engine: "baseline"
      }),
      lightrag:
        providerMode === "baseline"
          ? undefined
          : async () => {
              if (stored.length || localSnapshot.length) throw new Error("LightRAG pilot index does not include the enriched regulation snapshot");
              const config = lightRagConfigFromEnv();
              if (!config) throw new Error("LIGHTRAG_BASE_URL is not configured");
              const result = await queryLightRag(config, { query: question, includeChunkContent: false });
              const matched = matchLightRagReferencesToRegulations(result.references, records, 8);
              if (!result.hasContext || !matched.length) {
                throw new Error("LightRAG returned no canonical regulation references");
              }
              return {
                records: matched,
                canonicalIds: canonicalIds(matched),
                engine: "lightrag",
                queryMode: result.queryMode,
                referenceCount: result.references.length,
                retrievalLatencyMs: result.clientLatencyMs
              };
            },
      compare: compareRetrieval
    });
    const answerContext = rerankRegulationContext(retrieval.value.records, question, 8);
    const scoreByCanonical = new Map(answerContext.diagnostics.topScores.map((entry) => [entry.canonicalKey, entry.score]));
    const trust = assessRegulationChatTrust(question, answerContext.records, { language, scoreByCanonical });
    if (trust.abstain) {
      return NextResponse.json({
        answer: chatAbstentionAnswer(language, trust),
        citations: answerContext.records.slice(0, 6),
        answerMeta: { abstained: true, matchedProvisions: [] },
        trust: { ...trust, validationStage: "preflight" },
        retrieval: {
          requestedProvider: retrieval.requestedMode,
          servedBy: retrieval.servedBy,
          fallbackUsed: retrieval.fallbackUsed,
          totalCorpus: records.length,
          resultCount: retrieval.value.records.length,
          canonicalIds: retrieval.value.canonicalIds,
          baseline: attemptTelemetry(retrieval.baseline),
          lightrag: attemptTelemetry(retrieval.lightrag),
          comparison: retrieval.comparison
        },
        reranking: answerContext.diagnostics,
        graphPaths: answerContext.graphPaths
      });
    }
    const workspace = await resolveWorkspaceScope(request, auth.session).catch(() => null);
    if (workspace && hasRemoteLlm(modelChoice)) await assertEnterpriseAiBudget(workspace.tenantId);
    const answer = hasRemoteLlm(modelChoice)
      ? await answerRegulationQuestion(
          question,
          language,
          answerContext.records,
          getActiveTierWorkProfile(resolveRequestTier(auth.session, request.headers.get(TIER_PREVIEW_HEADER))),
          modelChoice,
          await getManagedPrompt("regulationBot", language),
          answerContext
        )
      : (() => {
          const local = generateLocalRegulationAnswer(question, language, answerContext);
          const status = missingKeyStatus(language, modelChoice);
          return {
            answer: local.answer,
            // Keep the strongest sources in ranked order so the UI can show
            // the primary references before rendering the conversational answer.
            citations: answerContext.records.slice(0, 6),
            answerMeta: { abstained: local.abstained, matchedProvisions: local.matchedProvisions },
            llmStatus: { ...status, message: `${status.message} Reranker + graph evidence formatter applied.` }
          };
        })();
    if (workspace) {
      const history = createResearchWorkspaceRecord("history", {
        action: "chat", resourceType: "chat", resourceId: `regulation-chat-${Date.now()}`,
        title: question.slice(0, 180), query: question, responseExcerpt: answer.answer.slice(0, 12_000),
        metadata: { provider: retrieval.servedBy, sourceIds: canonicalIds(answerContext.records).slice(0, 12), trustScore: trust.score }
      }, { tenantId: workspace.tenantId, userId: workspace.userId, clientId: workspace.clientId, matterId: workspace.matterId });
      await saveResearchWorkspaceRecord("history", history).catch(() => undefined);
      await recordEnterpriseMetric({
        tenantId: workspace.tenantId,
        operation: "regulation_chat",
        provider: hasRemoteLlm(modelChoice) ? "openai" : "local",
        model: configuredModel(modelChoice),
        ok: true,
        latencyMs: Date.now() - startedAt,
        inputTokensEstimate: estimateTokens(question) + answerContext.records.length * 700,
        outputTokensEstimate: estimateTokens(answer.answer)
      }).catch(() => undefined);
    }
    return NextResponse.json({
      ...answer,
      trust: { ...trust, validationStage: "preflight" },
      retrieval: {
        requestedProvider: retrieval.requestedMode,
        servedBy: retrieval.servedBy,
        fallbackUsed: retrieval.fallbackUsed,
        totalCorpus: records.length,
        resultCount: retrieval.value.records.length,
        canonicalIds: retrieval.value.canonicalIds,
        queryMode: retrieval.value.queryMode,
        referenceCount: retrieval.value.referenceCount,
        retrievalLatencyMs: retrieval.value.retrievalLatencyMs,
        baseline: attemptTelemetry(retrieval.baseline),
        lightrag: attemptTelemetry(retrieval.lightrag),
        comparison: retrieval.comparison
      },
      reranking: answerContext.diagnostics,
      graphPaths: answerContext.graphPaths
    });
  } catch (error) {
    console.error("Regulation chat request failed", error);
    return NextResponse.json(
      {
        error:
          language === "id"
            ? "Layanan analisis peraturan sedang tidak tersedia. Silakan coba kembali."
            : "The regulation analysis service is temporarily unavailable. Please try again."
      },
      { status: 503 }
    );
  }
}
