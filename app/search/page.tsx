import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AlphaBrand } from "@/app/brand";
import { tierHasFeature } from "@/lib/admin";
import { sessionFromCookieStore } from "@/lib/auth";
import { TrustedSearchClient } from "./trusted-search-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TrustedSearchPage() {
  const session = sessionFromCookieStore(await cookies());
  if (!session) redirect("/");
  const canSearchDecisions = session.role === "admin" || tierHasFeature(session.tier, "databaseRead");
  const canSearchRegulations = session.role === "admin" || tierHasFeature(session.tier, "regulationRead");

  return (
    <main className="trusted-search-page">
      <header className="workspace-topbar trusted-search-topbar">
        <AlphaBrand />
        <nav aria-label="Navigasi trusted search">
          <a href="/">Kembali ke aplikasi</a>
          <a href="/workspace">Workspace</a>
          <a href="/watchlist">Watchlist</a>
          <a href="/knowledge">Knowledge hub</a>
          <span>{session.name}</span>
        </nav>
      </header>

      <section className="trusted-search-hero">
        <div>
          <span className="case-detail-kicker">Citation &amp; Trust Layer</span>
          <h1>Universal research search</h1>
          <p>Cari putusan dan peraturan sekaligus, saring dengan facet, buka time machine, lalu simpan bukti ke workspace dengan Trust Layer tetap aktif.</p>
        </div>
        <div className="trusted-search-guardrail">
          <b>Fail closed</b>
          <span>Scope selalu diverifikasi ulang dari sesi di server.</span>
        </div>
      </section>

      <TrustedSearchClient canSearchDecisions={canSearchDecisions} canSearchRegulations={canSearchRegulations} />
    </main>
  );
}
