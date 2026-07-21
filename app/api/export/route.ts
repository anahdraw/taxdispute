import { NextResponse } from "next/server";
import { buildReportDocx, buildReportPdf, type ReportPayload } from "@/lib/report";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
  try {
    const body = (await request.json()) as ReportPayload & { format?: "docx" | "pdf" };
    const format = body.format === "pdf" ? "pdf" : "docx";
    const bytes = format === "pdf" ? await buildReportPdf(body) : await buildReportDocx(body);
    const responseBody = new Uint8Array(bytes);
    const contentType =
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const filename = `alpha-ai-jurist-report.${format}`;
    return new Response(responseBody, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Report export failed." },
      { status: 500 }
    );
  }
}
