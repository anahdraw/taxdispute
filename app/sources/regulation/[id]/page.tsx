import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AlphaBrand } from "@/app/brand";
import { SaveResearchControls } from "@/app/workspace/save-research-controls";
import { WatchSourceControl } from "@/app/watchlist/watch-source-control";
import { tierHasFeature } from "@/lib/admin";
import { sessionFromCookieStore } from "@/lib/auth";
import { regulations as seedRegulations } from "@/lib/mock-data";
import { mergeRegulationRecords } from "@/lib/regulation-knowledge";
import { loadLocalRegulationSnapshot } from "@/lib/regulation-snapshot";
import { buildRegulationResearchView, compareRegulationVersions } from "@/lib/regulation-timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readableDate(value?: string) {
  if (!value) return "Belum diketahui";
  try { return new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(new Date(value)); } catch { return value; }
}

function safeHref(value?: string) {
  if (!value) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; } catch { return ""; }
}

export default async function RegulationSourcePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ asOf?: string; compare?: string }>;
}) {
  const session = sessionFromCookieStore(await cookies());
  if (!session) redirect("/");
  if (session.role !== "admin" && !tierHasFeature(session.tier, "regulationRead")) redirect("/");
  const { id } = await params;
  const query = await searchParams;
  const snapshot = loadLocalRegulationSnapshot();
  const records = mergeRegulationRecords(snapshot.length ? snapshot : seedRegulations);
  const view = buildRegulationResearchView(records, id, { asOf: query.asOf });
  if (!view) notFound();
  const selected = view.selected;
  const compareRecord = query.compare ? records.find((record) => record.canonicalKey === query.compare) : undefined;
  const differences = compareRecord ? compareRegulationVersions(compareRecord, selected) : [];
  const sourceUrl = safeHref(selected.sourceUrl);
  const pdfs = [...new Set([selected.storedPdfUrl, selected.officialPdfUrl, selected.pdfUrl, ...(selected.pdfUrls || [])].map(safeHref).filter(Boolean))];
  const detailPath = `/sources/regulation/${encodeURIComponent(selected.canonicalKey || selected.id)}`;

  return (
    <main className="source-detail-page">
      <header className="workspace-topbar source-detail-topbar">
        <AlphaBrand />
        <nav><a href="/search">Universal search</a><a href="/watchlist">Watchlist</a><a href="/workspace">Workspace</a><span>{session.name}</span></nav>
      </header>

      <section className="source-detail-hero">
        <div>
          <span className="case-detail-kicker">Katalog peraturan · {selected.canonicalKey}</span>
          <h1>{selected.citation}</h1>
          <p>{selected.title}</p>
        </div>
        <SaveResearchControls
          excerpt={selected.extraction?.summary || selected.focus}
          quote={selected.extraction?.keyProvisions?.[0]?.text || selected.focus}
          resourceId={selected.canonicalKey || selected.id}
          resourceType="regulation"
          title={`${selected.citation} — ${selected.title}`}
          url={detailPath}
          recordView
        />
        <WatchSourceControl citation={selected.citation} name={selected.title} resourceId={selected.canonicalKey || selected.id} />
      </section>

      <section className="source-detail-grid">
        <article className="source-detail-card source-detail-overview">
          <div className="source-detail-section-title"><span className="case-detail-kicker">Detail sumber</span><h2>Identitas dan provenance</h2></div>
          <dl className="source-metadata-grid">
            <div><dt>Status hukum</dt><dd>{selected.extraction?.legalStatus || "unknown"}</dd></div>
            <div><dt>Mulai berlaku</dt><dd>{readableDate(selected.extraction?.effectiveDate)}</dd></div>
            <div><dt>Otoritas</dt><dd>{selected.sourceAuthority || "Belum diketahui"}</dd></div>
            <div><dt>Topik</dt><dd>{selected.topic || "general"}</dd></div>
            <div><dt>Source hash</dt><dd><code>{selected.fileHash || "Belum tersedia"}</code></dd></div>
            <div><dt>Ekstraksi</dt><dd>{selected.ingestionStatus || "seed"} · {selected.extractedAt || "waktu belum tersedia"}</dd></div>
          </dl>
          <p>{selected.extraction?.summary || selected.focus}</p>
          <div className="source-link-row">
            {sourceUrl && <a href={sourceUrl} rel="noreferrer" target="_blank">Halaman resmi ↗</a>}
            {pdfs.map((pdf, index) => <a href={pdf} key={pdf} rel={pdf.startsWith("http") ? "noreferrer" : undefined} target={pdf.startsWith("http") ? "_blank" : undefined}>PDF {index + 1} ↗</a>)}
            {!sourceUrl && !pdfs.length && <span>Sumber resmi/PDF masih masuk antrean review.</span>}
          </div>
        </article>

        <aside className="source-detail-card source-time-controls">
          <div className="source-detail-section-title"><span className="case-detail-kicker">Regulation time machine</span><h2>Aturan per tanggal</h2></div>
          <form method="get">
            <label>Tanggal analisis<input defaultValue={view.asOf} name="asOf" type="date" /></label>
            {query.compare && <input name="compare" type="hidden" value={query.compare} />}
            <button type="submit">Terapkan tanggal</button>
          </form>
          {view.applicableVersion ? <p><b>Versi yang terindikasi berlaku:</b><br />{view.applicableVersion.citation}</p> : <p className="source-warning">Tidak ada versi terverifikasi yang dapat dipastikan berlaku pada tanggal tersebut.</p>}
          {view.pendingEdgeCount > 0 && <p className="source-warning">{view.pendingEdgeCount} relasi graph dikarantina dan tidak digunakan untuk menentukan versi.</p>}
        </aside>
      </section>

      <section className="source-detail-card source-timeline">
        <div className="source-detail-section-title"><span className="case-detail-kicker">Riwayat hukum</span><h2>Timeline versi dan relasi terverifikasi</h2></div>
        <div className="source-timeline-list">
          {view.timeline.map((node) => (
            <article className={`${node.applicableAsOf ? "applicable" : ""} ${node.selected ? "selected" : ""}`} key={node.canonicalKey}>
              <span>{readableDate(node.effectiveFrom)}</span>
              <h3><a href={`/sources/regulation/${encodeURIComponent(node.canonicalKey)}?asOf=${encodeURIComponent(view.asOf)}`}>{node.citation}</a></h3>
              <p>{node.legalStatus} {node.effectiveTo ? `· berakhir ${readableDate(node.effectiveTo)}` : ""}</p>
            </article>
          ))}
          {!view.timeline.length && <p>Belum ada versi terhubung yang lolos review graph.</p>}
        </div>
        <div className="source-edge-list">
          {view.edges.filter((edge) => edge.eligibleForAnswer).map((edge) => <code key={edge.id}>{edge.source} —{edge.type}→ {edge.target}</code>)}
        </div>
      </section>

      <section className="source-detail-card source-consolidation">
        <div className="source-detail-section-title"><span className="case-detail-kicker">Consolidated law</span><h2>Konsolidasi untuk riset</h2></div>
        <p className="source-warning">{view.consolidation.warning}</p>
        <p>Sumber pembentuk: {view.consolidation.contributingSources.join(", ") || selected.canonicalKey}.</p>
        <div className="source-provision-list">
          {view.consolidation.provisions.map((provision, index) => (
            <article key={`${provision.sourceCanonicalKey}:${provision.article || index}`}>
              <header><b>{provision.article || `Bagian ${index + 1}`}</b><span>{provision.change === "base" ? "Naskah dasar" : "Perubahan"} · {provision.sourceCitation}{provision.page ? ` · halaman ${provision.page}` : ""}</span></header>
              <p>{provision.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="source-detail-card source-version-compare">
        <div className="source-detail-section-title"><span className="case-detail-kicker">Compare version</span><h2>Bandingkan ketentuan</h2></div>
        <form method="get">
          <input name="asOf" type="hidden" value={view.asOf} />
          <select defaultValue={query.compare || ""} name="compare">
            <option value="">Pilih versi pembanding</option>
            {view.timeline.filter((node) => node.canonicalKey !== selected.canonicalKey).map((node) => <option key={node.canonicalKey} value={node.canonicalKey}>{node.citation}</option>)}
          </select>
          <button type="submit">Bandingkan</button>
        </form>
        {compareRecord && <div className="source-diff-list">
          <p><b>{compareRecord.citation}</b> dibandingkan dengan <b>{selected.citation}</b>.</p>
          {differences.map((difference, index) => <article className={`diff-${difference.kind}`} key={`${difference.article}:${index}`}><header><b>{difference.article}</b><span>{difference.kind}</span></header><div><p>{difference.before || "—"}</p><p>{difference.after || "—"}</p></div></article>)}
        </div>}
        {!compareRecord && <p>Pilih versi yang terhubung dalam graph untuk melihat pasal ditambah, dihapus, berubah, atau tetap.</p>}
      </section>
    </main>
  );
}
