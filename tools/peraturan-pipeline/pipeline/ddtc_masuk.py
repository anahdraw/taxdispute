"""Menyerap katalog dan naskah DDTC ke korpus.

Dua sisi, satu jalan masuk. Sisi **pusat** memakai identitas biasa; sisi
**daerah** memakai `kunci_daerah`, karena "Perda 1 Tahun 2024" tanpa daerahnya
bukan identitas dan akan menimpa naskah yang sudah ada.

Yang tidak dikerjakan di sini: menimpa naskah yang sudah dimiliki. Salinan dari
katalog resmi DJP tetap menjadi rujukan utama; DDTC dipakai untuk yang belum
ada, dan untuk mengisi badan yang selama ini kosong — dokumen yang terhitung
dalam jumlah tetapi tidak dapat dicari maupun dikutip.

Status dari DDTC disimpan sebagai `status_site` bagi dokumen baru, tetapi tidak
menggantikan status yang sudah dihitung dari relasi. Ia bahan pembanding, bukan
putusan; yang memutuskan tetap `compute_validity` beserta pemeriksaan silangnya.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime
from pathlib import Path

from .normalize import kunci_daerah, normalize_nomor, turunkan_kode
from .sources import ddtc_koleksi as K
from .structure import parse_body, store_units

# Bentuk yang taksonomi DDTC namai lain dari peta kita. Hanya yang tidak
# tertebak oleh `turunkan_kode` yang perlu dicantumkan di sini.
BENTUK_TAMBAHAN = {
    "undang-undang darurat": "UU-DARURAT",
    "kitab undang-undang hukum dagang": "KUHD",
    "kitab undang-undang hukum perdata": "KUHPER",
    "kitab undang-undang hukum pidana": "KUHP",
    "qanun": "QANUN",                 # peraturan daerah di Aceh
}

# Bentuk yang tidak boleh berindentitas tanpa daerahnya. Daftar ini bukan
# penentu — penentunya adalah ada tidaknya daerah pada barisnya — melainkan
# jaring pengaman: bentuk di sini yang datang TANPA daerah ditolak, bukan
# disimpan dengan kunci yang akan bertabrakan.
#
# Daftar tulis-tangan sudah sekali salah di sini: "PER-WALI" ditulis padahal
# kode yang diturunkan "PER-WALIKO", sehingga 1.425 Peraturan Walikota lolos
# tanpa daerahnya. Karena itu pencocokannya lewat awalan, dan keputusan
# utamanya tidak lagi bergantung pada daftar ini.
AWALAN_DAERAH = ("PERDA", "QANUN", "PER-GUBERN", "KEP-GUBERN", "INS-GUBERN",
                 "SE-GUBERN", "PER-BUPATI", "KEP-BUPATI", "PER-WALI",
                 "KEP-WALI", "KEP-DPRD", "KEP-PENDAP", "S-KEPUTU")


def _bentuk_daerah(kode: str) -> bool:
    return any(kode.startswith(a) for a in AWALAN_DAERAH)

SKEMA = """
CREATE TABLE IF NOT EXISTS ddtc_log (
  slug     TEXT PRIMARY KEY,
  kanal    TEXT,
  reg_id   TEXT,
  hasil    TEXT,
  catatan  TEXT,
  waktu    TEXT
);
CREATE INDEX IF NOT EXISTS ix_ddtc_hasil ON ddtc_log(hasil);
"""


def pastikan_skema(conn) -> None:
    conn.executescript(SKEMA)
    conn.commit()


def _kode(jenis_teks: str | None) -> str | None:
    j = re.sub(r"\s*\([^)]*\)\s*$", "", (jenis_teks or "")).strip()
    tambah = BENTUK_TAMBAHAN.get(j.lower())
    if tambah:
        return tambah
    kode, _ = turunkan_kode(j)
    return kode


def identitas(baris: dict):
    """RegID untuk satu baris katalog DDTC, atau None bila tak dapat diurai."""
    kode = _kode(baris.get("jenis_teks") or baris.get("bentuk_ddtc"))
    if not kode:
        return None, None
    nomor = (baris.get("nomor_teks") or "").strip()
    tahun = None
    m = re.search(r"(?:19|20)\d{2}", nomor)
    if m:
        tahun = int(m.group(0))
    elif baris.get("tanggal"):
        tahun = int(str(baris["tanggal"])[:4])
    # Nomornya dibiarkan apa adanya. Kodenya sudah diketahui dari taksonomi
    # DDTC dan diteruskan sebagai `jenis`, jadi tidak perlu ditempelkan ke depan
    # nomor — dan menempelkannya justru memperkenalkan bentuk yang harus diurai
    # ulang, tempat kode bertanda hubung dahulu tersandung.
    # Penentunya: apakah barisnya menyebut daerah. Katalog daerah selalu
    # menyebutnya, katalog pusat tidak pernah — jadi aturan ini benar untuk
    # keduanya tanpa daftar bentuk yang harus dirawat.
    daerah = (baris.get("daerah") or "").strip()
    if daerah:
        return kunci_daerah(kode, nomor, tahun, daerah), kode
    if _bentuk_daerah(kode):
        # Bentuk daerah tanpa daerahnya tidak punya identitas. Menyimpannya
        # dengan kunci tanpa daerah adalah cara menimpa naskah yang sudah ada:
        # setiap kabupaten punya "Perda 1 Tahun 2024".
        return None, kode
    return normalize_nomor(nomor, kode, tahun), kode


# ---------------------------------------------------------------------------
# Katalog

def muat_katalog(conn, berkas: str | Path, sumber: str) -> dict:
    """Masukkan katalog DDTC ke `katalog_luar` dan padankan dengan korpus."""
    from .celah import pastikan_skema as skema_celah
    skema_celah(conn)
    data = json.loads(Path(berkas).read_text("utf-8"))
    n = {"dibaca": len(data), "berkunci": 0, "tanpa_kunci": 0}
    baris = []
    for d in data:
        rid, kode = identitas(d)
        n["berkunci" if rid else "tanpa_kunci"] += 1
        pokok = re.match(r"^\D*(\d+)", d.get("nomor_teks") or "")
        tahun = rid.tahun if rid else None
        baris.append((sumber, d["slug"], rid.key if rid else None, kode,
                      d.get("jenis_teks"), d.get("nomor_teks"), tahun,
                      d.get("judul"), d.get("tanggal"),
                      d.get("daerah") or d.get("provinsi"),
                      f"{K.SITUS}/id/sumber-hukum/{d.get('kanal','peraturan-daerah')}/{d['slug']}",
                      int(pokok.group(1)) if pokok else None))
    with conn:
        conn.execute("DELETE FROM katalog_luar WHERE sumber=?", (sumber,))
        conn.executemany(
            "INSERT OR REPLACE INTO katalog_luar"
            "(sumber,sumber_id,kunci,jenis_code,jenis_teks,nomor_teks,tahun,"
            " judul,tanggal,kategori,url,angka_pokok) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", baris)
        conn.execute(
            "UPDATE katalog_luar SET ada_di_kita=1 WHERE sumber=? AND kunci IN "
            "(SELECT id FROM regulation)", (sumber,))
    n["cocok"] = conn.execute(
        "SELECT COUNT(*) FROM katalog_luar WHERE sumber=? AND ada_di_kita=1",
        (sumber,)).fetchone()[0]
    n["celah"] = n["dibaca"] - n["cocok"]
    return n


def antrean(conn, sumber: str, batas: int | None = None) -> list[dict]:
    """Dokumen DDTC yang belum kita punya, atau yang ada tanpa naskah.

    Pertanyaannya "apakah naskahnya kita punya", bukan "apakah barisnya ada".
    Perbedaannya pernah menyembunyikan 1.657 dokumen tanpa naskah yang terhitung
    lengkap justru karena barisnya ada.
    """
    pastikan_skema(conn)
    bernaskah = ("SELECT id FROM regulation WHERE has_body=1 "
                 "  AND body_text IS NOT NULL AND body_text<>''")
    sudah = "SELECT slug FROM ddtc_log WHERE hasil IN ('masuk','terisi','ada')"
    q = (f"SELECT sumber_id slug, kunci, jenis_code, nomor_teks, tahun, judul,"
         f"       tanggal, kategori daerah, url "
         f"  FROM katalog_luar "
         f" WHERE sumber=? AND kunci IS NOT NULL "
         f"   AND (ada_di_kita=0 OR kunci NOT IN ({bernaskah})) "
         f"   AND sumber_id NOT IN ({sudah}) "
         f" ORDER BY tahun DESC, sumber_id" + (f" LIMIT {int(batas)}" if batas else ""))
    return [dict(r) for r in conn.execute(q, (sumber,))]


# ---------------------------------------------------------------------------
# Penyerapan

def _catat(conn, slug: str, kanal: str, reg_id: str | None, hasil: str,
           catatan: str = "") -> None:
    conn.execute(
        "INSERT OR REPLACE INTO ddtc_log(slug,kanal,reg_id,hasil,catatan,waktu)"
        " VALUES (?,?,?,?,?,?)",
        (slug, kanal, reg_id, hasil, catatan,
         datetime.now().isoformat(timespec="seconds")))


def serap_satu(conn, s, b: dict, kanal: str) -> dict:
    """Ambil satu dokumen lalu simpan. Pengambilan dan penyimpanan dipisah
    supaya yang pertama dapat dijalankan paralel dan yang kedua tidak."""
    try:
        d = K.ambil_dokumen(s, b["slug"], kanal)
    except Exception as e:                                        # noqa: BLE001
        return _simpan_dokumen(conn, b, None, kanal, str(e)[:160])
    return _simpan_dokumen(conn, b, d, kanal, None)


def _kanonik(b: dict) -> str:
    """Sebutan yang dapat dikutip untuk satu baris antrean.

    Kodenya sudah diketahui di sini, jadi penormal dipanggil langsung — bukan
    lewat `identitas()`, yang menuntut label bentuk dan bukan kodenya.
    """
    kode = b.get("jenis_code")
    nomor = (b.get("nomor_teks") or "").strip()
    tahun = b.get("tahun")
    if not (kode and nomor):
        return b.get("kunci") or ""
    daerah = (b.get("daerah") or "").strip()
    rid = (kunci_daerah(kode, nomor, tahun, daerah) if daerah
           else normalize_nomor(nomor, kode, tahun))
    return rid.canonical if rid else (b.get("kunci") or "")


def _simpan_dokumen(conn, b: dict, d, kanal: str,
                    galat: str | None) -> dict:
    slug = b["slug"]
    if galat:
        _catat(conn, slug, kanal, None, "galat", galat)
        return {"slug": slug, "hasil": "galat"}
    if d is None:
        _catat(conn, slug, kanal, None, "tidak_ditemukan")
        return {"slug": slug, "hasil": "tidak_ditemukan"}

    rid_key = b["kunci"]
    ada = conn.execute(
        "SELECT source, has_body, LENGTH(COALESCE(body_text,'')) n "
        "  FROM regulation WHERE id=?", (rid_key,)).fetchone()
    sha = hashlib.sha256((d.naskah or "").encode()).hexdigest()

    if ada and (ada["has_body"] or ada["n"] > 0):
        _catat(conn, slug, kanal, rid_key, "ada")
        return {"slug": slug, "hasil": "ada", "reg_id": rid_key}

    if ada:
        conn.execute(
            "UPDATE regulation SET body_text=?, has_body=1, sha256=?, "
            "       source=?, url=COALESCE(url,?) WHERE id=?",
            (d.naskah, sha, f'{ada["source"] or "?"}+ddtc', b["url"], rid_key))
        unit = store_units(conn, rid_key, parse_body(d.naskah))
        _catat(conn, slug, kanal, rid_key, "terisi", f"{unit} unit")
        return {"slug": slug, "hasil": "terisi", "reg_id": rid_key, "unit": unit}

    conn.execute(
        """INSERT INTO regulation
           (id,canonical,nomor_raw,jenis,jenis_code,kategori,tahun,tanggal,
            judul,url,status_site,has_body,body_text,source,sha256,fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        # Kolom `canonical` adalah SEBUTAN, bukan kunci. Meneruskan `kunci` ke
        # sini membuat 12.145 dokumen berkutipan "perda-9-kab-buleleng-2023" —
        # slug basis data yang tidak dapat ditempel ke dokumen mana pun sebagai
        # rujukan. Yang benar bentuk kanonik dari penormal.
        (rid_key, _kanonik(b), b["nomor_teks"], b["jenis_code"],
         b["jenis_code"], b.get("daerah"), b["tahun"],
         d.tanggal or b.get("tanggal"),
         (b.get("judul") or d.judul or "").strip().upper(), b["url"],
         d.status or None, 1, d.naskah, "ddtc", sha,
         datetime.now().isoformat(timespec="seconds")))
    unit = store_units(conn, rid_key, parse_body(d.naskah))
    _catat(conn, slug, kanal, rid_key, "masuk", f"{unit} unit")
    return {"slug": slug, "hasil": "masuk", "reg_id": rid_key, "unit": unit}


def serap(conn, baris: list[dict], kanal: str, jeda: float = 0.5,
          progress=print, pekerja: int = 1) -> dict:
    """Ambil dan simpan naskah untuk sederet antrean.

    Pengambilan boleh berjalan paralel, penyimpanan tidak. Halaman DDTC berukuran
    200–500 KB, jadi yang menghabiskan waktu adalah menunggu jaringan, bukan
    menulis basis data — 8.187 dokumen secara berurutan butuh lima setengah jam.
    Tetapi SQLite hanya punya satu penulis, dan menyebar penulisan ke beberapa
    utas hanya menukar waktu tunggu jaringan dengan waktu tunggu kunci. Jadi
    utas hanya mengambil; yang menyimpan tetap satu.
    """
    pastikan_skema(conn)
    if pekerja <= 1:
        s = K.sesi()
        n: dict[str, int] = {}
        for i, b in enumerate(baris, 1):
            r = _satu_aman(conn, s, b, kanal)
            n[r["hasil"]] = n.get(r["hasil"], 0) + 1
            if i % 50 == 0 or i == len(baris):
                conn.commit()
                progress(f"  {i}/{len(baris)} — {n}")
            time.sleep(jeda)
        conn.commit()
        return n

    from concurrent.futures import ThreadPoolExecutor
    from queue import Queue
    import threading

    lokal = threading.local()

    def ambil(b: dict):
        if not hasattr(lokal, "s"):
            lokal.s = K.sesi()
        try:
            return b, K.ambil_dokumen(lokal.s, b["slug"], kanal), None
        except Exception as e:                                    # noqa: BLE001
            return b, None, str(e)[:160]

    n = {}
    with ThreadPoolExecutor(max_workers=pekerja) as pool:
        for i, (b, d, galat) in enumerate(pool.map(ambil, baris), 1):
            r = _simpan_dokumen(conn, b, d, kanal, galat)
            n[r["hasil"]] = n.get(r["hasil"], 0) + 1
            if i % 100 == 0 or i == len(baris):
                conn.commit()
                progress(f"  {i}/{len(baris)} — {n}")
    conn.commit()
    return n


def _satu_aman(conn, s, b: dict, kanal: str) -> dict:
    try:
        return serap_satu(conn, s, b, kanal)
    except Exception as e:                                        # noqa: BLE001
        _catat(conn, b["slug"], kanal, None, "galat", str(e)[:160])
        return {"hasil": "galat"}



# ---------------------------------------------------------------------------
# Status sebagai bukti verifikasi

def muat_status(conn, berkas: str | Path, sumber: str,
                nama: str = "ddtc") -> dict:
    """Muat status dari berkas katalog DDTC ke tabel `verifikasi`."""
    from .verifikasi import bakukan, pastikan_skema as skema_verif
    skema_verif(conn)
    data = json.loads(Path(berkas).read_text("utf-8"))
    milik = {r[0] for r in conn.execute("SELECT id FROM regulation")}
    now = datetime.now().isoformat(timespec="seconds")
    baris, n = [], {"ditulis": 0, "bisu": 0, "bukan_milik_kita": 0,
                    "tanpa_kunci": 0}
    for d in data:
        rid, _ = identitas(d)
        if not rid:
            n["tanpa_kunci"] += 1
            continue
        if rid.key not in milik:
            n["bukan_milik_kita"] += 1
            continue
        mentah = (d.get("status") or "").strip()
        baku = bakukan(mentah)
        if baku == "tidak_diketahui":
            n["bisu"] += 1
        n["ditulis"] += 1
        baris.append((rid.key, nama, 1, mentah or None, baku, None,
                      f"{K.SITUS}/id/sumber-hukum/"
                      f"{d.get('kanal', 'peraturan-daerah')}/{d['slug']}",
                      d.get("judul"), now, None))
    with conn:
        conn.executemany(
            "INSERT OR REPLACE INTO verifikasi"
            "(reg_id,sumber,ditemukan,status_mentah,status_baku,pencabut,url,"
            " judul,waktu,galat) VALUES (?,?,?,?,?,?,?,?,?,?)", baris)
    return n


def banding_status(conn, nama: str = "ddtc") -> dict:
    """Bandingkan status DDTC dengan keberlakuan yang kita hitung sendiri."""
    q = """SELECT v.status_baku ddtc, d.status_derived kita, COUNT(*) n
             FROM verifikasi v JOIN validity d ON d.reg_id = v.reg_id
            WHERE v.sumber = ? AND v.ditemukan = 1
            GROUP BY 1, 2 ORDER BY 3 DESC"""
    rinci = [dict(r) for r in conn.execute(q, (nama,))]
    sepakat = sum(r["n"] for r in rinci
                  if r["ddtc"] == r["kita"]
                  or (r["ddtc"] == "berlaku" and r["kita"] == "diubah"))
    bisu = sum(r["n"] for r in rinci if r["ddtc"] == "tidak_diketahui")
    total = sum(r["n"] for r in rinci)
    return {"total": total, "sepakat": sepakat, "bisu": bisu,
            "berselisih": total - sepakat - bisu, "rinci": rinci}


# ---------------------------------------------------------------------------
# Rekonsiliasi peraturan daerah berindentitas cacat

def _kunci_judul(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _tanpa_daerah(reg_id: str, kode: str, nomor: str, tahun) -> bool:
    """Benar bila identitasnya tidak memuat daerah sama sekali."""
    from .normalize import _mkkey
    return reg_id == _mkkey(kode, nomor, "", tahun)


# Kepala naskah peraturan daerah menyebut daerahnya sendiri: "GUBERNUR BALI",
# "BUPATI BULELENG", "PERATURAN DAERAH PROVINSI KALIMANTAN SELATAN". Kata
# pembeda itulah bukti yang dipakai untuk memastikan padanan.
#
# Tangkapannya dibatasi paling banyak tiga kata dan berhenti pada tanda baca.
# Percobaan pertama memakai `[A-Z' .-]{2,40}`, dan pada naskah yang kepalanya
# seluruhnya beruruf besar itu menyapu kalimat alih-alih nama: "GUBERNUR BALI
# ... BELUM MENGUSULKAN" ikut terbaca, sehingga "belum" dan "mengusulkan"
# menjadi kata daerah. Kelebihan tangkapan tidak membuat padanan gagal; ia
# membuat padanan yang keliru tampak yakin.
RE_SEBUTAN = re.compile(
    r"\b(?:GUBERNUR|BUPATI|WALI\s*KOTA|WALIKOTA|PROVINSI|PROPINSI|KABUPATEN|KOTA)"
    r"\s+((?:[A-Z][A-Za-z']{2,}(?:\s+|$)){1,3})")
_BATAS = re.compile(r"^(?:NOMOR|TAHUN|TENTANG|DENGAN|RAHMAT|KEPALA|DAERAH|"
                    r"KHUSUS|IBUKOTA|TINGKAT|ADMINISTRASI|SELAKU|YANG|DAN|"
                    r"MENIMBANG|MENGINGAT|MEMUTUSKAN|SEBAGAI|DALAM|TELAH)$")
_BUKAN_NAMA = {"kepala", "daerah", "khusus", "ibukota", "ibu", "raya", "dan",
               "provinsi", "propinsi", "kabupaten", "kota", "wali", "republik",
               "indonesia", "administrasi", "tingkat", "nomor", "tahun",
               "tentang", "dengan", "rahmat", "tuhan", "maha"}


def _kata_daerah(teks: str | None, batas: int = 2500) -> set[str]:
    """Kata pembeda nama daerah yang disebut di kepala naskah."""
    out: set[str] = set()
    for m in RE_SEBUTAN.finditer((teks or "")[:batas]):
        for w in m.group(1).split():
            if _BATAS.match(w.upper()):
                break          # kata berikutnya bukan lagi bagian nama
            wl = w.lower().strip("'")
            if len(wl) > 3 and wl not in _BUKAN_NAMA:
                out.add(wl)
    return out


def rekonsiliasi_daerah(conn, terapkan: bool = False) -> dict:
    """Selesaikan peraturan daerah yang tersimpan tanpa daerah pada kuncinya.

    316 Perda masuk dari Ortax sebelum aturan identitas diperbaiki, dengan kunci
    seperti `perda-1-2024` yang tidak menyebut daerah mana.

    **Dua percobaan sebelumnya gagal, dan cara gagalnya menentukan cara ini.**

    Memadankan lewat *judul* pada bentuk dan tahun yang sama salah dengan cara
    yang berbahaya: judul Perda daerah sangat baku — "PAJAK HOTEL", "PAJAK
    REKLAME" — sehingga puluhan daerah berjudul sama persis, dan `perda-7-2002`
    dipadankan dengan `perda-8-provinsi-banten-2002`. Nomornya pun berbeda.
    Padanan semacam itu tidak menyelesaikan identitas yang cacat; ia
    menggantinya dengan identitas dokumen lain.

    Memadankan lewat *sidik jari isi* yang sama persis terlalu ketat: naskah
    dari Ortax dan dari DDTC melewati pengurai yang berbeda, jadi tidak pernah
    identik sampai ke aksara. Nol padanan, padahal dokumennya ada.

    Yang dipakai sekarang: nomor dan tahun harus sama, **dan** nama daerah pada
    kandidat harus disebut di dalam naskah dokumen yang cacat itu. Kepala naskah
    peraturan daerah memang menyebut daerahnya sendiri. Ini memverifikasi
    kandidat, bukan menghasilkannya — bedanya penting, karena menebak identitas
    adalah cara membuat tabrakan jenis baru.
    """
    kandidat = [dict(r) for r in conn.execute(
        "SELECT id, jenis_code, nomor_raw, tahun, judul, body_text "
        "  FROM regulation WHERE jenis_code IN (%s) AND has_body=1"
        % ",".join("?" * len(AWALAN_DAERAH)), AWALAN_DAERAH)]
    n = {"diperiksa": 0, "sepadan": 0, "kandidat_ganda": 0,
         "tanpa_padanan": 0, "tanpa_sebutan": 0, "dihapus": 0}
    hapus, ragu = [], []
    for r in kandidat:
        rid = normalize_nomor(r["nomor_raw"] or "", r["jenis_code"], r["tahun"])
        if not rid or not _tanpa_daerah(r["id"], rid.jenis_code, rid.nomor,
                                       rid.tahun):
            continue
        n["diperiksa"] += 1
        kata = _kata_daerah(r["body_text"])
        if not kata:
            n["tanpa_sebutan"] += 1
            continue
        padan = []
        for x in conn.execute(
                "SELECT id, nomor_raw, kategori FROM regulation "
                "  WHERE jenis_code=? AND tahun=? AND id<>? "
                "    AND source LIKE '%ddtc%' AND kategori IS NOT NULL",
                (r["jenis_code"], r["tahun"], r["id"])):
            xr = normalize_nomor(x["nomor_raw"] or "", r["jenis_code"],
                                 r["tahun"])
            if not xr or xr.nomor != rid.nomor:
                continue
            nama = {w for w in re.split(r"[^A-Za-z']+",
                                        (x["kategori"] or "").lower())
                    if len(w) > 3 and w not in _BUKAN_NAMA}
            if nama and nama <= kata:
                padan.append(x["id"])
        if len(padan) == 1:
            n["sepadan"] += 1
            hapus.append((r["id"], padan[0]))
        elif padan:
            n["kandidat_ganda"] += 1
            ragu.append((r["id"], padan))
        else:
            n["tanpa_padanan"] += 1
    if terapkan and hapus:
        with conn:
            for lama, _ in hapus:
                conn.execute("DELETE FROM pasal WHERE reg_id=?", (lama,))
                conn.execute("DELETE FROM regulation WHERE id=?", (lama,))
                conn.execute("DELETE FROM validity WHERE reg_id=?", (lama,))
        n["dihapus"] = len(hapus)
    n["contoh_sepadan"] = hapus[:8]
    n["contoh_ganda"] = ragu[:4]
    return n


def beri_daerah(conn, taksonomi: list[str], terapkan: bool = False) -> dict:
    """Lengkapi identitas peraturan daerah yang kuncinya tidak menyebut daerah.

    Sisa yang tidak punya padanan di DDTC tetap dapat diselesaikan, karena
    dokumennya menyebut daerahnya sendiri di kepala naskah. Yang dilakukan di
    sini bukan menebak: kata pembeda pada naskah dicocokkan dengan taksonomi 553
    daerah, dan hanya diterima bila **tepat satu** daerah yang cocok. Dua yang
    cocok berarti sebutannya tidak cukup membedakan, dan itu diserahkan ke
    peninjau.

    Kunci lamanya tidak dihapus melulu: barisnya dipindahkan ke kunci baru
    beserta unitnya, sehingga naskah yang sudah ada tidak hilang hanya karena
    identitasnya diperbaiki.
    """
    peta: dict[str, list[str]] = {}
    for nama in taksonomi:
        kata = {w for w in re.split(r"[^A-Za-z']+", nama.lower())
                if len(w) > 3 and w not in _BUKAN_NAMA}
        if kata:
            peta[nama] = sorted(kata)

    n = {"diperiksa": 0, "dipetakan": 0, "ganda": 0, "tanpa_padanan": 0,
         "bentrok": 0, "dipindahkan": 0}
    pindah = []
    for r in conn.execute(
            "SELECT id, jenis_code, nomor_raw, tahun, body_text "
            "  FROM regulation WHERE jenis_code IN (%s) AND has_body=1"
            % ",".join("?" * len(AWALAN_DAERAH)), AWALAN_DAERAH):
        rid = normalize_nomor(r["nomor_raw"] or "", r["jenis_code"], r["tahun"])
        if not rid or not _tanpa_daerah(r["id"], rid.jenis_code, rid.nomor,
                                       rid.tahun):
            continue
        n["diperiksa"] += 1
        # Judul lebih dahulu, preambul sebagai cadangan. Judul Perda selalu
        # menyebut daerahnya ("PERATURAN DAERAH PROPINSI KALIMANTAN SELATAN
        # NOMOR ..."), sedangkan preambul juga memuat tempat penandatanganan —
        # "Ditetapkan di Denpasar" — yang bersaing dengan daerahnya sendiri dan
        # membuat Perda Provinsi Bali tampak mungkin milik Kota Denpasar.
        cocok: list[str] = []
        for batas in (260, 2500):
            kata = _kata_daerah(r["body_text"], batas)
            if not kata:
                continue
            cocok = [nama for nama, k in peta.items() if set(k) <= kata]
            if len(cocok) == 1:
                break
        if len(cocok) != 1:
            n["ganda" if cocok else "tanpa_padanan"] += 1
            continue
        baru = kunci_daerah(r["jenis_code"], r["nomor_raw"] or "", r["tahun"],
                            cocok[0])
        if not baru or baru.key == r["id"]:
            n["tanpa_padanan"] += 1
            continue
        if conn.execute("SELECT 1 FROM regulation WHERE id=?",
                        (baru.key,)).fetchone():
            # Kunci barunya sudah terpakai. Ini bukan hal yang boleh ditimpa:
            # yang di sana sudah berindentitas utuh sejak awal.
            n["bentrok"] += 1
            continue
        n["dipetakan"] += 1
        pindah.append((r["id"], baru.key, baru.canonical, cocok[0]))

    if terapkan and pindah:
        with conn:
            for lama, baru_id, kanonik, daerah in pindah:
                conn.execute(
                    "UPDATE regulation SET id=?, canonical=?, kategori=? "
                    " WHERE id=?", (baru_id, kanonik, daerah, lama))
                conn.execute("UPDATE pasal SET reg_id=?, id=REPLACE(id,?,?) "
                             " WHERE reg_id=?",
                             (baru_id, lama, baru_id, lama))
                conn.execute("DELETE FROM validity WHERE reg_id=?", (lama,))
        n["dipindahkan"] = len(pindah)
    n["contoh"] = [(a, b, d) for a, b, _, d in pindah[:8]]
    return n
