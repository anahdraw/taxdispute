import { Pool } from "pg";
import type { ActivityLog, ManagedUser } from "./admin";
import { normalizeSubscriptionTier, normalizeUsername, seedUsers, userIdFromUsername } from "./admin";
import type { StoredDecisionFile } from "./stored-decisions";
import type { StoredReport } from "./stored-reports";
import type { ExtractionResult } from "./extraction";
import type { Regulation } from "./mock-data";
import { hashPassword, isPasswordHash, PASSWORD_HASH_PREFIX } from "./password";
import { normalizeRegulationTopic } from "./regulation-knowledge";
import type { PaginationParams } from "./pagination";

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

export async function countDecisionDocuments(): Promise<number> {
  await ensureDecisionSchema();
  const result = await getPool().query(`SELECT COUNT(*)::int AS total FROM decision_documents;`);
  return Number(result.rows[0]?.total || 0);
}

export async function listDecisionDocumentSummaries(params: PaginationParams): Promise<StoredDecisionFile[]> {
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
        CASE
          WHEN e.extraction IS NULL THEN NULL
          ELSE jsonb_strip_nulls(jsonb_build_object(
            'filename', e.extraction->>'filename',
            'documentType', e.extraction->>'documentType',
            'putusanNumber', e.extraction->>'putusanNumber',
            'putusanYear', e.extraction->>'putusanYear',
            'courtPanel', e.extraction->>'courtPanel',
            'decisionDate', e.extraction->>'decisionDate',
            'taxpayerName', e.extraction->>'taxpayerName',
            'taxpayerNpwp', e.extraction->>'taxpayerNpwp',
            'taxType', e.extraction->>'taxType',
            'taxPeriod', e.extraction->>'taxPeriod',
            'skpNumber', e.extraction->>'skpNumber',
            'djpDecisionNumber', e.extraction->>'djpDecisionNumber',
            'issueType', e.extraction->>'issueType',
            'issueSubtype', e.extraction->>'issueSubtype',
            'correctionAmount', e.extraction->>'correctionAmount',
            'correctionObject', e.extraction->>'correctionObject',
            'outcome', e.extraction->>'outcome',
            'summary', left(e.extraction->>'summary', 180),
            'extractionCompleteness', c.completeness,
            'extractedAt', e.extraction->>'extractedAt',
            'llmStatus', e.extraction->'llmStatus'
          ))
        END AS extraction
      FROM decision_documents d
      LEFT JOIN decision_extractions e ON e.document_id = d.id
      LEFT JOIN LATERAL (
        SELECT ROUND((
          (CASE WHEN NULLIF(e.extraction->>'putusanNumber', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'putusanYear', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'courtPanel', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'clerkName', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'decisionDate', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'taxpayerName', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'taxpayerNpwp', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'taxpayerAddress', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'legalCounselName', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'djpUnit', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'taxType', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'taxPeriod', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'skpNumber', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'djpDecisionNumber', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'issueType', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'correctionAmount', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'taxAuthorityPosition', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'taxpayerPosition', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'courtReasoning', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN NULLIF(e.extraction->>'outcome', '') IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN jsonb_array_length(CASE WHEN jsonb_typeof(e.extraction->'judgeNames') = 'array' THEN e.extraction->'judgeNames' ELSE '[]'::jsonb END) > 0 THEN 1 ELSE 0 END) +
          (CASE WHEN jsonb_array_length(CASE WHEN jsonb_typeof(e.extraction->'evidence') = 'array' THEN e.extraction->'evidence' ELSE '[]'::jsonb END) > 0 THEN 1 ELSE 0 END) +
          (CASE WHEN jsonb_array_length(CASE WHEN jsonb_typeof(e.extraction->'legalReferences') = 'array' THEN e.extraction->'legalReferences' ELSE '[]'::jsonb END) > 0 THEN 1 ELSE 0 END)
        ) * 100.0 / 23)::int AS completeness
      ) c ON e.extraction IS NOT NULL
      ORDER BY d.uploaded_at DESC
      LIMIT $1 OFFSET $2;
    `,
    [params.perPage, params.offset]
  );
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
      pdf_url TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE tax_regulations
    ADD COLUMN IF NOT EXISTS pdf_url TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE tax_regulations
      ADD COLUMN IF NOT EXISTS official_pdf_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS stored_pdf_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS source_authority TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS ingestion_status TEXT NOT NULL DEFAULT 'seed',
      ADD COLUMN IF NOT EXISTS ingestion_message TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS file_hash TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS extraction JSONB,
      ADD COLUMN IF NOT EXISTS relations JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS tax_regulations_topic_idx
      ON tax_regulations (topic, updated_at DESC);
  `);
}

function regulationFromRow(row: Record<string, unknown>, includeExtraction = true): Regulation {
  const source = String(row.source || "manual");
  const status = String(row.ingestion_status || "seed") as Regulation["ingestionStatus"];
  const relations = Array.isArray(row.relations) ? (row.relations as NonNullable<Regulation["relations"]>) : [];
  const storedPdfUrl = String(row.stored_pdf_url || "");
  const officialPdfUrl = String(row.official_pdf_url || row.pdf_url || "");
  return {
    id: String(row.id),
    topic: normalizeRegulationTopic(String(row.topic || "general")),
    title: String(row.title),
    citation: String(row.citation),
    focus: String(row.focus),
    relevance: Number(row.relevance || 70),
    source: source === "ortax" ? "ortax" : source === "seed" ? "seed" : source === "official" ? "official" : "manual",
    sourceUrl: String(row.source_url || ""),
    pdfUrl: storedPdfUrl || String(row.pdf_url || "") || officialPdfUrl,
    officialPdfUrl,
    storedPdfUrl,
    sourceAuthority: String(row.source_authority || ""),
    content: includeExtraction ? String(row.content || "") : "",
    ingestionStatus: status,
    ingestionMessage: String(row.ingestion_message || ""),
    fileHash: String(row.file_hash || ""),
    extraction: includeExtraction && row.extraction ? (row.extraction as NonNullable<Regulation["extraction"]>) : null,
    relations,
    extractedAt: row.extracted_at ? new Date(String(row.extracted_at)).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : undefined
  };
}

export async function listTaxRegulations(): Promise<Regulation[]> {
  await ensureRegulationSchema();
  const result = await getPool().query(`
    SELECT id, topic, title, citation, focus, relevance, source, source_url, pdf_url,
           official_pdf_url, stored_pdf_url, source_authority, content, ingestion_status,
           ingestion_message, file_hash, extraction, relations, extracted_at, updated_at
    FROM tax_regulations
    ORDER BY topic ASC, updated_at DESC, relevance DESC;
  `);
  return result.rows.map((row) => regulationFromRow(row));
}

export async function countTaxRegulations(): Promise<number> {
  await ensureRegulationSchema();
  const result = await getPool().query(`SELECT COUNT(*)::int AS total FROM tax_regulations;`);
  return Number(result.rows[0]?.total || 0);
}

export async function listTaxRegulationSummaries(params: PaginationParams): Promise<Regulation[]> {
  await ensureRegulationSchema();
  const result = await getPool().query(
    `
      SELECT id, topic, title, citation, focus, relevance, source, source_url, pdf_url,
             official_pdf_url, stored_pdf_url, source_authority, ingestion_status,
             ingestion_message, file_hash, relations, extracted_at, updated_at
      FROM tax_regulations
      ORDER BY topic ASC, updated_at DESC, relevance DESC
      LIMIT $1 OFFSET $2;
    `,
    [params.perPage, params.offset]
  );
  return result.rows.map((row) => regulationFromRow(row, false));
}

export async function getTaxRegulationById(id: string): Promise<Regulation | null> {
  await ensureRegulationSchema();
  const result = await getPool().query(
    `
      SELECT id, topic, title, citation, focus, relevance, source, source_url, pdf_url,
             official_pdf_url, stored_pdf_url, source_authority, content, ingestion_status,
             ingestion_message, file_hash, extraction, relations, extracted_at, updated_at
      FROM tax_regulations
      WHERE id = $1
      LIMIT 1;
    `,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return regulationFromRow(row);
}

export async function upsertTaxRegulations(records: Regulation[]) {
  if (records.length === 0) return;
  await ensureRegulationSchema();
  const pool = getPool();
  for (const record of records) {
    await pool.query(
      `
        INSERT INTO tax_regulations
          (id, topic, title, citation, focus, relevance, source, source_url, pdf_url,
           official_pdf_url, stored_pdf_url, source_authority, content, ingestion_status,
           ingestion_message, file_hash, extraction, relations, extracted_at, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           $15, $16, $17::jsonb, $18::jsonb, $19, $20)
        ON CONFLICT (id) DO UPDATE SET
          topic = EXCLUDED.topic,
          title = EXCLUDED.title,
          citation = EXCLUDED.citation,
          focus = EXCLUDED.focus,
          relevance = EXCLUDED.relevance,
          source = EXCLUDED.source,
          source_url = EXCLUDED.source_url,
          pdf_url = EXCLUDED.pdf_url,
          official_pdf_url = EXCLUDED.official_pdf_url,
          stored_pdf_url = EXCLUDED.stored_pdf_url,
          source_authority = EXCLUDED.source_authority,
          content = EXCLUDED.content,
          ingestion_status = EXCLUDED.ingestion_status,
          ingestion_message = EXCLUDED.ingestion_message,
          file_hash = EXCLUDED.file_hash,
          extraction = EXCLUDED.extraction,
          relations = EXCLUDED.relations,
          extracted_at = EXCLUDED.extracted_at,
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
        record.pdfUrl || "",
        record.officialPdfUrl || "",
        record.storedPdfUrl || "",
        record.sourceAuthority || "",
        record.content || "",
        record.ingestionStatus || "seed",
        record.ingestionMessage || "",
        record.fileHash || "",
        record.extraction ? JSON.stringify(record.extraction) : null,
        JSON.stringify(record.relations || record.extraction?.relations || []),
        record.extractedAt || record.extraction?.extractedAt || null,
        record.updatedAt || new Date().toISOString()
      ]
    );
  }
}

export async function deleteTaxRegulation(id: string) {
  await ensureRegulationSchema();
  await getPool().query(`DELETE FROM tax_regulations WHERE id = $1`, [id]);
}

export async function ensureReportSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tax_reports (
      id TEXT PRIMARY KEY,
      report_key TEXT NOT NULL,
      title TEXT NOT NULL,
      taxpayer_name TEXT NOT NULL DEFAULT '',
      case_number TEXT NOT NULL DEFAULT '',
      tax_type TEXT NOT NULL DEFAULT '',
      issue_type TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'en',
      input JSONB NOT NULL,
      extraction JSONB,
      analysis JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS tax_reports_report_key_language_idx
      ON tax_reports (report_key, language);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS tax_reports_updated_at_idx
      ON tax_reports (updated_at DESC);
  `);
}

export async function listTaxReports(): Promise<StoredReport[]> {
  await ensureReportSchema();
  const result = await getPool().query(`
    SELECT id, report_key, title, taxpayer_name, case_number, tax_type, issue_type, language, input, extraction, analysis, created_at, updated_at
    FROM tax_reports
    ORDER BY updated_at DESC
    LIMIT 500;
  `);
  return result.rows.map((row) => ({
    id: String(row.id),
    reportKey: String(row.report_key),
    title: String(row.title),
    taxpayerName: String(row.taxpayer_name || ""),
    caseNumber: String(row.case_number || ""),
    taxType: String(row.tax_type || ""),
    issueType: String(row.issue_type || ""),
    language: row.language === "id" ? "id" : "en",
    input: row.input,
    extraction: row.extraction || null,
    analysis: row.analysis,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }));
}

export async function countTaxReports(): Promise<number> {
  await ensureReportSchema();
  const result = await getPool().query(`SELECT COUNT(*)::int AS total FROM tax_reports;`);
  return Number(result.rows[0]?.total || 0);
}

export async function listTaxReportSummaries(params: PaginationParams): Promise<StoredReport[]> {
  await ensureReportSchema();
  const result = await getPool().query(
    `
      SELECT id, report_key, title, taxpayer_name, case_number, tax_type, issue_type, language, created_at, updated_at
      FROM tax_reports
      ORDER BY updated_at DESC
      LIMIT $1 OFFSET $2;
    `,
    [params.perPage, params.offset]
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    reportKey: String(row.report_key),
    title: String(row.title),
    taxpayerName: String(row.taxpayer_name || ""),
    caseNumber: String(row.case_number || ""),
    taxType: String(row.tax_type || ""),
    issueType: String(row.issue_type || ""),
    language: row.language === "id" ? "id" : "en",
    input: {} as StoredReport["input"],
    extraction: null,
    analysis: {} as StoredReport["analysis"],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }));
}

export async function getTaxReportById(id: string): Promise<StoredReport | null> {
  await ensureReportSchema();
  const result = await getPool().query(
    `
      SELECT id, report_key, title, taxpayer_name, case_number, tax_type, issue_type, language, input, extraction, analysis, created_at, updated_at
      FROM tax_reports
      WHERE id = $1
      LIMIT 1;
    `,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    reportKey: String(row.report_key),
    title: String(row.title),
    taxpayerName: String(row.taxpayer_name || ""),
    caseNumber: String(row.case_number || ""),
    taxType: String(row.tax_type || ""),
    issueType: String(row.issue_type || ""),
    language: row.language === "id" ? "id" : "en",
    input: row.input,
    extraction: row.extraction || null,
    analysis: row.analysis,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function upsertTaxReport(report: StoredReport) {
  await ensureReportSchema();
  await getPool().query(
    `
      INSERT INTO tax_reports
        (id, report_key, title, taxpayer_name, case_number, tax_type, issue_type, language, input, extraction, analysis, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13)
      ON CONFLICT (report_key, language) DO UPDATE SET
        id = EXCLUDED.id,
        title = EXCLUDED.title,
        taxpayer_name = EXCLUDED.taxpayer_name,
        case_number = EXCLUDED.case_number,
        tax_type = EXCLUDED.tax_type,
        issue_type = EXCLUDED.issue_type,
        input = EXCLUDED.input,
        extraction = EXCLUDED.extraction,
        analysis = EXCLUDED.analysis,
        updated_at = EXCLUDED.updated_at;
    `,
    [
      report.id,
      report.reportKey,
      report.title,
      report.taxpayerName,
      report.caseNumber,
      report.taxType,
      report.issueType,
      report.language,
      JSON.stringify(report.input),
      report.extraction ? JSON.stringify(report.extraction) : null,
      JSON.stringify(report.analysis),
      report.createdAt,
      report.updatedAt
    ]
  );
}

export async function deleteTaxReport(id: string) {
  await ensureReportSchema();
  await getPool().query(`DELETE FROM tax_reports WHERE id = $1`, [id]);
}

export async function ensureAdminSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      tier TEXT NOT NULL DEFAULT 'silver',
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'silver';
  `);
  await pool.query(`
    UPDATE app_users
      SET tier = 'platinum'
      WHERE role = 'admin' AND (tier IS NULL OR tier = '' OR tier = 'silver');
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS app_users_role_status_idx
      ON app_users (role, status);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS app_users_tier_idx
      ON app_users (tier);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'guest',
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx
      ON activity_logs (created_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  for (const user of seedUsers) {
    await pool.query(
      `
        INSERT INTO app_users
          (id, username, password, name, role, tier, status, created_at, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (username) DO NOTHING;
      `,
      [user.id, user.username, hashPassword(user.password), user.name, user.role, user.tier, user.status, user.createdAt, user.updatedAt]
    );
  }
  await migratePlaintextUserPasswords();
}

export async function getAppSetting<T>(key: string): Promise<T | null> {
  await ensureAdminSchema();
  const result = await getPool().query(`SELECT value FROM app_settings WHERE key = $1 LIMIT 1`, [key]);
  return result.rows[0]?.value ? (result.rows[0].value as T) : null;
}

export async function upsertAppSetting(key: string, value: unknown) {
  await ensureAdminSchema();
  await getPool().query(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
    `,
    [key, JSON.stringify(value)]
  );
}

async function migratePlaintextUserPasswords() {
  const result = await getPool().query(`SELECT id, password FROM app_users;`);
  for (const row of result.rows) {
    const password = String(row.password || "");
    if (!password || isPasswordHash(password)) continue;
    await getPool().query(`UPDATE app_users SET password = $1, updated_at = NOW() WHERE id = $2`, [
      hashPassword(password),
      String(row.id)
    ]);
  }
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  await ensureAdminSchema();
  const result = await getPool().query(`
    SELECT id, username, password, name, role, tier, status, last_login_at, created_at, updated_at
    FROM app_users
    ORDER BY role ASC, tier DESC, username ASC;
  `);
  return result.rows.map((row) => ({
    id: String(row.id),
    username: String(row.username),
    password: String(row.password),
    name: String(row.name),
    role: row.role === "admin" ? "admin" : "user",
    tier: normalizeSubscriptionTier(row.tier, row.role === "admin" ? "admin" : "user"),
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : undefined
  }));
}

export async function upsertManagedUser(user: ManagedUser) {
  await ensureAdminSchema();
  const username = normalizeUsername(user.username);
  if (!username || !user.password || !user.name) {
    throw new Error("Username, password, and name are required.");
  }
  const role = user.role === "admin" ? "admin" : "user";
  const tier = normalizeSubscriptionTier(user.tier, role);
  const storedPassword = isPasswordHash(user.password) ? user.password : hashPassword(user.password);
  const now = new Date().toISOString();
  await getPool().query(
    `
      INSERT INTO app_users
        (id, username, password, name, role, tier, status, last_login_at, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (username) DO UPDATE SET
        password = EXCLUDED.password,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        tier = EXCLUDED.tier,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at;
    `,
    [
      user.id || userIdFromUsername(username),
      username,
      storedPassword,
      user.name,
      role,
      tier,
      user.status === "inactive" ? "inactive" : "active",
      user.lastLoginAt || null,
      user.createdAt || now,
      now
    ]
  );
}

export async function countLegacyPlaintextUsers() {
  await ensureAdminSchema();
  const result = await getPool().query(`SELECT COUNT(*)::int AS count FROM app_users WHERE password NOT LIKE $1`, [
    `${PASSWORD_HASH_PREFIX}$%`
  ]);
  return Number(result.rows[0]?.count || 0);
}

export async function deleteManagedUser(id: string) {
  await ensureAdminSchema();
  await getPool().query(`DELETE FROM app_users WHERE id = $1`, [id]);
}

export async function markManagedUserLogin(username: string) {
  await ensureAdminSchema();
  await getPool().query(`UPDATE app_users SET last_login_at = NOW(), updated_at = NOW() WHERE username = $1`, [normalizeUsername(username)]);
}

export async function listActivityLogs(limit = 200): Promise<ActivityLog[]> {
  await ensureAdminSchema();
  const result = await getPool().query(
    `
      SELECT id, actor, role, action, target, status, detail, created_at
      FROM activity_logs
      ORDER BY created_at DESC
      LIMIT $1;
    `,
    [Math.max(1, Math.min(500, limit))]
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    actor: String(row.actor || ""),
    role: row.role === "admin" ? "admin" : row.role === "user" ? "user" : "guest",
    action: String(row.action || ""),
    target: String(row.target || ""),
    status: row.status === "error" ? "error" : row.status === "warning" ? "warning" : "success",
    detail: String(row.detail || ""),
    createdAt: new Date(row.created_at).toISOString()
  }));
}

export async function insertActivityLog(log: ActivityLog) {
  await ensureAdminSchema();
  await getPool().query(
    `
      INSERT INTO activity_logs
        (id, actor, role, action, target, status, detail, created_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING;
    `,
    [
      log.id,
      log.actor,
      log.role,
      log.action,
      log.target,
      log.status,
      log.detail,
      log.createdAt || new Date().toISOString()
    ]
  );
}

export async function getAdminTableCounts() {
  const pool = getPool();
  await ensureDecisionSchema();
  await ensureRegulationSchema();
  await ensureReportSchema();
  await ensureAdminSchema();
  const [decisions, reports, regulations, users, logs] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM decision_documents`),
    pool.query(`SELECT COUNT(*)::int AS count FROM tax_reports`),
    pool.query(`SELECT COUNT(*)::int AS count FROM tax_regulations`),
    pool.query(`SELECT COUNT(*)::int AS count FROM app_users`),
    pool.query(`SELECT COUNT(*)::int AS count FROM activity_logs`)
  ]);
  return {
    decisions: Number(decisions.rows[0]?.count || 0),
    reports: Number(reports.rows[0]?.count || 0),
    regulations: Number(regulations.rows[0]?.count || 0),
    users: Number(users.rows[0]?.count || 0),
    logs: Number(logs.rows[0]?.count || 0)
  };
}
