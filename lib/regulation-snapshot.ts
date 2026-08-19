import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { Regulation } from "./mock-data";
import { isAllowedOfficialRegulationUrl, isAllowedPdfReferenceUrl } from "./regulation-sources";

type SnapshotCache = { paths: string[]; stamp: string; records: Regulation[] };
let snapshotCache: SnapshotCache | null = null;

/**
 * Loads the deterministic snapshot produced by
 * `scripts/import_peraturan_pipeline.py`.
 *
 * This is opt-in.  A missing/invalid snapshot returns an empty list so local
 * search can fall back to the built-in seed corpus.  It never opens a
 * database, runs migrations, or fetches a URL.
 */
export function loadLocalRegulationSnapshot(snapshotPath = process.env.TDP_LOCAL_REGULATION_SNAPSHOT): Regulation[] {
  const configured = String(snapshotPath || "").trim();
  // The book projection is a ground-truth/graph fixture, not an implicit
  // addition to every generic search corpus. Enable it explicitly for the
  // regulation chatbot with TDP_BOOK_GROUND_TRUTH_SNAPSHOT.
  const bookPath = String(process.env.TDP_BOOK_GROUND_TRUTH_SNAPSHOT || "").trim();
  const resolvedPaths = [configured, bookPath].filter(Boolean).map((value) => path.resolve(value));
  if (!resolvedPaths.length) return [];
  try {
    const stats = resolvedPaths.map((resolved) => {
      try {
        const stat = fs.statSync(resolved);
        return `${resolved}:${stat.mtimeMs}:${stat.size}`;
      } catch {
        return `${resolved}:missing`;
      }
    });
    const stamp = stats.join("|");
    if (snapshotCache && snapshotCache.paths.join("|") === resolvedPaths.join("|") && snapshotCache.stamp === stamp) {
      return snapshotCache.records;
    }
    const records: Regulation[] = [];
    for (const resolved of resolvedPaths) {
      let text = "";
      try {
        const payload = fs.readFileSync(resolved);
        text = resolved.toLowerCase().endsWith(".gz") ? gunzipSync(payload).toString("utf8") : payload.toString("utf8");
      } catch {
        continue;
      }
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const value = JSON.parse(line) as Partial<Regulation>;
        if (!value.id || !value.title || !value.citation || !value.focus) continue;
        const sourceUrl = isAllowedOfficialRegulationUrl(value.sourceUrl) ? String(value.sourceUrl) : "";
        const rawPdf = String(value.storedPdfUrl || value.pdfUrl || value.officialPdfUrl || "");
        const officialPdfUrl = isAllowedOfficialRegulationUrl(value.officialPdfUrl || value.pdfUrl)
          ? String(value.officialPdfUrl || value.pdfUrl)
          : "";
        const pdfUrls = Array.isArray(value.pdfUrls)
          ? value.pdfUrls.map((url) => String(url || "")).filter((url) => isAllowedPdfReferenceUrl(url))
          : officialPdfUrl ? [officialPdfUrl] : [];
        const pdfUrl = isAllowedPdfReferenceUrl(rawPdf) ? rawPdf : officialPdfUrl;
        records.push({
          ...value,
          id: String(value.id),
          title: String(value.title),
          citation: String(value.citation),
          focus: String(value.focus),
          sourceUrl,
          officialPdfUrl,
          pdfUrl,
          pdfUrls,
          storedPdfUrl: isAllowedPdfReferenceUrl(String(value.storedPdfUrl || "")) ? String(value.storedPdfUrl) : "",
          source: sourceUrl || officialPdfUrl ? "official" : "manual",
          sourceLanguage: value.sourceLanguage === "en" ? "en" : "id",
          relations: Array.isArray(value.relations) ? value.relations : [],
          extraction: value.extraction || null
        } as Regulation);
      }
    }
    snapshotCache = { paths: resolvedPaths, stamp, records };
    return records;
  } catch {
    return [];
  }
}
