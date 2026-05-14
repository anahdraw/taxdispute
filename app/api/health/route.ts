import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "tax-dispute-simple-advisor",
    runtime: "nextjs",
    note: "Next.js deployment is active. Streamlit prototype files remain preserved in the repository."
  });
}
