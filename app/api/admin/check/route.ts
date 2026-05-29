import { NextResponse } from "next/server";
import type { SystemCheck } from "@/lib/admin";
import { getAdminTableCounts, hasDatabase } from "@/lib/db";
import { configuredModel, hasOpenAIKey } from "@/lib/openai";

export const runtime = "nodejs";

function check(name: string, status: SystemCheck["status"], detail: string, metric?: string): SystemCheck {
  return { name, status, detail, metric };
}

export async function GET() {
  const checks: SystemCheck[] = [
    check("Next.js API", "ok", "Server route is responding normally.", "online"),
    check(
      "OpenAI",
      hasOpenAIKey() ? "ok" : "warning",
      hasOpenAIKey() ? "OPENAI_API_KEY is configured for extraction, analysis, and chat." : "OPENAI_API_KEY is missing.",
      configuredModel()
    ),
    check(
      "Vercel Blob",
      process.env.BLOB_READ_WRITE_TOKEN ? "ok" : "warning",
      process.env.BLOB_READ_WRITE_TOKEN ? "Blob token is configured for PDF upload/storage." : "BLOB_READ_WRITE_TOKEN is missing.",
      process.env.BLOB_READ_WRITE_TOKEN ? "configured" : "not configured"
    )
  ];

  let counts: Record<string, number> = {};
  if (!hasDatabase()) {
    checks.push(check("Database", "warning", "DATABASE_URL or POSTGRES_URL is not configured.", "browser fallback"));
  } else {
    try {
      counts = await getAdminTableCounts();
      checks.push(
        check(
          "Database",
          "ok",
          "Database schema is reachable for decisions, reports, regulations, users, and logs.",
          `${counts.decisions || 0} decisions`
        )
      );
    } catch (error) {
      checks.push(
        check(
          "Database",
          "error",
          error instanceof Error ? error.message : "Database connection failed.",
          "error"
        )
      );
    }
  }

  const ok = checks.every((item) => item.status !== "error");
  return NextResponse.json({
    ok,
    generatedAt: new Date().toISOString(),
    service: "tax-dispute-agentic-advisor",
    runtime: "nextjs",
    model: configuredModel(),
    checks,
    counts
  });
}
