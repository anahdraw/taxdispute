"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { WatchlistSnapshot } from "@/lib/watchlist";
import { readActiveWorkspaceContext, type ActiveWorkspaceContext } from "@/lib/workspace-client-context";

const EMPTY: WatchlistSnapshot = { rules: [], alerts: [], unread: 0 };

function query(context: ActiveWorkspaceContext | null) {
  if (!context) return "";
  const params = new URLSearchParams({ tenantId: context.tenantId });
  if (context.clientId) params.set("clientId", context.clientId);
  if (context.matterId) params.set("matterId", context.matterId);
  return `?${params}`;
}

function date(value: string) { try { return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); } catch { return value; } }

export function WatchlistClient() {
  const [context, setContext] = useState<ActiveWorkspaceContext | null>(null);
  const [data, setData] = useState(EMPTY);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [citation, setCitation] = useState("");
  const [keywordText, setKeywordText] = useState("");
  const [status, setStatus] = useState("Memuat watchlist...");
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/watchlist${query(context)}`;

  async function reload(nextEndpoint = endpoint) {
    const response = await fetch(nextEndpoint, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Watchlist tidak dapat dimuat.");
    setData(payload as WatchlistSnapshot); setStatus("");
  }

  useEffect(() => { const active = readActiveWorkspaceContext(); const initialEndpoint = `/api/watchlist${query(active)}`; setContext(active); void (async () => {
    try {
      await reload(initialEndpoint);
      await fetch(initialEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
      await reload(initialEndpoint);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Watchlist tidak dapat dimuat."); }
  })(); /* bootstrap once */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Perubahan watchlist gagal.");
      await reload(); return payload;
    } finally { setBusy(false); }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      await post({ name, topic: topic || undefined, citation: citation || undefined, keywords: keywordText.split(",").map((item) => item.trim()).filter(Boolean), frequency: "daily" });
      setName(""); setTopic(""); setCitation(""); setKeywordText(""); setStatus("Watchlist dibuat dengan baseline sumber saat ini.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Watchlist gagal dibuat."); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Gagal menghapus."); await reload();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Gagal menghapus."); } finally { setBusy(false); }
  }

  return <div className="watchlist-layout">
    <section className="watchlist-card watchlist-create">
      <div><span className="case-detail-kicker">Tambah pemantauan</span><h2>Aturan, topik, atau kata kunci</h2></div>
      <form onSubmit={create}>
        <label>Nama watchlist<input maxLength={180} onChange={(event) => setName(event.target.value)} placeholder="Contoh: Perubahan aturan PPh 21" required value={name} /></label>
        <label>Topik<select onChange={(event) => setTopic(event.target.value)} value={topic}><option value="">Semua topik</option><option value="vat">PPN</option><option value="income_tax">PPh</option><option value="transfer_pricing">Transfer pricing</option><option value="general">Umum</option></select></label>
        <label>Sitasi spesifik<input maxLength={500} onChange={(event) => setCitation(event.target.value)} placeholder="Mis. PMK 168 Tahun 2023" value={citation} /></label>
        <label>Kata kunci<input maxLength={800} onChange={(event) => setKeywordText(event.target.value)} placeholder="pegawai tetap, TER, PPh 21" value={keywordText} /></label>
        <button disabled={busy} type="submit">Buat watchlist</button>
      </form>
      {status && <p role="status">{status}</p>}
    </section>
    <section className="watchlist-card watchlist-rules">
      <header><div><span className="case-detail-kicker">Subscriptions</span><h2>{data.rules.length} watchlist aktif</h2></div><button disabled={busy} onClick={() => void post({ action: "sync" }).then((payload) => setStatus(`${payload.created?.length || 0} alert baru dibuat.`)).catch((error) => setStatus(error instanceof Error ? error.message : "Sinkronisasi gagal."))} type="button">Periksa pembaruan</button></header>
      {data.rules.map((rule) => <article key={rule.id}><div><h3>{rule.name}</h3><p>{[rule.citation, rule.topic, rule.keywords.join(", ")].filter(Boolean).join(" · ")}</p><small>Terakhir diperiksa: {rule.lastCheckedAt ? date(rule.lastCheckedAt) : "belum pernah"} · {rule.frequency}</small></div><button disabled={busy} onClick={() => void remove(rule.id)} type="button">Hapus</button></article>)}
      {!data.rules.length && <p>Belum ada sumber atau topik yang dipantau.</p>}
    </section>
    <section className="watchlist-card watchlist-alerts">
      <header><div><span className="case-detail-kicker">Alerts</span><h2>{data.unread} belum dibaca</h2></div></header>
      {data.alerts.map((alert) => <article className={`${alert.severity} ${alert.acknowledgedAt ? "read" : ""}`} key={alert.id}><div><span>{alert.type} · {date(alert.createdAt)}</span><h3>{alert.title}</h3><p>{alert.message}</p><a href={`/sources/regulation/${encodeURIComponent(alert.resourceId)}`}>{alert.citation} ↗</a></div>{!alert.acknowledgedAt && <button disabled={busy} onClick={() => void post({ action: "acknowledge", id: alert.id })} type="button">Tandai dibaca</button>}</article>)}
      {!data.alerts.length && <p>Belum ada perubahan sejak baseline watchlist dibuat.</p>}
    </section>
  </div>;
}
