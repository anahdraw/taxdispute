import { NextResponse } from "next/server";
import { configuredModel, hasOpenAIKey } from "@/lib/openai";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "tax-dispute-simple-advisor",
    runtime: "nextjs",
    openaiConfigured: hasOpenAIKey(),
    model: configuredModel(),
    note: "Next.js deployment is active. Streamlit prototype files remain preserved in the repository."
  });
}
