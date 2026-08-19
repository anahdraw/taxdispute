#!/usr/bin/env python3
"""Small, dependency-free benchmark for scripts/regulation_quality.py."""
from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from regulation_quality import build_snapshot, canonical_key, extract_references, write_artifacts


SCHEMA = """
CREATE TABLE regulation (
 id TEXT PRIMARY KEY, canonical TEXT, nomor_raw TEXT, jenis TEXT, jenis_code TEXT,
 tahun INTEGER, tanggal TEXT, judul TEXT, url TEXT, status_site TEXT,
 has_body INTEGER, body_text TEXT, source TEXT, sha256 TEXT, id_body TEXT,
 canonical_body TEXT, identity_ok INTEGER
);
CREATE TABLE relation (
 id INTEGER PRIMARY KEY, src_id TEXT, dst_id TEXT, dst_raw TEXT, type TEXT,
 scope TEXT, evidence TEXT, evidence_pasal_id TEXT, method TEXT,
 confidence REAL, verified INTEGER, conflict TEXT
);
CREATE TABLE validity (
 reg_id TEXT PRIMARY KEY, valid_from TEXT, valid_to TEXT, status_derived TEXT,
 superseded_by TEXT, agrees_with_site INTEGER, reason TEXT
);
CREATE TABLE pasal (
 id TEXT PRIMARY KEY, reg_id TEXT, seq INTEGER, path TEXT, bagian_dok TEXT, text TEXT
);
"""


class RegulationQualityTest(unittest.TestCase):
    def make_db(self) -> Path:
        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        handle.close()
        path = Path(handle.name)
        conn = sqlite3.connect(path)
        conn.executescript(SCHEMA)
        regs = [
            ("uu-8-1983", "UU 8 TAHUN 1983", "UU 8 TAHUN 1983", "Undang-Undang", "UU", 1983, "1983-12-31", "PPN", "https://peraturan.go.id/uu8", "Aktif", 1, "", "djp", "hash-a", None, "UU 8 TAHUN 1983", 1),
            ("pp-50-2022", "PP 50 TAHUN 2022", "PP 50 TAHUN 2022", "Peraturan Pemerintah", "PP", 2022, "2022-12-12", "KUP", "https://peraturan.go.id/pp50", "Aktif", 1, "", "djp", "hash-b", None, "PP 50 TAHUN 2022", 1),
            ("pp-20-2026", "PP 20 TAHUN 2026", "PP 20 TAHUN 2026", "Instruksi Dirjen Pajak", "INS", 2026, "2026-04-22", "Perubahan PP", "https://peraturan.go.id/pp20", "Aktif", 1, "", "djp", "hash-c", "pp-20-2026", "PP 20 TAHUN 2026", 0),
            ("bad-alias", "20 TAHUN 2026", "20 TAHUN 2026", "Peraturan Presiden", "PERPRES", 2026, "2026-04-22", "Perubahan PP", "https://peraturan.go.id/pp20", "Aktif", 1, "", "djp", "hash-c", "pp-20-2026", "PP 20 TAHUN 2026", 0),
        ]
        conn.executemany("INSERT INTO regulation VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", regs)
        relations = [
            (1, "pp-50-2022", "uu-8-1983", "Undang-Undang Nomor 8 Tahun 1983", "MENCABUT", None, "UU dicabut", None, "rule", .99, 1, None),
            (2, "pp-50-2022", None, "Undang-Undang Nomor 999 Tahun 2020", "MENGUBAH", None, "mengubah UU", None, "rule", .99, 1, None),
            (3, "pp-20-2026", "pp-50-2022", "PP Nomor 50 Tahun 2022", "MENGUBAH", None, "diubah", None, "rule", .85, 1, None),
            (4, "pp-20-2026", "pp-50-2022", "PP Nomor 50 Tahun 2022", "DASAR_HUKUM", None, "dasar hukum", None, "rule", .99, 1, None),
        ]
        conn.executemany("INSERT INTO relation VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", relations)
        conn.execute("INSERT INTO validity VALUES (?,?,?,?,?,?,?)", ("uu-8-1983", "1984-07-01", None, "berlaku", None, 1, "ok"))
        conn.execute("INSERT INTO validity VALUES (?,?,?,?,?,?,?)", ("pp-50-2022", "2022-12-12", None, "berlaku", None, 1, "ok"))
        conn.execute("INSERT INTO pasal VALUES (?,?,?,?,?,?)", ("uu-8-1983#pasal-1", "uu-8-1983", 1, "Pasal 1", "batang_tubuh", "Berdasarkan Peraturan Pemerintah Nomor 50 Tahun 2022."))
        conn.execute("INSERT INTO pasal VALUES (?,?,?,?,?,?)", ("pp-50-2022#pasal-1", "pp-50-2022", 1, "Pasal 1", "mengingat", "Undang-Undang Nomor 8 Tahun 1983."))
        conn.commit()
        conn.close()
        return path

    def test_canonical_and_citation_extraction(self):
        self.assertEqual(canonical_key("Undang-Undang Nomor 8 Tahun 1983"), "uu-8-1983")
        self.assertEqual(canonical_key("UU No. 8 Tahun 1983"), "uu-8-1983")
        self.assertEqual(canonical_key("PER-31/PJ/2009"), "per-31-pj-2009")
        refs = extract_references("Undang-Undang Nomor 8 Tahun 1983 dan 212/PMK.07/2009")
        self.assertEqual([item["canonicalKey"] for item in refs], ["uu-8-1983", "pmk-212-pmk-07-2009"])
        self.assertEqual(extract_references("PP No. 50 Tahun 2022")[0]["canonicalKey"], "pp-50-2022")
        # A bare number is deliberately not a citation.
        self.assertEqual(extract_references("lihat Nomor 8 tanpa tahun"), [])

    def test_graph_quarantines_false_facts(self):
        path = self.make_db()
        try:
            snapshot = build_snapshot(path)
            summary = snapshot["summary"]
            self.assertEqual(summary["sourceRegulationRows"], 4)
            self.assertEqual(summary["duplicateSourceRows"], 1)
            self.assertGreater(summary["orphans"], 0)
            self.assertGreater(summary["conflicts"]["edges"], 0)
            by_type = {(edge["type"], edge["targetRaw"]): edge for edge in snapshot["edges"]}
            self.assertFalse(by_type[("MENCABUT", "Undang-Undang Nomor 8 Tahun 1983")]["eligibleForAnswer"])
            self.assertFalse(by_type[("MENGUBAH", "PP Nomor 50 Tahun 2022")]["eligibleForAnswer"])
            self.assertTrue(by_type[("DASAR_HUKUM", "PP Nomor 50 Tahun 2022")]["eligibleForAnswer"])
            self.assertEqual(summary["qualityGate"], "review_required")
        finally:
            path.unlink(missing_ok=True)

    def test_snapshot_and_artifacts_are_idempotent(self):
        path = self.make_db()
        output_a = Path(tempfile.mkdtemp())
        output_b = Path(tempfile.mkdtemp())
        try:
            first = build_snapshot(path)
            second = build_snapshot(path)
            self.assertEqual(first, second)
            write_artifacts(first, output_a)
            write_artifacts(second, output_b)
            for name in ("regulation-graph.json", "regulation-quality-report.json", "regulation-citations.jsonl", "regulation-review-queue.csv"):
                self.assertEqual((output_a / name).read_bytes(), (output_b / name).read_bytes())
            json.loads((output_a / "regulation-graph.json").read_text(encoding="utf-8"))
        finally:
            path.unlink(missing_ok=True)
            for output in (output_a, output_b):
                for child in output.iterdir():
                    child.unlink()
                output.rmdir()


if __name__ == "__main__":
    unittest.main()
