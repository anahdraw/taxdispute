import { NextResponse } from "next/server";
import { hasDatabase, listTaxRegulations, upsertTaxRegulations } from "@/lib/db";
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<Regulation>;
    const title = String(body.title || "").trim();
    const citation = String(body.citation || "").trim();
    const focus = String(body.focus || body.content || "").trim();
    if (!title || !citation || !focus) {
      return NextResponse.json({ error: "Title, citation, and focus are required." }, { status: 400 });
    }
    const topic = normalizeRegulationTopic(body.topic);
    const record: Regulation = {
      id:
        body.id ||
        `manual-${topic}-${title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60)}`,
      topic,
      title,
      citation,
      focus,
      relevance: Math.max(1, Math.min(100, Number(body.relevance || 75))),
      source: "manual",
      sourceUrl: String(body.sourceUrl || "").trim(),
      content: String(body.content || "").trim(),
      updatedAt: new Date().toISOString()
    };

    if (hasDatabase()) {
      await upsertTaxRegulations([record]);
    }

    const stored = await getStoredRegulations();
    return NextResponse.json({ ok: true, record, records: mergeRegulationRecords([...stored, record, ...regulations]) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save regulation." },
      { status: 500 }
    );
  }
}
