"""Normalisasi nomor peraturan + ekstraksi rujukan dari teks.

Ini adalah komponen paling menentukan presisi seluruh knowledge graph: dua
dokumen yang sama harus selalu memetakan ke kunci yang sama, dan kutipan di
dalam badan peraturan harus menempel ke dokumen yang benar.

Bentuk nomor yang ditemukan di katalog DJP:
    PER-31/PJ/2009        PER-26/PJ./2009     KEP-545/PJ./2000
    212/PMK.07/2009       16/PMK.03/2010      147/KMK.05/1996
    PMK 43 TAHUN 2026     44 TAHUN 2026       UU 7 TAHUN 2021
    34/MK/EF.2/2026       10/KM.10/KF.4/2024  4/KM.10/2024
    SE-24/PJ/2018         PP 55 TAHUN 2022
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# Peta nama jenis dokumen (dari dropdown DJP) ke kode singkat.
JENIS_MAP = {
    "undang-undang": "UU",
    "undang undang": "UU",
    "undang-undang dasar": "UUD",
    "perpu": "PERPU",
    "peraturan pemerintah pengganti undang-undang": "PERPU",
    "peraturan pemerintah": "PP",
    "peraturan presiden": "PERPRES",
    "keputusan presiden": "KEPPRES",
    "instruksi presiden": "INPRES",
    "peraturan menteri keuangan": "PMK",
    "keputusan menteri keuangan": "KMK",
    "instruksi menteri keuangan": "IMK",
    "peraturan dirjen pajak": "PER",
    "keputusan dirjen pajak": "KEP",
    "instruksi dirjen pajak": "INS",
    "surat edaran dirjen pajak": "SE",
    "surat edaran": "SE",
    "peraturan dirjen bea dan cukai": "PERDJBC",
    "keputusan dirjen bea dan cukai": "KEPDJBC",
    "peraturan menteri dalam negeri": "PERMENDAGRI",
    "keputusan menteri dalam negeri": "KEPMENDAGRI",
    "peraturan menteri perdagangan": "PERMENDAG",
    "peraturan menteri perindustrian": "PERMENPERIN",
    "peraturan daerah": "PERDA",
    "pengumuman": "PENG",
    "nota dinas direktur jenderal pajak": "ND",
    # Bentuk yang muncul di katalog tetapi belum terpetakan sampai kini.
    # Semuanya berlabel jelas di situs; yang hilang hanya kode pendeknya.
    "keputusan bersama dirjen": "SKB-DJ",
    "keputusan bersama menteri": "SKB-M",
    "peraturan bersama menteri": "PB-M",
    "peraturan bersama dirjen": "PB-DJ",
    "surat dirjen bea dan cukai": "S-DJBC",
    "surat dirjen anggaran": "S-DJA",
    "surat dirjen perbendaharaan": "S-DJPB",
    "peraturan dirjen perbendaharaan": "PER-DJPB",
    "keputusan dirjen bea dan cukai": "KEPDJBC",
    "keputusan menteri perindustrian": "KEPMENPERIN",
    "keputusan menteri perdagangan": "KEPMENDAG",
    "keputusan menteri tenaga kerja": "KEPMENAKER",
    "keputusan ketua pengadian pajak": "KEP-PP",
    "keputusan ketua pengadilan pajak": "KEP-PP",
    "peraturan badan koordinasi dan penanaman modal": "PER-BKPM",
}

# Kata pembuka menentukan bentuk hukumnya; sisanya menyebut penerbitnya.
_BENTUK_AWAL = [
    ("peraturan bersama", "PB"), ("keputusan bersama", "SKB"),
    ("surat edaran", "SE"), ("nota dinas", "ND"),
    ("peraturan", "PER"), ("keputusan", "KEP"),
    ("instruksi", "INS"), ("surat", "S"), ("pengumuman", "PENG"),
]
_SINGKAT_PENERBIT = {
    "menteri keuangan": "MK", "dirjen pajak": "PJ",
    "dirjen bea dan cukai": "DJBC", "dirjen anggaran": "DJA",
    "dirjen perbendaharaan": "DJPB", "menteri dalam negeri": "DAGRI",
    "menteri perdagangan": "DAG", "menteri perindustrian": "PERIN",
    "menteri tenaga kerja": "NAKER", "presiden": "PRES",
}


def turunkan_kode(jenis: str | None) -> tuple[str | None, bool]:
    """Kode jenis dari labelnya, bila belum ada di peta.

    Mengembalikan (kode, dari_peta). Katalog DJP sesekali menambah bentuk baru,
    dan tanpa aturan penurunan dokumen itu akan berakhir tanpa kode — lalu
    lenyap dari setiap penyaring, pemetaan hierarki, dan pemeriksaan mutu yang
    bekerja atas kode. Hilang diam-diam lebih buruk daripada berkode kasar,
    asalkan yang kasar itu ditandai sebagai turunan sehingga dapat dirapikan.
    """
    t = re.sub(r"\s+", " ", (jenis or "").strip().lower())
    if not t:
        return None, False
    if t in JENIS_MAP:
        return JENIS_MAP[t], True
    for awal, kode in _BENTUK_AWAL:
        if t.startswith(awal):
            sisa = t[len(awal):].strip()
            for nama, singkat in _SINGKAT_PENERBIT.items():
                if nama in sisa:
                    return f"{kode}-{singkat}", False
            # Tanpa penerbit yang dikenali, ambil kata pertama yang berarti.
            # "menteri", "badan", dan "dirjen" ada di hampir semua label, jadi
            # tidak membedakan apa pun. Yang membedakan adalah nama lembaganya.
            kata = [w for w in re.findall(r"[a-z]+", sisa)
                    if w not in ("dan", "atas", "tentang", "republik",
                                 "indonesia", "jenderal", "direktur",
                                 "menteri", "badan", "dirjen", "ketua",
                                 "kepala", "lembaga")]
            return (f"{kode}-{kata[0][:6].upper()}" if kata else kode), False
    return None, False

# Prefiks yang muncul menempel pada nomor itu sendiri.
PREFIX_CODES = {
    "PER": "PER", "KEP": "KEP", "SE": "SE", "S": "S", "PENG": "PENG",
    "ND": "ND", "INS": "INS", "PMK": "PMK", "KMK": "KMK", "UU": "UU",
    "PP": "PP", "PERPRES": "PERPRES", "KEPPRES": "KEPPRES", "PERPU": "PERPU",
}

# Unit penerbit yang tertanam di tengah nomor (212/PMK.07/2009 -> PMK.07).
UNIT_TO_JENIS = {
    "PMK": "PMK", "KMK": "KMK", "PJ": None, "MK": "KMK", "KM": "KMK",
    "PB": "PB", "PMK.03": "PMK",
}

_ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7,
          "VIII": 8, "IX": 9, "X": 10}


@dataclass(frozen=True)
class RegID:
    key: str            # 'per-31-pj-2009'  (kunci join di DB)
    canonical: str      # 'PER-31/PJ/2009'  (untuk tampilan)
    jenis_code: str     # 'PER'
    nomor: str          # '31'
    unit: str           # 'PJ'
    tahun: int | None

    def __bool__(self) -> bool:
        return bool(self.key)


# Aksara lebar-nol dan penanda arah teks. Tidak terlihat, tidak tercetak, dan
# cukup untuk membuat "134/PMK.010/2020" gagal diurai — pola nomor menuntut
# empat digit di ujung, dan di ujungnya ada tujuh aksara tak tampak.
RE_TAK_TAMPAK = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060\ufeff\u00ad]")


def _clean(s: str) -> str:
    s = RE_TAK_TAMPAK.sub("", s or "")
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("–", "-").replace("—", "-").replace("’", "'")
    s = re.sub(r"\s+", " ", s).strip()
    return s


# Kode yang sah, dikumpulkan dari peta jenis dan daftar prefiks. Dipakai agar
# `jenis_to_code` menerima KODE selain label lengkap.
_KODE_SAH: set[str] = set()

RE_KODE_TURUNAN = re.compile(r"[A-Z]{2,12}(?:-[A-Z]{2,10})?")


def jenis_to_code(jenis: str | None) -> str | None:
    """Kode jenis dari label ATAU dari kode itu sendiri.

    Sebagian pemanggil menyerahkan label lengkap ("Peraturan Daerah"), sebagian
    lagi menyerahkan kodenya ("PERDA") — dan sebelum ini hanya yang pertama
    dikenali. Akibatnya setiap nomor berbentuk "1 Tahun 2026" yang jenisnya
    diserahkan sebagai kode gagal dinormalkan: 532 peraturan pajak daerah
    tertolak seluruhnya, dan kegagalannya tampak seperti nomor yang tidak dapat
    diurai, bukan seperti pemanggilan yang bentuknya berbeda.
    """
    if not jenis:
        return None
    if not _KODE_SAH:
        _KODE_SAH.update(JENIS_MAP.values())
        _KODE_SAH.update(PREFIX_CODES.values())
    # Label diperiksa LEBIH DAHULU. Sebagian label berbentuk seperti kode —
    # "Undang-Undang" lolos pola kode turunan huruf demi huruf — dan bila
    # bentuknya diperiksa dulu, labelnya tidak pernah sampai ke peta:
    # `jenis_to_code("Undang-Undang")` mengembalikan "UNDANG-UNDANG", sehingga
    # setiap rujukan undang-undang di dalam naskah membentuk kunci
    # `undang-undang-23-2014` yang tidak akan pernah bertemu `uu-23-2014` di
    # korpus. Rujukan paling sering dipakai justru yang paling mudah hilang.
    j = _clean(jenis).lower().rstrip(".")
    if j in JENIS_MAP:
        return JENIS_MAP[j]

    tegak = _clean(jenis).upper().rstrip(".")
    if tegak in _KODE_SAH:
        return tegak
    # Kode turunan (`turunkan_kode`) tidak pernah terdaftar di peta — "PER-BKPM",
    # "KEP-GUBERN", "S-DJBC". Bentuknya diterima, tetapi hanya bentuknya:
    # huruf besar, paling banyak satu segmen berimbuh, tanpa angka dan tanpa
    # spasi. Batas itu menolak potongan judul yang keliru terbawa sebagai jenis,
    # yang kalau lolos akan melahirkan kunci mengarang untuk dokumen nyata.
    if RE_KODE_TURUNAN.fullmatch(tegak):
        return tegak
    # Awalan TERPANJANG yang cocok, bukan yang pertama ditemui. Urutan sisipan
    # peta bukan urutan kekhususan: "peraturan pemerintah" mendahului
    # "peraturan pemerintah pengganti undang-undang", sehingga Perpu 2/2022 —
    # Cipta Kerja — terbaca sebagai PP 2/2022, dokumen yang sama sekali lain.
    # Kekeliruan ini tidak menghasilkan kunci yang gagal; ia menghasilkan kunci
    # yang benar untuk peraturan yang salah.
    cocok = [(len(name), code) for name, code in JENIS_MAP.items()
             if j.startswith(name)]
    return max(cocok)[1] if cocok else None


def _nomor_norm(nomor: str) -> str:
    """'014' dan '14' adalah nomor yang sama — samakan agar tidak jadi dua node.

    Nomor beranak ("15.2", "3.A") dirapikan pada kedua ruasnya. Penomoran itu
    lazim di daerah, untuk peraturan yang disisipkan setelah nomor terbit:
    Perbup Aceh Singkil 15.2/2020 bukan Perbup 15/2020 dan bukan 152/2020.
    """
    m = re.match(r"^0*(\d+)([A-Z]?)$", nomor or "")
    if m:
        return m.group(1) + m.group(2)
    m = re.match(r"^0*(\d+)\.0*(\w{1,3})$", nomor or "")
    return f"{m.group(1)}.{m.group(2)}" if m else nomor


def _mkkey(jenis_code: str, nomor: str, unit: str, tahun) -> str:
    nomor = _nomor_norm(nomor)
    parts = [jenis_code, nomor, unit or "", str(tahun or "")]
    key = "-".join(p for p in parts if p)
    return re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-")


def normalize_nomor(nomor_raw: str, jenis: str | None = None,
                    tahun: int | None = None) -> RegID | None:
    """Ubah nomor apa adanya menjadi identitas kanonik.

    Mengembalikan None bila nomor tidak dapat diurai — panggil pipeline LLM
    tier-1 untuk sisa kasus ini, jangan menebak di sini.
    """
    s = _clean(nomor_raw).upper().replace("NOMOR", " ").strip(" .,:")
    # Spasi di dalam nomor dirapatkan: naskah lama menulis "291/KMK. 05/1997"
    # dan "10 / PJ / 2009". Membiarkannya membuat nomor yang sama menghasilkan
    # dua kunci berbeda — dan dua simpul berbeda di graf untuk satu dokumen.
    s = re.sub(r"(?<=[.\-/])\s+(?=[A-Z0-9])", "", s)
    s = re.sub(r"\s+(?=[.\-/])", "", s)
    if not s:
        return None
    jc = jenis_to_code(jenis)

    # Bentuk 1: PREFIKS-NOMOR/UNIT/TAHUN  (PER-31/PJ/2009, PER-26/PJ./2009)
    # Nomor pokok boleh beranak juga pada bentuk berunit: "164.1/PMK.05/2007"
    # adalah PMK yang disisipkan setelah 164 terbit, bukan PMK 164 dan bukan
    # PMK 1641. Dukungan nomor anak sebelumnya hanya ada pada bentuk
    # "N TAHUN YYYY", sehingga 16 PMK gagal dinormalkan sama sekali.
    # Titik sesudah awalan ikut diterima: Keputusan Menteri Tenaga Kerja
    # menulis "KEP.289/MEN/XII/2011", bukan "KEP-289/...". Tanpa ini 17 dokumen
    # gagal diurai karena tanda baca, bukan karena nomornya.
    m = re.match(r"^([A-Z]{1,7})\s*[-/.]\s*(\d+(?:\.\d+)?[A-Z]?)\s*/\s*"
                 r"([A-Z0-9.\-/]+?)\s*/\s*(\d{4})$", s)
    if m:
        pre, no, unit, th = m.groups()
        code = PREFIX_CODES.get(pre, jc or pre)
        unit = unit.rstrip(".")
        no = _nomor_norm(no)
        return RegID(_mkkey(code, no, unit, th), f"{code}-{no}/{unit}/{th}",
                     code, no, unit, int(th))

    # Bentuk 2: NOMOR/UNIT[/SUBUNIT]/TAHUN  (212/PMK.07/2009, 10/KM.10/KF.4/2024)
    m = re.match(r"^(\d+(?:\.\d+)?[A-Z]?)\s*/\s*"
                 r"([A-Z0-9.\-]+(?:\s*/\s*[A-Z0-9.\-]+)*)\s*/\s*(\d{4})$", s)
    if m:
        no, unit, th = m.groups()
        unit = re.sub(r"\s*/\s*", "/", unit).rstrip(".")
        head = unit.split("/")[0].split(".")[0]
        code = UNIT_TO_JENIS.get(head) or jc or head
        no = _nomor_norm(no)
        return RegID(_mkkey(code, no, unit, th), f"{no}/{unit}/{th}",
                     code, no, unit, int(th))

    # Bentuk 3: [JENIS] NOMOR TAHUN YYYY  (PMK 43 TAHUN 2026, 44 TAHUN 2026, UU 7 TAHUN 2021)
    # Tanda hubung ikut diterima pada awalannya: sebagian kode jenis memang
    # bertanda hubung ("PER-GUBERN", "UU-DARURAT"), dan menutupnya membuat
    # "PER-GUBERN 14 TAHUN 2026" gagal diurai sementara "PERDA 9 TAHUN 2023"
    # berhasil — perbedaan yang tidak berasal dari nomornya sama sekali.
    # Nomor pokok boleh beranak ("15.2 TAHUN 2020"). Bentuk berunit
    # ("291/KMK.05/1997") tidak tersentuh: pola ini menuntut "TAHUN YYYY" di
    # ujungnya, yang tidak dimiliki nomor berunit.
    m = re.match(r"^(?:([A-Z.\-\s]{2,30})\s+)?(\d+(?:\.\w{1,3})?[A-Z]?)"
                 r"\s+TAHUN\s+(\d{4})$", s)
    if m:
        pre, no, th = m.groups()
        code = None
        if pre:
            pre = pre.strip(" -").replace(".", "")
            code = PREFIX_CODES.get(pre) or jenis_to_code(pre)
        code = code or jc
        if code:
            no = _nomor_norm(no)
            return RegID(_mkkey(code, no, "", th), f"{code} {no} TAHUN {th}",
                         code, no, "", int(th))

    # Bentuk 4: PREFIKS-NOMOR/TAHUN (SE-24/2018) — jarang, unit implisit.
    m = re.match(r"^([A-Z]{1,7})\s*-\s*(\d+[A-Z]?)\s*/\s*(\d{4})$", s)
    if m:
        pre, no, th = m.groups()
        code = PREFIX_CODES.get(pre, jc or pre)
        no = _nomor_norm(no)
        return RegID(_mkkey(code, no, "", th), f"{code}-{no}/{th}", code, no, "", int(th))

    # Bentuk 5: hanya nomor + tahun diketahui dari metadata.
    m = re.match(r"^(\d+[A-Z]?)$", s)
    if m and jc and tahun:
        no = m.group(1)
        return RegID(_mkkey(jc, no, "", tahun), f"{jc} {no} TAHUN {tahun}",
                     jc, no, "", int(tahun))

    return None


def kunci_daerah(jenis_code: str | None, nomor_raw: str, tahun: int | None,
                 daerah: str | None) -> RegID | None:
    """Identitas peraturan daerah — daerahnya ikut, karena harus.

    "Perda 1 Tahun 2024" bukan identitas: setiap kabupaten dan setiap provinsi
    punya satu. Pada 532 peraturan daerah yang pertama dicoba, 28 identitas
    bertabrakan dan 56 naskah akan saling menimpa — Bali dengan Buleleng, tanpa
    satu pun galat yang terlihat. Yang hilang bukan barisnya, melainkan naskah
    yang sudah tersimpan lebih dahulu.

    Daerah ditaruh pada medan `unit`, tempat yang memang sudah ada untuk
    pembeda semacam ini ("PJ" pada PER-31/PJ/2009). Jadi seluruh hilir —
    graf, analisis celah, penautan rujukan — langsung memahaminya tanpa
    perubahan skema.
    """
    dasar = normalize_nomor(nomor_raw, jenis_code, tahun)
    if not dasar:
        return None
    unit = re.sub(r"[^a-z0-9]+", "-", _clean(daerah or "").lower()).strip("-")
    if not unit:
        return dasar
    return RegID(_mkkey(dasar.jenis_code, dasar.nomor, unit, dasar.tahun),
                 f"{dasar.jenis_code} {dasar.nomor}/{(daerah or '').strip()}/"
                 f"{dasar.tahun}", dasar.jenis_code, dasar.nomor, unit,
                 dasar.tahun)


# ---------------------------------------------------------------------------
# Ekstraksi rujukan dari badan teks
# ---------------------------------------------------------------------------

_JENIS_ALT = (
    r"Undang-Undang(?:\s+Dasar)?|Peraturan\s+Pemerintah\s+Pengganti\s+Undang-Undang|"
    r"Peraturan\s+Pemerintah|Peraturan\s+Presiden|Keputusan\s+Presiden|"
    r"Peraturan\s+Menteri\s+Keuangan|Keputusan\s+Menteri\s+Keuangan|"
    r"Peraturan\s+Direktur\s+Jenderal\s+Pajak|Peraturan\s+Dirjen\s+Pajak|"
    r"Keputusan\s+Direktur\s+Jenderal\s+Pajak|Keputusan\s+Dirjen\s+Pajak|"
    r"Surat\s+Edaran\s+Direktur\s+Jenderal\s+Pajak|Surat\s+Edaran\s+Dirjen\s+Pajak"
)

# "Peraturan Menteri Keuangan Nomor 252/PMK.03/2008"
RE_REF_NAMED = re.compile(
    rf"(?P<jenis>{_JENIS_ALT})\s+"
    rf"(?:Republik\s+Indonesia\s+)?Nomor\s+"
    # Urutan alternasi penting: "N Tahun YYYY" harus dicoba lebih dulu, kalau
    # tidak regex serakah hanya menangkap "N" dan tahun hilang.
    rf"(?P<nomor>[0-9]+[A-Z]?\s+Tahun\s+\d{{4}}"
    rf"|[A-Z]{{2,7}}\s*-\s*\d+[A-Z]?\s*/\s*[A-Za-z0-9.\-]+\s*/\s*\d{{4}}"
    # Spasi boleh muncul TEPAT SESUDAH titik di kode unit: naskah lama menulis
    # "291/KMK. 05/1997". Tanpa kelonggaran ini pola berhenti di spasi dan
    # menghasilkan rujukan terpotong "291/KMK." — yang tidak akan pernah tertaut
    # ke dokumen mana pun, dan tampak sebagai kekosongan padahal salah tangkap.
    rf"|[0-9]+[A-Z]?(?:\s*/\s*[A-Za-z0-9\-]+(?:\.\s*[A-Za-z0-9]+)*)+)",
    re.IGNORECASE,
)

# "PER-31/PJ/2009", "SE-24/PJ/2018", "KEP-545/PJ./2000"
RE_REF_CODED = re.compile(
    r"\b(?P<nomor>(?:PER|KEP|SE|S|PENG|ND|INS)\s*-\s*\d+[A-Z]?\s*/\s*[A-Za-z0-9.\-]+\s*/\s*\d{4})\b"
)

# "252/PMK.03/2008" telanjang di tengah kalimat
RE_REF_BARE = re.compile(
    r"(?<![\w/])(?P<nomor>\d{1,4}[A-Z]?/[A-Z]{2,6}(?:\.\d{2,3})?(?:/[A-Za-z0-9.]+)?/(?:19|20)\d{2})(?![\w/])"
)


def extract_refs(text: str, default_tahun: int | None = None) -> list[dict]:
    """Kembalikan daftar rujukan {raw, span, regid} dari sepotong teks."""
    if not text:
        return []
    out: list[dict] = []
    seen_spans: list[tuple[int, int]] = []

    def _add(raw: str, span, jenis=None):
        for a, b in seen_spans:
            if not (span[1] <= a or span[0] >= b):   # tumpang tindih
                return
        rid = normalize_nomor(raw, jenis, default_tahun)
        seen_spans.append(span)
        out.append({"raw": _clean(raw), "span": span,
                    "regid": rid, "jenis_hint": jenis})

    for m in RE_REF_NAMED.finditer(text):
        _add(m.group("nomor"), m.span(), m.group("jenis"))
    for m in RE_REF_CODED.finditer(text):
        _add(m.group("nomor"), m.span())
    for m in RE_REF_BARE.finditer(text):
        _add(m.group("nomor"), m.span())

    out.sort(key=lambda r: r["span"][0])
    return out


RE_KOP = re.compile(
    r"\b(UNDANG-UNDANG(?:\s+DASAR)?|PERATURAN\s+PEMERINTAH\s+PENGGANTI\s+UNDANG-UNDANG|"
    r"PERATURAN\s+PEMERINTAH|PERATURAN\s+PRESIDEN|KEPUTUSAN\s+PRESIDEN|"
    r"INSTRUKSI\s+PRESIDEN|PERATURAN\s+MENTERI\s+KEUANGAN|KEPUTUSAN\s+MENTERI\s+KEUANGAN|"
    r"PERATURAN\s+DIREKTUR\s+JENDERAL\s+PAJAK|KEPUTUSAN\s+DIREKTUR\s+JENDERAL\s+PAJAK|"
    r"SURAT\s+EDARAN\s+DIREKTUR\s+JENDERAL\s+PAJAK|INSTRUKSI\s+DIREKTUR\s+JENDERAL\s+PAJAK)"
    # "NOMOR" dibuat OPSIONAL: banyak Peraturan Dirjen menulis kopnya sebagai
    # "PERATURAN DIREKTUR JENDERAL PAJAK PER-10/PJ/2025 TENTANG ..." tanpa kata
    # itu. Selama "NOMOR" diwajibkan, kop asli terlewat dan regex justru
    # menangkap kutipan pertama di bagian Menimbang — menghasilkan tuduhan
    # salah-identitas yang keliru.
    r"(?:\s+REPUBLIK\s+INDONESIA)?\s+(?:NOMOR\s+)?([^\n]{1,60}?)\s*(?:TENTANG|\n|$)",
    re.I)

_KOP_TO_CODE = {
    "undang-undang": "UU", "undang-undang dasar": "UUD",
    "peraturan pemerintah pengganti undang-undang": "PERPU",
    "peraturan pemerintah": "PP", "peraturan presiden": "PERPRES",
    "keputusan presiden": "KEPPRES", "instruksi presiden": "INPRES",
    "peraturan menteri keuangan": "PMK", "keputusan menteri keuangan": "KMK",
    "peraturan direktur jenderal pajak": "PER",
    "keputusan direktur jenderal pajak": "KEP",
    "surat edaran direktur jenderal pajak": "SE",
    "instruksi direktur jenderal pajak": "INS",
}


def identity_from_body(body_text: str, tahun: int | None = None) -> RegID | None:
    """Baca identitas dokumen dari kop suratnya sendiri.

    Metadata katalog DJP tidak selalu benar — ditemukan entri berjudul
    'PERUBAHAN ATAS PERATURAN PEMERINTAH NOMOR 55 TAHUN 2022' yang dilabeli
    'Instruksi Dirjen Pajak' dan 'Peraturan Presiden', padahal badan teksnya
    berbunyi 'PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 20 TAHUN 2026'.
    Kop surat adalah sumber yang lebih otoritatif dan dipakai untuk memeriksa
    silang identitas setiap dokumen.
    """
    if not body_text:
        return None
    # Kop surat SELALU mendahului "Menimbang". Membatasi pencarian sampai titik
    # itu mencegah regex menyeberang ke daftar dasar hukum, tempat nomor-nomor
    # peraturan lain bertebaran.
    kepala = body_text[:4000]
    batas = re.search(r"\bMenimbang\b", kepala, re.I)
    if batas:
        kepala = kepala[:batas.start()]
    m = RE_KOP.search(kepala)
    if not m:
        return None
    kop = re.sub(r"\s+", " ", m.group(1)).strip().lower()
    code = _KOP_TO_CODE.get(kop)
    nomor = _clean(m.group(2)).rstrip(",;: ")
    if not nomor:
        return None
    # Kode jenis dari kop diteruskan sebagai petunjuk. Tanpa ini, nomor bergaya
    # "20 TAHUN 2026" tidak dapat diurai sama sekali (bentuk itu memerlukan
    # jenis dokumen), sehingga identitas justru gagal diperiksa pada dokumen
    # yang penomorannya paling modern.
    rid = normalize_nomor(nomor, None, tahun)
    if rid is None and code:
        rid = normalize_nomor(f"{code} {nomor}", None, tahun)
    if rid and code and rid.jenis_code != code:
        # Kop lebih dipercaya untuk jenis; nomor & tahun dari hasil parsing.
        return RegID(_mkkey(code, rid.nomor, rid.unit, rid.tahun),
                     rid.canonical.replace(rid.jenis_code, code, 1)
                     if rid.canonical.startswith(rid.jenis_code) else rid.canonical,
                     code, rid.nomor, rid.unit, rid.tahun)
    return rid


def alias_key(rid: RegID | None) -> str | None:
    """Kunci longgar (jenis, nomor, tahun) tanpa unit penerbit.

    Dipakai sebagai jaring pengaman saat kutipan menulis 'PMK Nomor 212 Tahun
    2009' sementara dokumennya bernomor '212/PMK.07/2009'. Hanya boleh dipakai
    bila kunci ketat gagal DAN alias itu unik di korpus.
    """
    if not rid or not rid.tahun:
        return None
    return f"{rid.jenis_code}|{_nomor_norm(rid.nomor)}|{rid.tahun}".lower()


def urutan_perubahan(judul: str) -> int | None:
    """'PERUBAHAN KEDUA ATAS ...' -> 2. Berguna untuk merangkai rantai amandemen."""
    j = _clean(judul or "").upper()
    words = {"PERTAMA": 1, "KEDUA": 2, "KETIGA": 3, "KEEMPAT": 4, "KELIMA": 5,
             "KEENAM": 6, "KETUJUH": 7, "KEDELAPAN": 8, "KESEMBILAN": 9,
             "KESEPULUH": 10}
    m = re.search(r"PERUBAHAN\s+(" + "|".join(words) + r")?\s*ATAS", j)
    if not m:
        return None
    return words.get(m.group(1) or "", 1)


def lengkapi_kode_jenis(conn, terapkan: bool = False) -> dict:
    """Isi `jenis_code` yang kosong dari label jenisnya.

    Dokumen tanpa kode bukan dokumen yang identitasnya tidak diketahui — label
    jenisnya ada dan terbaca. Yang hilang hanya kode pendeknya, dan akibatnya
    dokumen itu lenyap dari setiap penyaring dan pemetaan yang bekerja atas
    kode. Memulihkannya tidak menambah pengetahuan baru; ia hanya berhenti
    membuang yang sudah diketahui.
    """
    rows = conn.execute(
        "SELECT id, jenis FROM regulation "
        " WHERE (jenis_code IS NULL OR jenis_code='') AND jenis IS NOT NULL "
        "   AND jenis<>''").fetchall()
    n = {"diperiksa": len(rows), "dari_peta": 0, "diturunkan": 0, "gagal": 0}
    ubah = []
    for r in rows:
        kode, dari_peta = turunkan_kode(r["jenis"])
        if not kode:
            n["gagal"] += 1
            continue
        n["dari_peta" if dari_peta else "diturunkan"] += 1
        ubah.append((kode, r["id"]))
    if terapkan and ubah:
        conn.executemany("UPDATE regulation SET jenis_code=? WHERE id=?", ubah)
        conn.commit()
    n["diterapkan"] = len(ubah) if terapkan else 0
    return n
