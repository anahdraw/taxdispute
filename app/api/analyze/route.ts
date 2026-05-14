import { NextResponse } from "next/server";
import { buildAnalysis, type AnalyzeInput } from "@/lib/analyze";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as AnalyzeInput;
    return NextResponse.json(buildAnalysis(input));
  } catch {
    return NextResponse.json({ error: "Invalid analysis request" }, { status: 400 });
  }
}
