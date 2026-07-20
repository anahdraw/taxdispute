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
  const pdfUrl = record.pdfUrl || (isPdfUrl(sourceUrl) ? sourceUrl : "");
  const topic = regulationTopicLabel(record.topic || "general", "id");
  const sourceText = [
    `Judul: ${record.title}`,
    `Sitasi: ${record.citation}`,
    `Topik: ${topic}`,
    `Sumber: ${record.source || "seed"}`,
    `Fokus: ${record.focus}`,
    `Catatan: ${record.content || "-"}`
  ].join("\n\n");

  return {
    kind: "regulation",
    title: record.title,
    subtitle: `${record.citation} · ${topic}`,
    badges: [topic, record.citation, record.source || "seed", pdfUrl ? "PDF tersedia" : "PDF belum tersedia"].filter(Boolean),
    meta: [
      ["Tipe referensi", "Peraturan pajak"],
      ["Judul", record.title],
      ["Sitasi", record.citation],
      ["Topik", topic],
      ["Sumber", record.source || "seed"],
      ["Relevansi", `${record.relevance || 0}/100`],
      ["PDF tersedia", pdfUrl ? "Ya" : "Belum"],
      ["Update", record.updatedAt ? new Date(record.updatedAt).toLocaleString() : "-"]
    ],
    pdfUrl,
    sourceUrl,
    sourceText
  };
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
          <ReferenceViewer
            initialQuery={initialQuery}
            kind={record.kind}
            pdfUrl={record.pdfUrl}
            sourceUrl={record.sourceUrl}
            sourceText={record.sourceText}
            title={record.title}
          />
        </article>
      </section>
    </DetailThemeShell>
  );
}
