import { Pool } from "pg";
import type { StoredDecisionFile } from "./stored-decisions";
import type { ExtractionResult } from "./extraction";

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
    LIMIT 250;
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
