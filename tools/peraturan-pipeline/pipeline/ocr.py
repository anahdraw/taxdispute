"""OCR berjenjang — dipakai sesedikit mungkin.

Hasil survei korpus DJP mengubah peran OCR secara drastis:
  * Dokumen dengan badan HTML (mayoritas pasca-2000) tidak butuh OCR sama sekali.
  * Lampiran PDF terbitan modern (mis. Lampiran PMK 44/2026) sudah memiliki
    text layer — `pdftotext` mengembalikan teks bersih, biaya nol.
  * OCR sejati hanya diperlukan untuk hasil pindaian: peraturan lama dari
    sumber sekunder (JDIH Kemenkeu, peraturan.go.id) dan sebagian lampiran
    berupa gambar.

Karena itu rutenya berjenjang, dari yang gratis ke yang berbayar:

  Rute A  text layer   pdftotext -layout            gratis
  Rute B  OCR lokal    ocrmypdf/tesseract (ind)     gratis, ~2-5 dtk/hal
  Rute C  VLM          Claude Haiku (batch) vision  ~$0.001-0.004/halaman

Rute C hanya untuk halaman yang gagal di rute B (kepercayaan rendah, tabel
kompleks, formulir berkolom). Halaman semacam ini biasanya <5% korpus.
"""
from __future__ import annotations

import base64
import json
import re
import shutil
import subprocess
from pathlib import Path

from . import profil
from .config import MODEL_CHEAP, OCR_DIR
from .llm import Job, estimate_usd, image_block

MIN_CHARS_PER_PAGE = 180          # di bawah ini halaman dianggap tanpa text layer
MIN_TEXT_RATIO = 0.60             # rasio halaman ber-teks agar rute A diterima


def _have(binary: str) -> bool:
    return shutil.which(binary) is not None


def page_count(pdf: Path) -> int:
    try:
        out = subprocess.run(["pdfinfo", str(pdf)], capture_output=True,
                             text=True, timeout=60).stdout
        m = re.search(r"^Pages:\s+(\d+)", out, re.M)
        return int(m.group(1)) if m else 0
    except Exception:                                     # noqa: BLE001
        return 0


MAKS_SAMPEL_HALAMAN = 12


def probe_text_layer(pdf: Path) -> tuple[float, int]:
    """Kembalikan (rasio halaman ber-teks, jumlah halaman).

    Memeriksa SAMPEL halaman, bukan seluruhnya. Versi sebelumnya memanggil
    `pdftotext` sekali per halaman — pada satu lampiran 1.040 halaman itu
    berarti 1.040 proses anak hanya untuk menjawab pertanyaan biner "dokumen
    ini punya text layer atau tidak". Dua belas halaman yang tersebar merata
    sudah lebih dari cukup untuk memutuskannya.
    """
    n = page_count(pdf)
    if not n:
        return 0.0, 0
    if n <= MAKS_SAMPEL_HALAMAN:
        halaman = list(range(1, n + 1))
    else:
        langkah = n / MAKS_SAMPEL_HALAMAN
        halaman = sorted({max(1, min(n, int(i * langkah) + 1))
                          for i in range(MAKS_SAMPEL_HALAMAN)})
    good = 0
    for p in halaman:
        try:
            txt = subprocess.run(
                ["pdftotext", "-f", str(p), "-l", str(p), str(pdf), "-"],
                capture_output=True, text=True, timeout=120).stdout
        except Exception:                                 # noqa: BLE001
            txt = ""
        if len(re.sub(r"\s", "", txt)) >= MIN_CHARS_PER_PAGE:
            good += 1
    return good / len(halaman), n


# --- Rute A ----------------------------------------------------------------
def extract_text_layer(pdf: Path) -> str:
    return subprocess.run(["pdftotext", "-layout", str(pdf), "-"],
                          capture_output=True, text=True, timeout=600).stdout


# --- Rute B ----------------------------------------------------------------
def ocr_local(pdf: Path, lang="ind+eng", prof=None) -> tuple[str, float]:
    """OCR lokal gratis. Mengembalikan (teks, perkiraan kepercayaan 0..1).

    Resolusi dan mode segmentasi diambil dari profil bentuk dokumen. Lampiran
    tarif dirender lebih tinggi dan disegmentasi per kolom, karena satu digit
    yang tercampur antar kolom langsung salah di perhitungan pajaknya.
    """
    if prof is None:
        prof = profil.BAKU
    out_pdf = OCR_DIR / (pdf.stem + ".ocr.pdf")
    if _have("ocrmypdf"):
        subprocess.run(
            ["ocrmypdf", "--force-ocr", "--language", lang, "--optimize", "1",
             "--output-type", "pdf", str(pdf), str(out_pdf)],
            capture_output=True, timeout=3600)
        if out_pdf.exists():
            text = extract_text_layer(out_pdf)
            return text, _heuristic_conf(text)
    if _have("tesseract"):
        # Tanpa ocrmypdf: render per halaman lalu OCR.
        text_parts = []
        n = page_count(pdf) or 1
        for p in range(1, n + 1):
            png = OCR_DIR / f"{pdf.stem}-{p:04d}"
            subprocess.run(["pdftoppm", "-r", str(prof.dpi),
                            "-f", str(p), "-l", str(p),
                            "-png", str(pdf), str(png)],
                           capture_output=True, timeout=300)
            cand = sorted(OCR_DIR.glob(f"{pdf.stem}-{p:04d}*.png"))
            if not cand:
                continue
            res = subprocess.run(
                ["tesseract", str(cand[0]), "stdout", "-l", lang,
                 "--psm", prof.psm],
                capture_output=True, text=True, timeout=300)
            text_parts.append(res.stdout)
            cand[0].unlink(missing_ok=True)
        text = "\n\n".join(text_parts)
        return text, _heuristic_conf(text)
    return "", 0.0


_KATA_KUNCI = ("pasal", "ayat", "peraturan", "pajak", "menteri", "direktur",
               "berlaku", "tahun", "nomor")


def _heuristic_conf(text: str) -> float:
    """Perkiraan mutu OCR tanpa ground truth.

    Tiga sinyal: proporsi karakter yang sah, kehadiran kosakata perundangan,
    dan panjang rata-rata kata (OCR buruk menghasilkan pecahan token).
    """
    if not text or len(text) < 200:
        return 0.0
    letters = sum(c.isalnum() or c.isspace() or c in ".,;:()/-" for c in text)
    ratio_ok = letters / len(text)
    words = re.findall(r"[A-Za-zÀ-ÿ]{2,}", text.lower())
    if not words:
        return 0.0
    kw = sum(1 for k in _KATA_KUNCI if k in text.lower()) / len(_KATA_KUNCI)
    avg_len = sum(len(w) for w in words) / len(words)
    len_score = 1.0 if 4.0 <= avg_len <= 9.0 else 0.5
    return round(min(1.0, 0.45 * ratio_ok + 0.35 * kw + 0.20 * len_score), 3)


# --- Rute C ----------------------------------------------------------------
VLM_SYSTEM = """Anda mentranskripsi halaman dokumen peraturan perundang-undangan Indonesia menjadi teks terstruktur.

Aturan:
1. Transkripsikan APA ADANYA. Jangan meringkas, menerjemahkan, memperbaiki ejaan, atau melengkapi bagian yang terpotong.
2. Pertahankan penomoran asli: BAB, Bagian, Pasal, ayat "(1)", huruf "a.", angka "1.".
3. Tabel ditulis sebagai tabel Markdown, satu baris per baris tabel. Sel kosong ditulis kosong.
4. Formulir dan titik-titik isian ditulis sebagai "......" dengan nomor rujukannya bila ada, contoh: "nama : ...... (4)".
5. Bila ada bagian yang tidak terbaca, tulis persis [TIDAK TERBACA] di posisi itu. Jangan menebak angka — kesalahan satu digit pada tarif atau batasan nilai berakibat fatal.
6. Abaikan header/footer berulang dan nomor halaman.

Kembalikan objek JSON dengan field teks (hasil transkripsi Markdown) dan terbaca (true/false)."""

VLM_SCHEMA = {
    "type": "object",
    "properties": {
        "teks": {"type": "string"},
        "terbaca": {"type": "boolean"},
        "catatan": {"type": "string"},
    },
    "required": ["teks", "terbaca", "catatan"],
    "additionalProperties": False,
}


def render_page_png(pdf: Path, page: int, dpi=200) -> Path | None:
    stem = OCR_DIR / f"{pdf.stem}-vlm-{page:04d}"
    subprocess.run(["pdftoppm", "-r", str(dpi), "-f", str(page), "-l", str(page),
                    "-png", "-singlefile", str(pdf), str(stem)],
                   capture_output=True, timeout=300)
    p = Path(str(stem) + ".png")
    return p if p.exists() else None


def vlm_jobs(pdf: Path, pages: list[int], reg_id: str, dpi=200) -> list[Job]:
    """Susun permintaan batch VLM untuk halaman-halaman bermasalah saja."""
    jobs: list[Job] = []
    for p in pages:
        png = render_page_png(pdf, p, dpi)
        if not png:
            continue
        b64 = base64.standard_b64encode(png.read_bytes()).decode()
        jobs.append(Job(
            custom_id=f"ocr::{reg_id}::{pdf.stem}::{p}",
            system_stable=VLM_SYSTEM,
            user=[image_block(b64),
                  {"type": "text",
                   "text": f"Transkripsikan halaman {p} dokumen ini."}],
            schema=VLM_SCHEMA, max_tokens=8000))
    return jobs


def route_attachment(conn, att_row, *, vlm_threshold=None) -> dict:
    """Jalankan penjenjangan untuk satu lampiran dan catat rutenya.

    Ambang dan setelan render mengikuti profil dokumen, bukan satu angka untuk
    semua. Lampiran tarif menuntut ambang lebih tinggi daripada surat edaran:
    kesalahan yang dapat ditoleransi pada narasi tidak dapat ditoleransi pada
    angka yang dipakai menghitung.
    """
    pdf = Path(att_row["local_path"])
    if not pdf.exists():
        return {"route": "pending", "reason": "berkas tidak ada"}

    jenis = None
    try:
        r = conn.execute("SELECT jenis_code FROM regulation WHERE id=?",
                         (att_row["reg_id"],)).fetchone()
        jenis = r[0] if r else None
    except Exception:
        pass
    prof = profil.untuk(jenis, lampiran=True)
    if vlm_threshold is None:
        vlm_threshold = prof.ambang_vlm

    ratio, npages = probe_text_layer(pdf)
    if ratio >= MIN_TEXT_RATIO:
        text = extract_text_layer(pdf)
        conn.execute(
            "UPDATE attachment SET pages=?,text_ratio=?,route='textlayer',"
            "ocr_conf=1.0,text=?,cost_usd=0 WHERE id=?",
            (npages, ratio, text, att_row["id"]))
        return {"route": "textlayer", "pages": npages, "cost": 0.0}

    text, conf = ocr_local(pdf, prof=prof)
    if conf >= vlm_threshold:
        conn.execute(
            "UPDATE attachment SET pages=?,text_ratio=?,route='ocr_local',"
            "ocr_conf=?,text=?,cost_usd=0 WHERE id=?",
            (npages, ratio, conf, text, att_row["id"]))
        return {"route": "ocr_local", "pages": npages, "conf": conf, "cost": 0.0}

    conn.execute(
        "UPDATE attachment SET pages=?,text_ratio=?,route='vlm',ocr_conf=?,"
        "text=? WHERE id=?", (npages, ratio, conf, text, att_row["id"]))
    est = estimate_usd(MODEL_CHEAP, in_tok=1600 * max(npages, 1),
                       out_tok=1200 * max(npages, 1), batch=True)
    return {"route": "vlm", "pages": npages, "conf": conf, "est_cost": round(est, 4)}


def preflight(conn) -> dict:
    """Ringkas kesiapan perkakas + perkiraan beban OCR sebelum menjalankan."""
    return {
        "pdftotext": _have("pdftotext"),
        "pdfinfo": _have("pdfinfo"),
        "pdftoppm": _have("pdftoppm"),
        "tesseract": _have("tesseract"),
        "ocrmypdf": _have("ocrmypdf"),
        "lampiran_menunggu": conn.execute(
            "SELECT COUNT(*) c FROM attachment WHERE route='pending'").fetchone()["c"],
        "tanpa_badan_teks": conn.execute(
            "SELECT COUNT(*) c FROM regulation WHERE has_body=0").fetchone()["c"],
    }
