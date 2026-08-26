"""DDTC Perpajakan — pembentuk tautan, bukan konektor verifikasi.

Modul ini sengaja TIDAK memeriksa status ke DDTC secara otomatis. Alasannya
ditemukan saat mencoba, dan layak dicatat agar tidak dicoba lagi:

**Halamannya dirakit oleh JavaScript.** Klien HTTP biasa menerima cangkang yang
sama persis untuk dokumen yang ada maupun yang mengada-ada — judulnya sama
("Perpajakan DDTC"), tidak ada `h1`, dan pengalihan ke halaman 404 baru terjadi
setelah skrip berjalan di peramban. Percobaan pertama tampak berhasil: PMK
72/2023 mengembalikan status "Berlaku". Itu menyesatkan — kata itu berasal dari
kerangka halaman, bukan dari dokumennya, dan alamat yang jelas-jelas palsu pun
mengembalikan hasil yang sama.

Sumber yang mengembalikan jawaban meyakinkan untuk pertanyaan apa pun lebih
berbahaya daripada sumber yang tidak menjawab sama sekali. Karena itu DDTC
tidak dipakai sebagai sumber verifikasi.

**Yang tetap berguna:** alamat dokumennya deterministik, dibentuk dari jenis dan
nomornya. Jadi peninjau dapat dibawa langsung ke halaman yang tepat dan membaca
sendiri — dengan langganannya sendiri, di peramban yang menjalankan skripnya.
Satu klik, tanpa mencari.

**Batas yang dijaga.** Tidak ada isi yang diambil dari DDTC. Naskah dan
terjemahannya berada di balik langganan berbayar; yang dibuat di sini hanya
tautan menuju halamannya.
"""
from __future__ import annotations

import re

BASIS = "https://perpajakan.ddtc.co.id/id/sumber-hukum/peraturan-pusat/{slug}"
PENCARIAN = ("https://perpajakan.ddtc.co.id/id/sumber-hukum/peraturan/"
             "pencarian?kategori=pusat&keyword={q}")

# Kode jenis kita → sebutan yang dipakai DDTC pada alamat dokumennya.
JENIS_SLUG = {
    "UU": "undang-undang",
    "PERPU": "peraturan-pemerintah-pengganti-undang-undang",
    "PP": "peraturan-pemerintah", "PERPRES": "peraturan-presiden",
    "KEPPRES": "keputusan-presiden", "INPRES": "instruksi-presiden",
    "PMK": "peraturan-menteri-keuangan", "KMK": "keputusan-menteri-keuangan",
    "IMK": "instruksi-menteri-keuangan",
    "PER": "peraturan-dirjen-pajak", "KEP": "keputusan-dirjen-pajak",
    "SE": "surat-edaran-dirjen-pajak", "PENG": "pengumuman",
    "PERMENDAG": "peraturan-menteri-perdagangan",
    "PERMENDAGRI": "peraturan-menteri-dalam-negeri",
    "PERMENPERIN": "peraturan-menteri-perindustrian",
}


def tautan(jenis_code: str | None, nomor: str, tahun: int | None = None) -> str:
    """Alamat halaman DDTC untuk satu peraturan.

    Dua pola penomoran dipakai DDTC: "57-tahun-2026" untuk nomor sederhana dan
    "37mkef22026" — seluruh tanda baca dibuang — untuk nomor berunit. Bila
    jenisnya tidak dikenali, yang dikembalikan adalah alamat pencarian, bukan
    alamat dokumen: menebak alamat yang salah membawa pembaca ke halaman 404,
    sedangkan pencarian selalu membawanya ke sesuatu.
    """
    dasar = JENIS_SLUG.get((jenis_code or "").upper())
    n = (nomor or "").strip()
    if not dasar or not n:
        return PENCARIAN.format(q=re.sub(r"\s+", "+", f"{jenis_code or ''} {n}".strip()))
    m = re.match(r"^(\d+)\s*(?:TAHUN|Tahun)\s*(\d{4})$", n)
    ekor = (f"{m.group(1)}-tahun-{m.group(2)}" if m
            else re.sub(r"[^a-z0-9]", "", n.lower()))
    return BASIS.format(slug=f"{dasar}-{ekor}")
