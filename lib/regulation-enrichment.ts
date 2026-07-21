import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import type {
  Regulation,
  RegulationExtraction,
  RegulationProvision,
  RegulationRelation,
  RegulationRelationType
} from "./mock-data";
import { callOpenAIWithPdf, configuredModel, extractJsonObject, hasOpenAIKey } from "./openai";
import { deriveRegulationRelations, normalizeRegulationText } from "./regulation-knowledge";

const MAX_SOURCE_TEXT = 20000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const VERIFIED_PDF_OVERRIDES: Record<string, string[]> = {
  "pmk no. 15 tahun 2025": [
    "https://jdih.kemenkeu.go.id/api/download/20fcc3b3-4425-4664-816c-e5dae731d52a/2025pmkeuangan015.pdf",
    "https://peraturan.bpk.go.id/Download/375099/2025pmkeuangan015.pdf"
  ]
};

type DownloadedPdf = { bytes: ArrayBuffer; url: string };

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function cleanText(value: string) {
  return decodeHtml(value)
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtml(html: string) {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<(br|p|div|li|tr|h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function pageTitle(html: string) {
  return cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function removePreviousEnrichment(content: string) {
  return content.split("\n\n--- Official source indexing")[0].split("\n\n--- Source enrichment")[0].trim();
}

function sourceName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "official repository";
  }
}

function isPdfResponse(contentType: string, url: string) {
  return /application\/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(url);
}

function absoluteUrl(value: string, baseUrl: string) {
  try {
    return new URL(cleanText(value), baseUrl).toString();
  } catch {
    return "";
  }
}

function pdfCandidates(html: string, baseUrl: string) {
  const candidates = new Map<string, number>();
  const normalizedHtml = cleanText(html);
  const add = (href: string, label = "") => {
    const url = absoluteUrl(href, baseUrl);
    if (!/^https?:\/\//i.test(url)) return;
    const haystack = `${url} ${stripHtml(label)}`.toLowerCase();
    let score = 0;
    if (/\.pdf(?:$|[?#])/.test(url.toLowerCase())) score += 100;
    if (/\b(pdf|unduh|download|lampiran|dokumen|berkas)\b/.test(haystack)) score += 45;
    if (/\/(api\/download|download|unduh|uploads?|files?|documents?)\//.test(url.toLowerCase())) score += 40;
    if (/peraturan|jdih|pajak|kemenkeu|bpk|djp/.test(url.toLowerCase())) score += 10;
    if (score >= 45) candidates.set(url, Math.max(score, candidates.get(url) || 0));
  };

  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) add(match[1], match[2]);
  const rawUrlPattern = /(?:https?:\/\/[^\s"'<>]+|\/(?:api\/download|Download|download|files?)\/[^\s"'<>]+)/gi;
  for (const match of normalizedHtml.matchAll(rawUrlPattern)) add(match[0], "download pdf");
  return [...candidates.entries()].sort((left, right) => right[1] - left[1]).map(([url]) => url);
}

function sourcePageCandidates(sourceUrl: string) {
  const pages = [sourceUrl];
  try {
    const parsed = new URL(sourceUrl);
    if (/jdih\.kemenkeu\.go\.id$/i.test(parsed.hostname) && /^\/dok\/[^/]+\/?$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/files`;
      pages.push(parsed.toString());
    }
  } catch {
    // The caller validates sourceUrl before this helper runs.
  }
  return [...new Set(pages)];
}

function verifiedOverrides(record: Regulation) {
  const key = normalizeRegulationText(record.citation || record.title).toLowerCase();
  return VERIFIED_PDF_OVERRIDES[key] || [];
}

async function fetchWithTimeout(url: string, accept: string, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: accept,
        "User-Agent": "Alpha-AI-Jurist/1.0 (+official-regulation-indexer)"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadOfficialPdf(url: string): Promise<DownloadedPdf | null> {
  const response = await fetchWithTimeout(url, "application/pdf,*/*;q=0.8", 30000);
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") || "";
  if (!isPdfResponse(contentType, response.url || url)) return null;
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(
      bytes.byteLength > MAX_PDF_BYTES
        ? `Official PDF is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the indexing limit is 20 MB.`
        : "Official PDF was empty."
    );
  }
  return { bytes, url: response.url || url };
}

async function resolveOfficialSource(record: Regulation, sourceUrl: string) {
  const candidateUrls: string[] = [...verifiedOverrides(record)];
  let sourceText = "";
  let title = "";
  let resolvedPageUrl = sourceUrl;
  const pageMessages: string[] = [];

  for (const pageUrl of sourcePageCandidates(sourceUrl)) {
    try {
      const response = await fetchWithTimeout(pageUrl, "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8");
      if (!response.ok) {
        pageMessages.push(`${sourceName(pageUrl)} HTTP ${response.status}`);
        continue;
      }
      resolvedPageUrl = response.url || pageUrl;
      const contentType = response.headers.get("content-type") || "";
      if (isPdfResponse(contentType, resolvedPageUrl)) {
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength && bytes.byteLength <= MAX_PDF_BYTES) {
          return { pdf: { bytes, url: resolvedPageUrl } as DownloadedPdf, sourceText, title, resolvedPageUrl, pageMessages };
        }
      } else {
        const raw = await response.text();
        title ||= pageTitle(raw);
        const pageText = (contentType.includes("html") || raw.includes("<html") ? stripHtml(raw) : cleanText(raw)).slice(0, MAX_SOURCE_TEXT);
        if (pageText.length > sourceText.length) sourceText = pageText;
        candidateUrls.push(...pdfCandidates(raw, resolvedPageUrl));
      }
    } catch (error) {
      pageMessages.push(`${sourceName(pageUrl)}: ${error instanceof Error ? error.message : "unreachable"}`);
    }
  }

  for (const candidate of [...new Set(candidateUrls)].slice(0, 16)) {
    try {
      const pdf = await downloadOfficialPdf(candidate);
      if (pdf) return { pdf, sourceText, title, resolvedPageUrl, pageMessages };
    } catch (error) {
      pageMessages.push(`${sourceName(candidate)}: ${error instanceof Error ? error.message : "PDF download failed"}`);
    }
  }
  return { pdf: null, sourceText, title, resolvedPageUrl, pageMessages };
}

function safeFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "regulation";
}

async function preservePdf(record: Regulation, bytes: ArrayBuffer, hash: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return "";
  const filename = `${safeFilename(record.citation || record.title)}-${hash.slice(0, 12)}.pdf`;
  const blob = await put(`regulations/${filename}`, Buffer.from(bytes), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/pdf",
    cacheControlMaxAge: 31536000,
    token: process.env.BLOB_READ_WRITE_TOKEN
  });
  return blob.url;
}

function relationType(value: unknown): RegulationRelationType {
  const normalized = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["amends", "amended_by", "revokes", "revoked_by", "implements", "references", "related"].includes(normalized)) {
    return normalized as RegulationRelationType;
  }
  return "related";
}

function cleanStringArray(value: unknown, limit = 30) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeRegulationText(item)).filter(Boolean).slice(0, limit);
}

function normalizeRelations(value: unknown): RegulationRelation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const citation = normalizeRegulationText(row.citation);
      if (!citation) return null;
      const relation: RegulationRelation = {
        type: relationType(row.type),
        citation,
        title: normalizeRegulationText(row.title) || undefined,
        effectiveDate: normalizeRegulationText(row.effectiveDate) || undefined,
        note: normalizeRegulationText(row.note) || undefined,
        source: "pdf"
      };
      const key = `${relation.type}:${citation.toLowerCase()}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return relation;
    })
    .filter((item): item is RegulationRelation => Boolean(item))
    .slice(0, 40);
}

function normalizeProvisions(value: unknown): RegulationProvision[] {
  if (!Array.isArray(value)) return [];
  const provisions: RegulationProvision[] = [];
  for (const item of value) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const text = normalizeRegulationText(row.text);
    if (!text) continue;
    const page = Number(row.page);
    provisions.push({
      article: normalizeRegulationText(row.article) || undefined,
      page: Number.isFinite(page) && page > 0 ? Math.round(page) : undefined,
      text
    });
    if (provisions.length >= 30) break;
  }
  return provisions;
}

function normalizeExtraction(raw: unknown, pdfUrl: string): RegulationExtraction {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const legalStatus = String(data.legalStatus || "unknown").toLowerCase();
  const extractedAt = new Date().toISOString();
  return {
    schemaVersion: "regulation-extraction-v1",
    summary: normalizeRegulationText(data.summary),
    scope: cleanStringArray(data.scope),
    keyProvisions: normalizeProvisions(data.keyProvisions),
    effectiveDate: normalizeRegulationText(data.effectiveDate) || undefined,
    legalStatus: ["active", "amended", "partially_revoked", "revoked"].includes(legalStatus)
      ? (legalStatus as RegulationExtraction["legalStatus"])
      : "unknown",
    statusNote: normalizeRegulationText(data.statusNote) || undefined,
    relations: normalizeRelations(data.relations),
    keywords: cleanStringArray(data.keywords),
    verificationNotes: cleanStringArray(data.verificationNotes),
    extractedAt,
    model: configuredModel(),
    sourcePdfUrl: pdfUrl
  };
}

async function extractPdfWithLlm(record: Regulation, bytes: ArrayBuffer, pdfUrl: string) {
  if (!hasOpenAIKey()) throw new Error("OPENAI_API_KEY is not configured.");
  const filename = `${safeFilename(record.citation || record.title)}.pdf`;
  const fileData = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
  const response = await callOpenAIWithPdf(
    [
      `Extract the official Indonesian tax regulation PDF for ${record.title} (${record.citation}).`,
      "Return ONLY one valid JSON object. Do not wrap it in markdown.",
      "Use this exact schema:",
      '{"summary":"string","scope":["string"],"keyProvisions":[{"article":"Pasal/Ayat/Huruf or empty","page":1,"text":"verified provision summary"}],"effectiveDate":"string or empty","legalStatus":"active|amended|partially_revoked|revoked|unknown","statusNote":"string","relations":[{"type":"amends|amended_by|revokes|revoked_by|implements|references|related","citation":"string","title":"string","effectiveDate":"string","note":"string"}],"keywords":["string"],"verificationNotes":["string"]}',
      "Use only the attached PDF. Preserve article/page references when visible. For every revocation, amendment, implementation, or referenced regulation, add a relation. Do not infer a current legal status beyond the PDF text; put uncertainty in verificationNotes.",
      `Official PDF URL: ${pdfUrl}`
    ].join("\n"),
    "You are a source-grounded Indonesian tax regulation indexer. Extract verifiable legal structure for RAG, not legal advice. Never invent citations, dates, articles, pages, or relationships.",
    { filename, fileData }
  );
  return normalizeExtraction(extractJsonObject(response), pdfUrl);
}

function extractionContent(extraction: RegulationExtraction) {
  return [
    `Ringkasan PDF: ${extraction.summary || "-"}`,
    extraction.scope.length ? `Ruang lingkup:\n- ${extraction.scope.join("\n- ")}` : "",
    extraction.keyProvisions.length
      ? `Ketentuan kunci:\n${extraction.keyProvisions
          .map((item) => `- ${[item.article, item.page ? `hal. ${item.page}` : ""].filter(Boolean).join(" · ")}: ${item.text}`)
          .join("\n")}`
      : "",
    `Status hukum dalam dokumen: ${extraction.legalStatus}${extraction.statusNote ? ` — ${extraction.statusNote}` : ""}`,
    extraction.effectiveDate ? `Tanggal berlaku: ${extraction.effectiveDate}` : "",
    extraction.relations.length
      ? `Relasi antaraturan:\n${extraction.relations.map((item) => `- ${item.type}: ${item.citation}${item.note ? ` — ${item.note}` : ""}`).join("\n")}`
      : "",
    extraction.keywords.length ? `Kata kunci: ${extraction.keywords.join(", ")}` : "",
    extraction.verificationNotes.length ? `Catatan verifikasi:\n- ${extraction.verificationNotes.join("\n- ")}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type RegulationEnrichmentResult = {
  record: Regulation;
  enriched: boolean;
  message: string;
};

export async function enrichRegulation(record: Regulation): Promise<RegulationEnrichmentResult> {
  const sourceUrl = String(record.sourceUrl || record.officialPdfUrl || record.pdfUrl || "").trim();
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return {
      record: { ...record, ingestionStatus: "failed", ingestionMessage: "No valid official source URL." },
      enriched: false,
      message: "No valid official source URL."
    };
  }

  try {
    const resolved = await resolveOfficialSource(record, sourceUrl);
    if (!resolved.pdf) {
      const message = resolved.sourceText.length >= 120
        ? "Official page was readable, but no downloadable PDF was resolved. Review or update the official source URL."
        : `Official source was blocked or no readable PDF was found.${resolved.pageMessages.length ? ` ${resolved.pageMessages.slice(0, 2).join(" | ")}` : ""}`;
      const pageContent = resolved.sourceText
        ? [
            removePreviousEnrichment(record.content || ""),
            `--- Official source indexing (${new Date().toISOString()}) ---`,
            `Repository: ${sourceName(resolved.resolvedPageUrl)}`,
            resolved.title ? `Official page title: ${resolved.title}` : "",
            `Official page: ${resolved.resolvedPageUrl}`,
            "Official PDF: not resolved",
            `Official page text:\n${resolved.sourceText}`
          ]
            .filter(Boolean)
            .join("\n\n")
        : record.content || "";
      return {
        record: {
          ...record,
          sourceAuthority: sourceName(resolved.resolvedPageUrl),
          content: pageContent,
          ingestionStatus: "review_required",
          ingestionMessage: message,
          updatedAt: new Date().toISOString()
        },
        enriched: true,
        message
      };
    }

    const hash = createHash("sha256").update(Buffer.from(resolved.pdf.bytes)).digest("hex");
    let storedPdfUrl = record.storedPdfUrl || "";
    let storageMessage = "";
    try {
      storedPdfUrl = await preservePdf(record, resolved.pdf.bytes, hash);
      storageMessage = storedPdfUrl ? "A durable PDF copy was saved to Vercel Blob." : "Blob storage is not configured; the official PDF URL is used directly.";
    } catch (error) {
      storageMessage = `The official PDF was downloaded, but Blob preservation failed: ${error instanceof Error ? error.message : "unknown error"}`;
    }

    let extraction: RegulationExtraction | null = null;
    let extractionMessage = "";
    try {
      extraction = await extractPdfWithLlm(record, resolved.pdf.bytes, storedPdfUrl || resolved.pdf.url);
      extractionMessage = `Structured extraction completed with ${configuredModel()}.`;
    } catch (error) {
      extractionMessage = `PDF stored, but structured extraction requires review: ${error instanceof Error ? error.message : "unknown error"}`;
    }

    const fallbackRelations = deriveRegulationRelations(record);
    const relations = extraction?.relations.length ? extraction.relations : fallbackRelations;
    const updatedAt = new Date().toISOString();
    const content = [
      removePreviousEnrichment(record.content || ""),
      `--- Official source indexing (${updatedAt}) ---`,
      `Repository: ${sourceName(resolved.resolvedPageUrl)}`,
      resolved.title ? `Official page title: ${resolved.title}` : "",
      `Official page: ${resolved.resolvedPageUrl}`,
      `Official PDF: ${resolved.pdf.url}`,
      storedPdfUrl ? `Stored PDF: ${storedPdfUrl}` : "Stored PDF: not available",
      extraction ? extractionContent(extraction) : "",
      !extraction && resolved.sourceText ? `Official page text:\n${resolved.sourceText}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    const message = `${storageMessage} ${extractionMessage}`.trim();
    const ready = Boolean(storedPdfUrl && extraction);

    return {
      record: {
        ...record,
        source: "official",
        sourceUrl: resolved.resolvedPageUrl || sourceUrl,
        sourceAuthority: sourceName(resolved.resolvedPageUrl || sourceUrl),
        officialPdfUrl: resolved.pdf.url,
        storedPdfUrl,
        pdfUrl: storedPdfUrl || resolved.pdf.url,
        content,
        relevance: Math.max(record.relevance || 70, extraction ? 96 : 88),
        ingestionStatus: ready ? "ready" : "review_required",
        ingestionMessage: message,
        fileHash: hash,
        extraction,
        relations,
        extractedAt: extraction?.extractedAt,
        updatedAt
      },
      enriched: true,
      message
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Official source indexing failed.";
    return {
      record: { ...record, ingestionStatus: "failed", ingestionMessage: message, updatedAt: new Date().toISOString() },
      enriched: false,
      message
    };
  }
}
