import { NextResponse } from "next/server";
import { configuredModel, hasOpenAIKey } from "@/lib/openai";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "tax-dispute-simple-advisor",
    runtime: "nextjs",
    openaiConfigured: hasOpenAIKey(),
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    databaseConfigured: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
    model: configuredModel(),
    note: "Next.js deployment is active. Streamlit prototype files remain preserved in the repository."
  });
}
