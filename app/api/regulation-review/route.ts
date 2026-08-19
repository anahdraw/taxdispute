import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { REVIEW_STATUSES, reviewItems, reviewSummary, saveReviewDecision, type ReviewKind, type ReviewStatus } from "@/lib/regulation-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function validKind(value: string | null): ReviewKind | "all" | undefined {
  if (!value || value === "all") return value === "all" ? "all" : undefined;
  return ["node", "edge", "citation", "queue"].includes(value) ? value as ReviewKind : undefined;
}

export async function GET(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  try {
    if (url.searchParams.get("view") === "summary") return NextResponse.json(await reviewSummary(), { headers: { "Cache-Control": "private, no-store" } });
    const rawKind = url.searchParams.get("kind");
    const kind = validKind(rawKind);
    if (rawKind && kind === undefined) return jsonError("kind must be all, node, edge, citation, or queue.");
    const result = await reviewItems({
      kind,
      query: url.searchParams.get("q") || "",
      flag: url.searchParams.get("flag") || "",
      severity: url.searchParams.get("severity") || "",
      status: url.searchParams.get("status") || "",
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 50)
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("regulation review GET failed", error);
    return jsonError("Review data tidak dapat dimuat.", 500);
  }
}

export async function POST(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("Request body harus berupa object.");
    const kind = String(body.kind || "");
    const id = String(body.id || "").trim();
    const status = String(body.status || "") as ReviewStatus;
    if (!["node", "edge", "citation", "queue"].includes(kind) || !id) return jsonError("kind dan id wajib diisi.");
    if (!REVIEW_STATUSES.includes(status)) return jsonError("Status review tidak valid.");
    const decision = await saveReviewDecision({ kind: kind as ReviewKind, id, status, note: body.note, reviewer: auth.session.name });
    return NextResponse.json({ decision }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("regulation review POST failed", error);
    return jsonError("Status review tidak dapat disimpan.", 500);
  }
}
