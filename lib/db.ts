import { Pool } from "pg";
import type { StoredDecisionFile } from "./stored-decisions";
import type { ExtractionResult } from "./extraction";
import type { Regulation } from "./mock-data";
import { normalizeRegulationTopic } from "./regulation-knowledge";

declare global {
  // eslint-disable-next-line no-var
  var taxDisputePool: Pool | undefined;
}

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

export function hasDatabase() {
  return Boolean(databaseUrl());
}

export function getPool() {
  const connectionString = databaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL or POSTGRES_URL is not configured.");
  }
  if (!global.taxDisputePool) {
    global.taxDisputePool = new Pool({
      connectionString,
      max: 3,
      ssl: connectionString.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false }
    });
  }
  return global.taxDisputePool;
}

export async function ensureDecisionSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS decision_documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      pathname TEXT NOT NULL,
      url TEXT NOT NULL,
      download_url TEXT NOT NULL,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'uploaded',
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS decision_documents_uploaded_at_idx
      ON decision_documents (uploaded_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS decision_extractions (
      document_id TEXT PRIMARY KEY REFERENCES decision_documents(id) ON DELETE CASCADE,
      extraction JSONB NOT NULL,
      extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function listDecisionDocuments(): Promise<StoredDecisionFile[]> {
  await ensureDecisionSchema();
  const result = await getPool().query(`
    SELECT
      d.id,
      d.filename,
      d.pathname,
      d.url,
      d.download_url,
      d.size_bytes,
      d.status,
      d.uploaded_at,
      e.extraction
    FROM decision_documents d
    LEFT JOIN decision_extractions e ON e.document_id = d.id
    ORDER BY d.uploaded_at DESC
    LIMIT 1000;
  `);
  return result.rows.map((row) => ({
    id: String(row.id),
    filename: String(row.filename),
    pathname: String(row.pathname),
    url: String(row.url),
    downloadUrl: String(row.download_url),
    size: Number(row.size_bytes || 0),
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    status: row.status === "failed" ? "failed" : row.status === "extracted" ? "extracted" : "uploaded",
    extraction: row.extraction ? (row.extraction as ExtractionResult) : null
  }));
}

export async function getDecisionDocumentById(documentId: string): Promise<StoredDecisionFile | null> {
  await ensureDecisionSchema();
  const result = await getPool().query(
    `
      SELECT
        d.id,
        d.filename,
        d.pathname,
        d.url,
        d.download_url,
        d.size_bytes,
        d.status,
        d.uploaded_at,
        e.extraction
      FROM decision_documents d
      LEFT JOIN decision_extractions e ON e.document_id = d.id
      WHERE d.id = $1
      LIMIT 1;
    `,
    [documentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    filename: String(row.filename),
    pathname: String(row.pathname),
    url: String(row.url),
    downloadUrl: String(row.download_url),
    size: Number(row.size_bytes || 0),
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    status: row.status === "failed" ? "failed" : row.status === "extracted" ? "extracted" : "uploaded",
    extraction: row.extraction ? (row.extraction as ExtractionResult) : null
  };
}

export async function upsertDecisionDocument(document: StoredDecisionFile) {
  await ensureDecisionSchema();
  await getPool().query(
    `
      INSERT INTO decision_documents
        (id, filename, pathname, url, download_url, size_bytes, status, uploaded_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        filename = EXCLUDED.filename,
        pathname = EXCLUDED.pathname,
        url = EXCLUDED.url,
        download_url = EXCLUDED.download_url,
        size_bytes = EXCLUDED.size_bytes,
        status = EXCLUDED.status,
        uploaded_at = EXCLUDED.uploaded_at;
    `,
    [
      document.id,
      document.filename,
      document.pathname,
      document.url,
      document.downloadUrl,
      document.size,
      document.status,
      document.uploadedAt
    ]
  );
  if (document.extraction) {
    await upsertDecisionExtraction(document.id, document.extraction);
  }
}

export async function upsertDecisionExtraction(documentId: string, extraction: ExtractionResult) {
  await ensureDecisionSchema();
  await getPool().query(
    `
      INSERT INTO decision_extractions
        (document_id, extraction, extracted_at)
      VALUES
        ($1, $2::jsonb, $3)
      ON CONFLICT (document_id) DO UPDATE SET
        extraction = EXCLUDED.extraction,
        extracted_at = EXCLUDED.extracted_at;
    `,
    [documentId, JSON.stringify(extraction), extraction.extractedAt || new Date().toISOString()]
  );
  await getPool().query(`UPDATE decision_documents SET status = 'extracted' WHERE id = $1`, [documentId]);
}

export async function deleteDecisionDocument(documentId: string) {
  await ensureDecisionSchema();
  await getPool().query(`DELETE FROM decision_documents WHERE id = $1`, [documentId]);
}

export async function ensureRegulationSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tax_regulations (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL,
      citation TEXT NOT NULL,
      focus TEXT NOT NULL,
      relevance INTEGER NOT NULL DEFAULT 70,
      source TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS tax_regulations_topic_idx
      ON tax_regulations (topic, updated_at DESC);
  `);
}

export async function listTaxRegulations(): Promise<Regulation[]> {
  await ensureRegulationSchema();
  const result = await getPool().query(`
    SELECT id, topic, title, citation, focus, relevance, source, source_url, content, updated_at
    FROM tax_regulations
    ORDER BY topic ASC, updated_at DESC, relevance DESC;
  `);
  return result.rows.map((row) => ({
    id: String(row.id),
    topic: normalizeRegulationTopic(row.topic),
    title: String(row.title),
    citation: String(row.citation),
    focus: String(row.focus),
    relevance: Number(row.relevance || 70),
    source: row.source === "ortax" ? "ortax" : row.source === "seed" ? "seed" : "manual",
    sourceUrl: String(row.source_url || ""),
    content: String(row.content || ""),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined
  }));
}

export async function upsertTaxRegulations(records: Regulation[]) {
  if (records.length === 0) return;
  await ensureRegulationSchema();
  const pool = getPool();
  for (const record of records) {
    await pool.query(
      `
        INSERT INTO tax_regulations
          (id, topic, title, citation, focus, relevance, source, source_url, content, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          topic = EXCLUDED.topic,
          title = EXCLUDED.title,
          citation = EXCLUDED.citation,
          focus = EXCLUDED.focus,
          relevance = EXCLUDED.relevance,
          source = EXCLUDED.source,
          source_url = EXCLUDED.source_url,
          content = EXCLUDED.content,
          updated_at = EXCLUDED.updated_at;
      `,
      [
        record.id,
        normalizeRegulationTopic(record.topic),
        record.title,
        record.citation,
        record.focus,
        Math.max(1, Math.min(100, Number(record.relevance || 70))),
        record.source || "manual",
        record.sourceUrl || "",
        record.content || "",
        record.updatedAt || new Date().toISOString()
      ]
    );
  }
}

export async function deleteTaxRegulation(id: string) {
  await ensureRegulationSchema();
  await getPool().query(`DELETE FROM tax_regulations WHERE id = $1`, [id]);
}
