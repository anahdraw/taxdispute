"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReviewItem, ReviewKind, ReviewStatus } from "@/lib/regulation-review";
import { LLM_MODEL_HEADER, type LlmModelChoice } from "@/lib/model-options";
import type { ReviewAiSuggestion } from "@/lib/regulation-review-ai";

type Summary = {
  qualityGate: string;
  counts: { nodes: number; edges: number; citations: number; queue: number };
  flagCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  summary: Record<string, any>;
};

type ItemsPayload = { rows: ReviewItem[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
type AiPayload = {
  suggestion: ReviewAiSuggestion;
  llmStatus: { used: boolean; model: string; message: string };
  guardrail: string;
};
const statuses: ReviewStatus[] = ["Not Started", "In Review", "Verified", "Rejected", "Needs Source"];
const tabs: Array<{ key: ReviewKind | "all"; label: string; countKey?: keyof Summary["counts"] }> = [
  { key: "all", label: "Semua" }, { key: "node", label: "Node", countKey: "nodes" }, { key: "edge", label: "Edge", countKey: "edges" }, { key: "citation", label: "Citation", countKey: "citations" }, { key: "queue", label: "Queue", countKey: "queue" }
];

function label(value: string) { return value.replaceAll("_", " "); }
function safeUrl(value?: string) { return value && /^https?:\/\//i.test(value) ? value : ""; }
function formatDate(value?: string) { return value ? new Date(value).toLocaleString("id-ID") : "—"; }

export function RegulationReviewClient({ reviewer }: { reviewer: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [kind, setKind] = useState<ReviewKind | "all">("all");
  const [query, setQuery] = useState("");
  const [flag, setFlag] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ItemsPayload>({ rows: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } });
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiPayload, setAiPayload] = useState<AiPayload | null>(null);
  const [aiMode, setAiMode] = useState<LlmModelChoice>("local-rules");
  const [statusMessage, setStatusMessage] = useState("Memuat quality report lokal...");

  useEffect(() => {
    void fetch("/api/regulation-review?view=summary", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Summary gagal dimuat.");
      setSummary(payload); setStatusMessage("Quality report siap. Pilih item untuk mulai review.");
    }).catch((error) => setStatusMessage(error instanceof Error ? error.message : "Summary gagal dimuat."));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ kind, page: String(page), pageSize: "50" });
    if (query.trim()) params.set("q", query.trim());
    if (flag) params.set("flag", flag);
    if (severity) params.set("severity", severity);
    if (status) params.set("status", status);
    void fetch(`/api/regulation-review?${params}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Daftar review gagal dimuat.");
      setItems(payload); setSelected((current) => current && payload.rows.some((row: ReviewItem) => row.key === current.key) ? current : payload.rows[0] || null);
    }).catch((error) => setStatusMessage(error instanceof Error ? error.message : "Daftar review gagal dimuat."));
  }, [kind, query, flag, severity, status, page]);

  useEffect(() => { setNote(selected?.decision.note || ""); setAiPayload(null); setAiError(""); }, [selected]);

  async function requestAiAssist() {
    if (!selected) return;
    setAiBusy(true); setAiError(""); setStatusMessage("AI sedang membaca flags dan evidence item...");
    try {
      const response = await fetch("/api/regulation-review/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json", [LLM_MODEL_HEADER]: aiMode },
        body: JSON.stringify({ kind: selected.kind, id: selected.id })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Saran AI gagal dibuat.");
      setAiPayload(payload); setStatusMessage(payload.llmStatus?.used ? "Saran AI siap diverifikasi." : "Saran triage lokal siap; pilih mode AI bila ingin analisis model.");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Saran AI gagal dibuat.");
      setStatusMessage("Saran AI gagal dibuat. Keputusan manual tetap tersedia.");
    } finally { setAiBusy(false); }
  }

  function applyAiSuggestion(save = false) {
    if (!selected || !aiPayload) return;
    const suggestion = aiPayload.suggestion;
    const aiNote = `[AI ${Math.round(suggestion.confidence * 100)}%] ${suggestion.summary}\nLangkah: ${suggestion.recommendedAction}`;
    const mergedNote = note ? `${note}\n\n${aiNote}`.slice(0, 4000) : aiNote.slice(0, 4000);
    setSelected((current) => current ? { ...current, decision: { ...current.decision, status: suggestion.suggestedStatus } } : current);
    setNote(mergedNote);
    if (save) void saveDecision(suggestion.suggestedStatus, mergedNote);
  }

  async function saveDecision(statusOverride?: ReviewStatus, noteOverride?: string) {
    if (!selected) return;
    setBusy(true); setStatusMessage("Menyimpan keputusan review...");
    try {
      const response = await fetch("/api/regulation-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: selected.kind, id: selected.id, status: statusOverride || selected.decision.status, note: noteOverride || note }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Keputusan tidak dapat disimpan.");
      const nextDecision = payload.decision;
      setItems((current) => ({ ...current, rows: current.rows.map((row) => row.key === selected.key ? { ...row, decision: nextDecision } : row) }));
      setSelected((current) => current ? { ...current, decision: nextDecision } : current);
      setStatusMessage(`Tersimpan oleh ${reviewer} pada ${formatDate(nextDecision.updatedAt)}.`);
      void fetch("/api/regulation-review?view=summary", { cache: "no-store" }).then((response) => response.json()).then(setSummary).catch(() => undefined);
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Keputusan tidak dapat disimpan."); }
    finally { setBusy(false); }
  }

  function goToNext() {
    if (!selected || !items.rows.length) return;
    const currentIndex = items.rows.findIndex((row) => row.key === selected.key);
    setSelected(items.rows[(currentIndex + 1) % items.rows.length] || items.rows[0]);
  }

  const reviewedCount = useMemo(() => Object.entries(summary?.statusCounts || {}).filter(([status]) => status !== "Not Started").reduce((sum, [, count]) => sum + count, 0), [summary]);
  const totalReviewCount = useMemo(() => Object.values(summary?.counts || {}).reduce((sum, count) => sum + count, 0), [summary]);
  const progress = totalReviewCount ? Math.round((reviewedCount / totalReviewCount) * 100) : 0;

  const flags = useMemo(() => Object.entries(summary?.flagCounts || {}).sort((a, b) => b[1] - a[1]), [summary]);
  const selectedUrl = safeUrl(selected?.sourceUrl);
  return (
    <>
      <section className="regulation-review-kpis">
        <article><span>Quality gate</span><strong className="review-risk">{summary?.qualityGate || "—"}</strong><small>Evidence graph belum boleh auto-publish</small></article>
        <article><span>Flagged nodes</span><strong>{summary?.counts.nodes.toLocaleString("id-ID") || "—"}</strong><small>Identity/status review</small></article>
        <article><span>Flagged edges</span><strong>{summary?.counts.edges.toLocaleString("id-ID") || "—"}</strong><small>Relasi belum answer-eligible</small></article>
        <article><span>Flagged citations</span><strong>{summary?.counts.citations.toLocaleString("id-ID") || "—"}</strong><small>Target/self/unparsed references</small></article>
        <article className="review-progress-kpi"><span>Progress pegawai</span><strong>{progress}%</strong><div className="review-progress-track"><i style={{ width: `${progress}%` }} /></div><small>{reviewedCount.toLocaleString("id-ID")} dari {totalReviewCount.toLocaleString("id-ID")} item punya keputusan</small></article>
      </section>

      <section className="regulation-review-toolbar">
        <div className="review-tabs">{tabs.map((tab) => <button className={kind === tab.key ? "active" : ""} key={tab.key} onClick={() => { setKind(tab.key); setPage(1); }} type="button">{tab.label}{tab.countKey && summary ? ` · ${summary.counts[tab.countKey].toLocaleString("id-ID")}` : ""}</button>)}</div>
        <div className="review-filters">
          <input aria-label="Cari review" onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Cari ID, canonical, evidence..." value={query} />
          <select aria-label="Filter flag" onChange={(event) => { setFlag(event.target.value); setPage(1); }} value={flag}><option value="">Semua flag</option>{flags.map(([name, count]) => <option key={name} value={name}>{label(name)} · {count.toLocaleString("id-ID")}</option>)}</select>
          <select aria-label="Filter severity" onChange={(event) => { setSeverity(event.target.value); setPage(1); }} value={severity}><option value="">Semua severity</option><option value="High">High</option><option value="Medium">Medium</option></select>
          <select aria-label="Filter status" onChange={(event) => { setStatus(event.target.value); setPage(1); }} value={status}><option value="">Semua status</option>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        </div>
        <div className="review-operator-guide"><strong>Alur cepat:</strong> pilih item → minta saran AI → cek evidence → terapkan saran → simpan → lanjut ke item berikutnya.</div>
        <p className="review-status" role="status">{statusMessage}</p>
      </section>

      <section className="regulation-review-workbench">
        <div className="review-list-panel">
          <div className="review-list-heading"><div><span className="case-detail-kicker">Review queue</span><h2>{items.pagination.total.toLocaleString("id-ID")} item</h2></div><span>Halaman {items.pagination.page} / {items.pagination.totalPages}</span></div>
          <div className="review-list">{items.rows.map((item) => <button className={`review-list-item ${selected?.key === item.key ? "selected" : ""}`} key={item.key} onClick={() => setSelected(item)} type="button"><div><span className={`review-chip ${item.severity.toLowerCase()}`}>{item.severity}</span><span className="review-kind">{item.kind}</span><strong>{item.canonical || item.id}</strong></div><p>{label(item.flags[0] || "review_required")} · {item.source || "—"} {item.target ? `→ ${item.target}` : ""}</p><small>{item.title || item.raw || item.context || item.evidence || "Tidak ada ringkasan."}</small><em className={`review-status-pill status-${item.decision.status.toLowerCase().replaceAll(" ", "-")}`}>{item.decision.status}</em></button>)}{!items.rows.length && <div className="review-empty">Tidak ada item untuk filter ini.</div>}</div>
          <div className="review-pagination"><button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">← Sebelumnya</button><button disabled={page >= items.pagination.totalPages} onClick={() => setPage((current) => Math.min(items.pagination.totalPages, current + 1))} type="button">Berikutnya →</button></div>
        </div>

        <aside className="review-detail-panel">{selected ? <>
          <div className="review-detail-heading"><div><span className="case-detail-kicker">{selected.kind} detail</span><h2>{selected.canonical || selected.id}</h2></div><span className={`review-chip ${selected.severity.toLowerCase()}`}>{selected.severity}</span></div>
          <div className="review-detail-meta"><span>ID: {selected.id}</span><span>Source: {selected.source || "—"}</span><span>Type: {selected.type || "—"}</span>{selected.target && <span>Target: {selected.target}</span>}</div>
          <div className="review-flags">{selected.flags.map((flagValue) => <span key={flagValue}>{label(flagValue)}</span>)}</div>
          {selected.title && <section><h3>Title</h3><p>{selected.title}</p></section>}
          {selected.raw && <section><h3>Raw reference</h3><p>{selected.raw}</p></section>}
          {(selected.evidence || selected.context) && <section><h3>Evidence / context</h3><p className="review-evidence">{selected.evidence || selected.context}</p></section>}
          {selectedUrl && <p><a href={selectedUrl} rel="noreferrer" target="_blank">Buka sumber resmi ↗</a></p>}

          <section className="review-ai-card">
            <div className="review-ai-heading"><div><span className="case-detail-kicker">AI review assistant</span><h3>Saran triage berbasis evidence</h3></div><span className={`review-ai-connection ${aiPayload?.llmStatus.used ? "connected" : "local"}`}>{aiPayload?.llmStatus.used ? "AI terhubung" : "Local fallback"}</span></div>
            <p className="review-ai-help">AI hanya membaca item ini. Ia tidak dapat mengesahkan sumber dan tidak boleh menggantikan keputusan pegawai.</p>
            <div className="review-ai-controls"><label>Mode AI<select value={aiMode} onChange={(event) => setAiMode(event.target.value as LlmModelChoice)}><option value="local-rules">Local triage (hemat)</option><option value="openai-nano">Nano (cepat)</option><option value="openai-mini">Mini (lebih mendalam)</option><option value="local-onprem">On-prem (private)</option></select></label><button className="secondary-button" disabled={aiBusy} onClick={() => void requestAiAssist()} type="button">{aiBusy ? "Menganalisis..." : aiPayload ? "Analisis ulang" : "Minta saran AI"}</button></div>
            {aiError && <p className="review-ai-error" role="alert">{aiError}</p>}
            {aiPayload && <div className="review-ai-result"><div className="review-ai-result-top"><span className="review-ai-status">Saran: {aiPayload.suggestion.suggestedStatus}</span><span>Confidence {Math.round(aiPayload.suggestion.confidence * 100)}%</span></div><p>{aiPayload.suggestion.summary}</p><strong>Langkah berikutnya</strong><p>{aiPayload.suggestion.recommendedAction}</p><div className="review-ai-columns"><div><strong>Checklist</strong><ul>{aiPayload.suggestion.checks.map((check) => <li key={check}>{check}</li>)}</ul></div><div><strong>Risiko / pertanyaan</strong><ul>{[...aiPayload.suggestion.risks, ...aiPayload.suggestion.questions].slice(0, 6).map((risk) => <li key={risk}>{risk}</li>)}</ul></div></div><small>{aiPayload.llmStatus.message} {aiPayload.guardrail}</small><div className="review-ai-actions"><button className="secondary-button" onClick={() => applyAiSuggestion(false)} type="button">Terapkan ke form</button><button className="primary-button" disabled={busy} onClick={() => applyAiSuggestion(true)} type="button">Terapkan &amp; simpan</button></div></div>}
          </section>

          <section className="review-decision-box"><div className="review-decision-heading"><h3>Keputusan reviewer</h3><button className="text-button" onClick={goToNext} type="button">Item berikutnya →</button></div><select value={selected.decision.status} onChange={(event) => setSelected((current) => current ? { ...current, decision: { ...current.decision, status: event.target.value as ReviewStatus } } : current)}>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select><textarea maxLength={4000} onChange={(event) => setNote(event.target.value)} placeholder="Catatan verifikasi, sumber pengganti, atau alasan reject..." value={note} /><div className="review-quick-actions"><button type="button" onClick={() => setSelected((current) => current ? { ...current, decision: { ...current.decision, status: "Verified" } } : current)}>Verified</button><button type="button" onClick={() => setSelected((current) => current ? { ...current, decision: { ...current.decision, status: "Needs Source" } } : current)}>Needs Source</button><button type="button" onClick={() => setSelected((current) => current ? { ...current, decision: { ...current.decision, status: "Rejected" } } : current)}>Reject</button></div><button className="primary-button" disabled={busy} onClick={() => void saveDecision()} type="button">{busy ? "Menyimpan..." : "Simpan keputusan"}</button>{selected.decision.updatedAt && <small>Terakhir: {selected.decision.reviewer} · {formatDate(selected.decision.updatedAt)}</small>}</section>
          <details className="review-raw"><summary>Metadata JSON</summary><pre>{JSON.stringify(selected.details, null, 2)}</pre></details>
        </> : <div className="review-empty">Pilih item dari queue untuk melihat evidence dan memberi keputusan.</div>}</aside>
      </section>
    </>
  );
}
