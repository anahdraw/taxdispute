import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import {
  countTpLocalFileProjects,
  getTpLocalFileProjectById,
  hasDatabase,
  listTpLocalFileProjectSummaries,
  upsertTpLocalFileProject
} from "@/lib/db";
import { buildPaginationMeta, parsePaginationParams } from "@/lib/pagination";
import { emptyTpProjectState, type TpLocalFileProject } from "@/lib/tp-local-file";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireFeature(request, "tpLocalFile");
  if ("response" in auth) return auth.response;
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured.", records: [] }, { status: 503 });
  try {
    const params = parsePaginationParams(request.url, { perPage: 12, maxPerPage: 100 });
    const owner = auth.session.role === "admin" ? undefined : auth.session.username;
    const [records, total] = await Promise.all([
      listTpLocalFileProjectSummaries(params, owner),
      countTpLocalFileProjects(owner)
    ]);
    return NextResponse.json({ records, pagination: buildPaginationMeta(params, total) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not list TP projects.", records: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireFeature(request, "tpLocalFile");
  if ("response" in auth) return auth.response;
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  try {
    const body = await request.json().catch(() => ({}));
    const now = new Date().toISOString();
    const name = String(body.name || "New TP Local File").trim().slice(0, 180) || "New TP Local File";
    const project: TpLocalFileProject = {
      id: `tp-${randomUUID()}`,
      ownerUsername: auth.session.username,
      name,
      status: "draft",
      state: emptyTpProjectState(),
      documents: [],
      createdAt: now,
      updatedAt: now
    };
    await upsertTpLocalFileProject(project);
    const storedProject = await getTpLocalFileProjectById(project.id);
    if (!storedProject) throw new Error("The TP project was created but could not be reloaded.");
    return NextResponse.json({ project: storedProject }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create TP project." }, { status: 400 });
  }
}
