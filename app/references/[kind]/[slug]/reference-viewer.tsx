"use client";

import { useMemo, useState } from "react";
import { LLM_MODEL_HEADER, MODEL_CHOICE_STORAGE_KEY, normalizeModelChoice } from "@/lib/model-options";

export type ReferenceViewerProps = {
  canManage?: boolean;
  initialQuery: string;
  ingestionStatus?: string;
  kind: string;
  pdfUrl: string;
  regulationId?: string;
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

function currentModelHeader() {
  try {
    return { [LLM_MODEL_HEADER]: normalizeModelChoice(window.localStorage.getItem(MODEL_CHOICE_STORAGE_KEY)) };
  } catch {
    return { [LLM_MODEL_HEADER]: normalizeModelChoice("") };
  }
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

function InlineRichText({ text }: { text: string }) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong> : <span key={`${part}-${index}`}>{part}</span>
      )}
    </>
  );
}

function AnswerText({ text }: { text: string }) {
  const blocks = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className="rich-text reference-answer-text">
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const isList = lines.every((line) => /^[-•]\s+/.test(line));
        if (isList) {
          return (
            <ul key={`block-${index}`}>
              {lines.map((line, lineIndex) => (
                <li key={`line-${lineIndex}`}>
                  <InlineRichText text={line.replace(/^[-•]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={`block-${index}`}>
            <InlineRichText text={block.replace(/^#{1,6}\s*/, "")} />
          </p>
        );
      })}
    </div>
  );
}

export function ReferenceViewer({ canManage = false, initialQuery, ingestionStatus = "", kind, pdfUrl, regulationId = "", sourceUrl, sourceText, title }: ReferenceViewerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [processingPdf, setProcessingPdf] = useState(false);
  const pdfSrc = useMemo(() => (pdfUrl ? buildPdfSrc(pdfUrl, query) : ""), [pdfUrl, query]);
  const matchCount = useMemo(() => {
    const cleanQuery = query.trim();
    if (!cleanQuery) return 0;
    return (sourceText.match(new RegExp(escapeRegExp(cleanQuery), "gi")) || []).length;
  }, [query, sourceText]);

  async function processRegulationPdf() {
    if (!regulationId) return;
    setProcessingPdf(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/regulations/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: regulationId, limit: 1 })
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        enriched?: number;
        results?: Array<{ extracted?: boolean; message?: string; pdfStored?: boolean; status?: string }>;
      };
      if (!response.ok) throw new Error(data.error || "PDF resmi tidak dapat diproses.");
      const result = data.results?.[0];
      const message = result?.message || "PDF resmi telah diproses.";
      if (result?.status === "failed") throw new Error(message);
      setStatus(message);
      window.setTimeout(() => window.location.reload(), 700);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PDF resmi tidak dapat diproses.");
    } finally {
      setProcessingPdf(false);
    }
  }

  async function askReferenceBot() {
    const trimmed = question.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    setStatus("");
    setAnswer("");
    try {
      const response = await fetch("/api/reference-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...currentModelHeader() },
        body: JSON.stringify({
          question: trimmed,
          language: "id",
          title,
          kind,
          sourceText
        })
      });
      const data = (await response.json().catch(() => ({}))) as { answer?: string; error?: string; llmStatus?: { message?: string } };
      if (!response.ok) throw new Error(data.error || "Smartbot referensi gagal menjawab.");
      setAnswer(data.answer || "");
      setStatus(data.llmStatus?.message || "Smartbot referensi menjawab dari konteks dokumen ini.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Smartbot referensi gagal menjawab.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="reference-viewer">
      <div className="reference-search-card">
        <label>
          <span>Cari kata kunci di referensi</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Contoh: minyak, PPN, faktur pajak, arm's length" />
        </label>
        <div className="reference-search-actions">
          {kind === "regulation" && canManage && regulationId && (
            <button className="primary-button" onClick={processRegulationPdf} disabled={processingPdf}>
              {processingPdf
                ? "Mengunduh, menyimpan & mengekstrak..."
                : ingestionStatus === "ready"
                  ? "Unduh ulang & ekstrak ulang PDF"
                  : "Unduh, simpan & ekstrak PDF"}
            </button>
          )}
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

      <section className="reference-chat-card">
        <div>
          <h3>Tanya Smartbot tentang referensi ini</h3>
          <p className="muted">Jawaban dibatasi pada konteks referensi yang sedang dibuka agar lebih hemat token dan mudah diverifikasi.</p>
        </div>
        <label>
          <span>Pertanyaan</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Contoh: Apa isu utama dalam putusan ini? Dasar hukum apa yang dipakai? Bagian mana yang relevan untuk PPN minyak?"
            rows={3}
          />
        </label>
        <button className="primary-button" onClick={askReferenceBot} disabled={loading || !question.trim()}>
          {loading ? "Menjawab..." : "Tanya Smartbot Referensi"}
        </button>
        {status && <div className="status-banner success compact-status">{status}</div>}
        {error && <div className="status-banner error compact-status">{error}</div>}
        {answer && <AnswerText text={answer} />}
      </section>

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
