import { NextResponse } from "next/server";
import { hasDatabase, listTaxRegulations, upsertTaxRegulations } from "@/lib/db";
import type { Regulation } from "@/lib/mock-data";
import { buildOrtaxRegulationSeeds, mergeRegulationRecords, normalizeRegulationTopic } from "@/lib/regulation-knowledge";

export const runtime = "nodejs";

function cleanTitle(value: string) {
  return value.replace(/\s+/g, " ").replace(/&amp;/g, "&").trim();
}

async function probeOrtaxSource(record: Regulation): Promise<Regulation> {
  if (!record.sourceUrl?.startsWith("https://datacenter.ortax.org")) return record;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(record.sourceUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "RSM-Tax-Dispute-Prototype/1.0"
      }
    });
    const text = await response.text();
    const title = cleanTitle(text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] || "");
    const statusNote = response.ok
      ? `Ortax source checked${title ? `: ${title}` : ""}.`
      : `Ortax source returned HTTP ${response.status}.`;
    return {
      ...record,
      content: [record.content, statusNote].filter(Boolean).join("\n"),
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      ...record,
      content: [
        record.content,
        `Ortax source could not be checked during this update: ${error instanceof Error ? error.message : "network timeout"}.`
      ]
        .filter(Boolean)
        .join("\n"),
      updatedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { topic?: string };
    const topic = normalizeRegulationTopic(body.topic);
    const seeds = buildOrtaxRegulationSeeds(topic);
    const records = await Promise.all(seeds.map((record) => probeOrtaxSource(record)));

    if (hasDatabase()) {
      await upsertTaxRegulations(records);
    }

    const stored = hasDatabase() ? await listTaxRegulations().catch(() => []) : [];
    return NextResponse.json({
      ok: true,
      topic,
      imported: records.length,
      records: mergeRegulationRecords([...stored, ...records])
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update Ortax regulations." },
      { status: 500 }
    );
  }
}
