function tidyPunctuation(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:]){2,}/g, "$1")
    .replace(/\.{4,}/g, "…")
    .replace(/\s+…/g, "…")
    .trim();
}

export function normalizeExtractedText(value: unknown) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/(?:\\r\\n|\\n|\\r)+/g, "\n")
    .replace(/\bChunk\s+\d+\s*:\s*/gi, "\n")
    .replace(/\b(?:Section|Bagian|Halaman|Pages?)\s+\d+(?:\s*[-–]\s*\d+)?\s*:\s*/gi, "\n")
    .split("\n")
    .map(tidyPunctuation)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function splitLongItem(value: string) {
  if (value.length < 220) return [value];
  return value.split(/(?<=[.!?])\s+(?=(?:[A-Z][a-z]|The\b|Taxpayer\b|Pemohon\b|Terbanding\b|Majelis\b|DJP\b|WP\b))/g);
}

export function structuredTextItems(value: unknown, limit = 16) {
  const source = Array.isArray(value) ? value.map(String) : [String(value || "")];
  const candidates = source
    .flatMap((item) => normalizeExtractedText(item).split(/\n+|\s*[•▪◦]\s*|;\s+(?=[A-Z0-9])/g))
    .flatMap(splitLongItem)
    .map((item) => tidyPunctuation(item.replace(/^[-–—*]\s+/, "")))
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of candidates) {
    const key = item.toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}
