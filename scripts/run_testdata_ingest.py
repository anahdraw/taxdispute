#!/usr/bin/env python3
"""Smoke-test PDF ingestion from a local TestData folder."""

from __future__ import annotations

import argparse
import sqlite3
import sys
import tempfile
import textwrap
from pathlib import Path
from typing import Iterable, List

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from tax_dispute_core import (  # noqa: E402
    DuplicateDocumentError,
    find_pdfs,
    get_stats,
    init_db,
    list_documents,
    upsert_document,
)


def pdf_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def write_text_pdf(path: Path, lines: Iterable[str]) -> None:
    """Write a tiny single-page PDF with extractable Helvetica text."""
    wrapped: List[str] = []
    for line in lines:
        wrapped.extend(textwrap.wrap(line, width=88) or [""])
    wrapped = wrapped[:48]

    objects: List[bytes] = []

    def add_object(body: str) -> int:
        objects.append(body.encode("latin-1", errors="replace"))
        return len(objects)

    catalog_id = add_object("<< /Type /Catalog /Pages 2 0 R >>")
    pages_id = add_object("PAGES_PLACEHOLDER")
    font_id = add_object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    commands = ["BT", "/F1 10 Tf", "50 780 Td", "14 TL"]
    for line in wrapped:
        commands.append(f"({pdf_escape(line)}) Tj")
        commands.append("T*")
    commands.append("ET")
    stream = "\n".join(commands)
    stream_id = add_object(f"<< /Length {len(stream.encode('latin-1', errors='replace'))} >>\nstream\n{stream}\nendstream")
    page_id = add_object(
        f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 612 842] "
        f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {stream_id} 0 R >>"
    )
    objects[pages_id - 1] = f"<< /Type /Pages /Kids [{page_id} 0 R] /Count 1 >>".encode("latin-1")

    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for idx, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{idx} 0 obj\n".encode("ascii"))
        output.extend(body)
        output.extend(b"\nendobj\n")
    xref_start = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\nstartxref\n{xref_start}\n%%EOF\n".encode("ascii")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(output))


def sample_decision_lines(index: int, duplicate_number: str = "") -> List[str]:
    number = duplicate_number or f"PUT-90000{index}.16.2023.PP.M.XIIIA Tahun 2026"
    company = "PT TESTDATA PPN SATU" if index == 1 else "PT TESTDATA PPN DUA"
    amount = "Rp. 500.000.000,00" if index == 1 else "Rp. 750.000.000,00"
    return [
        f"PUTUSAN PENGADILAN PAJAK Nomor {number}",
        f"Pemohon Banding: {company}",
        "NPWP: 01.234.567.8-901.000",
        "Alamat: Jalan TestData Nomor 1 Jakarta",
        "Kuasa Hukum: Konsultan Pajak Test Data",
        "Terbanding: Direktur Jenderal Pajak",
        "Kantor Pelayanan Pajak Madya TestData",
        "Pokok Sengketa: koreksi Pajak Pertambahan Nilai PPN atas DPP PPN dan pajak masukan.",
        f"Nilai sengketa menurut Terbanding adalah {amount}.",
        "Menurut Pemohon Banding, koreksi DPP PPN tidak tepat karena penyerahan telah dilaporkan dalam SPT Masa PPN.",
        "Pemohon Banding mengajukan faktur pajak, SPT Masa PPN, bukti pembayaran, invoice, dan rekonsiliasi penjualan.",
        "Menurut Terbanding, koreksi tetap dipertahankan karena bukti pendukung belum cukup dan terdapat selisih rekonsiliasi.",
        "Dasar hukum yang dikutip adalah Undang-Undang PPN dan ketentuan Pajak Pertambahan Nilai.",
        "Pendapat Majelis: Majelis menilai sebagian bukti pembayaran dan SPT Masa PPN dapat meyakinkan Majelis.",
        "Mengadili: mengabulkan sebagian permohonan banding Pemohon Banding.",
        "Teks tambahan PPN pajak pertambahan nilai DPP PPN pajak masukan faktur pajak bukti pembayaran rekonsiliasi.",
        "Teks tambahan PPN pajak pertambahan nilai DPP PPN pajak masukan faktur pajak bukti pembayaran rekonsiliasi.",
        "Teks tambahan PPN pajak pertambahan nilai DPP PPN pajak masukan faktur pajak bukti pembayaran rekonsiliasi.",
    ]


def generate_sample_pdfs(testdata_dir: Path, include_duplicate: bool = False) -> List[Path]:
    first = testdata_dir / "PUT-900001.16.2023.PP.M.XIIIA-Tahun-2026.pdf"
    second = testdata_dir / "PUT-900002.16.2023.PP.M.XIIIA-Tahun-2026.pdf"
    write_text_pdf(first, sample_decision_lines(1))
    write_text_pdf(second, sample_decision_lines(2))
    paths = [first, second]
    if include_duplicate:
        duplicate = testdata_dir / "DUPLICATE-PUT-900001.16.2023.PP.M.XIIIA-Tahun-2026.pdf"
        write_text_pdf(duplicate, sample_decision_lines(3, duplicate_number="PUT-900001.16.2023.PP.M.XIIIA Tahun 2026"))
        paths.append(duplicate)
    return paths


def run_ingest(
    testdata_dir: Path,
    db_path: Path,
    max_files: int | None = None,
    overwrite: bool = False,
    require_completed: bool = False,
) -> int:
    init_db(db_path)
    pdfs = find_pdfs(testdata_dir)
    if max_files:
        pdfs = pdfs[:max_files]
    if not pdfs:
        print(f"FAIL: tidak ada PDF di folder {testdata_dir}")
        return 1

    records = []
    duplicates = []
    errors = []
    for pdf in pdfs:
        try:
            records.append(upsert_document(pdf, overwrite=overwrite, db_path=db_path, use_llm_extraction=False))
        except DuplicateDocumentError as exc:
            duplicates.append({"file": pdf.name, "error": str(exc), "duplicates": exc.duplicates})
        except Exception as exc:  # pragma: no cover - surfaced by script output
            errors.append({"file": pdf.name, "error": str(exc)})

    stats = get_stats(db_path)
    documents = list_documents(limit=1000, db_path=db_path)
    completed = [doc for doc in documents if doc.extraction_status == "completed"]
    failed_extractions = [doc for doc in documents if doc.extraction_status != "completed"]

    print("TestData ingest summary")
    print(f"- folder: {testdata_dir}")
    print(f"- db: {db_path}")
    print(f"- pdf ditemukan: {len(pdfs)}")
    print(f"- berhasil diproses: {len(records)}")
    print(f"- ekstraksi completed: {len(completed)}")
    print(f"- ekstraksi failed/pending: {len(failed_extractions)}")
    print(f"- ditolak duplikat: {len(duplicates)}")
    print(f"- error lain: {len(errors)}")
    print(f"- documents table: {stats.get('documents', 0)}")
    print(f"- document_extractions table: {stats.get('extractions', 0)}")
    print(f"- chunks table: {stats.get('chunks', 0)}")

    for doc in documents:
        status = "OK" if doc.extraction_status == "completed" else "FAILED"
        print(f"  {status} {doc.filename} | {doc.putusan_number} | {doc.tax_type} | {doc.issue_type} | {doc.extraction_status}")
    for item in duplicates:
        print(f"  DUPLICATE {item['file']} | {item['error']}")
    for item in errors:
        print(f"  ERROR {item['file']} | {item['error']}")

    if errors or duplicates:
        return 2
    if len(records) != len(pdfs):
        return 3
    if stats.get("documents", 0) != len(pdfs) or stats.get("extractions", 0) != len(pdfs):
        return 4
    if require_completed and failed_extractions:
        return 5
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Test PDF ingestion from the TestData folder.")
    parser.add_argument("--testdata", default="TestData", help="Folder containing PDF files. Default: TestData")
    parser.add_argument("--db", default="", help="Optional SQLite DB path. Default: temporary DB.")
    parser.add_argument("--max-files", type=int, default=0, help="Optional maximum number of PDFs to ingest.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite matching file_path records in the test DB.")
    parser.add_argument("--require-completed", action="store_true", help="Return non-zero if any ingested PDF has extraction_status other than completed.")
    parser.add_argument("--generate-samples", action="store_true", help="Create two safe synthetic PDF fixtures in TestData before running.")
    parser.add_argument("--generate-duplicate", action="store_true", help="Also create a duplicate-number PDF fixture for manual duplicate testing.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    testdata_dir = (ROOT_DIR / args.testdata).resolve() if not Path(args.testdata).is_absolute() else Path(args.testdata)
    testdata_dir.mkdir(parents=True, exist_ok=True)

    if args.generate_samples:
        generated = generate_sample_pdfs(testdata_dir, include_duplicate=args.generate_duplicate)
        print(f"Generated {len(generated)} sample PDF(s) in {testdata_dir}")

    if args.db:
        db_path = Path(args.db).resolve()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        return run_ingest(
            testdata_dir,
            db_path,
            max_files=args.max_files or None,
            overwrite=args.overwrite,
            require_completed=args.require_completed,
        )

    with tempfile.TemporaryDirectory(prefix="taxdispute-testdata-") as tmpdir:
        db_path = Path(tmpdir) / "testdata_ingest.sqlite"
        return run_ingest(
            testdata_dir,
            db_path,
            max_files=args.max_files or None,
            overwrite=args.overwrite,
            require_completed=args.require_completed,
        )


if __name__ == "__main__":
    raise SystemExit(main())
