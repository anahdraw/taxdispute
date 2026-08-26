"""Celah nomor urut: nomor mana yang bolong di dalam satu seri.

Analisis celah sebelumnya membandingkan korpus dengan katalog lain, sehingga ia
hanya menemukan yang diketahui katalog itu. Pemeriksaan ini berbeda: ia membaca
pola penomoran korpus sendiri.

Peraturan diberi nomor urut per tahun. Bila sebuah tahun memuat PER-1 sampai
PER-20 tetapi PER-7 dan PER-13 tidak ada, dua dokumen itu hilang — dan tidak ada
katalog mana pun yang perlu dikonsultasikan untuk mengetahuinya. Ini satu-satunya
cara menemukan dokumen yang hilang dari SEMUA sumber yang kita punya.

**Yang membuat pembacaan ini bisa keliru, dan bagaimana ditangani:**

*Nomor memang tidak selalu berurutan.* Sebagian seri melompat karena dokumennya
dibatalkan sebelum terbit, atau karena penomorannya dibagi per unit kerja.
Karena itu celah dilaporkan sebagai dugaan berperingkat, bukan sebagai kepastian:
lompatan satu-dua nomor di tengah seri padat jauh lebih meyakinkan daripada
lompatan di seri yang memang jarang.

*Seri yang terlalu pendek tidak berarti apa-apa.* Tiga dokumen dengan nomor 2, 5,
dan 40 bukan bukti 37 dokumen hilang — bukti bahwa kita tidak tahu pola
penomorannya. Seri semacam itu dilewati.
"""
from __future__ import annotations

import re

# Nomor pokok pada awal penomoran: "PER-31/PJ/2009" -> 31, "68 TAHUN 2022" -> 68.
RE_POKOK = re.compile(r"^\s*(?:[A-Z\-]+\s*[-/]?\s*)?(\d{1,4})\b")

# Kepadatan minimum sebuah seri sebelum lompatannya berarti. Di bawah ini,
# ketiadaan nomor lebih mungkin berarti penomorannya memang tidak rapat
# daripada berarti ada dokumen yang hilang.
KEPADATAN_MINIMUM = 0.55
MINIMUM_ANGGOTA = 8

# Nama daerah dikenali dari bentuk sebutannya, bukan dari daftar. Kolom
# `kategori` dipakai bersama untuk dua hal — daerah pada peraturan daerah,
# kategori topik pada dokumen pusat — dan memperlakukan "PPh" sebagai nama
# daerah akan memecah seri pusat menjadi serpihan yang tak berarti.
# `\b` sesudah "kab." tidak berlaku: titik dan spasi keduanya bukan aksara kata,
# jadi tidak ada batas di antaranya, dan "Kab. Buleleng" tertolak sebagai daerah.
RE_WILAYAH = re.compile(r"^(?:provinsi\b|kabupaten\b|kota\b|kab\.)", re.I)


def _wilayah(kategori: str | None) -> str:
    k = (kategori or "").strip()
    return k if RE_WILAYAH.match(k) else ""


def _pokok(nomor: str | None) -> int | None:
    m = RE_POKOK.match(nomor or "")
    if not m:
        return None
    n = int(m.group(1))
    # Nomor besar biasanya bukan nomor urut melainkan tahun atau kode unit.
    return n if 0 < n <= 3000 else None


def periksa(conn, jenis: str | None = None, tahun_min: int | None = None,
            sumber_luar: bool = True) -> dict:
    """Cari nomor yang hilang pada tiap seri (jenis + tahun).

    `sumber_luar` menandai celah yang ternyata ADA di katalog Ortax — itu
    membedakan "kita melewatkannya" dari "tidak ada di mana pun", dan keduanya
    menuntut tindakan yang berbeda.
    """
    where = ["jenis_code IS NOT NULL", "tahun IS NOT NULL", "berkala IS NULL"]
    arg: list = []
    if jenis:
        where.append("jenis_code=?"); arg.append(jenis)
    if tahun_min:
        where.append("tahun>=?"); arg.append(int(tahun_min))

    # Seri penomoran peraturan daerah berjalan PER DAERAH. Menggabungkannya
    # tidak hanya salah secara arti; ia menyembunyikan celah yang nyata. Bila
    # Kab. A punya Perda 1 dan 3 sedangkan Kab. B punya Perda 2, himpunan
    # gabungannya {1,2,3} tampak tanpa lubang — padahal Perda 2 Kab. A memang
    # tidak ada. Yang hilang justru menjadi tak terlihat karena tetangganya
    # kebetulan memakai nomor itu.
    seri: dict[tuple, set] = {}
    for r in conn.execute(
            f"SELECT jenis_code, tahun, nomor_raw, canonical, kategori "
            f"  FROM regulation WHERE {' AND '.join(where)}", arg):
        p = _pokok(r["nomor_raw"]) or _pokok(r["canonical"])
        if p:
            seri.setdefault((r["jenis_code"], r["tahun"],
                             _wilayah(r["kategori"])), set()).add(p)

    # Nomor yang ada di katalog luar dipakai untuk memilah celah yang masih
    # dapat diisi dari celah yang benar-benar tidak dimiliki siapa pun.
    di_luar: dict[tuple, set] = {}
    if sumber_luar:
        try:
            for r in conn.execute(
                    "SELECT jenis_code, tahun, nomor_teks, kategori "
                    "  FROM katalog_luar "
                    " WHERE jenis_code IS NOT NULL AND tahun IS NOT NULL"):
                p = _pokok(r["nomor_teks"])
                if p:
                    di_luar.setdefault((r["jenis_code"], r["tahun"],
                                        _wilayah(r["kategori"])), set()).add(p)
        except Exception:                                     # noqa: BLE001
            di_luar = {}

    hasil = []
    n_celah = n_dapat_diisi = 0
    for (kode, tahun, wilayah), angka in sorted(seri.items()):
        if len(angka) < MINIMUM_ANGGOTA:
            continue
        lo, hi = min(angka), max(angka)
        rentang = hi - lo + 1
        kepadatan = len(angka) / rentang
        if kepadatan < KEPADATAN_MINIMUM:
            continue
        hilang = sorted(set(range(lo, hi + 1)) - angka)
        if not hilang:
            continue
        ada_di_luar = sorted(set(hilang)
                             & di_luar.get((kode, tahun, wilayah), set()))
        n_celah += len(hilang)
        n_dapat_diisi += len(ada_di_luar)
        hasil.append({
            "jenis": kode, "tahun": tahun, "wilayah": wilayah,
            "punya": len(angka), "rentang": f"{lo}–{hi}",
            "kepadatan": round(kepadatan, 2),
            "hilang": hilang, "n_hilang": len(hilang),
            "ada_di_ortax": ada_di_luar,
        })

    hasil.sort(key=lambda x: (-x["kepadatan"], -x["n_hilang"]))
    return {"seri_diperiksa": len(seri), "seri_bercelah": len(hasil),
            "nomor_hilang": n_celah, "dapat_diisi_dari_ortax": n_dapat_diisi,
            "seri": hasil}
