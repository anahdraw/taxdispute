import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { resolveWorkspaceScope } from "@/lib/workspace-access";
import { enqueueEnterpriseJob, listEnterpriseJobs, type EnterpriseJobType } from "@/lib/enterprise-job-queue";
import type { AppSession } from "@/lib/auth";
import type { WorkspaceScope } from "@/lib/workspace";

export const runtime = "nodejs";
const allowed = new Set<EnterpriseJobType>(["lightrag_export", "lightrag_ingest", "retention_scan", "backup", "alert_sync", "search_reindex"]);
async function access(request: Request): Promise<{ response: NextResponse } | { session: AppSession; scope: WorkspaceScope }> { const auth = requireAuth(request, ["admin"]); if (auth.response) return { response: auth.response }; const scope = await resolveWorkspaceScope(request, auth.session); return scope ? { session: auth.session, scope } : { response: NextResponse.json({ error: "Workspace scope is required." }, { status: 403 }) }; }
export async function GET(request: Request) { const result = await access(request); if ("response" in result) return result.response; return NextResponse.json({ jobs: await listEnterpriseJobs(result.scope.tenantId) }, { headers: { "Cache-Control": "private, no-store" } }); }
export async function POST(request: Request) { const result = await access(request); if ("response" in result) return result.response; const body = await request.json().catch(() => null) as { type?: EnterpriseJobType; payload?: Record<string, unknown>; idempotencyKey?: string } | null; if (!body?.type || !allowed.has(body.type)) return NextResponse.json({ error: "Unsupported enterprise job type." }, { status: 400 }); const job = await enqueueEnterpriseJob({ tenantId: result.scope.tenantId, type: body.type, payload: body.payload, idempotencyKey: body.idempotencyKey }); return NextResponse.json({ job }, { status: 202, headers: { "Cache-Control": "private, no-store" } }); }
