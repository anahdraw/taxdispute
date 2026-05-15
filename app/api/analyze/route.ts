import { NextResponse } from "next/server";
import { buildAnalysis, type AnalyzeInput } from "@/lib/analyze";
import type { ExtractionResult } from "@/lib/extraction";
import { buildLlmAnalysis } from "@/lib/openai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = ("input" in body ? body.input : body) as AnalyzeInput;
    const extraction = ("extraction" in body ? body.extraction : null) as ExtractionResult | null;
    const localAnalysis = buildAnalysis(input);
    return NextResponse.json(await buildLlmAnalysis(input, localAnalysis, extraction));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid analysis request" },
      { status: 400 }
    );
  }
}
