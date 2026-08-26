"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SaveResearchControls } from "@/app/workspace/save-research-controls";
import type {
  KnowledgeDomain,
  KnowledgeDomainReadiness,
  KnowledgeEvidenceStatus,
  KnowledgeItem,
  KnowledgeSourceConnector
} from "@/lib/knowledge-hub";

type Payload = {
  items: KnowledgeItem[];
  total: number;
  hasMore: boolean;
  generatedAt: string;
  totals: { sourceRecords: number; primaryLawRecords: number; manualRecords: number; knowledgeItems: number; verifiedItems: number };
  readiness: KnowledgeDomainReadiness[];
  connectors: KnowledgeSourceConnector[];
  facets: {
    domains: Array<{ value: KnowledgeDomain; count: number }>;
    subtypes: Array<{ value: string; count: number }>;
    statuses: Array<{ value: KnowledgeEvidenceStatus; count: number }>;
  };
};

const domains: Array<{ value: KnowledgeDomain | "all"; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "treaty", label: "P3B / MLI" },
  { value: "guides", label: "Panduan" },
  { value: "manual", label: "Tax manual" },
  { value: "changes", label: "Perubahan" },
  { value: "glossary", label: "Glosarium" },
  { value: "forms", label: "Formulir" },
  { value: "rates", label: "Kurs" }
];

const readinessLabel = { ready: "Siap", partial: "Parsial", gap: "Belum cukup" } as const;
const evidenceLabel = { verified: "Terverifikasi", review_required: "Perlu review", reference_only: "Referensi non-hukum" } as const;

function formatNumber(value: number) {
  return new Intl.NumberFormat("id-ID").format(value);
}

function displayDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export function KnowledgeHubClient() {
  const [domain, setDomain] = useState<KnowledgeDomain | "all">("treaty");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [subtype, setSubtype] = useState("");
  const [status, setStatus] = useState<KnowledgeEvidenceStatus | "">("");
  const [offset, setOffset] = useState(0);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ domain, limit: "18", offset: String(offset) });
      if (submittedQuery) params.set("q", submittedQuery);
      if (subtype) params.set("subtype", subtype);
      if (status) params.set("status", status);
      const response = await fetch(`/api/knowledge?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Knowledge hub tidak dapat dimuat.");
      setPayload(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Knowledge hub tidak dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [domain, offset, status, submittedQuery, subtype]);

  useEffect(() => { void load(); }, [load]);
  const relevantReadiness = useMemo(() => payload?.readiness.filter((item) => domain === "all" || item.domain === domain) || [], [domain, payload]);
  const relevantConnectors = useMemo(() => payload?.connectors.filter((item) => domain === "all" || item.domain === domain) || [], [domain, payload]);
  const sufficient = payload?.readiness.every((item) => item.status === "ready") || false;

  function switchDomain(next: KnowledgeDomain | "all") {
    setDomain(next);
    setSubtype("");
    setOffset(0);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
    setOffset(0);
  }

  return <div className="knowledge-shell">
    {payload && <section className={`knowledge-sufficiency ${sufficient ? "ready" : "partial"}`}>
      <div><span>Kesimpulan sumber daya</span><h2>{sufficient ? "Cukup untuk produksi" : "Cukup untuk pilot, belum cukup untuk parity produksi"}</h2><p>{formatNumber(payload.totals.primaryLawRecords)} aturan primer dan {formatNumber(payload.totals.manualRecords)} entri manual sudah terhubung. Kekurangan paling nyata ada pada PDF terversi, manual Coretax, file formulir siap pakai, matching MLI, serta feed kurs mingguan.</p></div>
      <dl><div><dt>Corpus sumber</dt><dd>{formatNumber(payload.totals.sourceRecords)}</dd></div><div><dt>Item knowledge</dt><dd>{formatNumber(payload.totals.knowledgeItems)}</dd></div><div><dt>Bukti terverifikasi</dt><dd>{formatNumber(payload.totals.verifiedItems)}</dd></div></dl>
    </section>}

    <section className="knowledge-readiness" aria-label="Kesiapan tiap domain">
      {relevantReadiness.map((item) => <article className={`knowledge-readiness-card ${item.status}`} key={item.domain}>
        <header><div><span>{item.label}</span><strong>{formatNumber(item.itemCount)} item</strong></div><b>{readinessLabel[item.status]}</b></header>
        <p>{item.explanation}</p>
        <div className="knowledge-coverage"><span>Official {item.officialUrlCoverage}%</span><span>PDF {item.pdfCoverage}%</span><span>Locator {item.locatorCoverage}%</span></div>
        {item.missing.length > 0 && <details><summary>Yang masih kurang ({item.missing.length})</summary><ul>{item.missing.map((entry) => <li key={entry}>{entry}</li>)}</ul></details>}
      </article>)}
    </section>

    <section className="knowledge-browser">
      <nav className="knowledge-domain-tabs" aria-label="Domain knowledge">
        {domains.map((item) => <button className={domain === item.value ? "active" : ""} key={item.value} onClick={() => switchDomain(item.value)} type="button">{item.label}</button>)}
      </nav>
      <form className="knowledge-filters" onSubmit={submit}>
        <label><span>Cari pengetahuan</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Contoh: MLI Malaysia, dokter, SPT Tahunan, USD…" value={query} /></label>
        <label><span>Jenis</span><select onChange={(event) => { setSubtype(event.target.value); setOffset(0); }} value={subtype}><option value="">Semua jenis</option>{payload?.facets.subtypes.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select></label>
        <label><span>Status bukti</span><select onChange={(event) => { setStatus(event.target.value as KnowledgeEvidenceStatus | ""); setOffset(0); }} value={status}><option value="">Semua status</option><option value="verified">Terverifikasi</option><option value="review_required">Perlu review</option><option value="reference_only">Referensi non-hukum</option></select></label>
        <button type="submit">Cari</button>
      </form>

      {error && <div className="knowledge-error" role="alert">{error}</div>}
      <div className="knowledge-results-heading"><div><span>Hasil</span><h2>{loading ? "Memuat…" : `${formatNumber(payload?.total || 0)} item ditemukan`}</h2></div>{submittedQuery && <button onClick={() => { setQuery(""); setSubmittedQuery(""); setOffset(0); }} type="button">Hapus pencarian</button>}</div>
      <div className="knowledge-results">
        {!loading && payload?.items.map((item) => <article className="knowledge-item" key={item.id}>
          <header><div><span>{item.domain} · {item.subtype}</span><h3>{item.title}</h3></div><b className={item.evidenceStatus}>{evidenceLabel[item.evidenceStatus]}</b></header>
          <p>{item.summary || "Ringkasan belum tersedia."}</p>
          <dl><div><dt>Sitasi</dt><dd>{item.citation}</dd></div><div><dt>Status hukum</dt><dd>{item.legalStatus}</dd></div><div><dt>Mulai berlaku</dt><dd>{displayDate(item.effectiveFrom)}</dd></div><div><dt>Locator</dt><dd>{item.locator?.article || (item.locator?.page ? `Hal. ${item.locator.page}` : "Belum ada")}</dd></div></dl>
          <footer><div>{item.internalUrl && <a href={item.internalUrl}>Buka detail</a>}{item.officialUrl && <a href={item.officialUrl} rel="noreferrer" target="_blank">Sumber resmi ↗</a>}{item.pdfUrl && item.pdfUrl !== item.internalUrl && <a href={item.pdfUrl} rel="noreferrer" target="_blank">PDF ↗</a>}</div><SaveResearchControls excerpt={item.summary} resourceId={item.id} resourceType={item.sourceKind === "primary_law" || item.sourceKind === "reviewed_graph" ? "regulation" : "external"} title={item.title} url={item.internalUrl || item.officialUrl || item.pdfUrl} /></footer>
        </article>)}
        {!loading && payload?.items.length === 0 && <div className="knowledge-empty"><b>Tidak ada item yang cocok.</b><span>Coba hapus filter jenis/status atau gunakan istilah yang lebih umum.</span></div>}
      </div>
      <div className="knowledge-pagination"><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 18))} type="button">← Sebelumnya</button><span>{payload?.total ? `${offset + 1}–${Math.min(offset + 18, payload.total)} dari ${formatNumber(payload.total)}` : "0 hasil"}</span><button disabled={loading || !payload?.hasMore} onClick={() => setOffset(offset + 18)} type="button">Berikutnya →</button></div>
    </section>

    <section className="knowledge-connectors">
      <header><span className="case-detail-kicker">Official acquisition queue</span><h2>Sumber resmi yang harus disinkronkan</h2><p>Tautan berikut adalah target ingestion. Status “belum di-ingest” berarti kontennya tidak boleh diasumsikan sudah masuk ke jawaban chatbot.</p></header>
      <div>{relevantConnectors.map((source) => <article key={source.id}><span>{source.authority}</span><h3>{source.title}</h3><p>{source.note}</p><footer><b>{source.updateCadence === "weekly" ? "Mingguan" : "Event-driven"}</b><a href={source.url} rel="noreferrer" target="_blank">Buka sumber resmi ↗</a></footer></article>)}</div>
    </section>
  </div>;
}
