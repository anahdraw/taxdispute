"""Profil per bentuk dan tingkat peraturan.

Satu setelan OCR dan satu pola parsing untuk semua dokumen adalah asumsi yang
tidak tahan uji, karena bentuk peraturan Indonesia memang berbeda-beda:

- Undang-undang dan peraturan pemerintah bersusun penuh (BAB > Bagian >
  Paragraf > Pasal > ayat) dan hampir selalu punya Penjelasan terpisah.
- Peraturan Menteri Keuangan bersusun serupa tetapi lampirannya kerap berupa
  tabel dan formulir — bagian yang paling sering rusak saat di-OCR.
- Keputusan (KMK, KEP) umumnya tidak berpasal sama sekali; isinya diktum
  KESATU, KEDUA, KETIGA. Mencari "Pasal" di sana selalu nihil.
- Surat Edaran berbentuk narasi bernomor, tanpa pasal dan tanpa diktum.

Profil memberi tahu pengurai apa yang wajar diharapkan dari suatu bentuk, agar
ketiadaan sesuatu dapat dibedakan: tidak ada pasal di KMK itu normal, tidak ada
pasal di UU itu tanda pengurai gagal. Pembedaan itu yang membuat cacat parsing
bisa terdeteksi otomatis, bukan lolos diam-diam.

Untuk OCR, profil menentukan resolusi dan mode segmentasi halaman. Tabel dan
formulir butuh perlakuan berbeda dari paragraf mengalir; memaksakan `--psm 6`
(satu blok teks seragam) pada lampiran tabel adalah penyebab lazim angka
tercampur antar kolom.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Profil:
    nama: str
    # Tingkat yang wajar ada pada bentuk ini. Dipakai untuk menilai kewajaran
    # hasil parsing, bukan untuk membatasi apa yang boleh dikenali.
    tingkat: tuple[str, ...]
    ada_penjelasan: bool
    # Satuan operatif — yang dikutip orang saat merujuk aturan ini.
    satuan_kutipan: str
    dpi: int                  # resolusi render untuk OCR
    psm: str                  # mode segmentasi halaman tesseract
    ambang_vlm: float         # di bawah ini barulah rute berbayar dipertimbangkan
    catatan: str = ""


# --- profil per bentuk -----------------------------------------------------
_UU = Profil(
    nama="undang-undang / peraturan tingkat pusat",
    tingkat=("bab", "bagian", "paragraf", "pasal", "ayat", "huruf", "angka"),
    ada_penjelasan=True, satuan_kutipan="pasal", dpi=300, psm="6",
    ambang_vlm=0.75,
    catatan="teks mengalir, hampir selalu berlapis teks digital")

_PMK = Profil(
    nama="peraturan menteri / dirjen",
    tingkat=("bab", "bagian", "pasal", "ayat", "huruf", "angka"),
    ada_penjelasan=False, satuan_kutipan="pasal", dpi=300, psm="6",
    ambang_vlm=0.78,
    catatan="lampiran kerap berupa tabel dan formulir; diurai terpisah")

_KEPUTUSAN = Profil(
    nama="keputusan (KMK/KEP)",
    tingkat=("diktum", "huruf", "angka"),
    ada_penjelasan=False, satuan_kutipan="diktum", dpi=300, psm="6",
    ambang_vlm=0.72,
    catatan="tidak berpasal — isinya KESATU/KEDUA/KETIGA; sebagian besar "
            "hanya tersedia sebagai pindaian")

_EDARAN = Profil(
    nama="surat edaran",
    tingkat=("angka", "huruf"),
    ada_penjelasan=False, satuan_kutipan="angka", dpi=300, psm="6",
    ambang_vlm=0.72,
    catatan="narasi bernomor; bukan norma yang mengikat umum")

_LAMPIRAN_TABEL = Profil(
    nama="lampiran tabel / formulir",
    tingkat=(), ada_penjelasan=False, satuan_kutipan="baris",
    dpi=400, psm="4",
    ambang_vlm=0.88,
    catatan="psm 4 menjaga kolom tetap terpisah; ambang tinggi karena salah "
            "baca satu digit tarif berakibat langsung pada perhitungan")

_KONSOLIDASI = Profil(
    nama="naskah konsolidasi (SDSN)",
    tingkat=("bab", "bagian", "pasal", "ayat", "huruf", "angka"),
    ada_penjelasan=True, satuan_kutipan="pasal", dpi=300, psm="6",
    ambang_vlm=0.80,
    catatan="membawa tanda amandemen per ketentuan; penjelasan disisipkan "
            "langsung setelah tiap pasal")

# Bentuk yang tidak menyatakan apa pun tentang strukturnya. Dipakai sebagai
# baku, menggantikan `_PMK`.
#
# Bakunya dahulu profil peraturan menteri, yang menuntut adanya pasal — dan
# akibatnya setiap bentuk yang tidak ada di peta ini dituduh gagal diurai:
# 4.778 Surat Dirjen, 252 Pengumuman, Nota Dinas, Instruksi, Surat Kawat.
# Semuanya memang tidak berpasal. Sekitar 5.077 temuan palsu, cukup untuk
# menenggelamkan yang sungguhan — dan bagi pembaca laporan, 25% korpus tampak
# rusak padahal tidak.
#
# Bentuk yang tidak dikenali sebaiknya tidak dinilai sama sekali daripada
# dinilai dengan aturan bentuk lain yang kebetulan paling umum.
_TAK_DIKENAL = Profil(
    nama="bentuk belum dipetakan",
    tingkat=(), ada_penjelasan=False, satuan_kutipan="", dpi=300, psm="6",
    ambang_vlm=0.75,
    catatan="strukturnya belum diketahui; hasil penguraian tidak dinilai "
            "terhadap harapan apa pun")

PROFIL: dict[str, Profil] = {
    # --- berpasal ---
    "UU": _UU, "UU-DARURAT": _UU, "PERPU": _UU, "PP": _UU, "PERPRES": _UU,
    "PMK": _PMK, "PER": _PMK, "PERDIRJEN": _PMK, "PERDJBC": _PMK,
    "PER-DJPB": _PMK, "PER-BKPM": _PMK, "PB-M": _PMK, "PB-DJ": _PMK,
    "PERMENDAG": _PMK, "PERMENDAGRI": _PMK, "PERMENPERIN": _PMK,
    # peraturan daerah dan kepala daerah berstruktur pasal seperti PMK
    "PERDA": _PMK, "QANUN": _PMK, "PER-GUBERN": _PMK, "PER-BUPATI": _PMK,
    "PER-WALIKO": _PMK, "PER-WALI": _PMK, "PER-LAINNY": _PMK,
    "PER-KOORDI": _PMK, "PER-MAHKAM": _PMK, "PER-PERTAN": _PMK,
    "PER-AGRARI": _PMK,

    # --- berdiktum ---
    "KMK": _KEPUTUSAN, "KEP": _KEPUTUSAN, "KEPPRES": _KEPUTUSAN,
    "KEPDJBC": _KEPUTUSAN, "KEPMENDAG": _KEPUTUSAN,
    "KEPMENDAGRI": _KEPUTUSAN, "KEPMENPERIN": _KEPUTUSAN,
    "KEPMENAKER": _KEPUTUSAN, "KEP-PP": _KEPUTUSAN, "SKB-M": _KEPUTUSAN,
    "SKB-DJ": _KEPUTUSAN,
    "KEP-GUBERN": _KEPUTUSAN, "KEP-BUPATI": _KEPUTUSAN,
    "KEP-WALIKO": _KEPUTUSAN, "KEP-WALI": _KEPUTUSAN,
    "KEP-DPRD": _KEPUTUSAN, "KEP-PENDAP": _KEPUTUSAN,

    # --- narasi berbutir: surat, edaran, instruksi, pengumuman ---
    # Tidak berpasal dan tidak berdiktum. Menilainya dengan profil berpasal
    # adalah sebab tunggal dari ribuan temuan palsu.
    "SE": _EDARAN, "S": _EDARAN, "S-PJ": _EDARAN, "S-MK": _EDARAN,
    "S-KAWAT": _EDARAN, "S-DJBC": _EDARAN, "S-DJA": _EDARAN,
    "S-DJPB": _EDARAN, "SE-MK": _EDARAN, "SE-DJBC": _EDARAN,
    "SE-DJA": _EDARAN, "SE-DJPB": _EDARAN, "SE-BERSAM": _EDARAN,
    "SE-PJ": _EDARAN, "SE-PENGAD": _EDARAN, "SE-PENDAY": _EDARAN,
    "SE-BUMN": _EDARAN, "SE-GUBERN": _EDARAN,
    "PENG": _EDARAN, "ND": _EDARAN, "INS": _EDARAN, "INS-GUBERN": _EDARAN,
    "INPRES": _EDARAN, "IMK": _EDARAN,

    "SDSN": _KONSOLIDASI,
}

BAKU = _TAK_DIKENAL


def untuk(jenis_code: str | None, *, lampiran: bool = False) -> Profil:
    """Pilih profil dari kode jenis dokumen.

    Lampiran dinilai dengan profilnya sendiri, bukan profil induknya: lampiran
    tarif pada sebuah PMK lebih mirip tabel daripada mirip PMK.
    """
    if lampiran:
        return _LAMPIRAN_TABEL
    return PROFIL.get((jenis_code or "").upper(), BAKU)


def periksa_kewajaran(jenis_code: str | None, terhitung: dict) -> list[str]:
    """Bandingkan hasil parsing dengan yang wajar bagi bentuk ini.

    Mengembalikan daftar keganjilan. Kosong berarti hasil sesuai harapan.
    Gunanya bukan menolak hasil, melainkan menaikkannya ke antrean tinjauan —
    dokumen yang seharusnya berpasal tetapi tidak menghasilkan satu pun pasal
    hampir pasti gagal diurai, bukan benar-benar kosong.
    """
    p = untuk(jenis_code)
    ganjil = []
    # Bentuk yang belum dipetakan tidak dinilai terhadap harapan struktur apa
    # pun; hanya pemeriksaan panjang-lawan-unit di bawah yang tetap berlaku,
    # karena itu tidak mengandaikan bentuknya.
    if p.satuan_kutipan == "pasal" and not terhitung.get("pasal"):
        ganjil.append(f"{p.nama}: tidak ada satu pun pasal terurai")
    if p.satuan_kutipan == "diktum" and not (terhitung.get("pasal")
                                             or terhitung.get("diktum")):
        ganjil.append(f"{p.nama}: tidak ada diktum maupun pasal terurai")
    # Keputusan lama (KEP Dirjen era 1990-an) memakai pasal, bukan diktum.
    # Keduanya sah, jadi yang ditandai hanyalah bila tidak ada satu pun.
    if p.ada_penjelasan and terhitung.get("penjelasan") == 0:
        ganjil.append(f"{p.nama}: penjelasan tidak terpisah dari batang tubuh")
    # Sedikit unit hanya berarti cacat bila naskahnya panjang. Surat Edaran
    # sepanjang seribu aksara memang satu paragraf, dan menandainya ganjil
    # menghasilkan 2.000 temuan palsu yang menenggelamkan 17 yang sungguhan.
    # Ambang satu unit per 6.000 aksara sengaja longgar: yang dicari adalah
    # kegagalan mencolok, bukan penguraian yang kurang rapi.
    total = sum(v for v in terhitung.values() if isinstance(v, int))
    panjang = terhitung.get("panjang_naskah") or 0
    if panjang > 15000 and total < max(3, panjang // 6000):
        ganjil.append(
            f"naskah {panjang:,} aksara tetapi hanya {total} unit terurai — "
            f"kemungkinan besar gagal diurai".replace(",", "."))
    return ganjil
