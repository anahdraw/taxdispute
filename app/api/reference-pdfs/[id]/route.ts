import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOK_ID = "buku-praktis-pajak-2025";

function configuredBookPath() {
  return String(process.env.TDP_BOOK_PDF_PATH || "/Users/sintzu/Downloads/Buku-Saku-Pajak-Cover-revisi-2.pdf").trim();
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (id !== BOOK_ID) return NextResponse.json({ error: "Reference PDF not found." }, { status: 404 });
  const filePath = path.resolve(configuredBookPath());
  try {
    const bytes = await fs.readFile(filePath);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": "inline; filename=\"Buku-Praktis-Pajak-2025.pdf\"",
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch {
    return NextResponse.json({ error: "Reference PDF is not configured on this server." }, { status: 404 });
  }
}
