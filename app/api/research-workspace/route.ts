import { NextResponse } from "next/server";
import { requireWorkspaceScope } from "@/lib/workspace-access";
import {
  createResearchWorkspaceRecord,
  updateResearchWorkspaceRecord,
  type ResearchWorkspaceEntity,
  type ResearchWorkspaceScope
} from "@/lib/research-workspace";
import {
  deleteResearchWorkspaceRecord,
  getResearchWorkspaceRecord,
  listResearchWorkspace,
  saveResearchWorkspaceRecord
} from "@/lib/research-workspace-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ENTITIES = new Set<ResearchWorkspaceEntity>(["folder", "saved-item", "highlight", "history"]);

function entityFrom(value: unknown): ResearchWorkspaceEntity {
  const entity = String(value || "") as ResearchWorkspaceEntity;
  if (!VALID_ENTITIES.has(entity)) throw new Error("entity must be folder, saved-item, highlight, or history.");
  return entity;
}

function researchScope(scope: {
  tenantId: string;
  userId: string;
  clientId?: string;
  matterId?: string;
}): ResearchWorkspaceScope {
  return { tenantId: scope.tenantId, userId: scope.userId, clientId: scope.clientId, matterId: scope.matterId };
}

export async function GET(request: Request) {
  const access = await requireWorkspaceScope(request);
  if ("response" in access) return access.response;
  try {
    const snapshot = await listResearchWorkspace(researchScope(access.scope));
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load research workspace." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const access = await requireWorkspaceScope(request, { write: true });
  if ("response" in access) return access.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const entity = entityFrom(body.entity);
    const record = createResearchWorkspaceRecord(entity, body, researchScope(access.scope));
    const persisted = await saveResearchWorkspaceRecord(entity, record);
    return NextResponse.json({ record: persisted }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save research item." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const access = await requireWorkspaceScope(request, { write: true });
  if ("response" in access) return access.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const entity = entityFrom(body.entity);
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
    const scope = researchScope(access.scope);
    const current = await getResearchWorkspaceRecord(entity, id, scope);
    if (!current) return NextResponse.json({ error: "Research item not found." }, { status: 404 });
    const record = updateResearchWorkspaceRecord(entity, current, body);
    const persisted = await saveResearchWorkspaceRecord(entity, record);
    return NextResponse.json({ record: persisted }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update research item." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const access = await requireWorkspaceScope(request, { write: true });
  if ("response" in access) return access.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const entity = entityFrom(body.entity);
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
    const removed = await deleteResearchWorkspaceRecord(entity, id, researchScope(access.scope));
    if (!removed) return NextResponse.json({ error: "Research item not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete research item." }, { status: 400 });
  }
}
