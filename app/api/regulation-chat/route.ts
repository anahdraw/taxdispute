import { NextResponse } from "next/server";
import { hasDatabase, listTaxRegulations } from "@/lib/db";
import { answerRegulationQuestion } from "@/lib/openai";
import { mergeRegulationRecords, chooseRegulationContext } from "@/lib/regulation-knowledge";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
  try {
    const body = (await request.json()) as { question?: string; language?: "id" | "en"; topic?: string };
    const question = (body.question || "").trim();
    const language = body.language === "id" ? "id" : "en";
    if (!question) {
      return NextResponse.json({ error: language === "id" ? "Pertanyaan belum diisi." : "Question is required." }, { status: 400 });
    }
    const stored = hasDatabase() ? await listTaxRegulations().catch(() => []) : [];
    const records = mergeRegulationRecords(stored);
    return NextResponse.json(await answerRegulationQuestion(question, language, chooseRegulationContext(records, question, body.topic)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid regulation chat request" },
      { status: 400 }
    );
  }
}
