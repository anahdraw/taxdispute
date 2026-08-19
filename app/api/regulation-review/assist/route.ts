import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { buildReviewAiSuggestion } from "@/lib/regulation-review-ai";
import { reviewItem, type ReviewKind } from "@/lib/regulation-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;

  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Request body harus berupa object.");
    const kind = String(body.kind || "") as ReviewKind;
    const id = String(body.id || "").trim();
    if (!["node", "edge", "citation", "queue"].includes(kind) || !id) return errorResponse("kind dan id review wajib diisi.");

    const item = await reviewItem(kind, id);
    if (!item) return errorResponse("Item review tidak ditemukan atau bukan bagian dari queue.", 404);
    const result = await buildReviewAiSuggestion(item, modelChoiceFromRequest(request));
    return NextResponse.json({ item, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("regulation review AI assist failed", error);
    return errorResponse("Saran AI tidak dapat dibuat. Periksa koneksi model dan coba lagi.", 502);
  }
}
