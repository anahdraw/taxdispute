import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AlphaBrand } from "@/app/brand";
import { sessionFromCookieStore } from "@/lib/auth";
import { DisputeWorkbenchClient } from "./workbench-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DisputeWorkbenchPage() {
  const session = sessionFromCookieStore(await cookies()); if (!session) redirect("/");
  return <main className="workbench-page">
    <header className="workspace-topbar"><AlphaBrand /><nav><a href="/workspace">Workspace</a><a href="/search">Search</a><a href="/watchlist">Watchlist</a><a href="/knowledge">Knowledge</a><a href="/">Aplikasi</a><span>{session.name}</span></nav></header>
    <section className="workbench-hero"><div><span className="case-detail-kicker">Tax Dispute Operating System</span><h1>Dispute Workbench</h1><p>Dari proposisi dan bukti menuju preseden, kalkulasi, draf, dampak regulasi, dan approval—seluruhnya terikat pada matter yang sama.</p></div><aside><b>Fail-closed</b><span>Draf tidak dianggap final, kemiripan bukan prediksi, dan kalkulasi tetap skenario sampai direview.</span></aside></section>
    <DisputeWorkbenchClient />
  </main>;
}
