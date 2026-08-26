"""Lapisan percakapan di atas penelusuran korpus.

**Yang dikerjakan di sini bukan menjawab, melainkan menemukan.** Yang
dikembalikan adalah pasal-pasal nyata beserta kutipannya, bukan kalimat yang
dirangkai ulang. Bedanya penting untuk pekerjaan hukum: rangkuman yang menyimpang
sedikit dari bunyi pasalnya tetap terbaca meyakinkan, dan yang membacanya tidak
punya cara mengetahui bahwa ia menyimpang.

Yang membuatnya terasa seperti percakapan adalah **penyaring yang dibaca dari
pertanyaannya sendiri**. "Tarif PPh badan yang masih berlaku" tidak hanya dicari
sebagai lima kata; kata "masih berlaku" dibaca sebagai perintah menyisihkan yang
sudah dicabut. Dan yang dibaca itu **selalu dikatakan** pada jawabannya — supaya
pembaca tahu pertanyaannya ditafsirkan bagaimana, bukan menebak mengapa hasilnya
begitu.

Penyambungan LLM disiapkan di `susun_naratif()` tetapi **mati secara baku**.
Fungsinya bukan mencari, melainkan merangkai temuan yang sudah ada menjadi
kalimat. Selama mati, seluruh modul ini tidak memanggil layanan berbayar apa pun.
"""
from __future__ import annotations

import re

# Isyarat yang dibaca dari pertanyaan. Setiap pola menyebut apa yang diubahnya
# dan kata apa yang memicunya, karena keduanya ikut dilaporkan ke pembaca.
ISYARAT = [
    ("hanya_berlaku",
     r"\b((?:yang\s+)?masih\s+berlaku|yang\s+berlaku|sedang\s+berlaku|"
     r"berlaku\s+saat\s+ini)\b",
     "menyisihkan peraturan yang sudah dicabut"),
    ("sertakan_dicabut",
     r"\b(termasuk\s+yang\s+dicabut|sudah\s+dicabut|yang\s+dicabut|pernah\s+berlaku|historis)\b",
     "menyertakan peraturan yang sudah dicabut"),
]

# Bentuk yang dapat disebut langsung di dalam pertanyaan. Sebutan sehari-hari
# ikut, karena orang menulis "permenkeu" dan "pergub", bukan kode korpus.
SEBUTAN_BENTUK = {
    "pmk": "PMK", "permenkeu": "PMK", "peraturan menteri keuangan": "PMK",
    "kmk": "KMK", "keputusan menteri keuangan": "KMK",
    "uu": "UU", "undang-undang": "UU", "undang undang": "UU",
    "pp": "PP", "peraturan pemerintah": "PP",
    "perpres": "PERPRES", "peraturan presiden": "PERPRES",
    "keppres": "KEPPRES", "perpu": "PERPU",
    "perdirjen": "PER", "per dirjen": "PER", "peraturan dirjen": "PER",
    "kepdirjen": "KEP", "keputusan dirjen": "KEP",
    "se": "SE", "surat edaran": "SE", "pengumuman": "PENG",
    "perda": "PERDA", "peraturan daerah": "PERDA", "qanun": "QANUN",
    "pergub": "PER-GUBERN", "peraturan gubernur": "PER-GUBERN",
    "kepgub": "KEP-GUBERN", "keputusan gubernur": "KEP-GUBERN",
    "perbup": "PER-BUPATI", "peraturan bupati": "PER-BUPATI",
    "perwali": "PER-WALIKO", "peraturan wali kota": "PER-WALIKO",
    "peraturan walikota": "PER-WALIKO",
}

RE_TAHUN = re.compile(r"\b(?:tahun\s+)?((?:19|20)\d{2})\b")
# Kata yang menandai bahwa angka empat digit itu tahun DOKUMEN, bukan tahun
# yang kebetulan tersebut di dalam pertanyaan ("perubahan UU 7 Tahun 1983").
RE_TAHUN_SARING = re.compile(r"\b(terbit(?:an)?|tahun)\s+((?:19|20)\d{2})\b")


def baca_isyarat(q: str, punya_daerah=None) -> dict:
    """Tafsir pertanyaan menjadi penyaring, beserta alasan tiap penyaring."""
    t = (q or "").lower()
    saring: dict = {}
    alasan: list[str] = []

    for nama, pola, ket in ISYARAT:
        m = re.search(pola, t)
        if not m:
            continue
        if nama == "sertakan_dicabut":
            saring["sertakan_dicabut"] = True
        else:
            saring["sertakan_dicabut"] = False
        alasan.append(f'"{m.group(0)}" → {ket}')

    # Bentuk: sebutan terpanjang yang cocok, supaya "peraturan menteri keuangan"
    # tidak terbaca sebagai "peraturan" lalu jatuh ke bentuk yang salah.
    ketemu = [(len(k), k, v) for k, v in SEBUTAN_BENTUK.items()
              if re.search(r"\b" + re.escape(k) + r"\b", t)]
    if ketemu:
        _, kata, kode = max(ketemu)
        saring["jenis"] = kode
        alasan.append(f'"{kata}" → dibatasi ke bentuk {kode}')

    m = RE_TAHUN_SARING.search(t)
    if m:
        saring["tahun"] = int(m.group(2))
        alasan.append(f'"{m.group(0)}" → dibatasi ke tahun {m.group(2)}')

    # Daerah: dicocokkan ke daftar daerah yang benar-benar ada di korpus, bukan
    # ditebak dari kata "kabupaten". Menebak daerah menghasilkan penyaring yang
    # membuang segalanya tanpa sebab yang terbaca.
    #
    # Sebutan LENGKAP diperiksa lebih dahulu. Kata intinya saja tidak cukup
    # membedakan: "bandung" ada pada "Kota Bandung" dan "Kab. Bandung"
    # sekaligus, dan mengambil yang pertama membuat pertanyaan tentang kota
    # dijawab dengan peraturan kabupaten — tanpa satu pun tanda bahwa itu
    # terjadi. Bila kata intinya cocok ke lebih dari satu daerah, tidak ada
    # yang dipilih; yang ada hanya keterangan bahwa sebutannya kurang jelas.
    if punya_daerah:
        penuh = [n for n in punya_daerah
                 if re.search(r"\b" + re.escape(n.lower().replace(".", "")) + r"\b",
                              t.replace(".", ""))]
        if len(penuh) == 1:
            saring["kategori"] = penuh[0]
            alasan.append(f'"{penuh[0].lower()}" → dibatasi ke {penuh[0]}')
        else:
            inti_ke = {}
            for nama in punya_daerah:
                inti = re.sub(r"^(provinsi|kab\.|kabupaten|kota)\s+", "",
                              nama.lower()).strip()
                if len(inti) > 3 and re.search(r"\b" + re.escape(inti) + r"\b", t):
                    inti_ke.setdefault(inti, []).append(nama)
            for inti, daftar in inti_ke.items():
                if len(daftar) == 1:
                    saring["kategori"] = daftar[0]
                    alasan.append(f'"{inti}" → dibatasi ke {daftar[0]}')
                else:
                    alasan.append(
                        f'"{inti}" cocok ke {len(daftar)} daerah '
                        f'({", ".join(sorted(daftar)[:4])}) — tidak dibatasi; '
                        f'sebutkan lengkap, mis. "Kota {inti.title()}"')
                break

    return {"saring": saring, "alasan": alasan}


def bersihkan(q: str) -> str:
    """Buang kata perintah dari pertanyaannya, sisakan istilah pokoknya.

    Kata seperti "yang masih berlaku" sudah menjadi penyaring; membiarkannya di
    dalam kueri membuat BM25 mencarinya sebagai istilah dan menaikkan pasal yang
    kebetulan memuat kata "berlaku" — yaitu hampir setiap ketentuan penutup.
    """
    t = q or ""
    for _, pola, _ in ISYARAT:
        t = re.sub(pola, " ", t, flags=re.I)
    t = RE_TAHUN_SARING.sub(" ", t)
    t = re.sub(r"\b(apa|apakah|bagaimana|berapa|mana|di ?mana|sebutkan|"
               r"tolong|carikan|cari|jelaskan|adakah|bisakah)\b", " ", t,
               flags=re.I)
    return re.sub(r"\s{2,}", " ", t).strip(" ?.,")


def jawab(conn, q: str, limit: int = 8, saring_tambahan=None) -> dict:
    """Temukan pasal yang menjawab satu pertanyaan, beserta tafsirnya."""
    from .pasal import cari_pasal

    daerah = [r[0] for r in conn.execute(
        "SELECT DISTINCT kategori FROM regulation "
        " WHERE kategori LIKE 'Provinsi%' OR kategori LIKE 'Kab%' "
        "    OR kategori LIKE 'Kota%'")]
    tafsir = baca_isyarat(q, daerah)
    saring = {**tafsir["saring"], **(saring_tambahan or {})}
    inti = bersihkan(q) or (q or "").strip()

    kw = {}
    if saring.get("jenis"):
        kw["jenis"] = saring["jenis"]
    if saring.get("kategori"):
        kw["kategori"] = saring["kategori"]
    if saring.get("sertakan_dicabut"):
        kw["sertakan_dicabut"] = True

    # Tahun disaring SESUDAH penelusuran, karena penelusuran bekerja pada unit
    # sedangkan tahun sifat dokumennya. Karena itu kolamnya harus diperlebar
    # lebih dahulu: menyaring 8 hasil teratas menurut tahun membuang hampir
    # semuanya dan mengembalikan nol untuk pertanyaan yang jawabannya ada.
    # "penyusutan harta berwujud di PMK terbitan 2023" mengembalikan nol
    # padahal PMK 72/2023 justru mengaturnya.
    ambil = limit * 12 if saring.get("tahun") else limit
    hasil = cari_pasal(conn, inti, limit=ambil, **kw)
    if saring.get("tahun"):
        hasil = [h for h in hasil if h.get("tahun") == saring["tahun"]][:limit]

    return {
        "pertanyaan": q,
        "istilah_dicari": inti,
        "tafsir": tafsir["alasan"],
        "saring": saring,
        "hasil": hasil,
        "jumlah": len(hasil),
        "cara_kerja": ("Ini penelusuran, bukan rangkuman: yang ditampilkan "
                       "bunyi pasal yang benar-benar ada di korpus, beserta "
                       "rujukannya. Tidak ada kalimat yang dikarang."),
    }


# --------------------------------------------------------------------------
# Sambungan LLM — MATI secara baku

LLM_AKTIF = False


def susun_naratif(temuan: dict) -> dict | None:
    """Rangkai temuan menjadi jawaban naratif. Mati sampai dinyalakan.

    Sengaja dipisah dari `jawab()`: yang mencari tidak boleh bergantung pada
    yang merangkai. Selama sakelar ini mati, seluruh modul bekerja tanpa
    memanggil layanan berbayar — dan bila nanti dinyalakan, yang berubah hanya
    lapisan penyajiannya, bukan apa yang ditemukan.

    Bila dinyalakan, dua hal wajib dijaga: rangkuman tidak boleh memuat rujukan
    ke pasal yang tidak ada di `temuan`, dan bunyi pasalnya tetap ditampilkan di
    bawah rangkumannya — supaya pembaca dapat memeriksa sendiri.
    """
    if not LLM_AKTIF:
        return None
    raise NotImplementedError(
        "Sambungan LLM belum dipasang. Nyalakan hanya setelah pemilik korpus "
        "memutuskan biaya dan risikonya, dan pasang penjaga rujukan.")
