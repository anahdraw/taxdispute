#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import xlsx from "xlsx";

const { Pool } = pg;

const DEFAULT_FILE = "/Users/sintzu/Downloads/Database Sengketa TP.xlsx";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function isDryRun() {
  return process.argv.includes("--dry-run");
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDecision(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, "");
}

function unique(values, limit = 40) {
  const seen = new Set();
  const items = [];
  for (const value of values.map(normalizeText).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(value);
    if (items.length >= limit) break;
  }
  return items;
}

function joinUnique(values, separator = "\n\n") {
  return unique(values, 80).join(separator);
}

function splitLegalReferences(values) {
  return unique(
    values.flatMap((value) =>
      normalizeText(value)
        .split(/;|\n|•/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 4)
    ),
    50
  );
}

function extractYear(decisionNumber) {
  const match = normalizeText(decisionNumber).match(/Tahun\s*(\d{4})/i) || normalizeText(decisionNumber).match(/\b(20\d{2})\b/);
  return match ? match[1] : "";
}

function likelyTaxType(rows) {
  const text = rows
    .flatMap((row) => [row.Pokok_Sengketa, row.Dasar_Hukum])
    .map(normalizeText)
    .join(" ")
    .toLowerCase();
  if (text.includes("ppn") || text.includes("pajak pertambahan nilai")) return "PPN";
  if (text.includes("transfer pricing") || text.includes("hubungan istimewa") || text.includes("afiliasi")) return "PPh Badan / Transfer Pricing";
  if (text.includes("pph")) return "PPh";
  return "Transfer Pricing";
}

function buildExtraction(group, sourceName) {
  const first = group[0];
  const putusanNumber = normalizeText(first.No_Putusan);
  const taxpayerNames = unique(group.map((row) => row.Nama_WP), 8);
  const issues = unique(group.map((row) => row.Pokok_Sengketa), 30);
  const outcomes = unique(group.map((row) => row.Amar_Putusan), 12);
  const legalReferences = splitLegalReferences(group.map((row) => row.Dasar_Hukum));
  const taxAuthority = joinUnique(group.map((row) => row["Menurut DJP"]));
  const taxpayer = joinUnique(group.map((row) => row["Menurut Wajib Pajak"]));
  const courtReasoning = joinUnique(group.map((row) => row["Keputusan Majelis"]));
  const issueText = issues.join("; ");
  const outcomeText = outcomes.join("; ");

  return {
    filename: sourceName,
    documentType: "putusan_pengadilan_import_excel",
    putusanNumber,
    putusanYear: extractYear(putusanNumber),
    taxpayerName: taxpayerNames.join("; "),
    taxpayerNpwp: "",
    taxpayerAddress: "",
    representativeName: "",
    legalCounselName: "",
    legalCounselLicense: "",
    appelleeName: "Direktur Jenderal Pajak",
    djpUnit: "",
    taxType: likelyTaxType(group),
    taxPeriod: "",
    skpNumber: "",
    djpDecisionNumber: "",
    issueType: "Transfer Pricing",
    issueSubtype: issueText,
    correctionAmount: "",
    correctionObject: issueText,
    correctionReason: taxAuthority,
    taxpayerRebuttal: taxpayer,
    taxAuthorityPosition: taxAuthority,
    taxpayerPosition: taxpayer,
    evidence: [],
    legalReferences,
    courtReasoning,
    outcome: outcomeText,
    summary: `Imported Excel extraction for ${taxpayerNames[0] || "taxpayer"} covering ${issues.length || 1} dispute issue(s). Outcome: ${outcomeText || "-"}.`,
    extractedAt: new Date().toISOString(),
    llmStatus: {
      used: false,
      model: "excel-import",
      message: `Imported from existing Excel extraction (${group.length} row(s) merged).`
    }
  };
}

async function ensureSchema(pool) {
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
    CREATE TABLE IF NOT EXISTS decision_extractions (
      document_id TEXT PRIMARY KEY REFERENCES decision_documents(id) ON DELETE CASCADE,
      extraction JSONB NOT NULL,
      extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function upsert(pool, record) {
  await pool.query(
    `
      INSERT INTO decision_documents
        (id, filename, pathname, url, download_url, size_bytes, status, uploaded_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'extracted', $7)
      ON CONFLICT (id) DO UPDATE SET
        filename = EXCLUDED.filename,
        pathname = EXCLUDED.pathname,
        size_bytes = EXCLUDED.size_bytes,
        status = 'extracted',
        uploaded_at = EXCLUDED.uploaded_at;
    `,
    [record.id, record.filename, record.pathname, record.url, record.downloadUrl, record.size, record.uploadedAt]
  );
  await pool.query(
    `
      INSERT INTO decision_extractions
        (document_id, extraction, extracted_at)
      VALUES
        ($1, $2::jsonb, $3)
      ON CONFLICT (document_id) DO UPDATE SET
        extraction = EXCLUDED.extraction,
        extracted_at = EXCLUDED.extracted_at;
    `,
    [record.id, JSON.stringify(record.extraction), record.extraction.extractedAt]
  );
}

function buildRecords(filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  const groups = new Map();
  for (const row of rows) {
    const decision = normalizeDecision(row.No_Putusan);
    if (!decision) continue;
    if (!groups.has(decision)) groups.set(decision, []);
    groups.get(decision).push(row);
  }
  const sourceName = path.basename(filePath);
  const size = fs.statSync(filePath).size;
  return Array.from(groups.entries()).map(([decisionKey, group]) => {
    const hash = crypto.createHash("sha1").update(decisionKey).digest("hex").slice(0, 16);
    const extraction = buildExtraction(group, sourceName);
    return {
      id: `excel-${hash}`,
      filename: `${extraction.putusanNumber || hash}.xlsx-import`,
      pathname: `excel-import/${hash}`,
      url: `excel-import://${hash}`,
      downloadUrl: "",
      size,
      uploadedAt: new Date().toISOString(),
      status: "extracted",
      extraction
    };
  });
}

async function importViaApi(apiUrl, records) {
  let imported = 0;
  for (const record of records) {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record)
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`API import failed for ${record.filename}: ${response.status} ${detail}`);
    }
    imported += 1;
  }
  return imported;
}

async function main() {
  const filePath = argValue("--file", DEFAULT_FILE);
  const apiUrl = argValue("--api", "https://taxdispute.vercel.app/api/decisions");
  loadEnvFile(path.resolve(".env.local"));
  const records = buildRecords(filePath);
  const totalRows = xlsx.utils.sheet_to_json(xlsx.readFile(filePath).Sheets[xlsx.readFile(filePath).SheetNames[0]], { defval: "" }).length;
  console.log(`Excel rows: ${totalRows}`);
  console.log(`Unique decision records: ${records.length}`);

  if (isDryRun()) {
    console.log("Dry run only. First 3 records:");
    for (const record of records.slice(0, 3)) {
      console.log(JSON.stringify({ id: record.id, filename: record.filename, extraction: record.extraction }, null, 2));
    }
    return;
  }

  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    const imported = await importViaApi(apiUrl, records);
    console.log(`Imported ${imported} records through ${apiUrl}.`);
    return;
  }
  const pool = new Pool({
    connectionString,
    max: 3,
    ssl: connectionString.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false }
  });
  try {
    await ensureSchema(pool);
    for (const record of records) {
      await upsert(pool, record);
    }
  } finally {
    await pool.end();
  }
  console.log(`Imported ${records.length} records into decision_documents and decision_extractions.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
