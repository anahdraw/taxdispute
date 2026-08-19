from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.import_peraturan_pipeline import import_corpus


def make_source(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE regulation (
          id TEXT PRIMARY KEY, canonical TEXT, nomor_raw TEXT, jenis TEXT,
          jenis_code TEXT, kategori TEXT, tahun INTEGER, tanggal TEXT,
          judul TEXT, url TEXT, status_site TEXT, has_body INTEGER,
          body_text TEXT, source TEXT, sha256 TEXT, fetched_at TEXT,
          id_body TEXT, canonical_body TEXT, identity_ok INTEGER
        );
        CREATE TABLE validity (
          reg_id TEXT PRIMARY KEY, valid_from TEXT, valid_to TEXT,
          status_derived TEXT, superseded_by TEXT, agrees_with_site INTEGER,
          reason TEXT
        );
        CREATE TABLE pasal (
          id TEXT PRIMARY KEY, reg_id TEXT, seq INTEGER, bab TEXT,
          bagian TEXT, pasal TEXT, ayat TEXT, huruf TEXT, angka TEXT,
          bagian_dok TEXT, path TEXT, text TEXT
        );
        CREATE TABLE relation (
          id INTEGER PRIMARY KEY, src_id TEXT, dst_id TEXT, dst_raw TEXT,
          type TEXT, scope TEXT, evidence TEXT, evidence_pasal_id TEXT,
          method TEXT, confidence REAL, verified INTEGER, conflict TEXT,
          created_at TEXT
        );
        CREATE TABLE reg_tag (reg_id TEXT, tag_code TEXT, tag_name TEXT, term_id TEXT);
        CREATE TABLE attachment (
          id INTEGER PRIMARY KEY, reg_id TEXT, url TEXT, local_path TEXT,
          pages INTEGER, text_ratio REAL, route TEXT, ocr_conf REAL,
          text TEXT, cost_usd REAL
        );
        """
    )
    body = "Pasal 1\n(1) Pajak masukan dapat dikreditkan.\nSumber: ortax.org"
    source_hash = hashlib.sha256(body.encode()).hexdigest()
    conn.execute(
        "INSERT INTO regulation VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("uu-test", "UU 99 TAHUN 2099", "99 TAHUN 2099", "Undang-Undang", "UU", "PPN", 2099, "2099-01-01", "ATURAN PPN TEST", "https://www.pajak.go.id/id/peraturan/test", "Aktif", 1, body, "djp", source_hash, "2099-01-01T00:00:00Z", "UU 99 TAHUN 2099", "UU 99 TAHUN 2099", 1),
    )
    # A secondary URL is retained as a local opaque reference, never as a
    # public citation URL.
    external = "Pajak masukan dari coretax, Coretaxpedia, dan https://coretaxdjp.pajak.go.id."
    conn.execute(
        "INSERT INTO regulation VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("pmk-secondary", "PMK 1 TAHUN 2099", "1/PMK/2099", "Peraturan Menteri Keuangan", "PMK", "PPN", 2099, "2099-02-01", "ATURAN SEKUNDER", "https://secondary.example/rule", "Aktif", 1, external, "ortax", hashlib.sha256(external.encode()).hexdigest(), "2099-02-01T00:00:00Z", "", "", None),
    )
    conn.execute(
        "INSERT INTO regulation VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("invalid", "", "", "", "", "", 2099, "", "", "", "", 0, "", "djp", "", "", "", "", None),
    )
    conn.execute("INSERT INTO validity VALUES (?,?,?,?,?,?,?)", ("uu-test", "2099-01-01", None, "berlaku", None, 1, "tested"))
    conn.execute("INSERT INTO validity VALUES (?,?,?,?,?,?,?)", ("pmk-secondary", "2099-02-01", None, "berlaku", None, 1, "tested"))
    conn.execute("INSERT INTO pasal VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", ("pasal-1", "uu-test", 1, "I", "", "1", "1", "", "", "batang_tubuh", "Pasal 1 > ayat (1)", "Pajak masukan dapat dikreditkan."))
    conn.execute("INSERT INTO relation VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (1, "uu-test", "pmk-secondary", "PMK 1 TAHUN 2099", "MENGUBAH", "", "Bukti resmi", "pasal-1", "external", 0.97, 1, "", "2099-01-01"))
    conn.execute("INSERT INTO attachment VALUES (?,?,?,?,?,?,?,?,?,?)", (1, "uu-test", "https://www.pajak.go.id/sites/default/files/lampiran/uu-99-2099.pdf", "/tmp/uu-99-2099.pdf", 12, 0.98, "detail", 0.99, "", 0.0))
    conn.commit()
    conn.close()


class ImporterTests(unittest.TestCase):
    def test_normalization_quarantine_snapshot_and_rerun(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "pipeline.db"
            output = root / "out"
            target = root / "target.db"
            make_source(source)
            first = import_corpus(source, output, target)
            second = import_corpus(source, output, target)

            self.assertEqual(first["manifest_sha256"], second["manifest_sha256"])
            self.assertEqual(first["counts"]["normalized_regulations"], 2)
            self.assertEqual(first["counts"]["quarantined"], 1)
            self.assertGreater(first["counts"]["next_snapshot_regulations"], 0)

            regulations = [json.loads(line) for line in (output / "regulations.jsonl").read_text().splitlines()]
            secondary = next(item for item in regulations if item["source_id"] == "pmk-secondary")
            self.assertTrue(secondary["url"].startswith("aa-jurist-local://"))
            self.assertNotIn("ortax", secondary["content"].lower())
            self.assertNotIn("coretax", secondary["content"].lower())

            with gzip.open(output / "next-regulations.jsonl.gz", "rt", encoding="utf-8") as handle:
                snapshot = [json.loads(line) for line in handle if line.strip()]
            official = next(item for item in snapshot if item["id"] == "pipeline:uu-test")
            self.assertEqual(official["sourceUrl"], "https://www.pajak.go.id/id/peraturan/test")
            self.assertEqual(official["officialPdfUrl"], "https://www.pajak.go.id/sites/default/files/lampiran/uu-99-2099.pdf")
            self.assertEqual(official["pdfUrls"], ["https://www.pajak.go.id/sites/default/files/lampiran/uu-99-2099.pdf"])
            self.assertEqual(official["extraction"]["keyProvisions"][0]["article"], "Pasal 1 > ayat (1)")
            self.assertEqual(len(official["extraction"]["relations"]), 1)
            self.assertEqual(official["extraction"]["relations"][0]["type"], "amends")

            conn = sqlite3.connect(target)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM tax_regulations WHERE source='peraturan-pipeline'").fetchone()[0], 2)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM tax_regulation_chunks WHERE regulation_id LIKE 'pipeline:%'").fetchone()[0], 2)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM tax_regulation_links WHERE regulation_id LIKE 'pipeline:%'").fetchone()[0], 1)
            conn.close()


if __name__ == "__main__":
    unittest.main()
