#!/usr/bin/env python3
"""Build an auditable ground-truth and graph projection from Buku Praktis Pajak.

The book is treated as a teaching/reference source, not as a replacement for
the current official regulation corpus.  Every generated pair retains the
verbatim minimum excerpt and PDF page(s); the additional explanation is
explicitly labelled so an evaluator can check that the answer did not drop a
book requirement.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

from pypdf import PdfReader


DEFAULT_PDF = Path("/Users/sintzu/Downloads/Buku-Saku-Pajak-Cover-revisi-2.pdf")
DEFAULT_OUTPUT = Path("data/reference-knowledge")
PDF_ROUTE = "/api/reference-pdfs/buku-praktis-pajak-2025"
BOOK_ID = "buku-praktis-pajak-2025"


def clean(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.replace("\r", "\n").replace("\u00a0", " ")
    text = re.sub(r"(?im)^\s*Buku Praktis Pajak\s*\d*\s*$", "", text)
    text = re.sub(r"(?im)^\s*\d+\s*Buku Praktis Pajak\s*$", "", text)
    text = re.sub(r"(?im)^\s*Pajak Kita\s*$", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def remove_cross_topic_noise(text: str, topic_key: str) -> str:
    """Remove page-layout spillover where the PDF puts two page columns together."""

    if topic_key == "pph21":
        text = re.sub(r"\n\s*Pemotongan PPh Pasal 22 dilakukan.*?(?=\n\s*Pelaporan\b|\Z)", "", text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"\n\s*Pelaporan\s+dilakukan melalui SPT Masa ke Kantor Pelayanan Pajak\.?", "", text, flags=re.IGNORECASE)
    if topic_key == "pph22":
        text = re.sub(r"\n\s*Pemotongan PPh Pasal 23 dilakukan.*?(?=\n\s*Pelaporan\b|\Z)", "", text, flags=re.IGNORECASE | re.DOTALL)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def slug(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return value[:90] or "item"


def canonical_citation_id(value: str) -> str:
    match = re.search(r"\b(uu|pp|pmk|per|kep|se)\s*(?:no\.?|nomor)?\s*(\d+)[^0-9]{0,18}(19\d{2}|20\d{2})\b", value, flags=re.IGNORECASE)
    return f"law:{match.group(1).lower()}-{int(match.group(2))}-{match.group(3)}" if match else f"rule-reference:{slug(value)}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


TOPICS: list[dict[str, Any]] = [
    {
        "key": "pph21",
        "label": "PPh Pasal 21",
        "aliases": ["PPH 21", "PPh Pasal 21", "PPh 21"],
        "page_range": list(range(23, 26)),
        "extra": "Gunakan status penerima, jenis pembayaran, periode pajak, TER, PTKP, dan tarif Pasal 17 sebagai pemeriksaan awal. Nilai akhir tetap perlu dicocokkan dengan aturan yang berlaku untuk masa pajak tersebut.",
        "questions": [
            "Apa itu PPh Pasal 21?", "Siapa subjek PPh Pasal 21?", "Apa saja objek PPh Pasal 21?",
            "Bagaimana cara menghitung PPh Pasal 21 bulanan pegawai tetap?", "Bagaimana menghitung PPh Pasal 21 pegawai tidak tetap?",
            "Bagaimana menghitung PPh Pasal 21 bukan pegawai atau peserta kegiatan?", "Apa itu PTKP dan berapa komponennya?",
            "Berapa tarif progresif PPh Pasal 17 yang disebut dalam buku?", "Apa akibat tidak memiliki NPWP untuk PPh Pasal 21?",
        ],
    },
    {
        "key": "pph22",
        "label": "PPh Pasal 22",
        "aliases": ["PPH 22", "PPh Pasal 22", "PPh 22"],
        "page_range": list(range(26, 29)),
        "extra": "Pastikan dulu jenis pemungut, transaksi pembelian/impor, nilai dasar pengenaan, API/NPWP, dan apakah tarif khusus sektoral berlaku sebelum menghitung.",
        "questions": [
            "Apa itu PPh Pasal 22?", "Siapa pemungut PPh Pasal 22?", "Siapa wajib pajak yang dipungut PPh Pasal 22?",
            "Apa saja objek PPh Pasal 22?", "Berapa batas pembayaran dan pelaporan PPh Pasal 22?",
            "Berapa tarif PPh Pasal 22 atas impor?", "Berapa tarif PPh Pasal 22 atas pembelian oleh bendahara pemerintah atau BUMN/BUMD?",
            "Apa akibat tidak memiliki NPWP untuk PPh Pasal 22?",
        ],
    },
    {
        "key": "pph23",
        "label": "PPh Pasal 23",
        "aliases": ["PPH 23", "PPh Pasal 23", "PPh 23"],
        "page_range": list(range(29, 32)),
        "extra": "Klasifikasikan jenis penghasilan terlebih dahulu: dividen/bunga/royalti, sewa selain tanah/bangunan, jasa, atau hadiah. Pastikan pengecualian dan status NPWP sebelum memakai tarif.",
        "questions": [
            "Apa itu PPh Pasal 23?", "Siapa pemotong dan penerima penghasilan PPh Pasal 23?", "Apa saja objek PPh Pasal 23?",
            "Berapa tarif PPh Pasal 23 untuk dividen, bunga, dan royalti?", "Berapa tarif PPh Pasal 23 untuk sewa dan jasa?",
            "Kapan PPh Pasal 23 dipotong?", "Apa bukti yang wajib diberikan pemotong PPh Pasal 23?",
            "Kapan pelaporan PPh Pasal 23 dilakukan?", "Apa akibat tidak memiliki NPWP untuk PPh Pasal 23?",
        ],
    },
    {
        "key": "pph25",
        "label": "PPh Pasal 25",
        "aliases": ["PPH 25", "PPh Pasal 25", "PPh 25"],
        "page_range": list(range(32, 35)),
        "extra": "PPh Pasal 25 adalah angsuran, bukan tarif baru. Gunakan PPh terutang dan kredit pajak SPT Tahunan tahun sebelumnya, lalu cocokkan status wajib pajak baru atau yang sudah beroperasi.",
        "questions": [
            "Apa itu PPh Pasal 25?", "Siapa subjek PPh Pasal 25?", "Bagaimana dasar penghitungan PPh Pasal 25 untuk wajib pajak baru?",
            "Bagaimana rumus angsuran PPh Pasal 25?", "Kapan pembayaran PPh Pasal 25 dilakukan?",
            "Apakah pembayaran PPh Pasal 25 perlu dilaporkan secara khusus?", "Kapan angsuran PPh Pasal 25 dapat disesuaikan?",
            "Apa sanksi keterlambatan PPh Pasal 25?",
        ],
    },
    {
        "key": "pph42",
        "label": "PPh Final Pasal 4 ayat (2)",
        "aliases": ["PPH Final", "PPh Pasal 4 Ayat (2)", "PPh Final Pasal 4 ayat 2"],
        "page_range": list(range(35, 38)),
        "extra": "Karena bersifat final, pajak ini tidak dikreditkan dengan PPh lain dalam SPT Tahunan. Identifikasi objek dan tarif khususnya sebelum menghitung.",
        "questions": [
            "Apa itu PPh Final Pasal 4 ayat (2)?", "Apa saja objek PPh Final Pasal 4 ayat (2)?",
            "Berapa tarif PPh Final atas sewa tanah atau bangunan?", "Berapa tarif PPh Final atas hadiah undian dan saham bursa?",
            "Berapa tarif PPh Final atas pengalihan tanah atau bangunan?", "Bagaimana tarif PPh Final usaha jasa konstruksi?",
            "Kapan PPh Final Pasal 4 ayat (2) dipotong dan dibayar?", "Bagaimana pelaporan PPh Final Pasal 4 ayat (2)?",
        ],
    },
    {
        "key": "pph_umkm",
        "label": "PPh Final UMKM",
        "aliases": ["PPH Final UMKM", "UMKM", "PP 55 Tahun 2022"],
        "page_range": list(range(38, 41)),
        "extra": "Periksa omzet bruto setahun, bentuk usaha, masa penggunaan tarif, dan apakah kegiatan termasuk pekerjaan bebas. Setelah masa fasilitas berakhir, tarif normal dapat berlaku.",
        "questions": [
            "Apa itu PPh Final UMKM?", "Siapa yang dapat menggunakan PPh Final UMKM?", "Berapa batas omzet PPh Final UMKM?",
            "Berapa tarif PPh Final UMKM?", "Berapa lama masa penggunaan tarif PPh Final UMKM untuk orang pribadi?",
            "Berapa lama masa penggunaan tarif PPh Final UMKM untuk koperasi, CV, firma, dan PT?",
            "Kapan PPh Final UMKM dibayar dan apakah perlu dilaporkan khusus?", "Apa sanksi keterlambatan PPh Final UMKM?",
        ],
    },
    {
        "key": "ppn",
        "label": "PPN",
        "aliases": ["PPN", "Pajak Pertambahan Nilai", "Pajak Masukan"],
        "page_range": list(range(40, 48)),
        "extra": "Untuk perhitungan, bedakan harga jual, DPP, tarif, PPN Keluaran, PPN Masukan, fasilitas, dan masa pajak. Angka buku menjadi minimum penjelasan, bukan pengganti verifikasi peraturan terkini.",
        "questions": [
            "Apa itu PPN?", "Siapa subjek PPN?", "Apa saja objek PPN?", "Bagaimana mekanisme pemungutan dan pengkreditan PPN?",
            "Apa perbedaan PPN Keluaran dan PPN Masukan?", "Berapa tarif PPN yang dijelaskan dalam buku?",
            "Bagaimana rumus menghitung PPN non-mewah dengan mekanisme 12% dikali 11/12?",
            "Bagaimana menghitung PPN dalam satu masa pajak?", "Kapan pembayaran dan pelaporan SPT Masa PPN dilakukan?",
            "Apa sanksi keterlambatan PPN?",
        ],
    },
    {
        "key": "spt",
        "label": "SPT dan kewajiban wajib pajak",
        "aliases": ["SPT", "Surat Pemberitahuan", "Kewajiban Wajib Pajak"],
        "page_range": list(range(48, 57)),
        "extra": "Gunakan jawaban ini sebagai checklist administratif. Tenggat dan sanksi harus diverifikasi lagi terhadap masa pajak serta aturan terbaru yang ditampilkan di katalog resmi.",
        "questions": [
            "Apa itu SPT Tahunan PPh?", "Apa perbedaan SPT Tahunan dan SPT Masa?", "Kapan batas pelaporan SPT Tahunan PPh orang pribadi?",
            "Kapan batas pelaporan SPT Tahunan PPh badan?", "Kapan batas pelaporan SPT Masa PPh?", "Kapan batas pelaporan SPT Masa PPN?",
            "Apa kewajiban umum wajib pajak?", "Apa hak wajib pajak yang perlu diketahui?",
        ],
    },
    {
        "key": "administrasi",
        "label": "Administrasi perpajakan dan sistem DJP",
        "aliases": ["CoreTax", "NPWP", "NIK", "Administrasi Pajak"],
        "page_range": list(range(54, 71)) + list(range(72, 96)),
        "extra": "Istilah sistem pada buku diperlakukan sebagai konteks administratif. Untuk tindakan nyata, gunakan kanal resmi DJP dan jangan menyalin kredensial atau data rahasia ke chatbot.",
        "questions": [
            "Apa fungsi NPWP dan NIK dalam administrasi pajak?", "Apa itu bukti potong?", "Apa itu kode billing?",
            "Bagaimana gambaran umum administrasi pajak digital menurut buku?", "Apa yang perlu disiapkan sebelum melaporkan pajak secara elektronik?",
            "Bagaimana wajib pajak menjaga bukti dan dokumen perpajakan?",
        ],
    },
]


def page_matches(pages: list[str], aliases: list[str]) -> list[int]:
    pattern = re.compile("|".join(re.escape(alias) for alias in aliases), re.IGNORECASE)
    return [index + 1 for index, page in enumerate(pages) if pattern.search(page)]


def excerpt_for(pages: list[str], page_numbers: list[int], topic_key: str = "", max_chars: int = 2600) -> tuple[str, list[int]]:
    selected = page_numbers[:4] or list(range(1, min(4, len(pages)) + 1))
    parts: list[str] = []
    used: list[int] = []
    for number in selected:
        text = remove_cross_topic_noise(clean(pages[number - 1]), topic_key)
        if not text:
            continue
        parts.append(text)
        used.append(number)
        if len("\n\n".join(parts)) >= max_chars:
            break
    value = "\n\n".join(parts)
    if len(value) > max_chars:
        value = value[: max_chars - 1].rsplit(" ", 1)[0] + "…"
    return value, used


def build_pairs(pages: list[str]) -> list[dict[str, Any]]:
    pairs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for topic in TOPICS:
        matches = [number for number in topic.get("page_range", []) if 1 <= number <= len(pages)] or page_matches(pages, topic["aliases"])
        for question in topic["questions"]:
            excerpt, used_pages = excerpt_for(pages, matches, topic["key"])
            if not excerpt:
                continue
            key = question.lower()
            if key in seen:
                continue
            seen.add(key)
            answer = (
                f"Menurut Buku Praktis Pajak (2025), {excerpt}\n\n"
                f"Penjelasan tambahan: {topic['extra']}"
            )
            pairs.append({
                "id": f"book:{BOOK_ID}:{slug(topic['key'])}:{len(pairs)+1:03d}",
                "question": question,
                "answer": answer,
                "ground_truth_minimum": excerpt,
                "topic": topic["key"],
                "topic_label": topic["label"],
                "source": {
                    "book_id": BOOK_ID,
                    "title": "Buku Praktis Pajak",
                    "publisher": "Perkumpulan PRAKARSA",
                    "year": 2025,
                    "pdf_url": PDF_ROUTE,
                    "pages": used_pages,
                },
                "evaluation": {"must_include_minimum": True, "requires_current_rule_check": True},
            })

    # Add detail-level pairs from the book's own numbered/bulleted rules.  This
    # turns the book into a broad, inspectable ground-truth set without asking
    # a model to invent a legal proposition.
    for topic in TOPICS:
        matches = [number for number in topic.get("page_range", []) if 1 <= number <= len(pages)] or page_matches(pages, topic["aliases"])
        for page_number in matches[:6]:
            for line in clean(pages[page_number - 1]).splitlines():
                line = re.sub(r"^\s*", "", line).strip()
                line = re.sub(r"^(?:[•▪●]|\d+[.)])\s*", "", line).strip()
                if len(line) < 35 or len(line) > 280 or line.endswith(":"):
                    continue
                if not re.search(r"\b(?:tarif|batas|pajak|penghasilan|pembayaran|pelaporan|subjek|objek|sanksi|rumus|dihitung|wajib|omzet|NPWP|PPN|PPh)\b", line, re.I):
                    continue
                question = f"Apa ketentuan {topic['label']} mengenai {line[:110].rstrip('.')}?"
                key = question.lower()
                if key in seen:
                    continue
                seen.add(key)
                excerpt = line
                answer = f"Buku Praktis Pajak menyatakan: {excerpt}\n\nPenjelasan tambahan: {topic['extra']}"
                pairs.append({
                    "id": f"book:{BOOK_ID}:detail:{len(pairs)+1:03d}",
                    "question": question,
                    "answer": answer,
                    "ground_truth_minimum": excerpt,
                    "topic": topic["key"],
                    "topic_label": topic["label"],
                    "source": {"book_id": BOOK_ID, "title": "Buku Praktis Pajak", "publisher": "Perkumpulan PRAKARSA", "year": 2025, "pdf_url": PDF_ROUTE, "pages": [page_number]},
                    "evaluation": {"must_include_minimum": True, "requires_current_rule_check": True},
                })
                if len(pairs) >= 260:
                    return pairs
    return pairs


def to_regulation_record(pair: dict[str, Any], pdf_hash: str) -> dict[str, Any]:
    pages = pair["source"]["pages"]
    citation = f"Buku Praktis Pajak (2025), hlm. {', '.join(str(page) for page in pages)}"
    content = pair["answer"]
    return {
        "id": pair["id"],
        "topic": "vat" if pair["topic"] == "ppn" else "general",
        "title": pair["question"],
        "citation": citation,
        "focus": pair["answer"],
        "relevance": 96,
        "source": "manual",
        "sourceUrl": "",
        "pdfUrl": PDF_ROUTE,
        "officialPdfUrl": "",
        "storedPdfUrl": PDF_ROUTE,
        "sourceAuthority": "Perkumpulan PRAKARSA (bahan informasi publik)",
        "canonicalKey": pair["id"],
        "sourceLanguage": "id",
        "content": content,
        "ingestionStatus": "ready",
        "ingestionMessage": "Ground truth edukatif dari Buku Praktis Pajak; angka tetap perlu dicocokkan dengan peraturan resmi terkini.",
        "fileHash": f"sha256:{pdf_hash}",
        "extraction": {
            "schemaVersion": "regulation-extraction-v1",
            "summary": pair["ground_truth_minimum"],
            "scope": [pair["topic_label"]],
            "keyProvisions": [{"page": page, "article": "Buku Praktis Pajak", "text": pair["ground_truth_minimum"]} for page in pages],
            "effectiveDate": None,
            "legalStatus": "unknown",
            "statusNote": "Buku edukasi; bukan sumber hukum primer.",
            "relations": [],
            "keywords": [pair["topic"], "buku praktis pajak", "ground truth"],
            "verificationNotes": ["Minimum answer text is preserved verbatim from the supplied PDF.", "Verify current law against official regulation records."],
            "extractedAt": "2025-06-29T00:00:00Z",
            "model": "book-ground-truth-deterministic-v1",
            "sourcePdfUrl": PDF_ROUTE,
        },
        "relations": [],
        "extractedAt": "2025-06-29T00:00:00Z",
        "updatedAt": "2025-06-29T00:00:00Z",
    }


def build_graph(pairs: list[dict[str, Any]]) -> dict[str, Any]:
    nodes = [{"id": f"book:{BOOK_ID}", "kind": "source", "label": "Buku Praktis Pajak (2025)", "pdfUrl": PDF_ROUTE}]
    edges: list[dict[str, Any]] = []
    seen_nodes: set[str] = {nodes[0]["id"]}
    for pair in pairs:
        pair_id = pair["id"]
        topic_id = f"concept:{pair['topic']}"
        if topic_id not in seen_nodes:
            nodes.append({"id": topic_id, "kind": "concept", "label": pair["topic_label"]})
            seen_nodes.add(topic_id)
        nodes.append({"id": pair_id, "kind": "ground_truth", "label": pair["question"], "pdfUrl": PDF_ROUTE, "pages": pair["source"]["pages"]})
        edges.extend([
            {"source": f"book:{BOOK_ID}", "target": pair_id, "type": "supports_ground_truth", "verified": True, "confidence": 1.0, "eligibleForAnswer": True},
            {"source": pair_id, "target": topic_id, "type": "covers_concept", "verified": True, "confidence": 1.0, "eligibleForAnswer": True},
        ])
        citations = re.findall(r"\b(?:UU|PP|PMK|PER|KEP|SE)\s*(?:No\.?|Nomor)?\s*\d+(?:\s*/\s*(?:[A-Z.]+\s*/\s*)?\d{4}|\s+Tahun\s+\d{4})?", pair["ground_truth_minimum"], flags=re.IGNORECASE)
        for citation in sorted(set(citations)):
            citation_id = canonical_citation_id(citation)
            citation_key = citation_id.replace("law:", "")
            if citation_id not in seen_nodes:
                nodes.append({"id": citation_id, "kind": "rule_citation", "label": citation, "canonicalKey": citation_key})
                seen_nodes.add(citation_id)
            edges.append({"source": pair_id, "target": citation_id, "type": "mentions_rule", "verified": True, "confidence": 0.85, "eligibleForAnswer": False, "navigationOnly": True})
    return {"schemaVersion": "buku-praktis-pajak-graph-v1", "sourcePdf": PDF_ROUTE, "nodes": nodes, "edges": edges}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if not args.pdf.exists():
        raise SystemExit(f"PDF not found: {args.pdf}")
    reader = PdfReader(str(args.pdf))
    pages = [page.extract_text() or "" for page in reader.pages]
    pairs = build_pairs(pages)
    pdf_hash = sha256_file(args.pdf)
    records = [to_regulation_record(pair, pdf_hash) for pair in pairs]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    qa_jsonl = args.output_dir / "buku-praktis-pajak-qa.jsonl"
    with qa_jsonl.open("w", encoding="utf-8") as handle:
        for pair in pairs:
            handle.write(json.dumps(pair, ensure_ascii=False, sort_keys=True) + "\n")
    with gzip.open(args.output_dir / "buku-praktis-pajak-qa.jsonl.gz", "wt", encoding="utf-8", newline="\n") as handle:
        for pair in pairs:
            handle.write(json.dumps(pair, ensure_ascii=False, sort_keys=True) + "\n")
    with gzip.open(args.output_dir / "buku-praktis-pajak-records.jsonl.gz", "wt", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
    (args.output_dir / "buku-praktis-pajak-graph.json").write_text(json.dumps(build_graph(pairs), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ground_truth = {
        "schemaVersion": "buku-praktis-pajak-ground-truth-v1",
        "sourcePdf": PDF_ROUTE,
        "sourceFileSha256": pdf_hash,
        "cases": [{"id": pair["id"], "question": pair["question"], "minimumAnswer": pair["ground_truth_minimum"], "pages": pair["source"]["pages"], "topic": pair["topic"]} for pair in pairs],
    }
    (args.output_dir / "buku-praktis-pajak-ground-truth.json").write_text(json.dumps(ground_truth, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest = {"schemaVersion": "buku-praktis-pajak-import-v1", "pdf": str(args.pdf.resolve()), "pdfSha256": pdf_hash, "pages": len(pages), "qaPairs": len(pairs), "pdfRoute": PDF_ROUTE}
    (args.output_dir / "buku-praktis-pajak-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
