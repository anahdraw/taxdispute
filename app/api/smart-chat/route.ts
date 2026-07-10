import { NextResponse } from "next/server";
import { hasDatabase, listDecisionDocuments, listTaxRegulations } from "@/lib/db";
import { regulations as seedRegulations } from "@/lib/mock-data";
import { mergeRegulationRecords } from "@/lib/regulation-knowledge";
import { answerSmartChat, type SmartChatSourceMode } from "@/lib/smart-chat";
import { requireAuth } from "@/lib/auth";
import { getActiveTierWorkProfile } from "@/lib/tier-profiles";
import { modelChoiceFromRequest } from "@/lib/model-options";

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
    const regulationRecords = mergeRegulationRecords([...seedRegulations, ...storedRegulations]);

    return NextResponse.json(
      await answerSmartChat({
        question,
        language,
        documents,
        regulations: regulationRecords,
        mode,
        tierProfile: getActiveTierWorkProfile(auth.session.tier),
        modelChoice
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid smart chat request" },
      { status: 400 }
    );
  }
}
