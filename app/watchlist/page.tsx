import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AlphaBrand } from "@/app/brand";
import { sessionFromCookieStore } from "@/lib/auth";
import { WatchlistClient } from "./watchlist-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const session = sessionFromCookieStore(await cookies());
  if (!session) redirect("/");
  return <main className="watchlist-page">
    <header className="workspace-topbar"><AlphaBrand /><nav><a href="/workbench">Dispute workbench</a><a href="/search">Universal search</a><a href="/knowledge">Knowledge hub</a><a href="/workspace">Workspace</a><a href="/">Aplikasi</a><span>{session.name}</span></nav></header>
    <section className="workspace-hero"><span className="case-detail-kicker">Research monitoring</span><h1>Watchlist &amp; alert</h1><p>Pantau perubahan hash sumber, status hukum, tanggal berlaku, relasi graph, dan aturan baru yang cocok dengan topik riset.</p></section>
    <WatchlistClient />
  </main>;
}
