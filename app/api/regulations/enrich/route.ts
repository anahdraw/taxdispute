import { NextResponse } from "next/server";
import { hasDatabase, listTaxRegulations, upsertTaxRegulations } from "@/lib/db";
import { enrichRegulation } from "@/lib/regulation-enrichment";
import { regulations, type Regulation } from "@/lib/mock-data";
import { mergeRegulationRecords, normalizeRegulationTopic } from "@/lib/regulation-knowledge";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

async function storedRegulations() {
  if (!hasDatabase()) return [];
  return listTaxRegulations().catch(() => []);
}

function selectTargets(records: Regulation[], body: { id?: string; ids?: string[]; topic?: string; limit?: number }) {
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : body.id ? [String(body.id)] : [];
  const limit = Math.max(1, Math.min(30, Number(body.limit || (ids.length ? ids.length : 12))));
  if (ids.length) {
    const idSet = new Set(ids);
    return records.filter((item) => idSet.has(item.id)).slice(0, limit);
  }
  const topic = body.topic ? normalizeRegulationTopic(body.topic) : null;
  return records
    .filter((item) => (!topic || (item.topic || "general") === topic) && /^https?:\/\//i.test(item.sourceUrl || ""))
    .slice(0, limit);
}

export async function POST(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  try {
    const body = (await request.json()) as { id?: string; ids?: string[]; topic?: string; limit?: number };
    const stored = await storedRegulations();
    const allRecords = mergeRegulationRecords([...stored, ...regulations]);
    const targets = selectTargets(allRecords, body);
    if (!targets.length) {
      return NextResponse.json({ ok: false, error: "No regulation with a source URL was found.", records: allRecords }, { status: 400 });
    }

    const results = await Promise.all(targets.map((record) => enrichRegulation(record)));
    const enrichedRecords = results.filter((item) => item.enriched).map((item) => item.record);
    if (hasDatabase() && enrichedRecords.length) {
      await upsertTaxRegulations(enrichedRecords);
    }

    const refreshed = await storedRegulations();
    return NextResponse.json({
      ok: true,
      requested: targets.length,
      enriched: enrichedRecords.length,
      skipped: results.length - enrichedRecords.length,
      results: results.map((item) => ({ id: item.record.id, title: item.record.title, enriched: item.enriched, message: item.message })),
      records: mergeRegulationRecords([...refreshed, ...enrichedRecords])
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not enrich regulation sources." },
      { status: 500 }
    );
  }
}
