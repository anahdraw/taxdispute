"""Analisis celah: apa yang ada di katalog lain tetapi belum ada di korpus.

Ortax memuat 20.722 dokumen, korpus kita 6.029. Selisih 14.693 itu **bukan**
jumlah peraturan pajak yang kita lewatkan, dan menyajikannya begitu akan
menyesatkan. Sebagian besar selisih adalah lingkup yang memang lebih luas:
bea masuk, cukai, perdagangan, PNBP, OJK, perindustrian.

Karena itu celah dihitung per bentuk, bukan sebagai satu angka:

- **Bentuk yang kita bawa** (PMK, PER, KMK, PP, UU, …) — di sini selisih berarti
  sungguh-sungguh: dokumen yang seharusnya ada di korpus tetapi tidak ada.
- **Bentuk yang tidak kita bawa** (Peraturan OJK, Peraturan Bank Indonesia, …) —
  di sini selisih hanya menegaskan bahwa lingkupnya berbeda, bukan bahwa ada
  yang hilang.

Pembedaan itu yang menentukan apakah angka celah menunjuk pekerjaan atau hanya
menakut-nakuti.

**Batas yang dijaga.** Yang dibandingkan hanya metadata dari daftar publik.
Naskah lengkap di Ortax berada di balik langganan berbayar dan tidak diambil.
Hasil modul ini adalah daftar "apa yang perlu dicari", bukan salinan isinya.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .normalize import normalize_nomor, turunkan_kode

SKEMA = """
CREATE TABLE IF NOT EXISTS katalog_luar (
  sumber      TEXT NOT NULL,
  sumber_id   TEXT NOT NULL,
  kunci       TEXT,            -- kunci ternormalkan untuk dipadankan
  jenis_code  TEXT,
  jenis_teks  TEXT,
  nomor_teks  TEXT,
  tahun       INTEGER,
  judul       TEXT,
  tanggal     TEXT,
  kategori    TEXT,
  url         TEXT,
  angka_pokok INTEGER,       -- angka pertama pada nomor, untuk pemadanan longgar
  ada_di_kita INTEGER DEFAULT 0,
  PRIMARY KEY (sumber, sumber_id)
);
CREATE INDEX IF NOT EXISTS ix_luar_kunci ON katalog_luar(kunci);
CREATE INDEX IF NOT EXISTS ix_luar_celah ON katalog_luar(ada_di_kita, jenis_code);
"""


def pastikan_skema(conn) -> None:
    import sqlite3
    try:
        conn.executescript(SKEMA)
        conn.commit()
    except sqlite3.OperationalError as e:
        if "readonly" not in str(e).lower():
            raise


def _tahun(nomor: str | None, tanggal: str | None) -> int | None:
    """Tahun peraturan — dari bagian TERAKHIR nomornya, bukan yang pertama.

    "S-2099/PJ.51/1995" memuat dua rangkaian empat digit, dan yang pertama
    adalah nomor urutnya, bukan tahunnya. Mengambil yang pertama menghasilkan
    tahun 2099 — cukup masuk akal untuk lolos pemeriksaan sepintas, cukup salah
    untuk merusak setiap pemadanan dan pengurutan yang memakainya.
    """
    kandidat = re.findall(r"(?:19|20)\d{2}", nomor or "")
    if kandidat:
        return int(kandidat[-1])
    return int(tanggal[:4]) if tanggal and tanggal[:4].isdigit() else None


def muat(conn, berkas: str | Path, sumber: str = "ortax") -> dict:
    """Masukkan katalog luar dan padankan dengan korpus.

    Pemadanan memakai kunci yang sama dengan korpus (`normalize_nomor`), bukan
    perbandingan teks. Katalog berbeda menulis nomor yang sama dengan cara
    berbeda — "PER - 8/PJ/2026" dan "PER-8/PJ/2026" — dan membandingkannya
    sebagai teks akan melaporkan setiap dokumen sebagai hilang.
    """
    pastikan_skema(conn)
    data = json.loads(Path(berkas).read_text("utf-8"))

    n = {"dibaca": len(data), "berkunci": 0, "tanpa_kunci": 0}
    baris = []
    for d in data:
        kode, _ = turunkan_kode(d.get("jenis_teks"))
        tahun = _tahun(d.get("nomor_teks"), d.get("tanggal"))
        nomor = (d.get("nomor_teks") or "").strip()
        # Ortax menulis nomor sederhana tanpa awalan jenis ("43 Tahun 2026"),
        # sedangkan korpus menyimpannya lengkap ("PMK 43 TAHUN 2026") — dan
        # penormal memang menuntut awalan itu untuk membentuk kunci. Tanpa
        # penambahan ini, setiap PMK, PP, dan UU bernomor sederhana dilaporkan
        # hilang padahal ada. Kesalahannya tidak terlihat sebagai galat; ia
        # tampak sebagai celah yang meyakinkan.
        if kode and re.match(r"^\d+\s*(?:TAHUN|Tahun|tahun)\s*\d{4}$", nomor):
            nomor = f"{kode} {nomor}"
        rid = normalize_nomor(nomor, kode, tahun)
        kunci = rid.key if rid else None
        n["berkunci" if kunci else "tanpa_kunci"] += 1
        pokok = re.match(r"^\D*(\d+)", d.get("nomor_teks") or "")
        baris.append((sumber, str(d.get("sumber_id")), kunci, kode,
                      d.get("jenis_teks"), d.get("nomor_teks"), tahun,
                      d.get("judul"), d.get("tanggal"), d.get("kategori"),
                      d.get("url"), int(pokok.group(1)) if pokok else None))

    with conn:
        conn.execute("DELETE FROM katalog_luar WHERE sumber=?", (sumber,))
        conn.executemany(
            "INSERT OR REPLACE INTO katalog_luar"
            "(sumber,sumber_id,kunci,jenis_code,jenis_teks,nomor_teks,tahun,"
            " judul,tanggal,kategori,url,angka_pokok) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", baris)
        # Padankan lewat kunci kanonik, lalu lewat nomor+tahun sebagai cadangan
        # untuk dokumen yang kuncinya gagal dibentuk salah satu pihak.
        conn.execute(
            "UPDATE katalog_luar SET ada_di_kita=1 WHERE sumber=? AND kunci IN "
            "(SELECT id FROM regulation)", (sumber,))
        conn.execute(
            """UPDATE katalog_luar SET ada_di_kita=1
                WHERE sumber=? AND ada_di_kita=0 AND jenis_code IS NOT NULL
                  AND EXISTS (SELECT 1 FROM regulation r
                               WHERE r.jenis_code=katalog_luar.jenis_code
                                 AND r.tahun=katalog_luar.tahun
                                 AND REPLACE(REPLACE(LOWER(r.nomor_raw),' ',''),'.','')
                                   = REPLACE(REPLACE(LOWER(katalog_luar.nomor_teks),' ',''),'.',''))""",
            (sumber,))
        # Lapis ketiga: dua konvensi penomoran untuk dokumen yang sama.
        # Ortax menulis "PER-1/PJ/2024", katalog DJP menyimpan "PER 1 TAHUN
        # 2024" — nomor pokok dan tahunnya sama, unitnya saja ditulis berbeda.
        # Tanpa lapis ini setiap PER Dirjen berkonvensi lama dilaporkan hilang
        # padahal ada.
        #
        # Dikerjakan di Python, bukan SQL: aturannya menuntut pembacaan pola
        # nomor, dan menuliskannya sebagai rangkaian SUBSTR/INSTR menghasilkan
        # kueri yang tidak dapat diperiksa siapa pun — termasuk yang menulisnya.
        conn.executemany(
            "UPDATE katalog_luar SET ada_di_kita=1 WHERE sumber=? AND sumber_id=?",
            [(sumber, sid) for sid in _padan_longgar(conn, sumber)])
    n["cocok"] = conn.execute(
        "SELECT COUNT(*) FROM katalog_luar WHERE sumber=? AND ada_di_kita=1",
        (sumber,)).fetchone()[0]
    n["celah"] = n["dibaca"] - n["cocok"]
    return n


# Nomor korpus yang benar-benar tanpa kode unit: "PER 1 TAHUN 2024".
# Pemadanan longgar dibatasi ke bentuk ini saja. Membukanya untuk nomor berunit
# akan menyamakan "37/MK/EF.2/2026" dengan "37/KM.10/2026" — nomor pokok dan
# tahun sama, dokumennya berlainan.
# Awalan jenis boleh ada, boleh tidak: korpus menyimpan sebagian sebagai
# "PER 1 TAHUN 2024" dan sebagian lagi hanya "1 TAHUN 2024". Jenisnya diambil
# dari kolom `jenis_code` yang memang berwenang, bukan ditebak dari nomornya.
RE_POLOS = re.compile(r"^(?:[A-Z.\-]+\s+)?(\d+)\s+TAHUN\s+(\d{4})$", re.I)


def _padan_longgar(conn, sumber: str) -> list[str]:
    """Padankan lewat (jenis, angka pokok, tahun) untuk nomor tanpa unit."""
    indeks = {}
    for r in conn.execute(
            "SELECT jenis_code, nomor_raw, tahun FROM regulation "
            " WHERE jenis_code IS NOT NULL AND nomor_raw IS NOT NULL"):
        m = RE_POLOS.match((r[1] or "").strip())
        if m:
            indeks[(r[0].upper(), int(m.group(1)), int(m.group(2)))] = True

    cocok = []
    for r in conn.execute(
            "SELECT sumber_id, jenis_code, angka_pokok, tahun FROM katalog_luar "
            " WHERE sumber=? AND ada_di_kita=0 AND jenis_code IS NOT NULL "
            "   AND angka_pokok IS NOT NULL AND tahun IS NOT NULL", (sumber,)):
        if (r[1].upper(), int(r[2]), int(r[3])) in indeks:
            cocok.append(r[0])
    return cocok


# Kategori yang menandai dokumen benar-benar perpajakan. Ortax menandai
# dokumen kepabeanan, anggaran, dan organisasi sebagai "Lainnya", dan tanpa
# penyaring ini celah PMK terbaca 1.057 padahal 959 di antaranya bukan aturan
# pajak sama sekali. Angka yang menakut-nakuti tanpa menunjuk pekerjaan lebih
# buruk daripada tidak ada angka.
KATEGORI_PAJAK = ("PPh", "PPN", "KUP", "PBB", "BPHTB", "Bea Meterai", "PPSP")


# Bentuk yang diterbitkan otoritas pajak. Dokumen semacam ini adalah peraturan
# perpajakan menurut penerbitnya, apa pun label topik yang diberikan katalog
# luar. Ortax menandai PER-12/PJ/2017 sebagai "Lainnya" padahal judulnya
# "pencabutan Peraturan Direktur Jenderal Pajak Nomor PER-17/PJ/2013" — menyaring
# berdasarkan label itu membuang peraturan pajak yang jelas-jelas pajak.
JENIS_OTORITAS_PAJAK = ("PER", "KEP", "SE", "PENG", "INS", "ND", "S-PJ")

# Bentuk peraturan daerah. Katalog Ortax seluruhnya berlingkup perpajakan, jadi
# Perda dan Pergub yang ada di sana adalah peraturan pajak daerah — dan
# taksonomi kategorinya (PPh, PPN, KUP, PBB, BPHTB) memang tidak punya tempat
# untuk PDRD, sehingga 332 dari 391 Perda berakhir bertanda "Lainnya" padahal
# judulnya berbunyi "tata cara pemungutan pajak barang dan jasa tertentu" dan
# "nilai jual objek pajak". Menyaringnya berdasarkan kategori membuang seluruh
# lapisan pajak daerah dari korpus.
JENIS_PAJAK_DAERAH = ("PERDA", "PER-GUBERN", "KEP-GUBERN", "PER-BUPATI",
                      "PER-WALIKO", "PERMENDAGRI", "KEPMENDAGRI")


def _saring_pajak() -> str:
    kategori = " OR ".join(f"kategori LIKE '%{k}%'" for k in KATEGORI_PAJAK)
    penerbit = " OR ".join(
        f"jenis_code='{k}'"
        for k in JENIS_OTORITAS_PAJAK + JENIS_PAJAK_DAERAH)
    return f"(({kategori}) OR ({penerbit}))"


def ringkas(conn, sumber: str = "ortax", hanya_pajak: bool = False) -> dict:
    """Celah per bentuk, dipisahkan menurut apakah bentuk itu kita bawa."""
    pastikan_skema(conn)
    tambahan = (" AND " + _saring_pajak()) if hanya_pajak else ""
    kita = {r[0] for r in conn.execute(
        "SELECT DISTINCT jenis_code FROM regulation WHERE jenis_code IS NOT NULL")}

    rows = conn.execute(
        """SELECT COALESCE(jenis_code,'(tak terpetakan)') kode,
                  MAX(jenis_teks) teks, COUNT(*) n,
                  SUM(ada_di_kita) cocok, MIN(tahun) th_awal, MAX(tahun) th_akhir
             FROM katalog_luar WHERE sumber=?{tambahan}
            GROUP BY kode ORDER BY (COUNT(*)-SUM(ada_di_kita)) DESC""".format(
            tambahan=tambahan), (sumber,)).fetchall()

    dalam, luar = [], []
    for r in rows:
        d = {"kode": r["kode"], "jenis": r["teks"], "di_sumber": r["n"],
             "sudah_ada": r["cocok"], "celah": r["n"] - r["cocok"],
             "tahun_awal": r["th_awal"], "tahun_akhir": r["th_akhir"]}
        (dalam if r["kode"] in kita else luar).append(d)

    return {
        "sumber": sumber,
        "hanya_pajak": hanya_pajak,
        "total_di_sumber": sum(x["di_sumber"] for x in dalam + luar),
        "dalam_lingkup": {
            "bentuk": dalam,
            "celah": sum(x["celah"] for x in dalam),
            "sudah_ada": sum(x["sudah_ada"] for x in dalam)},
        "luar_lingkup": {
            "bentuk": luar,
            "celah": sum(x["celah"] for x in luar)},
    }


def daftar(conn, sumber: str = "ortax", jenis: str | None = None,
           tahun_min: int | None = None, limit: int = 200,
           hanya_pajak: bool = False) -> dict:
    """Dokumen yang ada di katalog luar tetapi belum ada di korpus."""
    pastikan_skema(conn)
    where = ["sumber=?", "ada_di_kita=0"]
    arg: list = [sumber]
    if hanya_pajak:
        where.append(_saring_pajak())
    if jenis:
        where.append("jenis_code=?"); arg.append(jenis)
    if tahun_min:
        where.append("tahun>=?"); arg.append(int(tahun_min))
    w = " AND ".join(where)
    total = conn.execute(
        f"SELECT COUNT(*) FROM katalog_luar WHERE {w}", arg).fetchone()[0]
    rows = conn.execute(
        f"""SELECT jenis_code, jenis_teks, nomor_teks, tahun, judul, tanggal,
                   kategori, url
              FROM katalog_luar WHERE {w}
             ORDER BY tahun DESC, nomor_teks LIMIT ?""", arg + [limit]).fetchall()
    return {"total": total, "hasil": [dict(r) for r in rows]}
