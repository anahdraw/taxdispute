"""Ambil ulang naskah Ortax dengan pengurai yang lebih baik.

5.874 dokumen masuk lewat medan `articleBody` pada blok JSON-LD. Medan itu ada
di setiap halaman, mudah ditemukan, dan untuk sebagian besar dokumen memang
memuat naskah lengkap — jadi tidak ada yang tampak salah. Yang tidak terlihat
adalah **strukturnya**: `articleBody` adalah satu paragraf tanpa satu pun jeda
baris, sehingga jedanya harus dikira-kira dari pola kata, dan hasilnya bermedian
**5 baris per dokumen**. 2.836 dokumen tersimpan dengan kurang dari 5 baris.

Naskah yang sama juga ada di halaman itu sebagai `<div id="isiaturan">` — HTML
bertabel, dengan penanda huruf dan angka pada selnya sendiri. Perda 26994 memberi
141 baris dari sana, melawan 29 baris hasil pengiraan. Dan pada Surat Dirjen
Pajak `articleBody` bahkan hanya cuplikan 300 aksara berakhiran "…", ditandai
`isFullContent: false` oleh halamannya sendiri.

Akibat perbedaan ini bukan pada panjang naskahnya melainkan pada apa yang dapat
dicari: dokumen bersatuan lima baris tidak dapat dikutip per pasal, dan
pencarian pasalnya mengembalikan seluruh dokumen sebagai satu blok.

**Yang dijaga:** naskah lama tidak dibuang sebelum yang baru terbukti lebih
baik. Ukurannya bukan panjang — naskah baru bisa lebih pendek karena markup
tidak lagi ikut terhitung — dan juga bukan jumlah baris. Baris ternyata dapat
naik sementara **unit justru turun**: pada percobaan pertama satu Surat Edaran
berbaris 5 menjadi 118, dan unitnya 6 menjadi 3, karena penanda butir `<li>`
hilang dalam pengubahan HTML ke teks. Yang menentukan apakah sebuah dokumen
dapat dicari dan dikutip adalah **jumlah unit**, jadi itulah yang dibandingkan.
"""
from __future__ import annotations

import hashlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from .sources import ortax as ORTAX
from .structure import parse_body, store_units

# Naskah baru diterima hanya bila unitnya bertambah cukup berarti. Satu-dua unit
# bisa berasal dari perbedaan penataan, bukan dari struktur yang benar-benar
# terbaca; dan menukar naskah untuk perbedaan sebesar itu berarti menulis ulang
# ribuan baris basis data tanpa memperoleh apa pun.
FAKTOR_UNIT = 1.5
MINIMUM_UNIT = 3


# Satu baris naskah berstruktur berisi satu butir — pada sumber yang membawa
# markup aslinya, panjangnya berkisar 60 aksara. Ambang 400 aksara per baris
# jauh di bawah itu, jadi yang tersaring hanya dokumen yang benar-benar
# menggumpal, bukan yang barisnya sekadar panjang.
AKSARA_PER_BARIS = 400
BARIS_WAJAR = 8


def antrean(conn, batas: int | None = None) -> list[dict]:
    """Dokumen Ortax yang naskahnya masih menggumpal.

    Disaring menurut **struktur yang sudah dimiliki**, bukan menurut kapan ia
    diambil. Dokumen yang masuk sesudah pengurai diperbaiki sudah berbaris
    wajar, dan menyaringnya lewat tanggal menuntut pengetahuan tentang kapan
    perbaikan itu terjadi — pengetahuan yang tidak ada di dalam basis data.
    Yang berbaris wajar dilewati, dari mana pun dan kapan pun ia datang.
    """
    q = ("""SELECT k.sumber_id, r.id AS reg_id, r.jenis_code,
                   r.body_text
              FROM katalog_luar k JOIN regulation r ON r.id = k.kunci
             WHERE k.sumber='ortax' AND r.has_body=1
               AND r.source LIKE '%ortax%'
             ORDER BY r.id""")
    baris = []
    for r in conn.execute(q):
        teks = r["body_text"] or ""
        n_baris = len(teks.splitlines())
        wajar = max(BARIS_WAJAR, len(teks) // AKSARA_PER_BARIS)
        if n_baris >= wajar:
            continue
        baris.append({"sumber_id": r["sumber_id"], "reg_id": r["reg_id"],
                      "jenis_code": r["jenis_code"], "n": len(teks)})
    return baris[:batas] if batas else baris


def jalankan(conn, baris: list[dict], pekerja: int = 3,
             progress=print) -> dict:
    lokal = threading.local()

    def ambil(b: dict):
        if not hasattr(lokal, "sesi"):
            lokal.sesi = ORTAX._klien()
        try:
            return b, ORTAX.ambil_dokumen(b["sumber_id"], sesi=lokal.sesi,
                                          jenis_code=b["jenis_code"]), None
        except Exception as e:                                # noqa: BLE001
            return b, None, str(e)[:120]

    n = {"diperiksa": 0, "diganti": 0, "dipertahankan": 0, "nihil": 0,
         "galat": 0, "unit_sebelum": 0, "unit_sesudah": 0}
    now = datetime.now().isoformat(timespec="seconds")
    with ThreadPoolExecutor(max_workers=pekerja) as pool:
        for i, (b, o, galat) in enumerate(pool.map(ambil, baris), 1):
            n["diperiksa"] += 1
            if galat:
                n["galat"] += 1
            elif not o or not o.get("teks"):
                n["nihil"] += 1
            else:
                lama = conn.execute(
                    "SELECT body_text FROM regulation WHERE id=?",
                    (b["reg_id"],)).fetchone()
                unit_baru = parse_body(o["teks"])
                unit_lama = conn.execute(
                    "SELECT COUNT(*) FROM pasal WHERE reg_id=?",
                    (b["reg_id"],)).fetchone()[0]
                baris_lama, baris_baru = len(unit_baru), unit_lama
                lebih = (len(unit_baru) >= MINIMUM_UNIT
                         and len(unit_baru) >= unit_lama * FAKTOR_UNIT)
                if not lebih:
                    n["dipertahankan"] += 1
                else:
                    conn.execute(
                        "UPDATE regulation SET body_text=?, sha256=?, "
                        "       fetched_at=? WHERE id=?",
                        (o["teks"],
                         hashlib.sha256(o["teks"].encode()).hexdigest(),
                         now, b["reg_id"]))
                    store_units(conn, b["reg_id"], unit_baru)
                    n["diganti"] += 1
                    n["unit_sebelum"] += unit_lama
                    n["unit_sesudah"] += len(unit_baru)
            if i % 100 == 0 or i == len(baris):
                conn.commit()
                progress(f"  {i}/{len(baris)} — diganti {n['diganti']}, "
                         f"dipertahankan {n['dipertahankan']}, "
                         f"nihil {n['nihil']}, galat {n['galat']}")
    conn.commit()
    return n
