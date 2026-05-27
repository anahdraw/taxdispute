import type { Regulation } from "./mock-data";

const MAX_SOURCE_TEXT = 14000;

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
  return content.split("\n\n--- Source enrichment")[0].trim();
}

function sourceName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

export type RegulationEnrichmentResult = {
  record: Regulation;
  enriched: boolean;
  message: string;
};

export async function enrichRegulation(record: Regulation): Promise<RegulationEnrichmentResult> {
  const sourceUrl = String(record.sourceUrl || "").trim();
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return { record, enriched: false, message: "No valid source URL." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "RSM-Tax-Dispute-Agentic-Advisor/1.0"
      }
    });
    if (!response.ok) {
      return { record, enriched: false, message: `Source returned HTTP ${response.status}.` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (/application\/pdf/i.test(contentType) || /\.pdf($|\?)/i.test(sourceUrl)) {
      const content = [
        removePreviousEnrichment(record.content || ""),
        `--- Source enrichment (${new Date().toISOString()}) ---`,
        `Source: ${sourceName(sourceUrl)}`,
        `URL: ${sourceUrl}`,
        "PDF source detected. The app can open it in the reference viewer, but text extraction from source PDFs is not enabled in this enrichment step yet."
      ]
        .filter(Boolean)
        .join("\n\n");
      return { record: { ...record, content, updatedAt: new Date().toISOString() }, enriched: true, message: "PDF source noted." };
    }

    const raw = await response.text();
    const title = pageTitle(raw);
    const sourceText = (contentType.includes("html") || raw.includes("<html") ? stripHtml(raw) : cleanText(raw)).slice(0, MAX_SOURCE_TEXT);
    if (sourceText.length < 120) {
      return { record, enriched: false, message: "Source text was too short or blocked." };
    }

    const content = [
      removePreviousEnrichment(record.content || ""),
      `--- Source enrichment (${new Date().toISOString()}) ---`,
      `Source: ${sourceName(sourceUrl)}`,
      title ? `Source title: ${title}` : "",
      `URL: ${sourceUrl}`,
      sourceText
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      record: {
        ...record,
        content,
        relevance: Math.max(record.relevance || 70, sourceText.length > 900 ? 85 : 78),
        updatedAt: new Date().toISOString()
      },
      enriched: true,
      message: `Fetched ${sourceText.length.toLocaleString("en-US")} characters.`
    };
  } catch (error) {
    return {
      record,
      enriched: false,
      message: error instanceof Error ? error.message : "Source enrichment failed."
    };
  } finally {
    clearTimeout(timeout);
  }
}
