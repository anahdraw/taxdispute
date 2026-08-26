const PDF_QUERY_KEYS = ["filename", "file", "name", "download", "attachment", "url", "src"];
const NESTED_RESOURCE_KEYS = ["file", "url", "src"];

export function canonicalizeHttpUrl(rawUrl, baseUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;

  try {
    const url = new URL(rawUrl, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function isLikelyPdfUrl(rawUrl, baseUrl) {
  const canonicalUrl = canonicalizeHttpUrl(rawUrl, baseUrl);
  if (!canonicalUrl) return false;

  const url = new URL(canonicalUrl);
  if (/\.pdf$/i.test(url.pathname)) return true;

  for (const key of PDF_QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (value && /\.pdf(?:$|[?#])/i.test(value.trim())) return true;
  }

  return false;
}

export function resolvePdfDownloadUrl(rawUrl, baseUrl) {
  const canonicalUrl = canonicalizeHttpUrl(rawUrl, baseUrl);
  if (!canonicalUrl) return null;

  const url = new URL(canonicalUrl);
  if (/\.pdf$/i.test(url.pathname)) return url.href;

  for (const key of NESTED_RESOURCE_KEYS) {
    const value = url.searchParams.get(key)?.trim();
    if (!value || !/^(?:https?:\/\/|\.{0,2}\/)/i.test(value)) continue;

    const nestedUrl = canonicalizeHttpUrl(value, url.href);
    if (nestedUrl && /\.pdf$/i.test(new URL(nestedUrl).pathname)) return nestedUrl;
  }

  return url.href;
}

export function sanitizeFilename(value) {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|[. ]+$/g, "")
    .trim();

  return (cleaned || "dokumen").slice(0, 150);
}

export function derivePdfFilename(candidate, index = 0) {
  const url = new URL(candidate.url);
  let filename = "";

  for (const key of ["filename", "name", "download", "attachment"]) {
    const value = url.searchParams.get(key);
    if (value && /\.pdf$/i.test(value.trim())) {
      filename = value.trim();
      break;
    }
  }

  if (!filename) {
    const lastPathPart = url.pathname.split("/").filter(Boolean).pop() || "";
    try {
      filename = decodeURIComponent(lastPathPart);
    } catch {
      filename = lastPathPart;
    }
  }

  if (!/\.pdf$/i.test(filename)) {
    const title = sanitizeFilename(candidate.title || "");
    filename = title && title !== "dokumen" ? title : `dokumen-${index + 1}`;
    filename += ".pdf";
  }

  const withoutExtension = filename.replace(/\.pdf$/i, "");
  return `${sanitizeFilename(withoutExtension)}.pdf`;
}

export function dedupeCandidates(candidates, baseUrl) {
  const byUrl = new Map();

  for (const candidate of candidates || []) {
    const url = resolvePdfDownloadUrl(candidate?.url, baseUrl);
    if (!url) continue;

    const normalized = {
      url,
      title: String(candidate.title || "").trim(),
      source: String(candidate.source || "Dokumen").trim()
    };

    const existing = byUrl.get(url);
    if (!existing || (!existing.title && normalized.title)) {
      byUrl.set(url, normalized);
    }
  }

  return [...byUrl.values()];
}
