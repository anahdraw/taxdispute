import { NextResponse } from "next/server";
import { buildAnalysis, type AnalyzeInput } from "@/lib/analyze";
import { buildLlmAnalysis } from "@/lib/openai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as AnalyzeInput;
    const localAnalysis = buildAnalysis(input);
    return NextResponse.json(await buildLlmAnalysis(input, localAnalysis));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid analysis request" },
      { status: 400 }
    );
  }
}
