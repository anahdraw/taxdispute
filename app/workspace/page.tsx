import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AlphaBrand } from "@/app/brand";
import { sessionFromCookieStore } from "@/lib/auth";
import { WorkspaceDashboard } from "./workspace-dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const session = sessionFromCookieStore(await cookies());
  if (!session) redirect("/");
  return (
    <main className="workspace-page">
      <header className="workspace-topbar">
        <AlphaBrand />
        <div>
          <a href="/">Kembali ke aplikasi</a>
          <span>{session.name}</span>
        </div>
      </header>
      <section className="workspace-hero">
        <span className="case-detail-kicker">Private matter workspace</span>
        <h1>Client, perkara, dokumen, dan riset</h1>
        <p>Data dipisahkan berdasarkan tenant, user, client, dan matter. Mode development tersimpan lokal di perangkat ini.</p>
      </section>
      <WorkspaceDashboard />
    </main>
  );
}
