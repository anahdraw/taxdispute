import { NextResponse } from "next/server";
import { configuredModel, hasOpenAIKey } from "@/lib/openai";
import { hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

function payload() {
  return {
    ok: true,
    service: "tax-dispute-agentic-advisor",
    runtime: "nextjs",
    openaiConfigured: hasOpenAIKey(),
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    databaseConfigured: hasDatabase(),
    model: configuredModel(),
    note: "Next.js deployment is active.",
    checkedAt: new Date().toISOString()
  };
}

function statusPill(ok: boolean) {
  return `<span class="pill ${ok ? "ok" : "warn"}">${ok ? "Configured" : "Needs setup"}</span>`;
}

function htmlHealth(data: ReturnType<typeof payload>) {
  const cards = [
    ["OpenAI", data.openaiConfigured, "LLM extraction, analysis, and chatbot"],
    ["Vercel Blob", data.blobConfigured, "Decision PDF storage and document links"],
    ["Database", data.databaseConfigured, "Saved decisions, reports, regulations, users, and logs"],
    ["Runtime", true, `${data.runtime} · ${data.model}`]
  ]
    .map(
      ([name, ok, detail]) => `
        <article class="card">
          <div>
            <span class="eyebrow">${name}</span>
            <h2>${ok ? "Ready" : "Attention required"}</h2>
          </div>
          ${statusPill(Boolean(ok))}
          <p>${detail}</p>
        </article>`
    )
    .join("");

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>RSM Tax Dispute Agentic Advisor - API Health</title>
      <style>
        :root {
          --rsm-blue: #009cde;
          --rsm-green: #43a047;
          --rsm-gray: #54585a;
          --ink: #2f3340;
          --muted: #667085;
          --line: #d7dde3;
          --soft: #f4f7f9;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          min-height: 100vh;
          background: linear-gradient(180deg, #fff 0%, var(--soft) 100%);
          color: var(--ink);
          font: 16px/1.55 "Segoe UI", Arial, Helvetica, sans-serif;
        }
        main {
          width: min(1120px, calc(100% - 40px));
          margin: 0 auto;
          padding: 42px 0 56px;
        }
        .rsm-mark {
          display: grid;
          grid-template-columns: 20px 58px 150px;
          grid-template-rows: 14px auto;
          align-items: end;
          gap: 9px 10px;
          width: 240px;
          margin-bottom: 32px;
        }
        .rsm-mark span { display: block; height: 14px; }
        .rsm-mark strong {
          grid-column: 1 / -1;
          color: var(--rsm-gray);
          font-size: 3.35rem;
          line-height: .94;
          letter-spacing: 0;
        }
        .gray { background: #8a8f93; }
        .green { background: var(--rsm-green); }
        .blue { background: var(--rsm-blue); }
        header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 24px;
          align-items: end;
          margin-bottom: 28px;
        }
        h1 {
          margin: 0;
          color: var(--rsm-gray);
          font-size: clamp(2.2rem, 5vw, 4.2rem);
          line-height: 1.02;
          letter-spacing: 0;
        }
        .lead {
          max-width: 720px;
          margin: 16px 0 0;
          color: var(--muted);
          font-size: 1.08rem;
        }
        .status {
          border-left: 5px solid var(--rsm-green);
          border-radius: 8px;
          background: #edf8ef;
          padding: 16px 18px;
          font-weight: 800;
          color: var(--rsm-gray);
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin: 24px 0;
        }
        .card {
          min-height: 170px;
          border: 1px solid var(--line);
          border-top: 5px solid var(--rsm-blue);
          border-radius: 8px;
          background: rgba(255,255,255,.96);
          padding: 18px;
          box-shadow: 0 12px 28px rgba(84, 88, 90, .08);
        }
        .card:nth-child(2) { border-top-color: var(--rsm-green); }
        .card:nth-child(3), .card:nth-child(4) { border-top-color: var(--rsm-gray); }
        .eyebrow {
          color: var(--muted);
          font-size: .78rem;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .04em;
        }
        h2 {
          margin: 7px 0 12px;
          font-size: 1.28rem;
          line-height: 1.2;
        }
        .card p {
          margin: 12px 0 0;
          color: var(--muted);
          font-size: .92rem;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          border-radius: 999px;
          padding: 0 11px;
          font-size: .8rem;
          font-weight: 900;
        }
        .pill.ok { background: #edf8ef; color: #2e7d32; }
        .pill.warn { background: #fff7ed; color: #9a3412; }
        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 28px;
        }
        a {
          display: inline-flex;
          align-items: center;
          min-height: 42px;
          border: 1px solid rgba(0,156,222,.25);
          border-radius: 8px;
          background: #eef9fd;
          color: #006f9f;
          font-weight: 850;
          padding: 0 14px;
          text-decoration: none;
        }
        a.primary {
          border-color: transparent;
          background: var(--rsm-green);
          color: #fff;
        }
        .meta {
          margin-top: 18px;
          color: var(--muted);
          font-size: .88rem;
        }
        @media (max-width: 860px) {
          header { grid-template-columns: 1fr; }
          .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 560px) {
          main { width: min(100% - 24px, 1120px); padding-top: 24px; }
          .grid { grid-template-columns: 1fr; }
          h1 { font-size: 2.2rem; }
        }
      </style>
    </head>
    <body>
      <main>
        <div class="rsm-mark" aria-label="RSM">
          <span class="gray"></span><span class="green"></span><span class="blue"></span><strong>RSM</strong>
        </div>
        <header>
          <div>
            <h1>API Health Check</h1>
            <p class="lead">Status halaman server untuk RSM Tax Dispute Agentic Advisor. Gunakan ini untuk memastikan service utama siap sebelum ekstraksi, RAG chatbot, dan report generation.</p>
          </div>
          <div class="status">Deployment active</div>
        </header>
        <section class="grid">${cards}</section>
        <div class="actions">
          <a class="primary" href="/">Back to app</a>
          <a href="/api/health?format=json">View raw JSON</a>
          <a href="/api/admin/check">Admin API check JSON</a>
        </div>
        <p class="meta">Checked at ${new Date(data.checkedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} Jakarta time.</p>
      </main>
    </body>
  </html>`;
}

export function GET(request: Request) {
  const data = payload();
  const url = new URL(request.url);
  const accept = request.headers.get("accept") || "";
  if (url.searchParams.get("format") === "json" || (accept.includes("application/json") && !accept.includes("text/html"))) {
    return NextResponse.json(data);
  }
  return new Response(htmlHealth(data), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
