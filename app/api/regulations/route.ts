import { NextResponse } from "next/server";
import {
  deleteTaxRegulation,
  getTaxRegulationById,
  hasDatabase,
  listTaxRegulationSummaries,
  listTaxRegulations,
  upsertTaxRegulations
} from "@/lib/db";
import { regulations, type Regulation } from "@/lib/mock-data";
import { mergeRegulationRecords, normalizeRegulationTopic } from "@/lib/regulation-knowledge";
import { requireAuth, requireFeature } from "@/lib/auth";
import { buildPaginationMeta, parsePaginationParams } from "@/lib/pagination";

export const runtime = "nodejs";

async function getStoredRegulations() {
  if (!hasDatabase()) return [];
  try {
    return await listTaxRegulations();
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const auth = requireFeature(request, "regulationRead");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const record =
      (hasDatabase() ? await getTaxRegulationById(id).catch(() => null) : null) || regulations.find((item) => item.id === id) || null;
    if (!record) return NextResponse.json({ error: "Regulation not found." }, { status: 404 });
    return NextResponse.json({ record });
  }

  if (url.searchParams.get("detail") === "full") {
    const stored = await getStoredRegulations();
    const records = mergeRegulationRecords(stored);
    return NextResponse.json({
      records,
      pagination: buildPaginationMeta({ page: 1, perPage: records.length || 1, offset: 0 }, records.length)
    });
  }

  const params = parsePaginationParams(request.url, { perPage: 25, maxPerPage: 500 });
  const allParams = { page: 1, perPage: 500, offset: 0 };
  const stored = hasDatabase() ? await listTaxRegulationSummaries(allParams).catch(() => []) : [];
  const merged = mergeRegulationRecords(stored);
  const records = merged.slice(params.offset, params.offset + params.perPage);
  return NextResponse.json({ records, pagination: buildPaginationMeta(params, merged.length) });
}

function slugPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function normalizeRegulationRecord(body: Partial<Regulation>, index = 0): Regulation {
  const title = String(body.title || "").trim();
  const citation = String(body.citation || "").trim();
  const focus = String(body.focus || body.content || "").trim();
  if (!title || !citation || !focus) {
    throw new Error("Title, citation, and focus are required.");
  }
  const topic = normalizeRegulationTopic(body.topic);
  const source =
    body.source === "ortax" ? "ortax" : body.source === "seed" ? "seed" : body.source === "official" ? "official" : "manual";
  return {
    id: String(body.id || `manual-${topic}-${slugPart(`${citation}-${title}`) || `rule-${index + 1}`}`),
    topic,
    title,
    citation,
    focus,
    relevance: Math.max(1, Math.min(100, Number(body.relevance || 75))),
    source,
    sourceUrl: String(body.sourceUrl || "").trim(),
    pdfUrl: String(body.pdfUrl || "").trim(),
    content: String(body.content || "").trim(),
    updatedAt: new Date().toISOString()
  };
}

export async function POST(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  try {
    const body = (await request.json()) as Partial<Regulation> & { records?: Partial<Regulation>[] };
    const incoming = Array.isArray(body.records) ? body.records : [body];
    const records = incoming.map((item, index) => normalizeRegulationRecord(item, index));

    if (hasDatabase()) {
      await upsertTaxRegulations(records);
    }

    const stored = await getStoredRegulations();
    const recordsForResponse = mergeRegulationRecords([...stored, ...records, ...regulations]);
    return NextResponse.json({
      ok: true,
      record: records[0],
      imported: records.length,
      records: recordsForResponse,
      pagination: buildPaginationMeta({ page: 1, perPage: recordsForResponse.length || 1, offset: 0 }, recordsForResponse.length)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save regulation." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  try {
    const body = (await request.json()) as { id?: string };
    const id = String(body.id || "").trim();
    if (!id) {
      return NextResponse.json({ error: "Regulation id is required." }, { status: 400 });
    }

    if (hasDatabase()) {
      await deleteTaxRegulation(id);
    }

    const stored = await getStoredRegulations();
    const records = mergeRegulationRecords(stored);
    return NextResponse.json({
      ok: true,
      records,
      pagination: buildPaginationMeta({ page: 1, perPage: records.length || 1, offset: 0 }, records.length)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete regulation." },
      { status: 500 }
    );
  }
}
