from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.run_testdata_ingest import generate_sample_pdfs, sample_decision_lines, write_text_pdf
from tax_dispute_core import DuplicateDocumentError, find_pdfs, get_stats, ingest_directory, list_documents, upsert_document


class TestDataIngestTests(unittest.TestCase):
    def test_find_pdfs_reads_only_pdf_files_from_testdata(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            testdata = Path(tmpdir) / "TestData"
            generate_sample_pdfs(testdata)
            (testdata / "notes.txt").write_text("not a pdf", encoding="utf-8")

            found = find_pdfs(testdata)

            self.assertEqual(2, len(found))
            self.assertTrue(all(path.suffix.lower() == ".pdf" for path in found))
            self.assertEqual(sorted(path.name.lower() for path in found), [path.name.lower() for path in found])

    def test_ingest_directory_from_testdata_saves_documents_extractions_and_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            testdata = Path(tmpdir) / "TestData"
            db_path = Path(tmpdir) / "test.sqlite"
            generate_sample_pdfs(testdata)

            records = ingest_directory(testdata, db_path=db_path)
            stats = get_stats(db_path)
            documents = list_documents(limit=10, db_path=db_path)

            self.assertEqual(2, len(records))
            self.assertEqual(2, stats["documents"])
            self.assertEqual(2, stats["extractions"])
            self.assertGreater(stats["chunks"], 0)
            self.assertEqual(2, len(documents))
            for doc in documents:
                self.assertEqual("completed", doc.extraction_status)
                self.assertIn("PUT-90000", doc.putusan_number)
                self.assertEqual("PPN", doc.tax_type)
                self.assertNotEqual("UNKNOWN", doc.issue_type)
                self.assertEqual("WP_PARTIAL_WIN", doc.outcome)

    def test_duplicate_putusan_number_in_testdata_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            testdata = Path(tmpdir) / "TestData"
            db_path = Path(tmpdir) / "test.sqlite"
            generate_sample_pdfs(testdata)
            duplicate_pdf = testdata / "duplicate-same-putusan.pdf"
            write_text_pdf(duplicate_pdf, sample_decision_lines(9, duplicate_number="PUT-900001.16.2023.PP.M.XIIIA Tahun 2026"))

            upsert_document(testdata / "PUT-900001.16.2023.PP.M.XIIIA-Tahun-2026.pdf", db_path=db_path)

            with self.assertRaises(DuplicateDocumentError) as context:
                upsert_document(duplicate_pdf, db_path=db_path)

            self.assertTrue(context.exception.duplicates)
            self.assertIn("nomor putusan sama", context.exception.duplicates[0]["match_reason"])


if __name__ == "__main__":
    unittest.main()
