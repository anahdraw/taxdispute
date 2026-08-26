import { NextResponse } from "next/server";
import { mergeRegulationRecords } from "@/lib/regulation-knowledge";
import { loadLocalRegulationSnapshot } from "@/lib/regulation-snapshot";
import type { ResearchWorkspaceScope } from "@/lib/research-workspace";
import { createWatchRule } from "@/lib/watchlist";
import { acknowledgeAlert, deleteWatchRule, listWatchlist, saveWatchRule, syncWatchlist } from "@/lib/watchlist-store";
import { requireWorkspaceScope } from "@/lib/workspace-access";
import { tierHasFeature } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scopeOf(value: { tenantId: string; userId: string; clientId?: string; matterId?: string }): ResearchWorkspaceScope {
  return { tenantId: value.tenantId, userId: value.userId, clientId: value.clientId, matterId: value.matterId };
}

function records() { return mergeRegulationRecords(loadLocalRegulationSnapshot()); }

function regulationEntitlement(access: { session: { role: string; tier: Parameters<typeof tierHasFeature>[0] } }) {
  return access.session.role === "admin" || tierHasFeature(access.session.tier, "regulationRead")
    ? null
    : NextResponse.json({ error: "Paket akun ini belum mencakup pemantauan peraturan." }, { status: 403 });
}

export async function GET(request: Request) {
  const access = await requireWorkspaceScope(request);
  if ("response" in access) return access.response;
  const entitlement = regulationEntitlement(access); if (entitlement) return entitlement;
  try {
    return NextResponse.json(await listWatchlist(scopeOf(access.scope)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Watchlist tidak dapat dimuat." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const access = await requireWorkspaceScope(request, { write: true });
  if ("response" in access) return access.response;
  const entitlement = regulationEntitlement(access); if (entitlement) return entitlement;
  try {
    const raw = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Body harus berupa object JSON.");
    const body = raw as Record<string, unknown>;
    const scope = scopeOf(access.scope);
    if (body.action === "sync") return NextResponse.json(await syncWatchlist(scope, records()), { headers: { "Cache-Control": "private, no-store" } });
    if (body.action === "acknowledge") {
      const ok = await acknowledgeAlert(scope, String(body.id || ""));
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Alert tidak ditemukan." }, { status: 404 });
    }
    const rule = createWatchRule(body, scope);
    return NextResponse.json({ rule: await saveWatchRule(rule, records()) }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Watchlist tidak dapat disimpan." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const access = await requireWorkspaceScope(request, { write: true });
  if ("response" in access) return access.response;
  const entitlement = regulationEntitlement(access); if (entitlement) return entitlement;
  try {
    const body = await request.json() as Record<string, unknown>;
    const ok = await deleteWatchRule(scopeOf(access.scope), String(body.id || ""));
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Watchlist tidak ditemukan." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Watchlist tidak dapat dihapus." }, { status: 400 });
  }
}
