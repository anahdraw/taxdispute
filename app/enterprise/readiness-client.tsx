"use client";

import { useState } from "react";

type Capability = { key: string; label: string; status: "ready_local" | "ready_production" | "partial" | "gap"; evidence: string; nextGap?: string };
type Readiness = { generatedAt: string; capabilities: Capability[]; usage: { requests: number; estimatedCostUsd: number; budgetUsd: number; warning: boolean }; queue: Record<string, number>; lightRagManifest: { documentCount: number; corpusHash: string; citationReadyCount: number; graphRelationCount: number } | null };

const labels = { ready_local: "Siap lokal", ready_production: "Siap produksi", partial: "Parsial", gap: "Gap" };

export function EnterpriseReadinessClient({ initial }: { initial: Readiness }) {
  const [data, setData] = useState(initial); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function refresh() { const response = await fetch("/api/enterprise/readiness", { cache: "no-store" }); if (response.ok) setData(await response.json()); }
  async function rebuildSearch() { setBusy(true); setMessage("Membangun indeks persisten…"); try { const response = await fetch("/api/enterprise/search-index", { method: "POST" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Rebuild gagal"); setMessage(`Indeks selesai: ${payload.index?.documentCount || 0} dokumen.`); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Rebuild gagal."); } finally { setBusy(false); } }
  return <section className="enterprise-console">
    <header><div><span>Snapshot {new Date(data.generatedAt).toLocaleString("id-ID")}</span><h2>Kontrol kesiapan</h2></div><div><button onClick={refresh}>Muat ulang</button><button className="primary" disabled={busy} onClick={rebuildSearch}>{busy ? "Memproses…" : "Bangun ulang search"}</button></div></header>
    {message && <p className="enterprise-message">{message}</p>}
    <div className="enterprise-summary"><article><span>LightRAG manifest</span><b>{data.lightRagManifest?.documentCount || 0}</b><small>dokumen, bukan indeks aktif</small></article><article><span>Citation-ready</span><b>{data.lightRagManifest?.citationReadyCount || 0}</b><small>memiliki hash, locator, status</small></article><article><span>Queue lokal</span><b>{data.queue.queued || 0}</b><small>queued · {data.queue.dead_letter || 0} dead-letter</small></article><article><span>AI cost estimate</span><b>US$ {data.usage.estimatedCostUsd.toFixed(4)}</b><small>{data.usage.budgetUsd ? `budget US$ ${data.usage.budgetUsd}` : "budget belum diisi"}</small></article></div>
    <div className="enterprise-capabilities">{data.capabilities.map((capability) => <article key={capability.key} className={capability.status}><header><h3>{capability.label}</h3><b>{labels[capability.status]}</b></header><p>{capability.evidence}</p>{capability.nextGap && <details><summary>Gap produksi berikutnya</summary><p>{capability.nextGap}</p></details>}</article>)}</div>
    <footer><a href="/api/enterprise/readiness">JSON readiness</a><a href="/api/enterprise/search-index">Status indeks</a><a href="/api/enterprise/jobs">Daftar job</a></footer>
  </section>;
}
