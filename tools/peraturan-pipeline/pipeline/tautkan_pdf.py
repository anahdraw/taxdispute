"""Tautkan berkas PDF yang sudah ada di disk ke dokumennya.

296 dari 339 PDF di `data/pdf` tidak tercatat di mana pun. Bukan karena
unduhannya gagal — berkasnya ada dan utuh — melainkan karena jalur yang
mengunduhnya berbeda dari jalur yang mencatatnya:

* Lampiran DJP (`crawl.download_attachments`) menulis baris `attachment`
  beserta `local_path`. 43 berkas, semuanya tertaut.
* Konektor verifikasi (`peraturan_go_id`, `bpk`) mengunduh PDF hanya untuk
  mengambil teksnya, menamainya dari alamat sumber (`pgi-uu40-2004.pdf`), lalu
  membuang berkasnya dari ingatan. 296 berkas, tak satu pun tertaut.

Akibatnya bukan berkas yang hilang melainkan berkas yang tidak dapat ditemukan:
naskah resminya ada di disk, dan tidak ada satu pun kueri yang bisa
menghubungkannya dengan peraturannya.

Namanya masih memuat identitasnya, jadi tautannya dapat dipulihkan tanpa
mengunduh ulang apa pun. Yang tidak dapat diurai dilaporkan sebagai tidak dapat
diurai — bukan ditebak ke dokumen terdekat.
"""
from __future__ import annotations

import re
from pathlib import Path

from .config import PDF_DIR
from .normalize import jenis_to_code, normalize_nomor

# Penanda bagian dokumen pada nama berkas peraturan.go.id: "bt" batang tubuh,
# "pjl" penjelasan, "Per" perubahan, "Lamp" lampiran. Dibuang sebelum nomornya
# diurai, tetapi disimpan sebagai keterangan.
RE_EKOR = re.compile(r"(bt|pjl|per|lamp\.?|penjelasan|lampiran)$", re.I)
RE_JENIS_AWAL = re.compile(r"^([A-Za-z][A-Za-z.\-]*?)\s*[-/ ]?\s*(\d)")

# Singkatan yang dipakai peraturan.go.id pada nama berkasnya sendiri, dan yang
# tidak ada di peta jenis mana pun karena bukan sebutan resmi. Keduanya
# diperiksa terhadap korpus sebelum dicantumkan di sini: `pgi-kp10-1999.pdf`
# adalah Keppres 10/1999, `pgi-ps101-2006.pdf` adalah Perpres 101/2006 —
# keduanya ada, dengan judul yang cocok.
#
# Tanpa peta ini, `jenis_to_code("kp")` mengembalikan "KP" — kode berbentuk sah
# yang tidak menunjuk apa pun — dan 119 berkas resmi tetap yatim.
ALIAS_BERKAS = {"kp": "KEPPRES", "ps": "PERPRES"}


def _kandidat(nama: str) -> tuple[list[str], str]:
    """Bentuk-bentuk nomor yang mungkin dimaksud oleh satu nama berkas.

    Nama berkas BPK adalah sisa alamat ter-URL-encode, dan `_` di dalamnya
    ambigu: pada "18_PMK.01_2020" ia berarti garis miring, pada
    "2002_20KMK_20222" ia bagian dari "_20" yang berarti spasi. Menebak satu
    aturan membuat separuhnya salah — dan salahnya tidak kelihatan, karena
    hasilnya tetap berupa nomor yang masuk akal.

    Karena itu keduanya dicoba, dan yang menentukan bukan aturannya melainkan
    korpus: kandidat diterima hanya bila ia menunjuk dokumen yang memang ada.
    """
    s = Path(nama).stem
    s = re.sub(r"^(?:pgi|bpk)-", "", s)
    m = RE_EKOR.search(s.replace(" ", ""))
    bagian = ""
    if m:
        bagian = m.group(1).lower().rstrip(".")
        s = RE_EKOR.sub("", s).strip(" .-")

    # "+" adalah spasi ter-URL-encode, dan "NO"/"TH" singkatan yang dipakai
    # peraturan.go.id pada nama berkasnya: "PP+NO+147+TH+2000".
    s = s.replace("+", " ")
    s = re.sub(r"\bNO(?:MOR)?\b\.?", " ", s, flags=re.I)
    s = re.sub(r"\bTH\b\.?", " TAHUN ", s, flags=re.I)

    # Setiap "_" pada nama BPK bisa berarti dua hal: awal "%20" (spasi) atau
    # pemisah "/". Pada satu nama keduanya bisa muncul bersamaan —
    # "KMK_20458_KMK.04_2003" adalah "KMK 458/KMK.04/2003" — jadi satu aturan
    # tidak cukup, dan menebak aturannya membuat separuh nama salah tanpa
    # kelihatan salah. Semua kombinasi dibangkitkan; korpus yang memutuskan.
    bentuk = set(_kombinasi(s))
    return [re.sub(r"\s+", " ", b).strip(" ./-") for b in bentuk if b], bagian


BATAS_KOMBINASI = 64


def _kombinasi(s: str) -> list[str]:
    """Semua tafsir "_" pada satu nama, dibatasi supaya tidak meledak."""
    out = [s]
    if "_" not in s:
        return out
    kerja = [s]
    for _ in range(6):
        lanjut = []
        for x in kerja:
            i = x.find("_")
            if i < 0:
                continue
            if x[i:i + 3] == "_20":
                lanjut.append(x[:i] + " " + x[i + 3:])
            lanjut.append(x[:i] + "/" + x[i + 1:])
        kerja = lanjut[:BATAS_KOMBINASI]
        out.extend(kerja)
        if not kerja:
            break
    return [x for x in out if "_" not in x] or out


def _coba(c: str):
    """Semua tafsir yang mungkin atas satu bentuk nama, sebagai RegID."""
    out = []
    # Bentuk apa adanya: "18/PMK.01/2020", "2002 KMK 222" — penormal sudah
    # mengenali nomor berunit dan menurunkan kodenya sendiri.
    th = re.findall(r"(?:19|20)\d{2}", c)
    tahun = int(th[-1]) if th else None
    out.append(normalize_nomor(c, None, tahun))
    # Bentuk "kode menempel nomor": "uu40-2004", "pmk18-2020".
    m = RE_JENIS_AWAL.match(c)
    if m:
        awal = m.group(1).lower().strip(".-")
        kode = ALIAS_BERKAS.get(awal) or jenis_to_code(m.group(1))
        if kode:
            sisa = c[m.start(2):]
            m2 = re.fullmatch(
                r"(\d+[A-Za-z]?)\s*[-/ ]\s*((?:19|20)\d{2})", sisa)
            nomor = f"{m2.group(1)} TAHUN {m2.group(2)}" if m2 else sisa
            th2 = re.findall(r"(?:19|20)\d{2}", sisa)
            out.append(normalize_nomor(nomor, kode,
                                       int(th2[-1]) if th2 else tahun))
    # Bentuk angka menyatu: "PP0031994" → PP 3 TAHUN 1994. Nomor berimbuh nol
    # dan tahun berdempet tanpa pemisah apa pun.
    m4 = re.fullmatch(r"([A-Za-z][A-Za-z.\-]*?)0*(\d{1,4})((?:19|20)\d{2})", c)
    if m4:
        kode = (ALIAS_BERKAS.get(m4.group(1).lower().strip(".-"))
                or jenis_to_code(m4.group(1)))
        if kode:
            out.append(normalize_nomor(
                f"{m4.group(2)} TAHUN {m4.group(3)}", kode, int(m4.group(3))))
    # Bentuk "tahun di depan": "2002 KMK 222" → KMK 222 TAHUN 2002.
    m3 = re.fullmatch(r"((?:19|20)\d{2})\s+([A-Za-z][A-Za-z.\-]*)\s+(\d+)", c)
    if m3:
        kode = jenis_to_code(m3.group(2))
        if kode:
            out.append(normalize_nomor(
                f"{m3.group(3)} TAHUN {m3.group(1)}", kode, int(m3.group(1))))
    return [r for r in out if r]


def kandidat_regid(nama: str):
    """Semua identitas yang mungkin dimaksud satu nama berkas, plus bagiannya.

    Sengaja tidak memilih. Nama berkas ini adalah sisa alamat yang sudah
    kehilangan pemisahnya, jadi satu nama sering punya beberapa tafsir yang
    sama-sama masuk akal — "PP0031994" bisa PP 3/1994 atau PP 31994/1994.
    Yang memutuskan bukan aturan penamaan melainkan korpus, dan itu dikerjakan
    oleh pemanggilnya, yang tahu apa yang ada di sana.
    """
    kandidat, bagian = _kandidat(nama)
    out: dict[str, object] = {}
    for c in kandidat:
        for rid in _coba(c):
            out[rid.key] = rid
    return list(out.values()), bagian


def _longgar(conn, rid) -> list[str]:
    """Dokumen dengan bentuk, nomor, dan tahun sama — kode unit diabaikan.

    Nama berkas sering menghilangkan kode unit: "KMK 222 Tahun 2002" untuk
    dokumen yang kuncinya `kmk-222-kmk-03-2002`. Itu bukan dokumen lain, itu
    nomor yang sama ditulis lebih pendek.
    """
    if not (rid.jenis_code and rid.tahun and rid.nomor):
        return []
    return [r[0] for r in conn.execute(
        "SELECT id FROM regulation WHERE jenis_code=? AND tahun=? AND id LIKE ?",
        (rid.jenis_code, rid.tahun,
         f"{rid.jenis_code.lower()}-{rid.nomor.lower()}-%{rid.tahun}"))]


def pilih(conn, nama: str, ada: set[str]) -> tuple[str | None, str, str]:
    """Satu dokumen untuk satu nama berkas, atau alasan mengapa tidak.

    Dua lapis, yang kedua hanya dipakai bila yang pertama tidak menemukan apa
    pun: kunci persis lebih dahulu, lalu padanan tanpa kode unit. Keduanya
    menuntut **tepat satu** hasil — dua tafsir yang sama-sama menunjuk dokumen
    nyata berarti namanya tidak cukup membedakan, dan itu dilaporkan, bukan
    dipilih.
    """
    rids, bagian = kandidat_regid(nama)
    if not rids:
        return None, bagian, "tidak dapat diurai"

    persis = sorted({r.key for r in rids if r.key in ada})
    if len(persis) == 1:
        return persis[0], bagian, ""
    if len(persis) > 1:
        return None, bagian, f"ambigu: {', '.join(persis[:3])}"

    longgar = sorted({x for r in rids for x in _longgar(conn, r)})
    if len(longgar) == 1:
        return longgar[0], bagian, "longgar"
    if len(longgar) > 1:
        return None, bagian, f"ambigu tanpa unit: {', '.join(longgar[:3])}"
    return None, bagian, f"belum ada di korpus ({rids[0].key})"


def jalankan(conn, terapkan: bool = False, direktori=None) -> dict:
    d = Path(direktori or PDF_DIR)
    tercatat = {Path(r[0]).name for r in conn.execute(
        "SELECT local_path FROM attachment WHERE local_path IS NOT NULL")}
    ada = {r[0] for r in conn.execute("SELECT id FROM regulation")}

    n = {"berkas": 0, "sudah_tertaut": 0, "tertaut": 0, "tertaut_longgar": 0,
         "ambigu": 0, "belum_ada": 0, "tak_terurai": 0}
    baris, gagal = [], []
    for p in sorted(d.glob("*.pdf")):
        n["berkas"] += 1
        if p.name in tercatat:
            n["sudah_tertaut"] += 1
            continue
        kunci, bagian, sebab = pilih(conn, p.name, ada)
        if not kunci:
            kunci_sebab = ("ambigu" if sebab.startswith("ambigu")
                           else "tak_terurai" if sebab == "tidak dapat diurai"
                           else "belum_ada")
            n[kunci_sebab] += 1
            gagal.append(f"{p.name} — {sebab}")
            continue
        n["tertaut_longgar" if sebab == "longgar" else "tertaut"] += 1
        ket = "pdf sumber" + (f" — {bagian}" if bagian else "")
        baris.append((f"pdf-{p.stem}"[:32], kunci, None, str(p), ket))

    if terapkan and baris:
        with conn:
            conn.executemany(
                "INSERT OR REPLACE INTO attachment"
                "(id,reg_id,url,local_path,route) VALUES (?,?,?,?,?)", baris)
    n["contoh_gagal"] = gagal[:12]
    n["contoh"] = [(b[3].split("/")[-1], b[1]) for b in baris[:6]]
    return n
