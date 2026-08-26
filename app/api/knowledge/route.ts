import path from "node:path";
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import {
  buildKnowledgeHub,
  queryKnowledgeHub,
  type KnowledgeDomain,
  type KnowledgeEvidenceStatus,
  type KnowledgeHub
} from "@/lib/knowledge-hub";
import { loadLocalRegulationSnapshot } from "@/lib/regulation-snapshot";
import { loadRegulationGraphSnapshot } from "@/lib/regulation-timeline";
import { loadOfficialKnowledgeChunks, loadOfficialKnowledgeSnapshot } from "@/lib/official-knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const domains = new Set<KnowledgeDomain>(["treaty", "guides", "manual", "changes", "glossary", "forms", "rates"]);
const statuses = new Set<KnowledgeEvidenceStatus>(["verified", "review_required", "reference_only"]);

let cache: { signature: string; hub: KnowledgeHub } | null = null;

function getHub() {
  const configured = process.env.TDP_LOCAL_REGULATION_SNAPSHOT || path.resolve("data/regulation-pipeline-import/next-regulations.jsonl.gz");
  const records = loadLocalRegulationSnapshot(configured);
  const graph = loadRegulationGraphSnapshot();
  const official = loadOfficialKnowledgeSnapshot();
  const chunks = loadOfficialKnowledgeChunks();
  const signature = `${records.length}:${graph.edges?.length || 0}:${records.at(-1)?.updatedAt || ""}:${official.stamp}:${chunks.stamp}`;
  if (cache?.signature === signature) return cache.hub;
  const hub = buildKnowledgeHub(records, graph, official.items, chunks.chunks);
  cache = { signature, hub };
  return hub;
}

export async function GET(request: Request) {
  const auth = await requireFeature(request, "regulationRead");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const requestedDomain = url.searchParams.get("domain") || "all";
  const requestedStatus = url.searchParams.get("status") || "";
  if (requestedDomain !== "all" && !domains.has(requestedDomain as KnowledgeDomain)) {
    return NextResponse.json({ error: "Domain pengetahuan tidak valid." }, { status: 400 });
  }
  if (requestedStatus && !statuses.has(requestedStatus as KnowledgeEvidenceStatus)) {
    return NextResponse.json({ error: "Status bukti tidak valid." }, { status: 400 });
  }
  const hub = getHub();
  const result = queryKnowledgeHub(hub, {
    domain: requestedDomain as KnowledgeDomain | "all",
    subtype: url.searchParams.get("subtype") || undefined,
    status: requestedStatus as KnowledgeEvidenceStatus || undefined,
    query: url.searchParams.get("q") || "",
    limit: Number(url.searchParams.get("limit") || 20),
    offset: Number(url.searchParams.get("offset") || 0)
  });
  return NextResponse.json({
    ...result,
    generatedAt: hub.generatedAt,
    totals: hub.totals,
    readiness: hub.readiness,
    connectors: hub.connectors
  }, { headers: { "Cache-Control": "private, no-store" } });
}
