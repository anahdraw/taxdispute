"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CitationIssue, TrustDecision } from "@/lib/citation-trust";
import type { HybridSearchResult, SearchCorpus, SearchFacetFilters, SearchHit, SearchLocator } from "@/lib/search-contracts";
import type { WorkspaceClient, WorkspaceMatter, WorkspaceMembership, WorkspaceTenant } from "@/lib/workspace";
import {
  readActiveWorkspaceContext,
  writeActiveWorkspaceContext,
  type ActiveWorkspaceContext
} from "@/lib/workspace-client-context";

type TenantRecord = { tenant: WorkspaceTenant; membership: WorkspaceMembership };

type SearchResponse = HybridSearchResult & {
  trust: TrustDecision;
  scope: {
    workspaceId: string;
    clientId: string | null;
    matterId: string | null;
    derivedFromSession: boolean;
    readOnly: boolean;
    legacyDecisionCorpusIncluded: boolean;
  };
};

type SearchRequestSnapshot = {
  query: string;
  corpora: SearchCorpus[];
  asOf: string;
  answer: string;
  facets: SearchFacetFilters;
};

const PAGE_SIZE = 10;

function queryString(context: ActiveWorkspaceContext) {
  const params = new URLSearchParams({ tenantId: context.tenantId });
  if (context.clientId) params.set("clientId", context.clientId);
  if (context.matterId) params.set("matterId", context.matterId);
  return `?${params.toString()}`;
}

function safeHref(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function machineCitation(hit: SearchHit) {
  return `[[cite:${hit.id}]]`;
}

function locatorLabel(locator?: SearchLocator) {
  if (!locator) return "Locator belum tersedia";
  return [
    locator.page ? `Halaman ${locator.page}` : "",
    locator.paragraph ? `Paragraf ${locator.paragraph}` : "",
    locator.section ? locator.section : ""
  ].filter(Boolean).join(" · ") || "Locator belum tersedia";
}

function statusLabel(status: SearchHit["status"]) {
  if (status === "verified") return "Terverifikasi";
  if (status === "review_required") return "Perlu review";
  return "Status belum diketahui";
}

function reasonLabel(reason: CitationIssue) {
  const labels: Record<CitationIssue["code"], string> = {
    NO_EVIDENCE: "Bukti tidak ditemukan",
    LOW_RETRIEVAL_SCORE: "Relevansi rendah",
    NO_VERIFIED_SOURCE: "Sumber belum terverifikasi",
    MISSING_LOCATOR: "Locator tidak tersedia",
    UNKNOWN_LEGAL_STATUS: "Status hukum belum pasti",
    UNSUPPORTED_CLAIM: "Klaim belum didukung",
    UNKNOWN_CITATION: "ID sitasi tidak dikenal",
    INELIGIBLE_CITATION: "Sumber sitasi belum memenuhi syarat",
    MALFORMED_CITATION: "Format sitasi salah",
    OUT_OF_SCOPE: "Pertanyaan di luar cakupan",
    TEMPORAL_MISMATCH: "Masa berlaku sumber tidak sesuai",
    TEMPORAL_UNCERTAINTY: "Metadata masa berlaku belum lengkap"
  };
  return labels[reason.code];
}

async function jsonResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error || "Permintaan tidak dapat diproses."));
  return payload;
}

export function TrustedSearchClient({
  canSearchDecisions,
  canSearchRegulations
}: {
  canSearchDecisions: boolean;
  canSearchRegulations: boolean;
}) {
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [clients, setClients] = useState<WorkspaceClient[]>([]);
  const [matters, setMatters] = useState<WorkspaceMatter[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [matterId, setMatterId] = useState("");
  const [scopeReady, setScopeReady] = useState(false);
  const scopeGeneration = useRef(0);

  const [query, setQuery] = useState("");
  const [useDecisions, setUseDecisions] = useState(canSearchDecisions);
  const [useRegulations, setUseRegulations] = useState(canSearchRegulations);
  const [asOf, setAsOf] = useState("");
  const [answer, setAnswer] = useState("");
  const [topicFacet, setTopicFacet] = useState("");
  const [statusFacet, setStatusFacet] = useState("");
  const [legalStatusFacet, setLegalStatusFacet] = useState("");
  const [authorityFacet, setAuthorityFacet] = useState("");
  const [yearFacet, setYearFacet] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [lastRequest, setLastRequest] = useState<SearchRequestSnapshot | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Menyiapkan scope workspace...");
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState("");

  const context: ActiveWorkspaceContext | null = tenantId ? {
    tenantId,
    ...(clientId ? { clientId } : {}),
    ...(clientId && matterId ? { matterId } : {})
  } : null;

  async function loadClients(nextTenantId: string) {
    const payload = await jsonResponse(await fetch(`/api/clients?tenantId=${encodeURIComponent(nextTenantId)}`, { cache: "no-store" }));
    return (payload.records || []) as WorkspaceClient[];
  }

  async function loadMatters(nextTenantId: string, nextClientId: string) {
    if (!nextClientId) return [];
    const params = new URLSearchParams({ tenantId: nextTenantId, clientId: nextClientId });
    const payload = await jsonResponse(await fetch(`/api/matters?${params}`, { cache: "no-store" }));
    return (payload.records || []) as WorkspaceMatter[];
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const persisted = readActiveWorkspaceContext();
        const workspacePayload = await jsonResponse(await fetch("/api/workspaces", { cache: "no-store" }));
        const nextTenants = (workspacePayload.records || []) as TenantRecord[];
        const nextTenantId = nextTenants.some(({ tenant }) => tenant.id === persisted?.tenantId)
          ? persisted!.tenantId
          : nextTenants[0]?.tenant.id || "";
        const nextClients = nextTenantId ? await loadClients(nextTenantId) : [];
        const nextClientId = nextClients.some((client) => client.id === persisted?.clientId)
          ? persisted!.clientId || ""
          : nextClients[0]?.id || "";
        const nextMatters = nextClientId ? await loadMatters(nextTenantId, nextClientId) : [];
        const nextMatterId = nextMatters.some((matter) => matter.id === persisted?.matterId)
          ? persisted!.matterId || ""
          : nextMatters[0]?.id || "";
        if (cancelled) return;
        setTenants(nextTenants);
        setTenantId(nextTenantId);
        setClients(nextClients);
        setClientId(nextClientId);
        setMatters(nextMatters);
        setMatterId(nextMatterId);
        setScopeReady(true);
        setStatus(nextTenantId ? "Scope siap. Pilihan disimpan hanya sebagai preferensi browser." : "Belum ada workspace yang dapat dipakai.");
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Scope workspace tidak dapat dimuat.");
      }
    })();
    return () => { cancelled = true; };
  // Helpers are stable and the initial scope must only bootstrap once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (scopeReady && context) writeActiveWorkspaceContext(context);
  }, [scopeReady, tenantId, clientId, matterId]);

  async function selectTenant(nextTenantId: string) {
    const generation = ++scopeGeneration.current;
    setTenantId(nextTenantId);
    setClientId("");
    setMatterId("");
    setClients([]);
    setMatters([]);
    setResult(null);
    setStatus("Memuat client...");
    try {
      const nextClients = await loadClients(nextTenantId);
      if (generation !== scopeGeneration.current) return;
      const nextClientId = nextClients[0]?.id || "";
      const nextMatters = await loadMatters(nextTenantId, nextClientId);
      if (generation !== scopeGeneration.current) return;
      setClients(nextClients);
      setClientId(nextClientId);
      setMatters(nextMatters);
      setMatterId(nextMatters[0]?.id || "");
      setStatus("Scope diperbarui.");
    } catch (error) {
      if (generation === scopeGeneration.current) setStatus(error instanceof Error ? error.message : "Client tidak dapat dimuat.");
    }
  }

  async function selectClient(nextClientId: string) {
    const generation = ++scopeGeneration.current;
    setClientId(nextClientId);
    setMatterId("");
    setMatters([]);
    setResult(null);
    if (!nextClientId) {
      setStatus("Pencarian akan disimpan pada level tenant.");
      return;
    }
    setStatus("Memuat matter...");
    try {
      const nextMatters = await loadMatters(tenantId, nextClientId);
      if (generation !== scopeGeneration.current) return;
      setMatters(nextMatters);
      setMatterId(nextMatters[0]?.id || "");
      setStatus("Scope diperbarui.");
    } catch (error) {
      if (generation === scopeGeneration.current) setStatus(error instanceof Error ? error.message : "Matter tidak dapat dimuat.");
    }
  }

  function recordHistory(snapshot: SearchRequestSnapshot, response: SearchResponse) {
    if (!context) return;
    const endpoint = `/api/research-workspace${queryString(context)}`;
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity: "history",
        action: "search",
        resourceType: "chat",
        title: `Trusted search: ${snapshot.query.slice(0, 180)}`,
        query: snapshot.query,
        responseExcerpt: response.trust.summary,
        metadata: {
          corpora: snapshot.corpora,
          asOf: snapshot.asOf || null,
          answerValidated: Boolean(snapshot.answer),
          resultCount: response.hits.length,
          totalCandidates: response.totalCandidates,
          trustScore: response.trust.score,
          abstained: response.trust.abstain
        }
      })
    }).catch(() => undefined);
  }

  async function performSearch(snapshot: SearchRequestSnapshot, nextOffset: number) {
    if (!context) return;
    setBusy(true);
    setStatus("Menjalankan hybrid search dan trust gate...");
    try {
      const response = await fetch(`/api/search${queryString(context)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: snapshot.query,
          corpora: snapshot.corpora,
          limit: PAGE_SIZE,
          offset: nextOffset,
          asOf: snapshot.asOf || undefined,
          answer: snapshot.answer || undefined,
          facets: snapshot.facets,
          language: "id"
        })
      });
      const payload = await jsonResponse(response) as unknown as SearchResponse;
      setResult(payload);
      setLastRequest(snapshot);
      setOffset(nextOffset);
      setStatus(payload.hits.length ? `${payload.hits.length} bukti ditampilkan.` : "Tidak ada bukti yang cocok dengan filter.");
      if (nextOffset === 0) recordHistory(snapshot, payload);
    } catch (error) {
      setResult(null);
      setStatus(error instanceof Error ? error.message : "Pencarian gagal.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const corpora: SearchCorpus[] = [
      ...(useDecisions ? ["decision" as const] : []),
      ...(useRegulations ? ["regulation" as const] : [])
    ];
    if (query.trim().length < 3) {
      setStatus("Pertanyaan harus berisi minimal 3 karakter.");
      return;
    }
    if (!corpora.length) {
      setStatus("Pilih minimal satu korpus.");
      return;
    }
    void performSearch({
      query: query.trim(), corpora, asOf, answer: answer.trim(),
      facets: {
        topics: topicFacet ? [topicFacet] : undefined,
        statuses: statusFacet ? [statusFacet as "verified" | "review_required" | "unknown"] : undefined,
        legalStatuses: legalStatusFacet ? [legalStatusFacet] : undefined,
        authorities: authorityFacet ? [authorityFacet] : undefined,
        years: yearFacet ? [Number(yearFacet)] : undefined
      }
    }, 0);
  }

  async function copyCitation(hit: SearchHit) {
    try {
      await navigator.clipboard.writeText(machineCitation(hit));
      setCopiedId(hit.id);
      window.setTimeout(() => setCopiedId((current) => current === hit.id ? "" : current), 1800);
    } catch {
      setCopiedId("");
    }
  }

  async function saveHit(hit: SearchHit) {
    if (!context) return;
    setSaveStatus((current) => ({ ...current, [hit.id]: "Menyimpan..." }));
    try {
      const sourceUrl = hit.detailUrl || safeHref(hit.sourceUrl);
      const response = await fetch(`/api/research-workspace${queryString(context)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "saved-item",
          resourceType: hit.corpus,
          resourceId: hit.id,
          title: hit.title,
          url: sourceUrl,
          excerpt: hit.snippet,
          metadata: {
            citation: hit.citation,
            machineCitation: machineCitation(hit),
            locator: hit.locator || null,
            status: hit.status,
            authority: hit.authority,
            score: hit.score
          }
        })
      });
      await jsonResponse(response);
      setSaveStatus((current) => ({ ...current, [hit.id]: "Tersimpan" }));
    } catch (error) {
      setSaveStatus((current) => ({ ...current, [hit.id]: error instanceof Error ? error.message : "Gagal menyimpan" }));
    }
  }

  async function highlightHit(hit: SearchHit) {
    if (!context || !hit.snippet) return;
    setSaveStatus((current) => ({ ...current, [hit.id]: "Menyimpan highlight..." }));
    try {
      const response = await fetch(`/api/research-workspace${queryString(context)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "highlight", resourceType: hit.corpus, resourceId: hit.id, title: hit.title,
          url: hit.detailUrl || safeHref(hit.sourceUrl), quote: hit.snippet,
          anchor: hit.locator ? { page: hit.locator.page } : {},
          metadata: { citation: hit.citation, machineCitation: machineCitation(hit), sourceHash: hit.sourceHash }
        })
      });
      await jsonResponse(response);
      setSaveStatus((current) => ({ ...current, [hit.id]: "Highlight tersimpan" }));
    } catch (error) {
      setSaveStatus((current) => ({ ...current, [hit.id]: error instanceof Error ? error.message : "Gagal menyimpan highlight" }));
    }
  }

  const answerMarkers = Array.from(answer.matchAll(/\[\[cite:([a-zA-Z0-9._:/-]+)\]\]/g));

  return (
    <>
      <section className="trusted-search-scope" aria-labelledby="trusted-search-scope-title">
        <div className="trusted-search-section-heading">
          <div>
            <span className="case-detail-kicker">Workspace scope</span>
            <h2 id="trusted-search-scope-title">Tenant, client, dan matter</h2>
          </div>
          <a href="/workspace">Kelola workspace &amp; private storage</a>
        </div>
        <div className="trusted-search-scope-grid">
          <label>Tenant<select disabled={!scopeReady} onChange={(event) => void selectTenant(event.target.value)} value={tenantId}>{tenants.map(({ tenant }) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
          <label>Client<select disabled={!tenantId} onChange={(event) => void selectClient(event.target.value)} value={clientId}><option value="">Level tenant</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <label>Matter<select disabled={!clientId} onChange={(event) => { setMatterId(event.target.value); setResult(null); setStatus("Scope diperbarui."); }} value={matterId}><option value="">Tanpa matter</option>{matters.map((matter) => <option key={matter.id} value={matter.id}>{matter.name}</option>)}</select></label>
        </div>
        <p className="trusted-search-status" role="status">{status}</p>
      </section>

      <form className="trusted-search-form" onSubmit={submit}>
        <div className="trusted-search-question">
          <label htmlFor="trusted-query">Pertanyaan riset</label>
          <textarea id="trusted-query" maxLength={1000} onChange={(event) => setQuery(event.target.value)} placeholder="Contoh: Apakah Pajak Masukan atas transaksi ini dapat dikreditkan dan aturan mana yang berlaku?" required value={query} />
        </div>
        <fieldset className="trusted-search-corpora">
          <legend>Korpus</legend>
          <label><input checked={useDecisions} disabled={!canSearchDecisions} onChange={(event) => setUseDecisions(event.target.checked)} type="checkbox" /> Putusan sengketa{!canSearchDecisions ? " (tidak termasuk paket)" : ""}</label>
          <label><input checked={useRegulations} disabled={!canSearchRegulations} onChange={(event) => setUseRegulations(event.target.checked)} type="checkbox" /> Peraturan{!canSearchRegulations ? " (tidak termasuk paket)" : ""}</label>
        </fieldset>
        <fieldset className="trusted-search-facets">
          <legend>Facet</legend>
          <label>Topik<select onChange={(event) => setTopicFacet(event.target.value)} value={topicFacet}><option value="">Semua topik</option>{result?.facets.topics.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}</select></label>
          <label>Kesiapan sumber<select onChange={(event) => setStatusFacet(event.target.value)} value={statusFacet}><option value="">Semua kesiapan</option>{result?.facets.statuses.map((item) => <option key={item.value} value={item.value}>{statusLabel(item.value as SearchHit["status"])} ({item.count})</option>)}</select></label>
          <label>Status hukum<select onChange={(event) => setLegalStatusFacet(event.target.value)} value={legalStatusFacet}><option value="">Semua status hukum</option>{result?.facets.legalStatuses.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}</select></label>
          <label>Otoritas<select onChange={(event) => setAuthorityFacet(event.target.value)} value={authorityFacet}><option value="">Semua otoritas</option>{result?.facets.authorities.slice(0, 30).map((item) => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}</select></label>
          <label>Tahun<select onChange={(event) => setYearFacet(event.target.value)} value={yearFacet}><option value="">Semua tahun</option>{result?.facets.years.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}</select></label>
        </fieldset>
        <label className="trusted-search-date">Berlaku per tanggal<input onChange={(event) => setAsOf(event.target.value)} type="date" value={asOf} /><small>Opsional; mengaktifkan pemeriksaan status hukum.</small></label>
        <details className="trusted-search-validator" open={Boolean(answer)}>
          <summary>Validasi jawaban dengan machine citation (opsional)</summary>
          <p>Tempel jawaban dan gunakan format <code>[[cite:ID_SUMBER]]</code> pada setiap klaim substantif.</p>
          <textarea maxLength={24000} onChange={(event) => setAnswer(event.target.value)} placeholder="Klaim ... [[cite:regulation:contoh:1]]" value={answer} />
          <small>{answer ? `${answerMarkers.length} marker sitasi terbaca.` : "Validator dijalankan bersamaan dengan pencarian jika jawaban diisi."}</small>
        </details>
        <button className="primary-button trusted-search-submit" disabled={busy || !scopeReady || !tenantId || (!canSearchDecisions && !canSearchRegulations)} type="submit">{busy ? "Memeriksa bukti..." : "Cari & periksa trust"}</button>
        {!canSearchDecisions && !canSearchRegulations && <p className="trusted-search-entitlement-note">Paket akun ini belum mencakup korpus putusan atau peraturan.</p>}
      </form>

      {result && (
        <section className="trusted-search-output" aria-live="polite">
          <article className={`trusted-search-trust-card ${result.trust.abstain ? "abstain" : "allow"}`}>
            <div className="trusted-search-trust-title">
              <div>
                <span>{result.trust.abstain ? "ABSTAIN" : "TRUST GATE PASSED"}</span>
                <h2>{result.trust.abstain ? "Jangan gunakan sebagai kesimpulan final" : "Bukti memenuhi trust gate"}</h2>
              </div>
              <strong>{result.trust.score}<small>/100</small></strong>
            </div>
            <p>{result.trust.summary}</p>
            <dl>
              <div><dt>Retrieved</dt><dd>{result.trust.evidence.retrieved}</dd></div>
              <div><dt>Verified</dt><dd>{result.trust.evidence.verified}</dd></div>
              <div><dt>With locator</dt><dd>{result.trust.evidence.located}</dd></div>
              <div><dt>Official rules</dt><dd>{result.trust.evidence.officialRegulations}</dd></div>
            </dl>
            {result.trust.reasons.length > 0 && <ul>{result.trust.reasons.map((reason, index) => <li key={`${reason.code}:${reason.citationId || ""}:${index}`}><b>{reasonLabel(reason)}</b><span>{reason.message}</span>{reason.citationId && <code>{reason.citationId}</code>}{reason.claim && <q>{reason.claim}</q>}</li>)}</ul>}
            {answer && result.trust.citationValidation && (
              <p className="trusted-search-validation-note">
                <b>Citation validator {result.trust.citationValidation.valid ? "lolos" : "belum lolos"}.</b>{" "}
                Cakupan {Math.round(result.trust.citationValidation.coverage * 100)}% · {result.trust.citationValidation.supportedClaims}/{result.trust.citationValidation.substantiveClaims} klaim didukung · {result.trust.citationValidation.citedIds.length} sumber dikutip.
              </p>
            )}
          </article>

          <div className="trusted-search-results-heading">
            <div>
              <span className="case-detail-kicker">Evidence results</span>
              <h2>{result.totalCandidates} kandidat relevan</h2>
              <p>Menampilkan {result.hits.length ? offset + 1 : 0}–{offset + result.hits.length}. Hybrid semantic: {result.diagnostics.semanticEnabled ? "aktif" : "belum ada embedding"}.</p>
            </div>
            <span>{result.diagnostics.elapsedMs} ms</span>
          </div>

          <div className="trusted-search-result-list">
            {result.hits.map((hit) => {
              const href = safeHref(hit.sourceUrl);
              return (
                <article className="trusted-search-result" key={hit.id}>
                  <header>
                    <div className="trusted-search-badges">
                      <span>{hit.corpus === "decision" ? "Putusan" : "Peraturan"}</span>
                      <span className={`verification-${hit.status}`}>{statusLabel(hit.status)}</span>
                      <span>Skor {hit.score}</span>
                    </div>
                    <h3>{hit.detailUrl ? <a href={hit.detailUrl}>{hit.title}</a> : hit.title}</h3>
                    <p>{[hit.citation, hit.authority, locatorLabel(hit.locator)].filter(Boolean).join(" · ")}</p>
                  </header>
                  <p className="trusted-search-snippet">{hit.snippet || "Cuplikan belum tersedia."}</p>
                  <div className="trusted-search-machine-citation">
                    <div><span>Machine citation ID</span><code>{machineCitation(hit)}</code></div>
                    <button onClick={() => void copyCitation(hit)} type="button">{copiedId === hit.id ? "Disalin" : "Salin ID"}</button>
                  </div>
                  {hit.matchedTerms.length > 0 && <p className="trusted-search-terms">Term cocok: {hit.matchedTerms.join(", ")}</p>}
                  <footer>
                    <div>{hit.detailUrl && <a href={hit.detailUrl}>Detail katalog</a>}{href && <a href={href} rel={href.startsWith("http") ? "noreferrer" : undefined} target={href.startsWith("http") ? "_blank" : undefined}>Sumber resmi</a>}<button disabled={saveStatus[hit.id]?.startsWith("Menyimpan")} onClick={() => void saveHit(hit)} type="button">Simpan</button><button disabled={!hit.snippet || saveStatus[hit.id]?.startsWith("Menyimpan")} onClick={() => void highlightHit(hit)} type="button">Highlight</button></div>
                    {saveStatus[hit.id] && <small role="status">{saveStatus[hit.id]}</small>}
                  </footer>
                </article>
              );
            })}
            {!result.hits.length && <div className="research-empty"><b>Belum ada bukti yang cocok.</b><span>Ubah istilah, korpus, atau tanggal pencarian. Trust layer memilih abstain bila bukti tidak cukup.</span></div>}
          </div>

          <nav className="trusted-search-pagination" aria-label="Pagination hasil pencarian">
            <button disabled={busy || offset === 0 || !lastRequest} onClick={() => lastRequest && void performSearch(lastRequest, Math.max(0, offset - PAGE_SIZE))} type="button">Sebelumnya</button>
            <span>Halaman {Math.floor(offset / PAGE_SIZE) + 1}</span>
            <button disabled={busy || !result.hasMore || !lastRequest} onClick={() => lastRequest && void performSearch(lastRequest, offset + PAGE_SIZE)} type="button">Berikutnya</button>
          </nav>
        </section>
      )}
    </>
  );
}
