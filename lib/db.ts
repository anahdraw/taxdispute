import { Pool } from "pg";
import type { ActivityLog, ManagedUser } from "./admin";
import { normalizeUsername, seedUsers, userIdFromUsername } from "./admin";
import type { StoredDecisionFile } from "./stored-decisions";
import type { StoredReport } from "./stored-reports";
import type { ExtractionResult } from "./extraction";
import type { Regulation } from "./mock-data";
import { hashPassword, isPasswordHash, PASSWORD_HASH_PREFIX } from "./password";
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
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS app_users_role_status_idx
      ON app_users (role, status);
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
  for (const user of seedUsers) {
    await pool.query(
      `
        INSERT INTO app_users
          (id, username, password, name, role, status, created_at, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (username) DO NOTHING;
      `,
      [user.id, user.username, hashPassword(user.password), user.name, user.role, user.status, user.createdAt, user.updatedAt]
    );
  }
  await migratePlaintextUserPasswords();
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
    SELECT id, username, password, name, role, status, last_login_at, created_at, updated_at
    FROM app_users
    ORDER BY role ASC, username ASC;
  `);
  return result.rows.map((row) => ({
    id: String(row.id),
    username: String(row.username),
    password: String(row.password),
    name: String(row.name),
    role: row.role === "admin" ? "admin" : "user",
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
  const storedPassword = isPasswordHash(user.password) ? user.password : hashPassword(user.password);
  const now = new Date().toISOString();
  await getPool().query(
    `
      INSERT INTO app_users
        (id, username, password, name, role, status, last_login_at, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (username) DO UPDATE SET
        password = EXCLUDED.password,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at;
    `,
    [
      user.id || userIdFromUsername(username),
      username,
      storedPassword,
      user.name,
      user.role === "admin" ? "admin" : "user",
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
