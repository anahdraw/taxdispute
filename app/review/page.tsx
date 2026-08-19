import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AlphaBrand } from "@/app/brand";
import { sessionFromCookieStore } from "@/lib/auth";
import { RegulationReviewClient } from "./regulation-review-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RegulationReviewPage() {
  const session = sessionFromCookieStore(await cookies());
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/");
  return (
    <main className="regulation-review-page">
      <header className="workspace-topbar regulation-review-topbar">
        <AlphaBrand />
        <nav aria-label="Navigasi review peraturan">
          <a href="/">Kembali ke aplikasi</a>
          <a href="/search">Trusted search</a>
          <a href="/workspace">Workspace</a>
          <span>{session.name}</span>
        </nav>
      </header>
      <section className="regulation-review-hero">
        <div>
          <span className="case-detail-kicker">Internal quality control</span>
          <h1>Review peraturan &amp; graph evidence</h1>
          <p>Verifikasi identity, status hukum, sitasi, dan relasi sebelum dipakai sebagai evidence jawaban AI.</p>
        </div>
        <div className="regulation-review-guardrail"><b>Fail closed</b><span>Item berstatus review_required tidak menjadi evidence terverifikasi.</span></div>
      </section>
      <RegulationReviewClient reviewer={session.name} />
    </main>
  );
}
