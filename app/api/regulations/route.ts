import { NextResponse } from "next/server";
import { deleteTaxRegulation, hasDatabase, listTaxRegulations, upsertTaxRegulations } from "@/lib/db";
import { regulations, type Regulation } from "@/lib/mock-data";
import { mergeRegulationRecords, normalizeRegulationTopic } from "@/lib/regulation-knowledge";

export const runtime = "nodejs";

async function getStoredRegulations() {
  if (!hasDatabase()) return [];
  try {
    return await listTaxRegulations();
  } catch {
    return [];
  }
}

export async function GET() {
  const stored = await getStoredRegulations();
  return NextResponse.json({ records: mergeRegulationRecords(stored) });
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
  const source = body.source === "ortax" ? "ortax" : body.source === "seed" ? "seed" : "manual";
  return {
    id: String(body.id || `manual-${topic}-${slugPart(`${citation}-${title}`) || `rule-${index + 1}`}`),
    topic,
    title,
    citation,
    focus,
    relevance: Math.max(1, Math.min(100, Number(body.relevance || 75))),
    source,
    sourceUrl: String(body.sourceUrl || "").trim(),
    content: String(body.content || "").trim(),
    updatedAt: new Date().toISOString()
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<Regulation> & { records?: Partial<Regulation>[] };
    const incoming = Array.isArray(body.records) ? body.records : [body];
    const records = incoming.map((item, index) => normalizeRegulationRecord(item, index));

    if (hasDatabase()) {
      await upsertTaxRegulations(records);
    }

    const stored = await getStoredRegulations();
    return NextResponse.json({
      ok: true,
      record: records[0],
      imported: records.length,
      records: mergeRegulationRecords([...stored, ...records, ...regulations])
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save regulation." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
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
    return NextResponse.json({ ok: true, records: mergeRegulationRecords(stored) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete regulation." },
      { status: 500 }
    );
  }
}
