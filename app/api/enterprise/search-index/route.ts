import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { resolveWorkspaceScope } from "@/lib/workspace-access";
import { loadSearchStore } from "@/lib/search-store";
import { buildPersistentHybridIndex, compactSearchProjection, persistentIndexFreshness, readPersistentHybridIndex, writePersistentHybridIndex } from "@/lib/persistent-hybrid-index";
import { enqueueEnterpriseJob, finishEnterpriseJob, claimEnterpriseJob } from "@/lib/enterprise-job-queue";
import type { AppSession } from "@/lib/auth";
import type { WorkspaceScope } from "@/lib/workspace";

export const runtime = "nodejs";

async function context(request: Request): Promise<{ response: NextResponse } | { session: AppSession; scope: WorkspaceScope }> {
  const auth = requireAuth(request, ["admin"]);
  if (auth.response) return { response: auth.response };
  const scope = await resolveWorkspaceScope(request, auth.session);
  if (!scope) return { response: NextResponse.json({ error: "Workspace scope is required." }, { status: 403 }) };
  return { session: auth.session, scope };
}

async function corpus(tenantId: string) {
  return loadSearchStore({ tenantId, wantsDecisions: true, wantsRegulations: true, includeLegacyDatabaseDecisions: true, mode: "local" });
}

export async function GET(request: Request) {
  const access = await context(request); if ("response" in access) return access.response;
  const [store, index] = await Promise.all([corpus(access.scope.tenantId), readPersistentHybridIndex(access.scope.tenantId)]);
  const projection = compactSearchProjection(store.documents);
  const freshness = index ? persistentIndexFreshness(index, projection) : null;
  return NextResponse.json({ index: index ? { schema: index.schema, builtAt: index.builtAt, documentCount: index.documentCount, corpusHash: index.corpusHash, embeddingDimensions: index.embeddingDimensions } : null, freshness, source: store.diagnostics }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const access = await context(request); if ("response" in access) return access.response;
  const job = await enqueueEnterpriseJob({ tenantId: access.scope.tenantId, type: "search_reindex", payload: { source: "local", requestedBy: access.session.sub }, idempotencyKey: `search-reindex-${Date.now()}` });
  const worker = `inline-${process.pid}`;
  const claimed = await claimEnterpriseJob(worker, ["search_reindex"], 600);
  if (!claimed || claimed.id !== job.id) return NextResponse.json({ job, queued: true }, { status: 202 });
  try {
    const store = await corpus(access.scope.tenantId);
    const index = buildPersistentHybridIndex(compactSearchProjection(store.documents), access.scope.tenantId);
    const target = await writePersistentHybridIndex(index);
    const completed = await finishEnterpriseJob(job.id, worker, { documentCount: index.documentCount, corpusHash: index.corpusHash });
    return NextResponse.json({ job: completed, index: { builtAt: index.builtAt, documentCount: index.documentCount, corpusHash: index.corpusHash, embeddingDimensions: index.embeddingDimensions }, targetStoredLocally: Boolean(target) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not build persistent search index.", jobId: job.id }, { status: 500 });
  }
}
