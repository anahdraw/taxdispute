import { NextResponse } from "next/server";
import {
  countTaxReports,
  deleteTaxReport,
  getTaxReportById,
  hasDatabase,
  listTaxReportSummaries,
  listTaxReports,
  upsertTaxReport
} from "@/lib/db";
import { buildStoredReport, type StoredReport } from "@/lib/stored-reports";
import { requireAuth } from "@/lib/auth";
import { buildPaginationMeta, parsePaginationParams } from "@/lib/pagination";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
  if (!hasDatabase()) return NextResponse.json({ records: [] });
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const record = await getTaxReportById(id).catch(() => null);
    if (!record) return NextResponse.json({ error: "Report not found." }, { status: 404 });
    return NextResponse.json({ record });
  }
  if (url.searchParams.get("detail") === "full") {
    const records = await listTaxReports().catch(() => []);
    return NextResponse.json({
      records,
      pagination: buildPaginationMeta({ page: 1, perPage: records.length || 1, offset: 0 }, records.length)
    });
  }
  const params = parsePaginationParams(request.url, { perPage: 25, maxPerPage: 200 });
  const [records, total] = await Promise.all([listTaxReportSummaries(params).catch(() => []), countTaxReports().catch(() => 0)]);
  return NextResponse.json({ records, pagination: buildPaginationMeta(params, total) });
}

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
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
    const params = { page: 1, perPage: 25, offset: 0 };
    const [records, total] = await Promise.all([listTaxReportSummaries(params), countTaxReports()]);
    return NextResponse.json({ report: normalized, records, pagination: buildPaginationMeta(params, total) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save report." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
  try {
    const body = (await request.json()) as Partial<StoredReport>;
    if (!body.id) {
      return NextResponse.json({ error: "Report id is required." }, { status: 400 });
    }
    if (hasDatabase()) {
      await deleteTaxReport(body.id);
      const params = { page: 1, perPage: 25, offset: 0 };
      const [records, total] = await Promise.all([listTaxReportSummaries(params).catch(() => []), countTaxReports().catch(() => 0)]);
      return NextResponse.json({ records, pagination: buildPaginationMeta(params, total) });
    }
    return NextResponse.json({ records: [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete report." },
      { status: 500 }
    );
  }
}
