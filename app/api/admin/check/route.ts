import { NextResponse } from "next/server";
import type { SystemCheck } from "@/lib/admin";
import { countLegacyPlaintextUsers, getAdminTableCounts, hasDatabase } from "@/lib/db";
import { configuredModel, hasOpenAIKey } from "@/lib/openai";
import { hasExplicitAuthSecret, requireAuth } from "@/lib/auth";
import { PASSWORD_HASH_ALGORITHM } from "@/lib/password";

export const runtime = "nodejs";

function check(name: string, status: SystemCheck["status"], detail: string, metric?: string): SystemCheck {
  return { name, status, detail, metric };
}

export async function GET(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  const checks: SystemCheck[] = [
    check("Next.js API", "ok", "Server route is responding normally.", "online"),
    check(
      "OpenAI",
      hasOpenAIKey() ? "ok" : "warning",
      hasOpenAIKey() ? "OPENAI_API_KEY is configured for extraction, analysis, and chat." : "OPENAI_API_KEY is missing.",
      configuredModel()
    ),
    check(
      "Auth session secret",
      hasExplicitAuthSecret() ? "ok" : "warning",
      hasExplicitAuthSecret()
        ? "TDP_AUTH_SECRET/AUTH_SECRET is configured for signed login cookies."
        : "Set TDP_AUTH_SECRET in Vercel for production-grade cookie signing.",
      hasExplicitAuthSecret() ? "configured" : "local mode"
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
    checks.push(check("Database", "warning", "DATABASE_URL or POSTGRES_URL is not configured.", "local mode"));
  } else {
    try {
      counts = await getAdminTableCounts();
      const legacyPasswordUsers = await countLegacyPlaintextUsers();
      checks.push(
        check(
          "Database",
          "ok",
          "Database schema is reachable for decisions, reports, regulations, users, and logs.",
          `${counts.decisions || 0} decisions`
        ),
        check(
          "Password hashing",
          legacyPasswordUsers === 0 ? "ok" : "warning",
          legacyPasswordUsers === 0
            ? `User passwords are stored with ${PASSWORD_HASH_ALGORITHM}.`
            : `${legacyPasswordUsers} legacy plaintext user password(s) still need migration.`,
          legacyPasswordUsers === 0 ? "hashed" : `${legacyPasswordUsers} legacy`
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
