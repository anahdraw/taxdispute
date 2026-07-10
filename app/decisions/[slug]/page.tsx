import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DetailThemeShell } from "@/app/detail-theme-shell";
import { DecisionDetailActions } from "./actions";
import { decodeDecisionSlug } from "@/lib/decision-links";
import { getDecisionDocumentById, hasDatabase } from "@/lib/db";
import type { ExtractionResult } from "@/lib/extraction";
import { hasPpnComponentData, ppnClassificationRows, ppnComponentRows, ppnFormulaRows } from "@/lib/ppn-components";
import { referenceDetailPath } from "@/lib/reference-links";
import type { StoredDecisionFile } from "@/lib/stored-decisions";
import { sessionFromCookieStore } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

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

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\bChunk\s+\d+\s*:\s*/gi, "\n\n")
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function dash(value: unknown) {
  return String(value || "").trim() || "-";
}

function truncate(value: unknown, maxLength = 620) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, "")}...`;
}

function safeDomId(value: unknown) {
  return String(value || "case").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96);
}

function classifyOutcome(outcome: string) {
  const text = outcome.toLowerCase();
  if (/dikabulkan seluruh|fully|granted in full|seluruhnya/.test(text)) return "WP full win";
  if (/dikabulkan sebagian|partial|partially|sebagian/.test(text)) return "WP partial win";
  if (/tidak dapat diterima|gugur|formal|dismiss/.test(text)) return "Formal dismissal";
  if (/ditolak|djp|terbanding|authority|rejected/.test(text)) return "DJP win / appeal rejected";
  return "Unclassified";
}

function extractionCompleteness(extraction: ExtractionResult | null | undefined) {
  if (!extraction) return 0;
  const scalarFields: Array<keyof ExtractionResult> = [
    "putusanNumber",
    "putusanYear",
    "courtPanel",
    "clerkName",
    "decisionDate",
    "taxpayerName",
    "taxpayerNpwp",
    "taxpayerAddress",
    "legalCounselName",
    "djpUnit",
    "taxType",
    "taxPeriod",
    "skpNumber",
    "djpDecisionNumber",
    "issueType",
    "correctionAmount",
    "taxAuthorityPosition",
    "taxpayerPosition",
    "courtReasoning",
    "outcome"
  ];
  const filled = scalarFields.filter((field) => String(extraction[field] || "").trim()).length;
  const arrayFilled = [extraction.judgeNames, extraction.evidence, extraction.legalReferences].filter((items) => Array.isArray(items) && items.length > 0).length;
  return Math.round(((filled + arrayFilled) / (scalarFields.length + 3)) * 100);
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

function DetailRows({ rows }: { rows: Array<[string, React.ReactNode]> }) {
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

function CaseDetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="case-detail-card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function HoverHelp({ text, hint }: { text: React.ReactNode; hint: string }) {
  return (
    <span className="hover-help" tabIndex={0} aria-label={typeof text === "string" ? `${text}. ${hint}` : hint}>
      <span className="hover-help-label">{text}</span>
      <span className="hover-help-icon" aria-hidden="true">i</span>
      <span className="hover-help-tooltip" role="tooltip">{hint}</span>
    </span>
  );
}

function PpnComponentsCard({ extraction }: { extraction: ExtractionResult }) {
  if (!hasPpnComponentData(extraction)) return null;
  const ppn = extraction.ppnComponents;
  const componentRows = ppnComponentRows(ppn, "id");
  const classificationRows = ppnClassificationRows(ppn, "id");
  const formulaRows = ppnFormulaRows(ppn, "id");

  return (
    <CaseDetailCard title="Komponen PPN">
      <div className="ppn-component-table">
        <table>
          <thead>
            <tr>
              <th>Komponen</th>
              <th>Key</th>
              <th>Nilai terekstraksi</th>
            </tr>
          </thead>
          <tbody>
            {[...componentRows, ...classificationRows].map((row) => (
              <tr key={row.key}>
                <td>
                  <HoverHelp text={row.label} hint={row.hint} />
                </td>
                <td className="mono-cell">{row.key}</td>
                <td className={String(row.value).startsWith("Rp") || String(row.value).startsWith("-Rp") ? "currency-cell" : ""}>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {formulaRows.length > 0 && (
        <>
          <h4 className="case-subtitle">Cek rumus indikatif</h4>
          <div className="ppn-component-table">
            <table>
              <thead>
                <tr>
                  <th>Rumus</th>
                  <th>Hasil indikatif</th>
                </tr>
              </thead>
              <tbody>
                {formulaRows.map((row) => (
                  <tr key={row.formula}>
                    <td>
                      <HoverHelp text={row.formula} hint={row.basis} />
                    </td>
                    <td className="currency-cell">{row.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {ppn.ppn_notes && <p className="muted ppn-note">{ppn.ppn_notes}</p>}
    </CaseDetailCard>
  );
}

function CaseDetailSheet({ document }: { document: StoredDecisionFile }) {
  const extraction = document.extraction;
  if (!extraction) {
    return <div className="empty-state">This document has no extraction data yet. Re-extract it from Decision Database first.</div>;
  }

  const completeness = extractionCompleteness(extraction);
  const outcomeLabel = classifyOutcome(extraction.outcome || "");
  const badges = [extraction.taxType, extraction.issueType || extraction.issueSubtype, extraction.documentType, outcomeLabel, `${completeness}% extraction confidence`].filter(Boolean);
  const judges = Array.isArray(extraction.judgeNames) && extraction.judgeNames.length ? extraction.judgeNames.join("; ") : "-";
  const legalReferences = Array.isArray(extraction.legalReferences) && extraction.legalReferences.length ? extraction.legalReferences.join("; ") : "-";
  const evidence = Array.isArray(extraction.evidence) && extraction.evidence.length ? extraction.evidence.join("; ") : "-";
  const tabBase = `case-tabs-${safeDomId(document.id)}`;

  return (
    <article className="case-detail-sheet linked-case-sheet">
      <div className="case-detail-header">
        <div>
          <span className="case-detail-kicker">Putusan detail · linked page</span>
          <h3>{dash(extraction.putusanNumber || document.filename)}</h3>
          <p>
            Tahun {dash(extraction.putusanYear)}
            {extraction.courtPanel ? ` · Panel ${extraction.courtPanel}` : ""}
            {extraction.hearingDate ? ` · Sidang ${extraction.hearingDate}` : ""}
          </p>
        </div>
        <div className="case-detail-meter">
          <span>Extraction confidence</span>
          <strong>{completeness}%</strong>
        </div>
      </div>

      <div className="case-detail-badges">
        {badges.map((badge) => (
          <span key={badge}>{badge}</span>
        ))}
      </div>

      <div className="case-detail-tabs">
        <input className="case-tab-radio" id={`${tabBase}-metadata`} name={tabBase} type="radio" defaultChecked />
        <input className="case-tab-radio" id={`${tabBase}-calculation`} name={tabBase} type="radio" />
        <input className="case-tab-radio" id={`${tabBase}-paragraphs`} name={tabBase} type="radio" />
        <div className="case-tab-list" role="tablist" aria-label="Putusan detail sections">
          <label htmlFor={`${tabBase}-metadata`}>1. Metadata penting</label>
          <label htmlFor={`${tabBase}-calculation`}>2. Perhitungan</label>
          <label htmlFor={`${tabBase}-paragraphs`}>3. Paragraf penting</label>
        </div>
        <div className="case-tab-panels">
          <section className="case-tab-panel">
            <div className="case-file-stats">
              <div>
                <span>File asli</span>
                <b>{document.filename}</b>
              </div>
              <div>
                <span>File size</span>
                <b>{formatBytes(document.size)}</b>
              </div>
              <div>
                <span>Uploaded at</span>
                <b>{new Date(document.uploadedAt).toLocaleString()}</b>
              </div>
              <div>
                <span>LLM</span>
                <b>{extraction.llmStatus?.model || "-"}</b>
              </div>
            </div>
            <CaseDetailCard title="Informasi kunci">
              <DetailRows
                rows={[
                  ["Outcome", dash(extraction.outcome)],
                  ["Klasifikasi", outcomeLabel],
                  ["Jenis pajak", dash(extraction.taxType)],
                  ["Masa/Tahun Pajak", dash(extraction.taxPeriod)],
                  ["Nomor putusan", dash(extraction.putusanNumber)],
                  ["Nomor SKP/STP", dash(extraction.skpNumber)],
                  ["Nomor KEP", dash(extraction.djpDecisionNumber)],
                  ["Nilai sengketa/koreksi", dash(extraction.correctionAmount)],
                  ["Objek koreksi", dash(extraction.correctionObject)]
                ]}
              />
            </CaseDetailCard>
            <div className="case-detail-grid two">
              <CaseDetailCard title="Pemohon Banding / WP">
                <DetailRows
                  rows={[
                    ["Nama", dash(extraction.taxpayerName)],
                    ["NPWP", dash(extraction.taxpayerNpwp)],
                    ["Alamat", truncate(extraction.taxpayerAddress, 220)],
                    ["Wakil", dash(extraction.representativeName)],
                    ["Kuasa hukum", dash(extraction.legalCounselName)],
                    ["Lisensi kuasa", dash(extraction.legalCounselLicense)]
                  ]}
                />
              </CaseDetailCard>
              <CaseDetailCard title="Terbanding / DJP">
                <DetailRows
                  rows={[
                    ["Unit", dash(extraction.djpUnit || extraction.appelleeName)],
                    ["Nama pihak", dash(extraction.appelleeName)],
                    ["Jenis pajak", dash(extraction.taxType)],
                    ["Masa/Tahun Pajak", dash(extraction.taxPeriod)]
                  ]}
                />
              </CaseDetailCard>
            </div>
            <CaseDetailCard title="Majelis Hakim">
              <DetailRows
                rows={[
                  ["Majelis", dash(extraction.courtPanel)],
                  ["Hakim", judges],
                  ["Panitera", dash(extraction.clerkName)],
                  ["Jenis acara", dash(extraction.procedureType)],
                  ["Tingkat pemeriksaan", dash(extraction.examinationLevel)],
                  ["Nomor berkas", dash(extraction.caseFileNumber)],
                  ["Tanggal putusan", dash(extraction.decisionDate)]
                ]}
              />
            </CaseDetailCard>
          </section>
          <section className="case-tab-panel">
            {hasPpnComponentData(extraction) ? (
              <PpnComponentsCard extraction={extraction} />
            ) : (
              <CaseDetailCard title="Komponen PPN terekstraksi">
                <p>Belum ada komponen PPN terstruktur pada data ini. Gunakan Re-extract agar field PPN baru dibaca dari dokumen.</p>
              </CaseDetailCard>
            )}
            <CaseDetailCard title="Nilai sengketa umum">
              <DetailRows
                rows={[
                  ["Sebelum / nilai koreksi", dash(extraction.correctionAmount)],
                  ["Objek koreksi", dash(extraction.correctionObject)],
                  ["Outcome", dash(extraction.outcome)],
                  ["Klasifikasi", outcomeLabel]
                ]}
              />
            </CaseDetailCard>
          </section>
          <section className="case-tab-panel">
            <CaseDetailCard title="Pokok Sengketa">
              <div className="case-issue-card">
                <b>{dash(extraction.issueType || extraction.issueSubtype || extraction.correctionObject)}</b>
                <p>{truncate(extraction.summary || extraction.correctionReason || extraction.taxAuthorityPosition, 700)}</p>
              </div>
            </CaseDetailCard>
            <div className="case-detail-grid two">
              <CaseDetailCard title="Menurut Terbanding / DJP">
                <p>{truncate(extraction.taxAuthorityPosition || extraction.correctionReason, 700) || "-"}</p>
              </CaseDetailCard>
              <CaseDetailCard title="Menurut Pemohon Banding / WP">
                <p>{truncate(extraction.taxpayerPosition || extraction.taxpayerRebuttal, 700) || "-"}</p>
              </CaseDetailCard>
            </div>
            <div className="case-detail-grid two">
              <CaseDetailCard title="Bukti terdeteksi">
                <p>{evidence}</p>
              </CaseDetailCard>
              <CaseDetailCard title="Dasar hukum terdeteksi">
                <p>{legalReferences}</p>
              </CaseDetailCard>
            </div>
            <CaseDetailCard title="Konten Putusan">
              <DetailRows
                rows={[
                  ["Pertimbangan", truncate(extraction.courtReasoning, 1000)],
                  ["Amar putusan", truncate(extraction.outcome, 520)]
                ]}
              />
            </CaseDetailCard>
          </section>
        </div>
      </div>
    </article>
  );
}

export default async function DecisionDetailPage({ params }: PageProps) {
  const session = sessionFromCookieStore(await cookies());
  if (!session) redirect("/");
  const { slug } = await params;
  if (!hasDatabase()) notFound();

  let documentId = "";
  try {
    documentId = decodeDecisionSlug(slug);
  } catch {
    notFound();
  }

  const document = await getDecisionDocumentById(documentId);
  if (!document) notFound();

  return (
    <DetailThemeShell className="decision-detail-page">
      <aside className="detail-sidebar">
        <RsmMark />
        <p className="caption">Tax Dispute Agentic Advisor</p>
        <div className="session-card">
          <span>Detail putusan</span>
          <b>{document.extraction?.putusanNumber || document.filename}</b>
          <i>{document.status}</i>
        </div>
        <DecisionDetailActions document={document} backLabel="Kembali ke database" printLabel="Cetak / simpan PDF" canManage={session.role === "admin"} />
        {(document.downloadUrl || document.url).startsWith("https://") && (
          <a className="table-button detail-open-pdf" href={referenceDetailPath("decision", document.id)}>
            Buka penampil PDF
          </a>
        )}
      </aside>
      <section className="detail-main">
        <CaseDetailSheet document={document} />
      </section>
    </DetailThemeShell>
  );
}
