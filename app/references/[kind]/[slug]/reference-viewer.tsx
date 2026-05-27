"use client";

import { useMemo, useState } from "react";

export type ReferenceViewerProps = {
  initialQuery: string;
  pdfUrl: string;
  sourceUrl: string;
  sourceText: string;
  title: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPdfSrc(pdfUrl: string, query: string) {
  const cleanQuery = query.trim();
  const hash = new URLSearchParams();
  hash.set("toolbar", "1");
  hash.set("navpanes", "0");
  if (cleanQuery) hash.set("search", cleanQuery);
  return `${pdfUrl}#${hash.toString()}`;
}

function TextPreview({ text, query }: { text: string; query: string }) {
  const blocks = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 14);
  const cleanQuery = query.trim();
  const pattern = cleanQuery ? new RegExp(`(${escapeRegExp(cleanQuery)})`, "ig") : null;

  return (
    <div className="reference-text-preview">
      {blocks.map((block, blockIndex) => {
        if (!pattern) return <p key={blockIndex}>{block}</p>;
        const parts = block.split(pattern).filter(Boolean);
        return (
          <p key={blockIndex}>
            {parts.map((part, partIndex) =>
              part.toLowerCase() === cleanQuery.toLowerCase() ? <mark key={`${part}-${partIndex}`}>{part}</mark> : <span key={`${part}-${partIndex}`}>{part}</span>
            )}
          </p>
        );
      })}
    </div>
  );
}

export function ReferenceViewer({ initialQuery, pdfUrl, sourceUrl, sourceText, title }: ReferenceViewerProps) {
  const [query, setQuery] = useState(initialQuery);
  const pdfSrc = useMemo(() => (pdfUrl ? buildPdfSrc(pdfUrl, query) : ""), [pdfUrl, query]);
  const matchCount = useMemo(() => {
    const cleanQuery = query.trim();
    if (!cleanQuery) return 0;
    return (sourceText.match(new RegExp(escapeRegExp(cleanQuery), "gi")) || []).length;
  }, [query, sourceText]);

  return (
    <section className="reference-viewer">
      <div className="reference-search-card">
        <label>
          <span>Cari kata kunci di referensi</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Contoh: minyak, PPN, faktur pajak, arm's length" />
        </label>
        <div className="reference-search-actions">
          {pdfUrl && (
            <a className="table-button" href={pdfSrc} target="_blank" rel="noreferrer">
              Buka PDF di tab baru
            </a>
          )}
          {sourceUrl && sourceUrl !== pdfUrl && (
            <a className="table-button" href={sourceUrl} target="_blank" rel="noreferrer">
              Buka sumber asli
            </a>
          )}
        </div>
        <p className="muted">
          {pdfUrl
            ? "Viewer PDF memakai pencarian bawaan browser. Jika highlight belum muncul otomatis, gunakan Ctrl/Cmd+F di area PDF."
            : "PDF belum tersedia untuk referensi ini. Pencarian dilakukan pada metadata dan ringkasan yang tersimpan."}
          {query.trim() ? ` Ditemukan ${matchCount} kecocokan di teks ringkasan.` : ""}
        </p>
      </div>

      {pdfUrl ? (
        <div className="reference-pdf-frame">
          <iframe key={pdfSrc} title={`PDF viewer - ${title}`} src={pdfSrc} />
        </div>
      ) : (
        <div className="status-banner warning reference-no-pdf">PDF belum tersedia. Gunakan link sumber asli atau teks ringkasan di bawah.</div>
      )}

      <section className="case-detail-card reference-text-card">
        <h3>Teks ringkasan / metadata</h3>
        <TextPreview text={sourceText} query={query} />
      </section>
    </section>
  );
}
