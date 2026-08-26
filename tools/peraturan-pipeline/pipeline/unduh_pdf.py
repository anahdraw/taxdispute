"""Unduh pindaian resmi untuk dokumen yang sumbernya memang menerbitkannya.

Korpus ini menyimpan **transkripsi**, bukan pindaian. Untuk riset dan penelusuran
relasi itu lebih berguna daripada PDF — dapat dicari per ayat. Untuk keperluan
yang menuntut pembuktian naskah, transkripsi bukan pengganti, dan di situlah
modul ini dipakai.

**Batasnya bukan teknis melainkan siapa yang menerbitkan.** Pada uji 36 dokumen
lintas bentuk: UU, PP, dan Perpres selalu punya PDF di peraturan.go.id atau JDIH;
PMK dan KMK sebagian; terbitan Direktorat Jenderal Pajak (PER, KEP, SE, PENG,
S-PJ) dan seluruh peraturan daerah **tidak satu pun**. DJP menerbitkan badan
aturannya sebagai HTML dan hanya lampirannya sebagai PDF; PDF asli DDTC berada
di balik langganan. Karena itu antreannya dibatasi ke bentuk yang sumbernya
benar-benar memuat PDF — mencoba 19.676 dokumen yang sudah diketahui nihil hanya
menghasilkan 59 ribu permintaan sia-sia.

**Yang diunduh diperiksa, bukan dipercaya.** Berkas yang diterima harus benar-
benar PDF: banyak sumber menjawab permintaan yang gagal dengan halaman HTML
ber-status 200, dan menyimpannya sebagai `.pdf` menghasilkan pustaka berisi
berkas yang tidak dapat dibuka — dengan hitungan yang terlihat berhasil.
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .config import PDF_DIR
from .crawl import Fetcher
from .normalize import normalize_nomor
from .sources import bpk as BPK
from .sources import jdih_kemenkeu as JKM
from .sources import peraturan_go_id as PGI

SUMBER = (("peraturan.go.id", PGI), ("jdih-bpk", BPK), ("jdih-kemenkeu", JKM))

# Bentuk yang sumber resminya benar-benar menerbitkan pindaian. Daftar ini hasil
# pengukuran, bukan dugaan — dan dugaan pertama salah pada dua tempat sekaligus:
#
#   bentuk        terukur   ukuran rata-rata
#   UU              6/8        ~11 MB
#   PP              4/5        0,8 MB
#   PERPRES         5/5        0,2 MB
#   KEPPRES         4/5        0,1 MB
#   INPRES          4/5        < 0,1 MB
#   PERPU           3/5        < 0,1 MB
#   PMK            9/12        0,3–5,5 MB
#   KMK            0/14        —
#   PERMENDAGRI, PERMENDAG, KEPMENDAG, KEPMENAKER, IMK   0/5 masing-masing
#
# **KMK dikeluarkan meski awalnya masuk.** Sampel pertama tiga dokumen
# menemukan satu PDF, dan itu cukup untuk memasukkannya; sampel empat belas
# dokumen menemukan nol. Yang lebih menyesatkan: JDIH Kemenkeu mengembalikan
# alamat yang dinamainya `full_text_pdf`, dan alamat itu menjawab dengan HTML
# ber-status 200 — naskahnya, bukan pindaiannya. Tanpa `_sah_pdf`, 3.004 KMK
# akan tersimpan sebagai berkas `.pdf` yang tidak dapat dibuka, dengan laporan
# yang berbunyi berhasil.
#
# Peraturan menteri selain Menteri Keuangan juga nol, jadi dikeluarkan: 400
# dokumen dikalikan tiga sumber adalah 1.200 permintaan yang hasilnya sudah
# diketahui.
BENTUK_BERPDF = (
    "UU", "UU-DARURAT", "PERPU", "PP", "PERPRES", "KEPPRES", "INPRES", "PMK",
)

MAGIC = b"%PDF"
MINIMUM_BITA = 2048


def antrean(conn, batas: int | None = None,
            jenis: str | None = None) -> list[dict]:
    """Dokumen berbentuk terjangkau yang belum punya berkas PDF tersimpan."""
    bentuk = (jenis,) if jenis else BENTUK_BERPDF
    q = (f"""SELECT r.id, r.jenis_code, r.nomor_raw, r.tahun, r.canonical
               FROM regulation r
              WHERE r.jenis_code IN ({",".join("?" * len(bentuk))})
                AND NOT EXISTS (SELECT 1 FROM attachment a
                                 WHERE a.reg_id = r.id
                                   AND a.local_path IS NOT NULL)
              ORDER BY r.tahun DESC, r.id""")
    baris = [dict(r) for r in conn.execute(q, bentuk)]
    return baris[:batas] if batas else baris


def _sah_pdf(p: Path) -> bool:
    """Benar bila berkasnya sungguh PDF, bukan halaman galat berjudul .pdf."""
    try:
        if p.stat().st_size < MINIMUM_BITA:
            return False
        with p.open("rb") as f:
            return f.read(4) == MAGIC
    except OSError:
        return False


def _ambil_satu(b: dict, fetcher: Fetcher) -> dict:
    rid = normalize_nomor(b["nomor_raw"] or "", b["jenis_code"], b["tahun"])
    nomor = rid.nomor if rid else (b["nomor_raw"] or "")
    dicoba = []
    for nama, mod in SUMBER:
        arg = nomor if mod is PGI else b["nomor_raw"]
        try:
            d = mod.fetch(fetcher, b["jenis_code"], arg, b["tahun"],
                          want_pdf=False, pdf_dir=None)
        except Exception as e:                                # noqa: BLE001
            dicoba.append(f"{nama}:galat({type(e).__name__})")
            continue
        if not d or not getattr(d, "pdf_urls", None):
            dicoba.append(f"{nama}:tanpa-pdf")
            continue
        for u in d.pdf_urls:
            ekor = u.rsplit("/", 1)[-1].split("?")[0][:80] or "berkas"
            if not ekor.lower().endswith(".pdf"):
                ekor += ".pdf"
            tuju = Path(PDF_DIR) / f"{nama.split('.')[0]}-{b['id']}-{ekor}"
            try:
                fetcher.download(u, tuju)
            except Exception as e:                            # noqa: BLE001
                dicoba.append(f"{nama}:unduh-galat({type(e).__name__})")
                continue
            if not _sah_pdf(tuju):
                tuju.unlink(missing_ok=True)
                dicoba.append(f"{nama}:bukan-pdf")
                continue
            return {"id": b["id"], "hasil": "unduh", "dari": nama,
                    "url": u, "berkas": str(tuju), "dicoba": dicoba}
    return {"id": b["id"], "hasil": "tanpa_pdf", "dicoba": dicoba}


def jalankan(conn, baris: list[dict], pekerja: int = 3, jeda: float = 0.6,
             progress=print) -> dict:
    lokal = threading.local()

    def kerja(b: dict):
        if not hasattr(lokal, "f"):
            lokal.f = Fetcher(delay=jeda)
        try:
            return _ambil_satu(b, lokal.f)
        except Exception as e:                                # noqa: BLE001
            return {"id": b["id"], "hasil": "galat", "dicoba": [str(e)[:100]]}

    n: dict[str, int] = {}
    bita = 0
    with ThreadPoolExecutor(max_workers=pekerja) as pool:
        for i, r in enumerate(pool.map(kerja, baris), 1):
            n[r["hasil"]] = n.get(r["hasil"], 0) + 1
            if r["hasil"] == "unduh":
                p = Path(r["berkas"])
                bita += p.stat().st_size
                conn.execute(
                    "INSERT OR REPLACE INTO attachment"
                    "(id,reg_id,url,local_path,route) VALUES (?,?,?,?,?)",
                    (f"pdf-{r['id']}"[:32], r["id"], r["url"], r["berkas"],
                     f"pdf resmi ({r['dari']})"))
            if i % 50 == 0 or i == len(baris):
                conn.commit()
                progress(f"  {i}/{len(baris)} — {n} | {bita / 1048576:.0f} MB")
    conn.commit()
    n["megabita"] = round(bita / 1048576, 1)
    return n
