import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AlphaBrand } from "@/app/brand";
import { sessionFromCookieStore } from "@/lib/auth";
import { getEnterpriseReadiness } from "@/lib/enterprise-readiness";
import { defaultWorkspaceTenantId } from "@/lib/workspace";
import { EnterpriseReadinessClient } from "./readiness-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EnterprisePage() {
  const session = sessionFromCookieStore(await cookies());
  if (!session || session.role !== "admin") redirect("/");
  const initial = await getEnterpriseReadiness(defaultWorkspaceTenantId());
  return <main className="enterprise-page">
    <header className="workspace-topbar"><AlphaBrand /><nav><a href="/search">Search</a><a href="/workbench">Workbench</a><a href="/workspace">Workspace</a><a href="/">Aplikasi</a><span>{session.name}</span></nav></header>
    <section className="enterprise-hero"><div><span className="case-detail-kicker">Gelombang 5 · enterprise scale</span><h1>Enterprise Readiness</h1><p>Status teknis yang fail-closed: apa yang siap lokal, baru parsial, atau masih menjadi gap produksi.</p></div><aside><b>Tidak ada status kosmetik</b><span>Full-corpus LightRAG baru “ready” jika jumlah dokumen dan hash indeks aktif sama dengan manifest.</span></aside></section>
    <EnterpriseReadinessClient initial={initial} />
  </main>;
}
