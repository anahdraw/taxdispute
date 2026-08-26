"""Terbitan berkala: nilai kurs mingguan dan tarif bunga bulanan.

Dua jenis Keputusan Menteri Keuangan terbit berulang dengan bentuk yang tetap:

- **Nilai kurs** — mingguan, 1.358 penerbitan di korpus, memuat ~25 mata uang.
- **Tarif bunga sanksi administratif** — bulanan, 70 penerbitan, memuat lima
  lapisan tarif sanksi dan satu tarif imbalan.

Keduanya secara hukum adalah peraturan, tetapi secara penggunaan bukan. Tidak
ada yang membaca KMK kurs untuk mengetahui normanya; yang dicari adalah
**angkanya pada tanggal tertentu**. Menyimpannya sebagai 1.428 dokumen di
daftar peraturan — 23,7% dari seluruh korpus — membuat daftar itu nyaris tidak
dapat ditelusuri, sementara angka yang sebenarnya dicari tetap terkubur di dalam
teks.

Karena itu penerbitan berkala dipisahkan: dokumennya tetap utuh dan tetap dapat
dikutip, tetapi angkanya diurai ke tabel tersendiri dan ditelusuri lewat tanggal,
bukan lewat nomor keputusan.

Yang sengaja tidak dilakukan: menghapusnya dari tabel `regulation`. Kutipan
resmi tetap menunjuk nomor KMK-nya, jadi dokumennya harus tetap ada — yang
berubah hanya bagaimana ia ditemukan.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

SKEMA = """
CREATE TABLE IF NOT EXISTS terbitan (
  reg_id     TEXT PRIMARY KEY,
  jenis      TEXT NOT NULL,        -- kurs | tarif_bunga
  mulai      TEXT,                 -- ISO, awal masa berlaku angka
  sampai     TEXT,                 -- ISO, akhir masa berlaku angka
  canonical  TEXT, judul TEXT, url TEXT, tanggal TEXT,
  n_baris    INTEGER DEFAULT 0,
  catatan    TEXT                  -- alasan bila periode gagal dibaca
);
CREATE INDEX IF NOT EXISTS ix_terbitan_periode ON terbitan(jenis, mulai, sampai);

CREATE TABLE IF NOT EXISTS kurs_nilai (
  reg_id     TEXT NOT NULL, urut INTEGER,
  kode       TEXT,                 -- USD, AUD, ...
  mata_uang  TEXT,                 -- 'dolar Amerika Serikat'
  nilai      REAL,                 -- rupiah per satuan
  satuan     REAL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_kurs_reg ON kurs_nilai(reg_id);
CREATE INDEX IF NOT EXISTS ix_kurs_kode ON kurs_nilai(kode);

CREATE TABLE IF NOT EXISTS tarif_nilai (
  reg_id     TEXT NOT NULL, urut INTEGER,
  kelompok   TEXT,                 -- sanksi | imbalan
  dasar      TEXT,                 -- 'Pasal 19 ayat (1), ...'
  persen     REAL
);
CREATE INDEX IF NOT EXISTS ix_tarif_reg ON tarif_nilai(reg_id);
"""

BULAN = {"januari": 1, "februari": 2, "maret": 3, "april": 4, "mei": 5,
         "juni": 6, "juli": 7, "agustus": 8, "september": 9, "oktober": 10,
         "november": 11, "desember": 12}

# Periode ditulis dengan dua cara: pada judul tarif bunga ("PERIODE 1 FEBRUARI
# 2026 SAMPAI DENGAN 28 FEBRUARI 2026") dan pada diktum kurs ("berlaku untuk
# tanggal 7 Januari 2026 sampai dengan 13 Januari 2026"). Keduanya dibaca
# dengan pola yang sama karena bentuk tanggalnya identik.
# Tahun pada tanggal AWAL boleh tidak ada: penerbitan lama menulis "24
# DESEMBER SAMPAI DENGAN 30 DESEMBER 2007". Bila hilang, tahunnya diambil dari
# tanggal akhir — dan bila itu membuat awal > akhir, berarti periodenya
# melintasi pergantian tahun, sehingga tahun awal dikurangi satu.
RE_PERIODE = re.compile(
    r"(\d{1,2})\s+(" + "|".join(BULAN) + r")\s*(\d{4})?\s*"
    r"(?:s\.?d\.?|sampai\s+dengan|hingga)\s*"
    r"(\d{1,2})\s+(" + "|".join(BULAN) + r")\s+(\d{4})", re.I)

# "1. Rp. 16.754,00 untuk dolar Amerika Serikat (USD) 1,-" — angka, nama, kode.
# Tata letak tabel dari situs menaruh tiap sel pada barisnya sendiri, jadi
# spasi dan baris baru diperlakukan sama.
RE_KURS = re.compile(
    r"(\d{1,2})\.\s+Rp\.?\s*([\d.,]+)\s+untuk\s+(.+?)\s*\(([A-Z]{3})\)"
    r"\s*(\d[\d.,]*)\s*-?", re.S | re.I)

RE_TARIF = re.compile(
    r"(\d{1,2})\.\s+((?:Pasal|Ketentuan)[^\n]{0,220}?)\s+(\d{1,2},\d{1,2})\s*%", re.S)
RE_IMBALAN = re.compile(
    r"B\.\s*Imbalan\s+Bunga\s*:(.{0,900}?)(?:KEDUA|$)", re.S | re.I)
RE_IMBALAN_BARIS = re.compile(
    r"((?:Pasal)[^\n]{0,220}?)\s+(\d{1,2},\d{1,2})\s*%", re.S)

JUDUL_KURS = re.compile(r"NILAI\s+KURS\s+SEBAGAI\s+DASAR", re.I)
JUDUL_TARIF = re.compile(r"TARIF\s+BUNGA\s+SEBAGAI\s+DASAR", re.I)


def pastikan_skema(conn) -> None:
    import sqlite3
    try:
        conn.executescript(SKEMA)
        if "berkala" not in [r[1] for r in conn.execute(
                "PRAGMA table_info(regulation)")]:
            # Penanda pada regulation agar daftar peraturan dapat menyisihkan
            # terbitan berkala tanpa perlu mencocokkan judul setiap kali.
            conn.execute("ALTER TABLE regulation ADD COLUMN berkala TEXT")
        conn.commit()
    except sqlite3.OperationalError as e:
        if "readonly" not in str(e).lower():
            raise


def _tanggal(hari: str, bulan: str, tahun: str) -> str | None:
    try:
        return date(int(tahun), BULAN[bulan.lower()], int(hari)).isoformat()
    except (ValueError, KeyError):
        return None


def baca_periode(judul: str, badan: str) -> tuple[str | None, str | None, str]:
    """Baca masa berlaku angka — bukan masa berlaku keputusannya.

    Keputusan kurs ditetapkan beberapa hari sebelum angkanya berlaku, jadi
    tanggal penetapan tidak boleh dipakai sebagai tanggal kursnya. Selisih itu
    kecil tetapi cukup untuk membuat pencarian pada tanggal batas mengembalikan
    kurs minggu yang salah.
    """
    for sumber, nama in ((judul or "", "judul"), (badan or "", "diktum")):
        m = RE_PERIODE.search(sumber)
        if m:
            th_akhir = m.group(6)
            b = _tanggal(m.group(4), m.group(5), th_akhir)
            a = _tanggal(m.group(1), m.group(2), m.group(3) or th_akhir)
            if a and b and a > b:
                a = _tanggal(m.group(1), m.group(2), str(int(th_akhir) - 1))
            if a and b:
                return a, b, f"dibaca dari {nama}"
    return None, None, "periode tidak ditemukan di judul maupun diktum"


def _angka(s: str) -> float | None:
    """Baca angka yang ditulis dengan dua konvensi berbeda.

    Korpus memuat keduanya, kadang berselang tahun: "13.665,00" (Indonesia)
    dan "15,615.00" (Inggris). Menganggap salah satunya sebagai satu-satunya
    bentuk membuat kurs 2024 terbaca 1.561.500 kali lipat, atau tidak terbaca
    sama sekali. Aturannya: bila kedua pemisah muncul, yang PALING KANAN adalah
    pemisah desimal — itu berlaku pada kedua konvensi tanpa perlu menebak.
    """
    s = (s or "").strip().rstrip("-").rstrip(",").strip()
    if not s:
        return None
    if "." in s and "," in s:
        desimal = "," if s.rfind(",") > s.rfind(".") else "."
        ribuan = "." if desimal == "," else ","
        s = s.replace(ribuan, "").replace(desimal, ".")
    elif "," in s:
        # Koma tunggal: desimal hanya bila diikuti satu atau dua digit terakhir.
        s = s.replace(",", ".") if re.search(r",\d{1,2}$", s) else s.replace(",", "")
    elif "." in s and not re.search(r"\.\d{1,2}$", s):
        s = s.replace(".", "")          # titik tunggal sebagai pemisah ribuan
    try:
        return float(s)
    except ValueError:
        return None


def urai_kurs(badan: str) -> list[dict]:
    out, terlihat = [], set()
    for m in RE_KURS.finditer(badan or ""):
        kode = m.group(4).upper()
        if kode in terlihat:          # diktum kedua kadang mengulang tabelnya
            continue
        nilai = _angka(m.group(2))
        if nilai is None:
            continue
        terlihat.add(kode)
        out.append({"urut": int(m.group(1)), "kode": kode,
                    "mata_uang": re.sub(r"\s+", " ", m.group(3)).strip(),
                    "nilai": nilai, "satuan": _angka(m.group(5)) or 1})
    return out


def urai_tarif(badan: str) -> list[dict]:
    teks = badan or ""
    out = []
    batas_imbalan = teks.lower().find("b. imbalan")
    sanksi = teks[:batas_imbalan] if batas_imbalan > 0 else teks
    for m in RE_TARIF.finditer(sanksi):
        p = _angka(m.group(3))
        if p is None:
            continue
        out.append({"urut": int(m.group(1)), "kelompok": "sanksi",
                    "dasar": re.sub(r"\s+", " ", m.group(2)).strip(),
                    "persen": p})
    mi = RE_IMBALAN.search(teks)
    if mi:
        for i, m in enumerate(RE_IMBALAN_BARIS.finditer(mi.group(1)), 1):
            p = _angka(m.group(2))
            if p is None:
                continue
            out.append({"urut": i, "kelompok": "imbalan",
                        "dasar": re.sub(r"\s+", " ", m.group(1)).strip(),
                        "persen": p})
    return out


def bangun(conn, progress=print) -> dict:
    """Urai semua penerbitan berkala ke tabel angkanya."""
    pastikan_skema(conn)
    rows = conn.execute(
        "SELECT id, canonical, judul, url, tanggal, body_text FROM regulation "
        "WHERE judul LIKE '%NILAI KURS%' OR judul LIKE '%TARIF BUNGA%'"
    ).fetchall()

    n = {"kurs": 0, "tarif_bunga": 0, "baris_kurs": 0, "baris_tarif": 0,
         "tanpa_periode": 0, "tanpa_angka": 0}
    with conn:
        conn.execute("DELETE FROM terbitan")
        conn.execute("DELETE FROM kurs_nilai")
        conn.execute("DELETE FROM tarif_nilai")
        conn.execute("UPDATE regulation SET berkala=NULL")
        for r in rows:
            judul, badan = r["judul"] or "", r["body_text"] or ""
            if JUDUL_KURS.search(judul):
                jenis = "kurs"
            elif JUDUL_TARIF.search(judul):
                jenis = "tarif_bunga"
            else:
                # Judul memuat frasanya tetapi bukan penerbitan berkala —
                # misalnya KMK yang MENGUBAH keputusan tarif bunga. Dokumen
                # semacam itu tetap di daftar peraturan biasa.
                continue

            mulai, sampai, catatan = baca_periode(judul, badan)
            baris = urai_kurs(badan) if jenis == "kurs" else urai_tarif(badan)
            if not mulai:
                n["tanpa_periode"] += 1
            if not baris:
                n["tanpa_angka"] += 1

            conn.execute(
                "INSERT OR REPLACE INTO terbitan"
                "(reg_id,jenis,mulai,sampai,canonical,judul,url,tanggal,"
                " n_baris,catatan) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (r["id"], jenis, mulai, sampai, r["canonical"], judul,
                 r["url"], r["tanggal"], len(baris), catatan))
            conn.execute("UPDATE regulation SET berkala=? WHERE id=?",
                         (jenis, r["id"]))
            n[jenis] += 1

            if jenis == "kurs":
                conn.executemany(
                    "INSERT INTO kurs_nilai(reg_id,urut,kode,mata_uang,nilai,"
                    "satuan) VALUES (?,?,?,?,?,?)",
                    [(r["id"], b["urut"], b["kode"], b["mata_uang"],
                      b["nilai"], b["satuan"]) for b in baris])
                n["baris_kurs"] += len(baris)
            else:
                conn.executemany(
                    "INSERT INTO tarif_nilai(reg_id,urut,kelompok,dasar,persen)"
                    " VALUES (?,?,?,?,?)",
                    [(r["id"], b["urut"], b["kelompok"], b["dasar"],
                      b["persen"]) for b in baris])
                n["baris_tarif"] += len(baris)
    return n


# --- pembacaan -------------------------------------------------------------
def pada(conn, jenis: str, tanggal: str) -> dict:
    """Penerbitan yang angkanya berlaku pada tanggal tertentu.

    Bila tanggalnya jatuh di celah antar-penerbitan — dan celah memang ada,
    karena tidak semua minggu terarsip — yang dikembalikan adalah penerbitan
    terdekat SEBELUMNYA, disertai keterangan bahwa ia sudah lewat masa. Diam-
    diam menampilkan angka dari periode lain tanpa mengatakannya adalah cara
    paling halus untuk menyesatkan.
    """
    pastikan_skema(conn)
    tepat = conn.execute(
        "SELECT * FROM terbitan WHERE jenis=? AND mulai<=? AND sampai>=? "
        "ORDER BY mulai DESC LIMIT 1", (jenis, tanggal, tanggal)).fetchone()
    if tepat:
        return {"terbitan": dict(tepat), "tepat": True, "baris": _baris(conn, tepat),
                "keterangan": None}

    sebelum = conn.execute(
        "SELECT * FROM terbitan WHERE jenis=? AND mulai IS NOT NULL AND mulai<=? "
        "ORDER BY mulai DESC LIMIT 1", (jenis, tanggal)).fetchone()
    if not sebelum:
        return {"terbitan": None, "tepat": False, "baris": [],
                "keterangan": "Tidak ada penerbitan pada atau sebelum tanggal ini "
                              "di dalam korpus."}
    return {"terbitan": dict(sebelum), "tepat": False,
            "baris": _baris(conn, sebelum),
            "keterangan": f'Tidak ada penerbitan yang mencakup {tanggal}. Yang '
                          f'ditampilkan adalah penerbitan terdekat sebelumnya '
                          f'({sebelum["mulai"]} s.d. {sebelum["sampai"]}), dan '
                          f'masa berlakunya sudah lewat.'}


def _baris(conn, t) -> list[dict]:
    if t["jenis"] == "kurs":
        return [dict(x) for x in conn.execute(
            "SELECT urut,kode,mata_uang,nilai,satuan FROM kurs_nilai "
            "WHERE reg_id=? ORDER BY urut", (t["reg_id"],))]
    return [dict(x) for x in conn.execute(
        "SELECT urut,kelompok,dasar,persen FROM tarif_nilai "
        "WHERE reg_id=? ORDER BY kelompok DESC, urut", (t["reg_id"],))]


def tetangga(conn, jenis: str, mulai: str | None) -> dict:
    """Penerbitan sebelum dan sesudah — untuk tombol geser tanggal."""
    if not mulai:
        return {}
    sb = conn.execute(
        "SELECT reg_id,mulai,sampai,canonical FROM terbitan "
        "WHERE jenis=? AND mulai<? ORDER BY mulai DESC LIMIT 1",
        (jenis, mulai)).fetchone()
    ss = conn.execute(
        "SELECT reg_id,mulai,sampai,canonical FROM terbitan "
        "WHERE jenis=? AND mulai>? ORDER BY mulai LIMIT 1",
        (jenis, mulai)).fetchone()
    return {"sebelumnya": dict(sb) if sb else None,
            "berikutnya": dict(ss) if ss else None}


def rentang(conn, jenis: str) -> dict:
    """Batas tanggal yang tersedia, untuk menyetel penggeser."""
    pastikan_skema(conn)
    r = conn.execute(
        "SELECT MIN(mulai) awal, MAX(sampai) akhir, COUNT(*) n, "
        "       SUM(mulai IS NULL) tanpa_periode "
        "  FROM terbitan WHERE jenis=?", (jenis,)).fetchone()
    return dict(r) if r else {}


def deret(conn, kode: str, dari: str, sampai: str, batas: int = 400) -> list[dict]:
    """Deret satu mata uang antar waktu — untuk melihat pergerakannya."""
    pastikan_skema(conn)
    return [dict(r) for r in conn.execute(
        """SELECT t.mulai, t.sampai, t.canonical, k.nilai, k.satuan
             FROM kurs_nilai k JOIN terbitan t ON t.reg_id=k.reg_id
            WHERE k.kode=? AND t.mulai>=? AND t.mulai<=?
            ORDER BY t.mulai LIMIT ?""", (kode.upper(), dari, sampai, batas))]


def mata_uang(conn) -> list[dict]:
    pastikan_skema(conn)
    return [dict(r) for r in conn.execute(
        """SELECT kode, MAX(mata_uang) nama, COUNT(*) n
             FROM kurs_nilai GROUP BY kode ORDER BY n DESC, kode""")]
