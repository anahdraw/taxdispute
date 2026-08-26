import { NextResponse } from "next/server";
import { processNextTpAgentRun } from "@/lib/tp-agent-worker";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized TP agent worker." }, { status: 401 });
  try {
    return NextResponse.json(await processNextTpAgentRun({ leaseSeconds: 600 }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "TP agent worker failed." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
