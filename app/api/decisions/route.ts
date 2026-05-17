import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { deleteDecisionDocument, hasDatabase, listDecisionDocuments, upsertDecisionDocument } from "@/lib/db";
import type { StoredDecisionFile } from "@/lib/stored-decisions";

export const runtime = "nodejs";

export async function GET() {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "DATABASE_URL or POSTGRES_URL is not configured.", records: [] }, { status: 503 });
  }
  try {
    const records = await listDecisionDocuments();
    return NextResponse.json({ records });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not list decision documents.", records: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "DATABASE_URL or POSTGRES_URL is not configured." }, { status: 503 });
  }
  try {
    const body = (await request.json()) as StoredDecisionFile;
    if (!body.id || !body.filename || !body.pathname || !body.url) {
      return NextResponse.json({ error: "Missing required decision document fields." }, { status: 400 });
    }
    await upsertDecisionDocument({
      id: body.id,
      filename: body.filename,
      pathname: body.pathname,
      url: body.url,
      downloadUrl: body.downloadUrl || body.url,
      size: Number(body.size || 0),
      uploadedAt: body.uploadedAt || new Date().toISOString(),
      status: body.status === "failed" ? "failed" : body.status === "extracted" ? "extracted" : "uploaded",
      extraction: body.extraction || null
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save decision document." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as Partial<StoredDecisionFile>;
    if (!body.id) {
      return NextResponse.json({ error: "Missing decision document id." }, { status: 400 });
    }

    let blobWarning = "";
    const blobTarget = body.url || body.downloadUrl || body.pathname || "";
    if (blobTarget && process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        await del(blobTarget);
      } catch (error) {
        blobWarning = error instanceof Error ? error.message : "Blob delete failed.";
      }
    }

    if (hasDatabase()) {
      await deleteDecisionDocument(body.id);
    }

    return NextResponse.json({ ok: true, blobWarning });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete decision document." },
      { status: 500 }
    );
  }
}
