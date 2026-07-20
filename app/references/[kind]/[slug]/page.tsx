import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DetailThemeShell } from "@/app/detail-theme-shell";
import { getDecisionDocumentById, hasDatabase, listTaxRegulations } from "@/lib/db";
import { decodeReferenceSlug, type ReferenceKind } from "@/lib/reference-links";
import { regulations, type Regulation } from "@/lib/mock-data";
import { mergeRegulationRecords, regulationTopicLabel } from "@/lib/regulation-knowledge";
import type { StoredDecisionFile } from "@/lib/stored-decisions";
import { sessionFromCookieStore } from "@/lib/auth";
import { ReferenceViewer } from "./reference-viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ kind: string; slug: string }>;
  searchParams?: Promise<{ q?: string }>;
};

type ReferenceRecord = {
  kind: ReferenceKind;
  title: string;
  subtitle: string;
  badges: string[];
  meta: Array<[string, ReactNode]>;
  pdfUrl: string;
  sourceUrl: string;
  sourceText: string;
  regulation?: Regulation;
};

function dash(value: unknown) {
  return String(value || "").trim() || "-";
}

function isPdfUrl(value: string) {
  return /^https?:\/\//i.test(value) && /\.pdf(?:[?#].*)?$/i.test(value);
}

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\bChunk\s+\d+\s*:\s*/gi, "\n\n")
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function RsmMark() {
  return (
    <div className="rsm-mark detail-rsm-mark" aria-label="RSM">
      <span className="rsm-gray" />
      <span className="rsm-green" />
      <span className="rsm-blue" />
      <strong>RSM</strong>
    </div>
  );
}

function DetailRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="case-detail-rows">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function decisionReference(document: StoredDecisionFile): ReferenceRecord {
  const extraction = document.extraction;
  const pdfUrl = document.url?.startsWith("https://") ? document.url : document.downloadUrl?.startsWith("https://") ? document.downloadUrl : "";
  const sourceText = [
    `File: ${document.filename}`,
    `Nomor putusan: ${dash(extraction?.putusanNumber)}`,
    `Wajib pajak: ${dash(extraction?.taxpayerName)}`,
    `Jenis pajak: ${dash(extraction?.taxType)}`,
    `Masa pajak: ${dash(extraction?.taxPeriod)}`,
    `Pokok sengketa: ${dash(extraction?.issueType || extraction?.issueSubtype || extraction?.correctionObject)}`,
    `Ringkasan: ${cleanText(extraction?.summary)}`,
    `Posisi DJP: ${cleanText(extraction?.taxAuthorityPosition)}`,
    `Posisi WP: ${cleanText(extraction?.taxpayerPosition || extraction?.taxpayerRebuttal)}`,
    `Pertimbangan Majelis: ${cleanText(extraction?.courtReasoning)}`,
    `Amar/Outcome: ${cleanText(extraction?.outcome)}`,
    `Bukti: ${Array.isArray(extraction?.evidence) ? extraction?.evidence.join("; ") : "-"}`,
    `Dasar hukum: ${Array.isArray(extraction?.legalReferences) ? extraction?.legalReferences.join("; ") : "-"}`
  ].join("\n\n");

  return {
    kind: "decision",
    title: dash(extraction?.putusanNumber || document.filename),
    subtitle: [extraction?.taxpayerName, extraction?.taxType, extraction?.issueType || extraction?.issueSubtype].filter(Boolean).join(" · ") || document.filename,
    badges: [extraction?.taxType, extraction?.issueType || extraction?.issueSubtype, extraction?.outcome, document.status].filter(Boolean) as string[],
    meta: [
      ["Tipe referensi", "Putusan Pengadilan Pajak"],
      ["File", document.filename],
      ["Wajib pajak", dash(extraction?.taxpayerName)],
      ["Nomor putusan", dash(extraction?.putusanNumber)],
      ["Tahun", dash(extraction?.putusanYear)],
      ["Ukuran file", formatBytes(document.size)],
      ["PDF tersedia", pdfUrl ? "Ya" : "Belum"],
      ["Upload", new Date(document.uploadedAt).toLocaleString()]
    ],
    pdfUrl,
    sourceUrl: document.downloadUrl || document.url || "",
    sourceText
  };
}

async function regulationRecords() {
  const stored = hasDatabase() ? await listTaxRegulations().catch(() => []) : [];
  return mergeRegulationRecords([...stored, ...regulations]);
}

function regulationReference(record: Regulation): ReferenceRecord {
  const sourceUrl = record.sourceUrl || "";
  const pdfUrl = record.storedPdfUrl || record.pdfUrl || record.officialPdfUrl || (isPdfUrl(sourceUrl) ? sourceUrl : "");
  const topic = regulationTopicLabel(record.topic || "general", "id");
  const extraction = record.extraction;
  const sourceText = [
    `Judul: ${record.title}`,
    `Sitasi: ${record.citation}`,
    `Topik: ${topic}`,
    `Sumber: ${record.source || "seed"}`,
    `Fokus: ${record.focus}`,
    `Catatan awal: ${record.content || "-"}`,
    extraction ? `Hasil ekstraksi PDF: ${extraction.summary}` : "Hasil ekstraksi PDF: belum tersedia",
    extraction?.scope.length ? `Ruang lingkup: ${extraction.scope.join("; ")}` : "",
    extraction?.keyProvisions.length
      ? `Ketentuan kunci: ${extraction.keyProvisions.map((item) => `${item.article || "Bagian"}${item.page ? ` hal. ${item.page}` : ""}: ${item.text}`).join("; ")}`
      : "",
    record.relations?.length
      ? `Relasi antaraturan: ${record.relations.map((item) => `${item.type} ${item.citation}${item.note ? ` (${item.note})` : ""}`).join("; ")}`
      : ""
  ].filter(Boolean).join("\n\n");

  return {
    kind: "regulation",
    title: record.title,
    subtitle: `${record.citation} · ${topic}`,
    badges: [topic, record.citation, record.source || "seed", record.ingestionStatus || "seed", pdfUrl ? "PDF tersimpan" : "PDF belum tersedia"].filter(Boolean),
    meta: [
      ["Tipe referensi", "Peraturan pajak"],
      ["Judul", record.title],
      ["Sitasi", record.citation],
      ["Topik", topic],
      ["Sumber", record.source || "seed"],
      ["Otoritas sumber", record.sourceAuthority || "-"],
      ["Relevansi", `${record.relevance || 0}/100`],
      ["PDF tersedia", pdfUrl ? "Ya" : "Belum"],
      ["Status pipeline", record.ingestionStatus || "seed"],
      ["Hasil ekstraksi", extraction ? `${extraction.schemaVersion} · ${extraction.model}` : "Belum"],
      ["Update", record.updatedAt ? new Date(record.updatedAt).toLocaleString() : "-"]
    ],
    pdfUrl,
    sourceUrl,
    sourceText,
    regulation: record
  };
}

const relationLabels: Record<string, string> = {
  amends: "Mengubah",
  amended_by: "Diubah oleh",
  revokes: "Mencabut/menggantikan",
  revoked_by: "Dicabut oleh",
  implements: "Melaksanakan",
  references: "Merujuk",
  related: "Terkait"
};

function RegulationPipeline({ record }: { record: Regulation }) {
  const extraction = record.extraction;
  const relations = record.relations || extraction?.relations || [];
  return (
    <>
      <section className={`status-banner compact-status regulation-pipeline-status ${record.ingestionStatus === "failed" ? "error" : record.ingestionStatus === "ready" ? "success" : "warning"}`}>
        <div>
          <strong>Status pemrosesan: {record.ingestionStatus || "seed"}</strong>
          <span>{record.ingestionMessage || (extraction ? "PDF resmi telah diproses menjadi knowledge terstruktur." : "Record ini masih berupa metadata awal dan belum mempunyai hasil ekstraksi PDF.")}</span>
        </div>
      </section>

      <section className="case-detail-card regulation-provenance-card">
        <h3>Provenance dokumen resmi</h3>
        <DetailRows
          rows={[
            ["Halaman sumber", record.sourceUrl ? <a href={record.sourceUrl} target="_blank" rel="noreferrer">{record.sourceUrl}</a> : "-"],
            ["PDF resmi", record.officialPdfUrl ? <a href={record.officialPdfUrl} target="_blank" rel="noreferrer">Buka PDF pada sumber resmi</a> : "Belum ditemukan"],
            ["Salinan Blob", record.storedPdfUrl ? <a href={record.storedPdfUrl} target="_blank" rel="noreferrer">Buka salinan PDF tersimpan</a> : "Belum disimpan"],
            ["SHA-256", record.fileHash ? <code>{record.fileHash}</code> : "-"],
            ["Waktu ekstraksi", record.extractedAt ? new Date(record.extractedAt).toLocaleString() : "-"]
          ]}
        />
      </section>

      <section className="case-detail-card regulation-extraction-card">
        <h3>Hasil ekstraksi PDF</h3>
        {extraction ? (
          <div className="regulation-extraction-body">
            <div className="regulation-extraction-summary">
              <span>Ringkasan terverifikasi dari PDF</span>
              <p>{extraction.summary || "Ringkasan belum tersedia."}</p>
            </div>
            <div className="regulation-extraction-facts">
              <div><span>Status hukum dalam dokumen</span><strong>{extraction.legalStatus}</strong></div>
              <div><span>Tanggal berlaku</span><strong>{extraction.effectiveDate || "Perlu verifikasi"}</strong></div>
              <div><span>Model ekstraksi</span><strong>{extraction.model}</strong></div>
            </div>
            {extraction.scope.length > 0 && (
              <div>
                <h4>Ruang lingkup</h4>
                <ul>{extraction.scope.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            {extraction.keyProvisions.length > 0 && (
              <div className="regulation-provision-list">
                <h4>Ketentuan kunci</h4>
                {extraction.keyProvisions.map((item, index) => (
                  <article key={`${item.article || "provision"}-${index}`}>
                    <b>{item.article || "Bagian penting"}{item.page ? ` · halaman ${item.page}` : ""}</b>
                    <p>{item.text}</p>
                  </article>
                ))}
              </div>
            )}
            {extraction.verificationNotes.length > 0 && (
              <details className="regulation-verification-notes">
                <summary>Catatan yang masih perlu diverifikasi</summary>
                <ul>{extraction.verificationNotes.map((item) => <li key={item}>{item}</li>)}</ul>
              </details>
            )}
          </div>
        ) : (
          <div className="empty-state regulation-extraction-empty">
            Belum ada JSON ekstraksi PDF. Gunakan tombol <strong>Unduh, simpan & ekstrak PDF</strong> di bawah; metadata seed tidak dianggap sebagai hasil pembacaan dokumen.
          </div>
        )}
      </section>

      <section className="case-detail-card regulation-relations-card">
        <h3>Keterkaitan antaraturan</h3>
        {relations.length ? (
          <div className="regulation-relation-grid">
            {relations.map((relation, index) => (
              <article key={`${relation.type}-${relation.citation}-${index}`}>
                <span>{relationLabels[relation.type] || relation.type}</span>
                <strong>{relation.citation}</strong>
                {relation.title && <p>{relation.title}</p>}
                {relation.note && <small>{relation.note}</small>}
                <i>Sumber relasi: {relation.source === "pdf" ? "hasil ekstraksi PDF" : "catatan awal/seed"}</i>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">Belum ada relasi yang terverifikasi. Relasi akan dibentuk dari klausul mencabut, mengubah, melaksanakan, dan merujuk pada PDF resmi.</div>
        )}
      </section>
    </>
  );
}

async function getReference(kind: ReferenceKind, id: string): Promise<ReferenceRecord | null> {
  if (kind === "decision") {
    if (!hasDatabase()) return null;
    const document = await getDecisionDocumentById(id);
    return document ? decisionReference(document) : null;
  }

  const records = await regulationRecords();
  const record = records.find((item) => item.id === id);
  return record ? regulationReference(record) : null;
}

export default async function ReferencePage({ params, searchParams }: PageProps) {
  const session = sessionFromCookieStore(await cookies());
  if (!session) redirect("/");
  const { kind: rawKind, slug } = await params;
  if (rawKind !== "decision" && rawKind !== "regulation") notFound();

  let id = "";
  try {
    id = decodeReferenceSlug(slug);
  } catch {
    notFound();
  }

  const record = await getReference(rawKind, id);
  if (!record) notFound();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialQuery = String(resolvedSearchParams.q || "").trim();

  return (
    <DetailThemeShell className="reference-page">
      <aside className="detail-sidebar reference-sidebar">
        <RsmMark />
        <p className="caption">Tax Dispute Agentic Advisor</p>
        <div className="session-card">
          <span>Penampil referensi</span>
          <b>{record.kind === "decision" ? "Putusan" : "Peraturan"}</b>
          <i>{record.pdfUrl ? "PDF tersedia" : "Teks dan sumber"}</i>
        </div>
        <a className="table-button" href="/?page=smartchat">
          Kembali ke chatbot
        </a>
        {record.kind === "decision" && (
          <a className="table-button" href={`/decisions/${slug}`}>
            Buka detail putusan
          </a>
        )}
        {record.sourceUrl && (
          <a className="table-button detail-open-pdf" href={record.sourceUrl} target="_blank" rel="noreferrer">
            Buka sumber asli
          </a>
        )}
      </aside>
      <section className="detail-main reference-main">
        <article className="case-detail-sheet reference-sheet">
          <div className="case-detail-header reference-header">
            <div>
              <span className="case-detail-kicker">Halaman referensi · {record.kind === "decision" ? "putusan" : "peraturan"}</span>
              <h3>{record.title}</h3>
              <p>{record.subtitle}</p>
            </div>
            <div className="case-detail-meter">
              <span>PDF</span>
              <strong>{record.pdfUrl ? "Tersedia" : "Belum"}</strong>
            </div>
          </div>
          <div className="case-detail-badges">
            {record.badges.map((badge) => (
              <span key={badge}>{badge}</span>
            ))}
          </div>
          <section className="case-detail-card">
            <h3>Metadata referensi</h3>
            <DetailRows rows={record.meta} />
          </section>
          {record.regulation && <RegulationPipeline record={record.regulation} />}
          <ReferenceViewer
            canManage={session.role === "admin"}
            initialQuery={initialQuery}
            kind={record.kind}
            pdfUrl={record.pdfUrl}
            regulationId={record.regulation?.id || ""}
            ingestionStatus={record.regulation?.ingestionStatus || ""}
            sourceUrl={record.sourceUrl}
            sourceText={record.sourceText}
            title={record.title}
          />
        </article>
      </section>
    </DetailThemeShell>
  );
}
