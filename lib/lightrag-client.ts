import type { Regulation } from "./mock-data";

export const LIGHTRAG_QUERY_MODES = ["local", "global", "hybrid", "naive", "mix"] as const;

export type LightRagQueryMode = (typeof LIGHTRAG_QUERY_MODES)[number];

export type LightRagConfig = {
  baseUrl: string;
  apiKey?: string;
  queryMode: LightRagQueryMode;
  timeoutMs: number;
  topK: number;
  chunkTopK: number;
  enableRerank: boolean;
};

export type LightRagReference = {
  referenceId: string;
  filePath: string;
  chunks: string[];
  canonicalId?: string;
  rank: number;
};

export type LightRagQueryResult = {
  response: string;
  context: string;
  references: LightRagReference[];
  queryMode: LightRagQueryMode;
  clientLatencyMs: number;
  serverLatencyMs?: number;
  hasContext: boolean;
};

export type LightRagQueryInput = {
  query: string;
  mode?: LightRagQueryMode;
  topK?: number;
  chunkTopK?: number;
  contextOnly?: boolean;
  includeChunkContent?: boolean;
  enableRerank?: boolean;
};

export type LightRagDocument = {
  canonicalId: string;
  fileSource: string;
  text: string;
};

export type LightRagInsertResult = {
  status: "success" | "partial_success" | "failure";
  message: string;
  trackId: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function booleanFromEnv(value: unknown, fallback: boolean) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function normalizeLightRagQueryMode(value: unknown): LightRagQueryMode {
  const normalized = String(value || "").trim().toLowerCase();
  return LIGHTRAG_QUERY_MODES.includes(normalized as LightRagQueryMode) ? (normalized as LightRagQueryMode) : "mix";
}

function normalizedBaseUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("LIGHTRAG_BASE_URL must be an absolute http(s) URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("LIGHTRAG_BASE_URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("LIGHTRAG_BASE_URL must not contain credentials; use LIGHTRAG_API_KEY");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

/** Return null when LightRAG is intentionally not configured. */
export function lightRagConfigFromEnv(env: Record<string, string | undefined> = process.env): LightRagConfig | null {
  const baseUrl = normalizedBaseUrl(env.LIGHTRAG_BASE_URL || env.LIGHTRAG_URL);
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: String(env.LIGHTRAG_API_KEY || "").trim() || undefined,
    queryMode: normalizeLightRagQueryMode(env.LIGHTRAG_QUERY_MODE),
    timeoutMs: boundedInteger(env.LIGHTRAG_TIMEOUT_MS, 30_000, 1_000, 120_000),
    topK: boundedInteger(env.LIGHTRAG_TOP_K, 20, 1, 100),
    chunkTopK: boundedInteger(env.LIGHTRAG_CHUNK_TOP_K, 12, 1, 100),
    enableRerank: booleanFromEnv(env.LIGHTRAG_ENABLE_RERANK, true)
  };
}

export function buildLightRagQueryPayload(input: LightRagQueryInput, config: LightRagConfig) {
  const query = String(input.query || "").trim();
  if (query.length < 3) throw new Error("LightRAG query must contain at least 3 characters");
  return {
    query,
    mode: normalizeLightRagQueryMode(input.mode || config.queryMode),
    only_need_context: input.contextOnly !== false,
    include_references: true,
    include_chunk_content: input.includeChunkContent !== false,
    enable_rerank: input.enableRerank ?? config.enableRerank,
    top_k: boundedInteger(input.topK, config.topK, 1, 100),
    chunk_top_k: boundedInteger(input.chunkTopK, config.chunkTopK, 1, 100)
  };
}

function endpoint(baseUrl: string, path: string) {
  return new URL(path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`).toString();
}

function requestHeaders(config: LightRagConfig) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };
  if (config.apiKey) headers["X-API-Key"] = config.apiKey;
  return headers;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, maximum = 200_000) {
  return String(value || "").replace(/\r\n?/g, "\n").trim().slice(0, maximum);
}

function referenceChunks(value: unknown) {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(new Set(raw.map((item) => cleanText(item, 50_000)).filter(Boolean))).slice(0, 12);
}

/**
 * Canonical source convention used by the regulation indexer. The marker in
 * document text remains the primary key; the file-name convention is a
 * deterministic fallback for older LightRAG responses without chunk content.
 */
export function canonicalIdFromLightRagReference(filePath: unknown, chunks: string[] = []) {
  const chunkText = chunks.join("\n");
  const marker = chunkText.match(/AAJ-CANONICAL-ID:\s*([^\s]+)/i)?.[1] || chunkText.match(/ID dokumen:\s*([^\s]+)/i)?.[1];
  if (marker) return marker.trim();
  const sourcePath = String(filePath || "").trim();
  const uriMatch = sourcePath.match(/^aa-jurist:\/\/(?:regulation|decision)\/(.+)$/i);
  if (uriMatch?.[1]) {
    try {
      return decodeURIComponent(uriMatch[1]).trim();
    } catch {
      return uriMatch[1].trim();
    }
  }
  // LightRAG 1.5.5 stores `Path(file_source).name`; a URI source used by the
  // v1 pilot therefore comes back as the exact bare AA-Jurist record ID.
  if (sourcePath && !/[\\/]/.test(sourcePath) && !/\.[a-z0-9]{1,8}$/i.test(sourcePath)) return sourcePath;
  const basename = sourcePath.split(/[\\/]/).pop() || "";
  const fileMatch = basename.match(/^aaj-(?:regulation|decision)--(.+?)(?:\.[a-z0-9]+)?$/i);
  if (!fileMatch?.[1]) return undefined;
  try {
    return decodeURIComponent(fileMatch[1]).trim();
  } catch {
    return fileMatch[1].trim();
  }
}

export function normalizeLightRagResponse(value: unknown, queryMode: LightRagQueryMode, clientLatencyMs = 0): LightRagQueryResult {
  const responseObject = objectValue(value);
  const response = cleanText(responseObject.response);
  const rawReferences = Array.isArray(responseObject.references) ? responseObject.references : [];
  const references = rawReferences.slice(0, 50).map((raw, index) => {
    const reference = objectValue(raw);
    const chunks = referenceChunks(reference.content);
    const filePath = cleanText(reference.file_path, 2_000);
    return {
      referenceId: cleanText(reference.reference_id, 200) || String(index + 1),
      filePath,
      chunks,
      canonicalId: canonicalIdFromLightRagReference(filePath, chunks),
      rank: index + 1
    };
  });
  const contextFromReferences = references.flatMap((reference) => reference.chunks).join("\n\n");
  const context = contextFromReferences || response;
  const explicitNoContext = /\[(?:no-context|no_context)\]|no relevant context found/i.test(response);
  const serverLatency = Number(responseObject.response_time);
  return {
    response,
    context,
    references,
    queryMode,
    clientLatencyMs: Math.max(0, clientLatencyMs),
    ...(Number.isFinite(serverLatency) ? { serverLatencyMs: Math.max(0, serverLatency * 1_000) } : {}),
    hasContext: Boolean(context.trim()) && !explicitNoContext
  };
}

function apiErrorDetail(value: unknown) {
  const item = objectValue(value);
  const detail = typeof item.detail === "string" ? item.detail : typeof item.message === "string" ? item.message : "";
  return cleanText(detail, 500).replace(/[\r\n\t]+/g, " ");
}

async function fetchJson(
  config: LightRagConfig,
  path: string,
  payload: unknown,
  fetchImpl: FetchLike,
  now: () => number
): Promise<{ json: unknown; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = now();
  try {
    const response = await fetchImpl(endpoint(config.baseUrl, path), {
      method: "POST",
      headers: requestHeaders(config),
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal
    });
    let json: unknown = {};
    try {
      json = await response.json();
    } catch {
      json = {};
    }
    if (!response.ok) {
      const detail = apiErrorDetail(json);
      throw new Error(`LightRAG HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return { json, latencyMs: Math.max(0, now() - startedAt) };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`LightRAG request timed out after ${config.timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function queryLightRag(
  config: LightRagConfig,
  input: LightRagQueryInput,
  dependencies: { fetch?: FetchLike; now?: () => number } = {}
) {
  const payload = buildLightRagQueryPayload(input, config);
  const { json, latencyMs } = await fetchJson(config, "query", payload, dependencies.fetch || fetch, dependencies.now || Date.now);
  return normalizeLightRagResponse(json, payload.mode, latencyMs);
}

function safeFileToken(value: string) {
  const token = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return token || "unknown";
}

function bulletList(values: Array<string | undefined>) {
  const unique = Array.from(new Set(values.map((value) => cleanText(value, 20_000)).filter(Boolean)));
  return unique.length ? unique.map((value) => `- ${value}`).join("\n") : "- Belum tersedia.";
}

/** Build one Indonesian canonical regulation document for the pilot index. */
export function regulationToLightRagDocument(record: Regulation): LightRagDocument {
  const canonicalId = cleanText(record.canonicalKey || record.id, 200);
  const extraction = record.extraction;
  const provisions = extraction?.keyProvisions?.map((provision) =>
    [provision.article ? `[${provision.article}]` : "", provision.page ? `(halaman ${provision.page})` : "", provision.text]
      .filter(Boolean)
      .join(" ")
  );
  // `record.relations` can contain sentence-pattern guesses produced by
  // deriveRegulationRelations(). Graph indexing must only receive relations
  // traced to the official extraction source, otherwise one heuristic edge can
  // contaminate cross-regulation retrieval for the whole workspace.
  const relations = (extraction?.relations || [])
    .filter((relation) => relation.source === "pdf" || relation.source === "official_page")
    .map((relation) =>
      [relation.type.toUpperCase(), relation.citation, relation.title, relation.effectiveDate, relation.note].filter(Boolean).join(" — ")
    );
  const sourceUrl = cleanText(record.sourceUrl || record.officialPdfUrl || record.pdfUrl, 2_000);
  const parts = [
    "AAJ-DOC-TYPE: regulation",
    `AAJ-CANONICAL-ID: ${canonicalId}`,
    `AAJ-SOURCE-LANGUAGE: ${record.sourceLanguage || "id"}`,
    sourceUrl ? `AAJ-OFFICIAL-SOURCE: ${sourceUrl}` : "",
    "",
    `# ${cleanText(record.citation, 500)} — ${cleanText(record.title, 1_000)}`,
    "",
    "## Fokus",
    cleanText(record.focus, 30_000) || "Belum tersedia.",
    "",
    "## Ringkasan ekstraksi",
    cleanText(extraction?.summary, 30_000) || "Belum tersedia.",
    "",
    "## Ruang lingkup",
    bulletList(extraction?.scope || []),
    "",
    "## Ketentuan utama",
    bulletList(provisions || []),
    "",
    "## Status hukum",
    bulletList([
      extraction?.legalStatus ? `Status: ${extraction.legalStatus}` : undefined,
      extraction?.effectiveDate ? `Tanggal efektif: ${extraction.effectiveDate}` : undefined,
      extraction?.statusNote
    ]),
    "",
    "## Relasi peraturan",
    bulletList(relations),
    "",
    "## Kata kunci",
    bulletList(extraction?.keywords || []),
    "",
    "## Isi sumber tersimpan",
    cleanText(record.content, 200_000) || "Belum tersedia."
  ];
  return {
    canonicalId,
    fileSource: `aaj-regulation--${safeFileToken(canonicalId)}.md`,
    text: parts.filter((part, index) => part || parts[index - 1] !== "").join("\n").trim()
  };
}

export function matchLightRagReferencesToRegulations(references: LightRagReference[], records: Regulation[], limit = 8) {
  const byCanonicalId = new Map<string, Regulation>();
  for (const record of records) {
    for (const key of [record.canonicalKey, record.id].filter(Boolean)) byCanonicalId.set(String(key).toLowerCase(), record);
  }
  const matched: Regulation[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const canonicalId = reference.canonicalId?.toLowerCase();
    const record = canonicalId ? byCanonicalId.get(canonicalId) : undefined;
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    matched.push(record);
    if (matched.length >= Math.max(1, limit)) break;
  }
  return matched;
}

export async function insertLightRagDocuments(
  config: LightRagConfig,
  documents: LightRagDocument[],
  options: { batchSize?: number; fetch?: FetchLike; now?: () => number } = {}
) {
  const batchSize = boundedInteger(options.batchSize, 10, 1, 50);
  const results: LightRagInsertResult[] = [];
  for (let index = 0; index < documents.length; index += batchSize) {
    const batch = documents.slice(index, index + batchSize);
    const payload = {
      texts: batch.map((document) => document.text),
      file_sources: batch.map((document) => document.fileSource)
    };
    const { json } = await fetchJson(config, "documents/texts", payload, options.fetch || fetch, options.now || Date.now);
    const response = objectValue(json);
    const status = ["success", "partial_success", "failure"].includes(String(response.status))
      ? (String(response.status) as LightRagInsertResult["status"])
      : "failure";
    results.push({
      status,
      message: cleanText(response.message, 2_000),
      trackId: cleanText(response.track_id, 500)
    });
  }
  return results;
}
