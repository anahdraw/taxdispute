"""Skema SQLite + FTS5 untuk korpus & knowledge graph peraturan perpajakan."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager

from .config import DB_PATH

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Satu baris per dokumen peraturan.
CREATE TABLE IF NOT EXISTS regulation (
  id            TEXT PRIMARY KEY,   -- kunci kanonik, mis. 'per-31-pj-2009'
  canonical     TEXT NOT NULL,      -- tampilan kanonik, mis. 'PER-31/PJ/2009'
  nomor_raw     TEXT,               -- apa adanya dari situs
  jenis         TEXT,               -- 'Peraturan Dirjen Pajak', ...
  jenis_code    TEXT,               -- PER | PMK | KMK | UU | PP | SE | KEP | PERPRES ...
  kategori      TEXT,               -- PPh | PPN | KUP | PBB | BM | BPHTB | Lainnya
  tahun         INTEGER,
  tanggal       TEXT,               -- ISO-8601 tanggal penetapan
  judul         TEXT,
  url           TEXT,
  status_site   TEXT,               -- label DJP: Aktif | Dicabut | Diubah/...
  has_body      INTEGER DEFAULT 0,  -- 1 bila body HTML tersedia di DJP
  body_text     TEXT,
  source        TEXT DEFAULT 'djp', -- djp | jdih-kemenkeu | peraturan.go.id | manual
  sha256        TEXT,
  fetched_at    TEXT
);
CREATE INDEX IF NOT EXISTS ix_reg_tahun    ON regulation(tahun);
CREATE INDEX IF NOT EXISTS ix_reg_jenis    ON regulation(jenis_code);
CREATE INDEX IF NOT EXISTS ix_reg_kategori ON regulation(kategori);
CREATE INDEX IF NOT EXISTS ix_reg_status   ON regulation(status_site);

-- Tag katalog DJP (kode 4 digit: 2005-PPh Pasal 21, 3004-Faktur Pajak, ...).
CREATE TABLE IF NOT EXISTS reg_tag (
  reg_id   TEXT NOT NULL REFERENCES regulation(id) ON DELETE CASCADE,
  tag_code TEXT,
  tag_name TEXT,
  term_id  TEXT,
  PRIMARY KEY (reg_id, tag_name)
);

-- Unit terkecil yang dapat dikutip: pasal / ayat / huruf / angka.
CREATE TABLE IF NOT EXISTS pasal (
  id      TEXT PRIMARY KEY,   -- '<reg_id>#pasal-4-ayat-2-huruf-a'
  reg_id  TEXT NOT NULL REFERENCES regulation(id) ON DELETE CASCADE,
  seq     INTEGER,
  bab     TEXT,
  bagian  TEXT,
  pasal   TEXT,               -- '4', '4A', '17'
  ayat    TEXT,
  huruf   TEXT,
  angka   TEXT,
  bagian_dok TEXT,            -- menimbang | mengingat | batang_tubuh | penutup | penjelasan
  path    TEXT,               -- 'BAB II > Pasal 4 > ayat (2) > huruf a'
  text    TEXT
);
CREATE INDEX IF NOT EXISTS ix_pasal_reg ON pasal(reg_id);

-- Lampiran (PDF/gambar) — satu-satunya tempat OCR benar-benar dibutuhkan.
CREATE TABLE IF NOT EXISTS attachment (
  id          TEXT PRIMARY KEY,
  reg_id      TEXT NOT NULL REFERENCES regulation(id) ON DELETE CASCADE,
  url         TEXT,
  local_path  TEXT,
  pages       INTEGER,
  text_ratio  REAL,           -- rasio halaman yang punya text layer
  route       TEXT,           -- textlayer | ocr_local | vlm | pending
  ocr_conf    REAL,
  text        TEXT,
  cost_usd    REAL DEFAULT 0
);

-- Sisi graf: relasi antar peraturan.
-- type: MENCABUT | MENCABUT_SEBAGIAN | MENGUBAH | DASAR_HUKUM | MELAKSANAKAN | MENGGANTI
CREATE TABLE IF NOT EXISTS relation (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  src_id     TEXT NOT NULL,
  dst_id     TEXT,            -- NULL bila belum ter-resolve ke dokumen
  dst_raw    TEXT,            -- teks nomor apa adanya dari kutipan
  type       TEXT NOT NULL,
  scope      TEXT,            -- 'Pasal 5 ayat (2)' untuk pencabutan sebagian
  evidence   TEXT,            -- kalimat sumber (bukti audit)
  evidence_pasal_id TEXT,
  method     TEXT,            -- rule | rule+llm | llm | manual
  confidence REAL,
  verified   INTEGER DEFAULT 0,
  conflict   TEXT,            -- catatan bila bertentangan dgn status situs / arah balik
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_rel_src ON relation(src_id);
CREATE INDEX IF NOT EXISTS ix_rel_dst ON relation(dst_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rel ON relation(src_id, dst_raw, type, IFNULL(scope,''));

-- Hasil komputasi masa berlaku (point-in-time).
CREATE TABLE IF NOT EXISTS validity (
  reg_id        TEXT PRIMARY KEY REFERENCES regulation(id) ON DELETE CASCADE,
  valid_from    TEXT,
  valid_to      TEXT,          -- NULL = masih berlaku
  status_derived TEXT,         -- berlaku | dicabut | diubah | dicabut_sebagian | tidak_diketahui
  superseded_by TEXT,
  agrees_with_site INTEGER,    -- 1 cocok, 0 bertentangan, NULL tidak dapat dibandingkan
  reason        TEXT
);

-- Dokumen dari sumber sekunder (peraturan.go.id, JDIH Kemenkeu, ...).
CREATE TABLE IF NOT EXISTS external_doc (
  reg_id    TEXT NOT NULL,
  source    TEXT NOT NULL,
  url       TEXT,
  slug      TEXT,
  judul     TEXT,
  jenis     TEXT,
  tanggal   TEXT,
  status    TEXT,
  ln_nomor  TEXT,
  tln_nomor TEXT,
  n_relasi  INTEGER DEFAULT 0,
  text_len  INTEGER DEFAULT 0,
  fetched_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (reg_id, source)
);

-- Gold set: relasi berlabel untuk mengukur akurasi ekstraksi.
-- tier: 'silver' = rujukan silang otomatis dari sumber resmi lain,
--       'gold'   = dilabeli manusia (satu-satunya yang boleh disebut kebenaran).
CREATE TABLE IF NOT EXISTS goldset (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tier       TEXT NOT NULL,
  src_id     TEXT NOT NULL,
  dst_id     TEXT,
  dst_raw    TEXT,
  type       TEXT NOT NULL,
  scope      TEXT,
  label      INTEGER,          -- 1 benar, 0 salah, NULL belum dilabeli
  sumber     TEXT,             -- asal label
  evidence   TEXT,
  catatan    TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_gold ON goldset(tier,src_id,IFNULL(dst_id,dst_raw),type);

-- Jejak biaya LLM/OCR agar anggaran terukur.
CREATE TABLE IF NOT EXISTS cost_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT DEFAULT (datetime('now')),
  stage TEXT, model TEXT, units INTEGER,
  in_tok INTEGER, out_tok INTEGER, cache_read_tok INTEGER, usd REAL
);

-- Indeks pencarian leksikal tingkat pasal.
CREATE VIRTUAL TABLE IF NOT EXISTS pasal_fts USING fts5(
  text, path, canonical, judul,
  content='', tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS pasal_fts_map (
  rowid INTEGER PRIMARY KEY, pasal_id TEXT UNIQUE
);
"""


def connect(path=None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path or DB_PATH), timeout=60)
    conn.row_factory = sqlite3.Row
    return conn


# Kolom hasil pemeriksaan silang identitas (ditambahkan setelah ditemukan
# entri katalog dengan jenis dokumen yang salah label).
MIGRATIONS = [
    ("regulation", "id_body", "TEXT"),          # identitas menurut kop surat
    ("regulation", "canonical_body", "TEXT"),
    ("regulation", "identity_ok", "INTEGER"),   # 1 cocok, 0 beda, NULL tak terperiksa
]


def migrate(conn) -> None:
    for table, col, typ in MIGRATIONS:
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if col not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")


def init(path=None) -> None:
    with connect(path) as conn:
        conn.executescript(SCHEMA)
        migrate(conn)


@contextmanager
def session(path=None):
    conn = connect(path)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def log_cost(conn, stage, model, units, in_tok=0, out_tok=0, cache_read_tok=0, usd=0.0):
    conn.execute(
        "INSERT INTO cost_log(stage,model,units,in_tok,out_tok,cache_read_tok,usd)"
        " VALUES (?,?,?,?,?,?,?)",
        (stage, model, units, in_tok, out_tok, cache_read_tok, usd),
    )
