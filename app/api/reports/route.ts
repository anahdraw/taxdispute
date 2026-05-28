import { NextResponse } from "next/server";
import { deleteTaxReport, hasDatabase, listTaxReports, upsertTaxReport } from "@/lib/db";
import { buildStoredReport, type StoredReport } from "@/lib/stored-reports";

export const runtime = "nodejs";

export async function GET() {
  if (!hasDatabase()) return NextResponse.json({ records: [] });
  const records = await listTaxReports().catch(() => []);
  return NextResponse.json({ records });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const report = ("report" in body ? body.report : body) as Partial<StoredReport>;
    const normalized =
      report.id && report.input && report.analysis
        ? (report as StoredReport)
        : buildStoredReport({
            input: body.input,
            extraction: body.extraction || null,
            analysis: body.analysis,
            language: body.language === "id" ? "id" : "en"
          });

    if (!hasDatabase()) {
      return NextResponse.json({ report: normalized, records: [], warning: "Database is not configured." });
    }

    await upsertTaxReport(normalized);
    const records = await listTaxReports();
    return NextResponse.json({ report: normalized, records });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save report." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as Partial<StoredReport>;
    if (!body.id) {
      return NextResponse.json({ error: "Report id is required." }, { status: 400 });
    }
    if (hasDatabase()) {
      await deleteTaxReport(body.id);
      const records = await listTaxReports().catch(() => []);
      return NextResponse.json({ records });
    }
    return NextResponse.json({ records: [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete report." },
      { status: 500 }
    );
  }
}

