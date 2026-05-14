import { NextResponse } from "next/server";
import { answerRegulationQuestion } from "@/lib/openai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { question?: string; language?: "id" | "en" };
    const question = (body.question || "").trim();
    const language = body.language === "id" ? "id" : "en";
    if (!question) {
      return NextResponse.json({ error: language === "id" ? "Pertanyaan belum diisi." : "Question is required." }, { status: 400 });
    }
    return NextResponse.json(await answerRegulationQuestion(question, language));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid regulation chat request" },
      { status: 400 }
    );
  }
}
