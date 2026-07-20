import type { Regulation } from "./mock-data";
import { callOpenAIWithPdf, configuredModel, hasOpenAIKey } from "./openai";

const MAX_SOURCE_TEXT = 14000;
const MAX_PDF_BYTES = 12 * 1024 * 1024;

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
    return new URL(decodeHtml(value), baseUrl).toString();
  } catch {
    return "";
  }
}

function pdfCandidates(html: string, baseUrl: string) {
  const candidates = new Map<string, number>();
  const add = (href: string, label = "") => {
    const url = absoluteUrl(href, baseUrl);
    if (!/^https?:\/\//i.test(url)) return;
    const haystack = `${url} ${stripHtml(label)}`.toLowerCase();
    let score = 0;
    if (/\.pdf(?:$|[?#])/.test(url.toLowerCase())) score += 100;
    if (/\b(pdf|unduh|download|lampiran|dokumen)\b/.test(haystack)) score += 45;
    if (/\/(download|unduh|uploads?|files?|documents?)\//.test(url.toLowerCase())) score += 35;
    if (/peraturan|jdih|pajak|kemenkeu|bpk/.test(url.toLowerCase())) score += 10;
    if (score >= 45) candidates.set(url, Math.max(score, candidates.get(url) || 0));
  };

  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) add(match[1], match[2]);
  const rawPdfPattern = /https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi;
  for (const match of html.matchAll(rawPdfPattern)) add(match[0], "pdf");
  return [...candidates.entries()].sort((left, right) => right[1] - left[1]).map(([url]) => url);
}

async function fetchWithTimeout(url: string, accept: string, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: accept,
        "User-Agent": "RSM-Tax-Dispute-Agentic-Advisor/1.0 (+official-regulation-indexer)"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadOfficialPdf(url: string) {
  const response = await fetchWithTimeout(url, "application/pdf,*/*;q=0.8", 20000);
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") || "";
  if (!isPdfResponse(contentType, response.url || url)) return null;
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(
      bytes.byteLength > MAX_PDF_BYTES
        ? `Official PDF is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the current indexing limit is 12 MB.`
        : "Official PDF was empty."
    );
  }
  return { bytes, url: response.url || url };
}

async function reviewPdfWithLlm(record: Regulation, bytes: ArrayBuffer, pdfUrl: string) {
  if (!hasOpenAIKey()) return "AI PDF review is pending because OPENAI_API_KEY is not configured.";
  const filename = `${record.citation || record.title}`.replace(/[^a-z0-9.-]+/gi, "-").slice(0, 90) || "regulation.pdf";
  const fileData = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
  return callOpenAIWithPdf(
    [
      `Review the official Indonesian tax regulation PDF for: ${record.title} (${record.citation}).`,
      "Return a compact source-grounded knowledge note in Indonesian with these headings:",
      "Ringkasan, Ruang lingkup, Ketentuan kunci, Tanggal/status berlaku, Relasi dengan aturan lain, Kata kunci RAG, Batasan verifikasi.",
      "Do not invent article numbers or effective dates. Mention page/article references only when clearly visible in the PDF.",
      `Official PDF URL: ${pdfUrl}`
    ].join("\n"),
    "You index official Indonesian tax regulations for retrieval-augmented generation. Use only the attached PDF and clearly separate verified provisions from uncertainty.",
    { filename: filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`, fileData }
  );
}

export type RegulationEnrichmentResult = {
  record: Regulation;
  enriched: boolean;
  message: string;
};

export async function enrichRegulation(record: Regulation): Promise<RegulationEnrichmentResult> {
  const sourceUrl = String(record.sourceUrl || record.pdfUrl || "").trim();
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return { record, enriched: false, message: "No valid official source URL." };
  }

  try {
    const sourceResponse = await fetchWithTimeout(sourceUrl, "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8");
    if (!sourceResponse.ok) {
      return { record, enriched: false, message: `Official source returned HTTP ${sourceResponse.status}.` };
    }

    const contentType = sourceResponse.headers.get("content-type") || "";
    let pdf: { bytes: ArrayBuffer; url: string } | null = null;
    let sourceText = "";
    let title = "";

    if (isPdfResponse(contentType, sourceResponse.url || sourceUrl)) {
      const bytes = await sourceResponse.arrayBuffer();
      if (bytes.byteLength > MAX_PDF_BYTES) {
        throw new Error(`Official PDF is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the current indexing limit is 12 MB.`);
      }
      pdf = { bytes, url: sourceResponse.url || sourceUrl };
    } else {
      const raw = await sourceResponse.text();
      title = pageTitle(raw);
      sourceText = (contentType.includes("html") || raw.includes("<html") ? stripHtml(raw) : cleanText(raw)).slice(0, MAX_SOURCE_TEXT);
      const candidates = pdfCandidates(raw, sourceResponse.url || sourceUrl).slice(0, 8);
      for (const candidate of candidates) {
        try {
          pdf = await downloadOfficialPdf(candidate);
          if (pdf) break;
        } catch {
          // Try the next official PDF candidate from the same source page.
        }
      }
    }

    let aiNote = "";
    let aiMessage = "";
    if (pdf) {
      try {
        aiNote = await reviewPdfWithLlm(record, pdf.bytes, pdf.url);
        aiMessage = ` PDF indexed with ${configuredModel()}.`;
      } catch (error) {
        aiMessage = ` PDF found, but AI indexing was not completed: ${error instanceof Error ? error.message : "unknown error"}`;
      }
    }

    if (!pdf && sourceText.length < 120) {
      return { record, enriched: false, message: "The official page was blocked or no readable PDF/text was found." };
    }

    const content = [
      removePreviousEnrichment(record.content || ""),
      `--- Official source indexing (${new Date().toISOString()}) ---`,
      `Repository: ${sourceName(sourceUrl)}`,
      title ? `Official page title: ${title}` : "",
      `Official page: ${sourceUrl}`,
      pdf ? `Official PDF: ${pdf.url}` : "Official PDF: not discovered on this page",
      aiNote ? `AI PDF review:\n${aiNote}` : "",
      !aiNote && sourceText ? `Official page text:\n${sourceText}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      record: {
        ...record,
        source: record.source === "seed" ? "seed" : "official",
        pdfUrl: pdf?.url || record.pdfUrl || "",
        content,
        relevance: Math.max(record.relevance || 70, pdf && aiNote ? 92 : pdf ? 84 : 78),
        updatedAt: new Date().toISOString()
      },
      enriched: true,
      message: pdf ? `Official PDF found.${aiMessage}` : `Indexed ${sourceText.length.toLocaleString("en-US")} characters from the official page.`
    };
  } catch (error) {
    return {
      record,
      enriched: false,
      message: error instanceof Error ? error.message : "Official source indexing failed."
    };
  }
}
