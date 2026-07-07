import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  return NextResponse.json({
    authenticated: Boolean(session),
    session: session
      ? {
          role: session.role,
          name: session.name,
          username: session.username
        }
      : null
  });
}
