import { NextResponse } from "next/server";
import { tierHasFeature } from "@/lib/admin";
import { navigatePrecedents, type MatterScope } from "@/lib/dispute-workbench";
import {
  addWorkbenchTask,
  createWorkbenchEvidence,
  decideWorkbenchApproval,
  deleteWorkbenchEntity,
  generateWorkbenchDraft,
  getDisputeWorkbench,
  requestWorkbenchApproval,
  reviewWorkbenchCalculation,
  runWorkbenchCalculation,
  selectWorkbenchPrecedent,
  syncWorkbenchImpacts,
  updateWorkbenchEvidence,
  updateWorkbenchImpact,
  updateWorkbenchTask,
  updateWorkbenchWorkflow
} from "@/lib/dispute-workbench-store";
import type { ResearchWorkspaceScope } from "@/lib/research-workspace";
import { listWatchlist } from "@/lib/watchlist-store";
import { requireWorkspaceScope } from "@/lib/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scopeOf(scope: { tenantId: string; clientId?: string; matterId?: string; userId: string }): MatterScope {
  if (!scope.clientId || !scope.matterId) throw new Error("Client dan matter wajib dipilih.");
  return { tenantId: scope.tenantId, clientId: scope.clientId, matterId: scope.matterId, userId: scope.userId };
}

function researchScope(scope: MatterScope): ResearchWorkspaceScope { return { tenantId: scope.tenantId, clientId: scope.clientId, matterId: scope.matterId, userId: scope.userId }; }
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }

export async function GET(request: Request) {
  const access = await requireWorkspaceScope(request, { requireClient: true, requireMatter: true });
  if ("response" in access) return access.response;
  try {
    const scope = scopeOf(access.scope); const snapshot = await getDisputeWorkbench(scope);
    const query = new URL(request.url).searchParams.get("q") || "";
    const precedentAllowed = access.session.role === "admin" || tierHasFeature(access.session.tier, "databaseRead");
    return json({ snapshot, precedent: query && precedentAllowed ? navigatePrecedents(query, snapshot.precedents, 12) : null, capabilities: { precedent: precedentAllowed, approval: ["owner", "admin"].includes(access.scope.membershipRole) || access.scope.matterRole === "lead" } });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Dispute Workbench tidak dapat dimuat." }, 500); }
}

export async function POST(request: Request) {
  const access = await requireWorkspaceScope(request, { write: true, requireClient: true, requireMatter: true });
  if ("response" in access) return access.response;
  try {
    const raw = await request.json(); if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Body harus berupa object JSON.");
    const body = raw as Record<string, unknown>; const action = String(body.action || ""); const scope = scopeOf(access.scope);
    let snapshot;
    if (action === "evidence.create") snapshot = await createWorkbenchEvidence(scope, body);
    else if (action === "evidence.update") snapshot = await updateWorkbenchEvidence(scope, body);
    else if (action === "precedent.select") {
      if (access.session.role !== "admin" && !tierHasFeature(access.session.tier, "databaseRead")) return json({ error: "Paket akun belum mencakup riset putusan." }, 403);
      snapshot = await selectWorkbenchPrecedent(scope, body);
    }
    else if (action === "calculation.run") snapshot = await runWorkbenchCalculation(scope, body);
    else if (action === "calculation.review") snapshot = await reviewWorkbenchCalculation(scope, String(body.id || ""), body.reviewed !== false);
    else if (action === "draft.generate") snapshot = await generateWorkbenchDraft(scope, body);
    else if (action === "impact.sync") { const watchlist = await listWatchlist(researchScope(scope)); snapshot = await syncWorkbenchImpacts(scope, watchlist.alerts); }
    else if (action === "impact.update") snapshot = await updateWorkbenchImpact(scope, body);
    else if (action === "workflow.update") snapshot = await updateWorkbenchWorkflow(scope, body);
    else if (action === "task.create") snapshot = await addWorkbenchTask(scope, body);
    else if (action === "task.update") snapshot = await updateWorkbenchTask(scope, body);
    else if (action === "approval.request") snapshot = await requestWorkbenchApproval(scope, body);
    else if (action === "approval.decide") snapshot = await decideWorkbenchApproval(scope, body, ["owner", "admin"].includes(access.scope.membershipRole) || access.scope.matterRole === "lead");
    else if (action === "delete") snapshot = await deleteWorkbenchEntity(scope, String(body.entity || ""), String(body.id || ""));
    else throw new Error("Aksi Dispute Workbench tidak dikenal.");
    return json({ snapshot });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Perubahan Dispute Workbench gagal." }, 400); }
}
