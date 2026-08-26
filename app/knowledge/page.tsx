import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AlphaBrand } from "@/app/brand";
import { tierHasFeature } from "@/lib/admin";
import { sessionFromCookieStore } from "@/lib/auth";
import { KnowledgeHubClient } from "./knowledge-hub-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const session = sessionFromCookieStore(await cookies());
  if (!session) redirect("/");
  if (session.role !== "admin" && !tierHasFeature(session.tier, "regulationRead")) redirect("/");
  return (
    <main className="knowledge-page">
      <header className="workspace-topbar">
        <AlphaBrand />
        <nav aria-label="Navigasi knowledge hub">
          <a href="/search">Universal search</a>
          <a href="/watchlist">Watchlist</a>
          <a href="/workspace">Workspace</a>
          <a href="/">Aplikasi</a>
          <span>{session.name}</span>
        </nav>
      </header>
      <section className="knowledge-hero">
        <div>
          <span className="case-detail-kicker">Gelombang 3 · parity pengetahuan</span>
          <h1>Tax Knowledge Hub</h1>
          <p>P3B/MLI, panduan praktis, tax manual, perubahan hukum, glosarium, formulir, dan kurs—dengan asal sumber serta kekurangan data yang terlihat jelas.</p>
        </div>
        <div className="knowledge-hero-note"><b>Evidence first</b><span>Manual tidak diperlakukan sebagai hukum; data dinamis tidak disebut mutakhir tanpa sinkronisasi resmi.</span></div>
      </section>
      <KnowledgeHubClient />
    </main>
  );
}
