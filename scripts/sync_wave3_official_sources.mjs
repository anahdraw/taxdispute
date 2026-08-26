import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve("outputs/knowledge-acquisition");
const SNAPSHOT_DIR = path.resolve("content/official-knowledge");
const CACHE_DIR = path.join(OUTPUT_DIR, "pages");
const FILE_DIR = path.join(OUTPUT_DIR, "files");
const OFFLINE = process.argv.includes("--offline");
const SKIP_DOWNLOADS = process.argv.includes("--skip-downloads");
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const SOURCES = {
  treaty: { url: "https://www.pajak.go.id/id/taxtreaty-mli", cache: process.env.AAJ_TREATY_HTML || "/private/tmp/aaj-treaty.html" },
  coretax: { url: "https://www.pajak.go.id/coretaxpedia/buku-panduan-coretax-djp", cache: process.env.AAJ_CORETAX_HTML || "/private/tmp/aaj-coretax.html" },
  forms: { url: "https://www.pajak.go.id/id/formulir-page", cache: process.env.AAJ_FORMS_HTML || "/private/tmp/aaj-forms.html" },
  rates: { url: "https://fiskal.kemenkeu.go.id/informasi-publik/kurs-pajak", cache: process.env.AAJ_RATES_HTML || path.join(CACHE_DIR, "rates.html") }
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function decodeHtml(value) {
  const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}

function plain(value) {
  return decodeHtml(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value, base) {
  try { return new URL(decodeHtml(value), base).toString(); } catch { return ""; }
}

function slug(value) {
  return plain(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

function isoDate(value) {
  let text = plain(value);
  if (!text || text === "-") return "";
  const months = { Januari: "January", Februari: "February", Maret: "March", April: "April", Mei: "May", Juni: "June", Juli: "July", Agustus: "August", September: "September", Oktober: "October", November: "November", Desember: "December" };
  for (const [indonesian, english] of Object.entries(months)) text = text.replace(new RegExp(`\\b${indonesian}\\b`, "i"), english);
  const parsed = Date.parse(`${text} UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "";
}

function anchors(html, base) {
  const result = [];
  for (const match of html.matchAll(/<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = `${match[1]} ${match[3]}`;
    const type = decodeHtml(attrs.match(/\btype=["']([^"']*)["']/i)?.[1] || "");
    const length = Number(type.match(/length\s*=\s*(\d+)/i)?.[1] || 0);
    result.push({ url: absoluteUrl(match[2], base), text: plain(match[4]), type: type.split(";")[0].trim(), length });
  }
  return result;
}

async function fetchBuffer(url, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "User-Agent": "AAJurist-Knowledge-Sync/1.0 (+official-source-audit)" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_FILE_BYTES) throw new Error(`file exceeds ${MAX_FILE_BYTES} bytes`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_FILE_BYTES) throw new Error(`file exceeds ${MAX_FILE_BYTES} bytes`);
    return { buffer, contentType: response.headers.get("content-type") || "", finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
}

async function loadPage(name, source) {
  const cacheTarget = path.join(CACHE_DIR, `${name}.html`);
  let buffer = null;
  let fetched = false;
  let error = "";
  if (!OFFLINE) {
    try {
      const remote = await fetchBuffer(source.url);
      buffer = remote.buffer;
      fetched = true;
      fs.writeFileSync(cacheTarget, buffer);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }
  for (const candidate of [source.cache, cacheTarget]) {
    if (!buffer && candidate && fs.existsSync(candidate)) buffer = fs.readFileSync(candidate);
  }
  if (!buffer) throw new Error(`${name}: source unavailable${error ? ` (${error})` : ""}`);
  return { html: buffer.toString("utf8"), sourceHash: sha256(buffer), fetched, fetchError: error };
}

function parseTreaties(html, sourceHash) {
  const result = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => plain(match[1]));
    if (cells.length < 7 || !/^\d+$/.test(cells[0]) || !cells[1]) continue;
    const [rowNumber, partner, treatySigningDate, treatyEntryIntoForce, treatyEntryIntoEffect, mliSigningDate, mliEntryIntoEffect] = cells;
    const hasMli = ![mliSigningDate, mliEntryIntoEffect].every((value) => !value || value === "-");
    result.push({
      id: `official:treaty:${slug(partner)}`,
      domain: "treaty",
      subtype: hasMli ? "P3B + MLI" : "P3B",
      title: `P3B Indonesia – ${partner}`,
      citation: `DJP Tax Treaty & MLI, baris ${rowNumber}`,
      summary: `Mitra P3B ${partner}. Penandatanganan P3B: ${treatySigningDate || "belum tersedia"}; berlaku: ${treatyEntryIntoForce || "belum tersedia"}; efektif: ${treatyEntryIntoEffect || "belum tersedia"}.${hasMli ? ` MLI ditandatangani ${mliSigningDate || "belum tersedia"} dan efektif ${mliEntryIntoEffect || "belum tersedia"}.` : " Belum ada tanggal MLI pada matriks DJP."}`,
      tags: [partner, "P3B", ...(hasMli ? ["MLI"] : [])],
      evidenceStatus: "verified",
      legalStatus: "official_matrix",
      effectiveFrom: isoDate(treatyEntryIntoEffect),
      officialUrl: SOURCES.treaty.url,
      pdfUrl: "",
      internalUrl: "",
      sourceHash,
      locator: { article: `Tabel P3B/MLI baris ${rowNumber}` },
      sourceKind: "official_guidance",
      metadata: { rowNumber: Number(rowNumber), partner, treatySigningDate, treatyEntryIntoForce, treatyEntryIntoEffect, mliSigningDate, mliEntryIntoEffect, mliMatched: hasMli, temporalReviewRequired: false }
    });
  }
  return result;
}

function coretaxSeries(title) {
  if (/pendaftaran|pengukuhan|pencabutan|perubahan data|perubahan status|penghapusan/i.test(title)) return "Registrasi";
  if (/spt|bukti potong|pembayaran/i.test(title)) return "SPT dan pembayaran";
  if (/instansi pemerintah|migas|lembaga keuangan/i.test(title)) return "Segmen wajib pajak";
  return "Layanan perpajakan";
}

function parseCoretax(html) {
  return anchors(html, SOURCES.coretax.url)
    .filter((link) => /\.pdf(?:$|[?#])/i.test(link.url) && /manual|panduan|cara[_ -]?lapor|coretax|nppn/i.test(`${link.url} ${link.text}`))
    .map((link, index) => ({ link, index }));
}

function parseForms(html) {
  const result = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const links = anchors(row[1], SOURCES.forms.url);
    const detail = links.find((link) => /\/id\/formulir-pajak\//i.test(link.url));
    const files = links.filter((link) => /\.(?:pdf|xlsx?|docx?|zip|rar)(?:$|[?#])/i.test(link.url));
    if (!detail || !files.length) continue;
    for (const [fileIndex, file] of files.entries()) {
      result.push({ detail, file, fileIndex });
    }
  }
  return result;
}

function formSubtype(title) {
  if (/spt tahunan/i.test(title)) return "SPT Tahunan";
  if (/spt masa/i.test(title)) return "SPT Masa";
  if (/dgt|domisili|p3b/i.test(title)) return "P3B / DGT";
  if (/bukti potong|pemotongan/i.test(title)) return "Bukti potong";
  if (/faktur pajak/i.test(title)) return "Faktur pajak";
  if (/pendaftaran|npwp|pengukuhan|nonaktif|sertifikat|efin|akun/i.test(title)) return "Registrasi";
  return "Formulir lain";
}

function safeFilename(url, prefix) {
  let basename = "document";
  try { basename = decodeURIComponent(new URL(url).pathname.split("/").pop() || basename); } catch {}
  basename = basename.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-180) || "document";
  return `${prefix}-${sha256(url).slice(0, 12)}-${basename}`;
}

function validFileSignature(buffer, url) {
  const pathname = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ""; } })();
  if (pathname.endsWith(".pdf") || pathname.endsWith(".pdf.pdf")) return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (/\.(?:xlsx|docx|zip)$/.test(pathname)) return buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (/\.(?:xls|doc)$/.test(pathname)) return (buffer[0] === 0xd0 && buffer[1] === 0xcf) || (buffer[0] === 0x50 && buffer[1] === 0x4b);
  if (pathname.endsWith(".rar")) return buffer.subarray(0, 4).toString("ascii") === "Rar!";
  return buffer.length > 0;
}

async function downloadFile(url, prefix) {
  const target = path.join(FILE_DIR, safeFilename(url, prefix));
  if (fs.existsSync(target)) {
    const buffer = fs.readFileSync(target);
    if (!validFileSignature(buffer, url)) throw new Error("downloaded artifact has an invalid file signature");
    return { sourceHash: sha256(buffer), byteLength: buffer.length, localPath: path.relative(ROOT, target), contentType: "", downloaded: false };
  }
  if (SKIP_DOWNLOADS || OFFLINE) return { sourceHash: "", byteLength: 0, localPath: "", contentType: "", downloaded: false };
  const remote = await fetchBuffer(url, 90_000);
  if (!validFileSignature(remote.buffer, url)) throw new Error("remote response does not match the expected file signature");
  fs.writeFileSync(target, remote.buffer);
  return { sourceHash: sha256(remote.buffer), byteLength: remote.buffer.length, localPath: path.relative(ROOT, target), contentType: remote.contentType, downloaded: true };
}

function extractPdfPages(localPath) {
  if (!localPath || !/\.pdf$/i.test(localPath)) return [];
  const absolute = path.resolve(localPath);
  if (!fs.existsSync(absolute)) return [];
  const converted = spawnSync("pdftotext", ["-layout", absolute, "-"], { encoding: "utf8", maxBuffer: 80 * 1024 * 1024 });
  if (converted.status !== 0 || !converted.stdout) return [];
  return converted.stdout.split("\f").map((text, index) => ({ page: index + 1, text: text.replace(/\s+/g, " ").trim() })).filter((page) => page.text.length >= 40);
}

async function mapWithConcurrency(values, limit, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      try { output[index] = await mapper(values[index], index); }
      catch (error) { output[index] = { error: error instanceof Error ? error.message : String(error), value: values[index] }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

function ratesFromSeed() {
  const seed = path.resolve("content/official-knowledge/rates-seed.json");
  return fs.existsSync(seed) ? JSON.parse(fs.readFileSync(seed, "utf8")) : { items: [], meta: {} };
}

function parseIndonesianNumber(value) {
  const normalized = plain(value).replace(/[^0-9,.-]/g, "").replaceAll(".", "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseRatesPage(html) {
  const citation = plain(html.match(/<strong>\s*(KMK\s+Nomor[^<]+)<\/strong>/i)?.[1] || "");
  const range = plain(html.match(/Tanggal berlaku:\s*([^<]+)<\/em>/i)?.[1] || "");
  const [fromText = "", toText = ""] = range.split(/\s+-\s+/);
  const pdfHref = html.match(/<a\b[^>]*class=["'][^"']*view-pdf[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1]
    || html.match(/<a\b[^>]*href=["']([^"']+\.pdf)["'][^>]*>[^<]*(?:Baca salinan KMK|Download)/i)?.[1]
    || "";
  const rows = [];
  for (const row of html.matchAll(/<tr\b[^>]*class=["'][^"']*table-bordered[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => plain(match[1]));
    if (cells.length < 3 || !/^\d+$/.test(cells[0])) continue;
    const currencyMatch = cells[1].match(/^(.+?)\s*\(([A-Z]{3})\)/);
    if (!currencyMatch) continue;
    rows.push([currencyMatch[2], currencyMatch[1].trim(), parseIndonesianNumber(cells[2]), currencyMatch[2] === "JPY" ? 100 : 1]);
  }
  if (!citation || rows.length < 20) return null;
  return { meta: { source: "Direktorat Jenderal Strategi Ekonomi dan Fiskal, Kementerian Keuangan", officialUrl: SOURCES.rates.url, pdfUrl: absoluteUrl(pdfHref, SOURCES.rates.url), citation, validFrom: isoDate(fromText), validTo: isoDate(toText), retrievedAt: new Date().toISOString(), sourceHash: "" }, items: rows };
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(FILE_DIR, { recursive: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const pages = {};
  for (const [name, source] of Object.entries(SOURCES)) {
    try { pages[name] = await loadPage(name, source); }
    catch (error) { pages[name] = { html: "", sourceHash: "", fetched: false, fetchError: error instanceof Error ? error.message : String(error) }; }
  }

  const treaties = pages.treaty.html ? parseTreaties(pages.treaty.html, pages.treaty.sourceHash) : [];
  const coretaxLinks = pages.coretax.html ? parseCoretax(pages.coretax.html) : [];
  const formLinks = pages.forms.html ? parseForms(pages.forms.html) : [];

  const coretaxDownloads = await mapWithConcurrency(coretaxLinks, 4, async ({ link }, index) => ({ index, ...(await downloadFile(link.url, "coretax")) }));
  const formDownloads = await mapWithConcurrency(formLinks, 6, async ({ file }, index) => ({ index, ...(await downloadFile(file.url, "form")) }));
  const failures = [];
  const chunks = [];

  const coretax = coretaxLinks.map(({ link }, index) => {
    const downloaded = coretaxDownloads[index];
    if (downloaded?.error) failures.push({ domain: "guides", url: link.url, error: downloaded.error });
    const file = downloaded?.error ? {} : downloaded;
    const pagesExtracted = extractPdfPages(file?.localPath || "");
    const id = `official:coretax:${slug(link.text || link.url)}`;
    for (const page of pagesExtracted) {
      chunks.push({ id: `${id}:p${page.page}`, parentId: id, domain: "guides", subtype: "Coretax", title: link.text, page: page.page, text: page.text, officialUrl: SOURCES.coretax.url, pdfUrl: link.url, sourceHash: file?.sourceHash || "" });
    }
    const published = link.url.match(/\/((?:19|20)\d{2})-(\d{2})\//);
    return {
      id, domain: "guides", subtype: "Coretax", title: link.text || `Buku Panduan Coretax ${index + 1}`,
      citation: `DJP Buku Panduan Coretax · ${link.text || index + 1}`,
      summary: `Manual operasional resmi DJP untuk ${String(link.text || "proses Coretax").toLowerCase()}. Teks tersedia dalam ${pagesExtracted.length} halaman yang dapat ditelusuri.`,
      tags: ["Coretax", coretaxSeries(link.text), link.text].filter(Boolean),
      evidenceStatus: file?.sourceHash && pagesExtracted.length ? "verified" : "review_required",
      legalStatus: "official_guidance", effectiveFrom: published ? `${published[1]}-${published[2]}-01` : "",
      officialUrl: SOURCES.coretax.url, pdfUrl: link.url, internalUrl: "", sourceHash: file?.sourceHash || "",
      locator: pagesExtracted.length ? { page: 1 } : undefined, sourceKind: "official_guidance",
      metadata: { series: coretaxSeries(link.text), pageCount: pagesExtracted.length, byteLength: file?.byteLength || 0, auditArtifactHash: file?.sourceHash || "", temporalReviewRequired: true }
    };
  });

  const forms = formLinks.map(({ detail, file, fileIndex }, index) => {
    const downloaded = formDownloads[index];
    if (downloaded?.error) failures.push({ domain: "forms", url: file.url, error: downloaded.error });
    const audit = downloaded?.error ? {} : downloaded;
    const combinedTitle = `${detail.text} — ${file.text}`;
    const fileDate = file.url.match(/\/((?:19|20)\d{2})-(\d{2})\//);
    return {
      id: `official:form:${slug(detail.text)}:${fileIndex + 1}:${sha256(file.url).slice(0, 10)}`,
      domain: "forms", subtype: formSubtype(combinedTitle), title: file.text || detail.text,
      citation: `DJP Formulir Perpajakan · ${detail.text}`,
      summary: `Berkas resmi ${file.text || detail.text}. Katalog DJP tidak selalu menyatakan status aktif; validasi tahun pajak dan aturan dasar tetap diperlukan sebelum digunakan.`,
      tags: [detail.text, path.extname(new URL(file.url).pathname).replace(".", "").toUpperCase(), formSubtype(combinedTitle)].filter(Boolean),
      evidenceStatus: audit?.sourceHash ? "verified" : "review_required", legalStatus: "official_catalogue_entry",
      effectiveFrom: fileDate ? `${fileDate[1]}-${fileDate[2]}-01` : "", officialUrl: detail.url, pdfUrl: file.url,
      internalUrl: "", sourceHash: audit?.sourceHash || "", locator: { article: detail.text }, sourceKind: "official_guidance",
      metadata: { mimeType: file.type || audit?.contentType || "", declaredByteLength: file.length || 0, downloadedByteLength: audit?.byteLength || 0, auditArtifactHash: audit?.sourceHash || "", extension: path.extname(new URL(file.url).pathname).slice(1).toLowerCase(), temporalReviewRequired: true, activeStatus: "not_asserted" }
    };
  });

  const rateSeed = (pages.rates.html && parseRatesPage(pages.rates.html)) || ratesFromSeed();
  let rateDocument = {};
  if (rateSeed.meta?.pdfUrl) {
    const downloaded = await downloadFile(rateSeed.meta.pdfUrl, "rate").catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    if (downloaded?.error) failures.push({ domain: "rates", url: rateSeed.meta.pdfUrl, error: downloaded.error });
    else rateDocument = downloaded;
  }
  const rates = (rateSeed.items || []).map((row) => {
    const [currency, currencyName, value, unit] = Array.isArray(row) ? row : [row.currency, row.currencyName, row.value, row.unit];
    return {
      id: `official:rate:${String(rateSeed.meta?.citation || "current").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}:${String(currency).toLowerCase()}`,
      domain: "rates", subtype: "Kurs mingguan", title: `${currency} — ${currencyName}`,
      citation: rateSeed.meta?.citation || "KMK Kurs Pajak",
      summary: `${unit === 100 ? "100" : "1"} ${currency} = Rp${Number(value).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, berlaku ${rateSeed.meta?.validFrom || ""} sampai ${rateSeed.meta?.validTo || ""}.`,
      tags: [String(currency), String(currencyName), "kurs pajak"], evidenceStatus: rateDocument.sourceHash ? "verified" : "review_required",
      legalStatus: "active", effectiveFrom: rateSeed.meta?.validFrom || "", officialUrl: rateSeed.meta?.officialUrl || SOURCES.rates.url,
      pdfUrl: rateSeed.meta?.pdfUrl || "", internalUrl: "", sourceHash: rateDocument.sourceHash || rateSeed.meta?.sourceHash || "",
      locator: { page: 3, article: "Diktum KESATU" }, sourceKind: "primary_law",
      metadata: { currency, currencyName, value: Number(value), unit: Number(unit), validFrom: rateSeed.meta?.validFrom || "", validTo: rateSeed.meta?.validTo || "", byteLength: rateDocument.byteLength || 0, auditArtifactHash: rateDocument.sourceHash || "", temporalReviewRequired: false }
    };
  });
  const items = [...treaties, ...coretax, ...forms, ...rates];
  const manifest = {
    schemaVersion: "aa-jurist-official-knowledge-v1",
    generatedAt: new Date().toISOString(),
    offline: OFFLINE,
    skipDownloads: SKIP_DOWNLOADS,
    sources: Object.fromEntries(Object.entries(pages).map(([name, page]) => [name, { url: SOURCES[name].url, sourceHash: page.sourceHash, fetched: page.fetched, fetchError: page.fetchError || "" }])),
    counts: { treaties: treaties.length, coretaxManuals: coretax.length, coretaxPages: chunks.length, formFiles: forms.length, rateRows: rates.length, items: items.length, failures: failures.length },
    hashes: { items: sha256(JSON.stringify(items)), chunks: sha256(JSON.stringify(chunks)) },
    failures
  };
  fs.writeFileSync(path.join(SNAPSHOT_DIR, "official-knowledge.json"), `${JSON.stringify({ schemaVersion: manifest.schemaVersion, generatedAt: manifest.generatedAt, items }, null, 2)}\n`);
  fs.writeFileSync(path.join(SNAPSHOT_DIR, "coretax-chunks.json"), `${JSON.stringify({ schemaVersion: manifest.schemaVersion, generatedAt: manifest.generatedAt, chunks }, null, 2)}\n`);
  fs.writeFileSync(path.join(SNAPSHOT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (treaties.length < 65 || coretax.length < 20 || forms.length < 50 || rates.length < 20) process.exitCode = 1;
}

await main();
