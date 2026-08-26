import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AlphaBrand } from "@/app/brand";
import { SaveResearchControls } from "@/app/workspace/save-research-controls";
import { tierHasFeature } from "@/lib/admin";
import { sessionFromCookieStore } from "@/lib/auth";
import { loadOfficialKnowledgeChunks, loadOfficialKnowledgeSnapshot } from "@/lib/official-knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readableDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Belum dinyatakan";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(new Date(value));
}

function metadataLabel(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

export default async function KnowledgeDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ chunkPage?: string }> }) {
  const session = sessionFromCookieStore(await cookies());
  if (!session) redirect("/");
  if (session.role !== "admin" && !tierHasFeature(session.tier, "regulationRead")) redirect("/");
  const { id } = await params;
  const query = await searchParams;
  const snapshot = loadOfficialKnowledgeSnapshot();
  const item = snapshot.items.find((entry) => entry.id === decodeURIComponent(id));
  if (!item) notFound();
  const pages = item.domain === "guides" ? loadOfficialKnowledgeChunks().chunks.filter((chunk) => chunk.parentId === item.id) : [];
  const chunkPage = Math.max(1, Number.parseInt(query.chunkPage || "1", 10) || 1);
  const pageSize = 25;
  const visiblePages = pages.slice((chunkPage - 1) * pageSize, chunkPage * pageSize);
  const totalChunkPages = Math.max(1, Math.ceil(pages.length / pageSize));
  const detailPath = `/knowledge/${encodeURIComponent(item.id)}`;
  const metadata = Object.entries(item.metadata || {}).filter(([, value]) => value !== "" && value !== null && value !== undefined);

  return <main className="source-detail-page knowledge-detail-page">
    <header className="workspace-topbar source-detail-topbar">
      <AlphaBrand />
      <nav><a href="/knowledge">Knowledge Hub</a><a href="/search">Universal search</a><a href="/workspace">Workspace</a><span>{session.name}</span></nav>
    </header>
    <section className="source-detail-hero">
      <div><span className="case-detail-kicker">{item.domain} · {item.subtype}</span><h1>{item.title}</h1><p>{item.citation}</p></div>
      <SaveResearchControls excerpt={item.summary} resourceId={item.id} resourceType="external" title={item.title} url={detailPath} recordView />
    </section>
    <section className="source-detail-grid">
      <article className="source-detail-card source-detail-overview">
        <div className="source-detail-section-title"><span className="case-detail-kicker">Detail sumber</span><h2>Provenance dan isi katalog</h2></div>
        <p>{item.summary}</p>
        <dl className="source-metadata-grid">
          <div><dt>Status bukti</dt><dd>{item.evidenceStatus}</dd></div>
          <div><dt>Status sumber</dt><dd>{item.legalStatus}</dd></div>
          <div><dt>Mulai berlaku/terbit</dt><dd>{readableDate(item.effectiveFrom)}</dd></div>
          <div><dt>Locator</dt><dd>{item.locator?.article || (item.locator?.page ? `Halaman ${item.locator.page}` : "Belum tersedia")}</dd></div>
          <div><dt>Jenis sumber</dt><dd>{item.sourceKind}</dd></div>
          <div><dt>Halaman terindeks</dt><dd>{pages.length || "—"}</dd></div>
        </dl>
        <div className="source-link-row">{item.officialUrl && <a href={item.officialUrl} rel="noreferrer" target="_blank">Halaman resmi ↗</a>}{item.pdfUrl && <a href={item.pdfUrl} rel="noreferrer" target="_blank">Berkas resmi ↗</a>}</div>
      </article>
      <aside className="source-detail-card source-time-controls">
        <div className="source-detail-section-title"><span className="case-detail-kicker">Integrity</span><h2>Checksum sumber</h2></div>
        <p>SHA-256 dipakai untuk mendeteksi perubahan file setelah sinkronisasi. Checksum tidak menggantikan validasi status berlaku.</p>
        <code className="knowledge-detail-hash">{item.sourceHash || "Checksum belum tersedia"}</code>
        {item.metadata?.temporalReviewRequired === true && <p className="source-warning">Status temporal perlu diperiksa sebelum dokumen dipakai sebagai dasar tindakan.</p>}
      </aside>
    </section>
    {metadata.length > 0 && <section className="source-detail-card">
      <div className="source-detail-section-title"><span className="case-detail-kicker">Metadata terstruktur</span><h2>Field yang dapat dicari</h2></div>
      <dl className="source-metadata-grid">{metadata.map(([key, value]) => <div key={key}><dt>{metadataLabel(key)}</dt><dd>{typeof value === "boolean" ? (value ? "Ya" : "Tidak") : String(value)}</dd></div>)}</dl>
    </section>}
    {pages.length > 0 && <section className="source-detail-card source-provision-list">
      <div className="source-detail-section-title"><span className="case-detail-kicker">PDF text index</span><h2>{pages.length} halaman dapat ditelusuri</h2></div>
      <p className="source-warning">Teks ini adalah hasil ekstraksi untuk pencarian. Gunakan PDF resmi sebagai tampilan final.</p>
      {visiblePages.map((page) => <article id={`page-${page.page}`} key={page.id}><header><b>Halaman {page.page}</b><span>{page.sourceHash.slice(0, 12)}…</span></header><p>{page.text}</p></article>)}
      {totalChunkPages > 1 && <nav className="knowledge-pagination" aria-label="Halaman teks manual"><a aria-disabled={chunkPage <= 1} href={chunkPage <= 1 ? detailPath : `${detailPath}?chunkPage=${chunkPage - 1}`}>← Sebelumnya</a><span>Bagian {chunkPage} dari {totalChunkPages}</span><a aria-disabled={chunkPage >= totalChunkPages} href={chunkPage >= totalChunkPages ? detailPath : `${detailPath}?chunkPage=${chunkPage + 1}`}>Berikutnya →</a></nav>}
    </section>}
  </main>;
}
