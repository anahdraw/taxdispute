"""Isi celah korpus dari sumber resmi.

Daftar celah menyebutkan jenis, nomor, dan tahun dokumen yang ada di katalog
lain tetapi belum ada di korpus. Modul ini mengambil dokumen yang SAMA dari
repositori resmi — bukan dari katalog yang menemukan celahnya.

Alasannya bukan teknis. Peraturan perundang-undangan dikecualikan dari hak cipta
oleh UU 28/2014 Pasal 42, jadi naskahnya milik publik. Yang bukan milik publik
adalah hasil ketikan ulang sebuah penerbit atas naskah itu, dan Ortax menyatakan
haknya secara tegas pada tiap halaman dokumennya. Mengambil dari penerbit resmi
menghindari persoalan itu seluruhnya, dan sekaligus memberi salinan yang lebih
berwenang.

**Yang masuk ditandai berbeda.** Dokumen hasil pengisian celah diberi `source`
sesuai repositori asalnya, bukan 'djp'. Korpus harus tetap dapat menjawab "dari
mana salinan ini datang" tanpa menebak, terutama ketika salinan dari sumber
berbeda ternyata tidak sama.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime

from dataclasses import dataclass

from .config import PDF_DIR
from .crawl import Fetcher
from .normalize import normalize_nomor
from .sources import bpk as BPK
from .sources import jdih_kemenkeu as JKM
from .sources import ortax as ORTAX
from .sources import peraturan_go_id as PGI
from .structure import parse_body, store_units


@dataclass
class _Salinan:
    """Bentuk seragam agar salinan Ortax dan salinan konektor resmi setara.

    Konektor resmi mengembalikan `Doc`; Ortax mengembalikan dict. Menyamakan
    keduanya di sini membuat sisa alur tidak perlu tahu asal salinannya —
    perbedaan asal sudah tercatat di kolom `source`.
    """
    url: str | None = None
    judul: str | None = None
    text: str | None = None
    jenis: str | None = None
    tanggal: str | None = None
    status: str | None = None

SUMBER = [("jdih-kemenkeu", JKM), ("peraturan.go.id", PGI), ("jdih-bpk", BPK)]

# Bentuk yang ketiga repositori resmi ini memang membawa. PER, KEP, PENG, INS,
# ND, dan SE adalah terbitan Direktorat Jenderal Pajak sendiri dan tidak dimuat
# di sana — mencobanya hanya menghabiskan waktu lalu melaporkan "tidak
# ditemukan", yang terbaca seolah dokumennya tidak ada padahal sumbernya saja
# yang keliru.
JENIS_RESMI = {"PMK", "KMK", "IMK", "PP", "PERPRES", "PERPU", "UU",
               "KEPPRES", "INPRES", "PERMENDAG", "PERMENDAGRI",
               "PERMENPERIN", "KEPMENDAGRI", "KEPMENPERIN", "PERDA"}

# Ortax memuat naskah untuk semua bentuk, termasuk yang tidak ada di repositori
# resmi mana pun — Surat Edaran (2.857 berkategori pajak) yang sama sekali tidak
# ada di katalog peraturan DJP adalah contoh terbesarnya.
JENIS_ORTAX = None      # None berarti tanpa batasan bentuk

JENIS_DIDUKUNG = JENIS_RESMI      # nama lama, dipertahankan agar pemanggil lama tetap jalan

SKEMA = """
CREATE TABLE IF NOT EXISTS pengisian (
  sumber_id   TEXT PRIMARY KEY,     -- id di katalog luar
  reg_id      TEXT,                 -- id korpus bila berhasil masuk
  jenis_code  TEXT, nomor_teks TEXT, tahun INTEGER,
  hasil       TEXT,                 -- masuk | tanpa_naskah | tidak_ditemukan | galat
  dari        TEXT,                 -- repositori yang memberi salinannya
  url         TEXT,
  dicoba      TEXT,                 -- daftar sumber yang dicoba beserta hasilnya
  n_unit      INTEGER DEFAULT 0,
  waktu       TEXT
);
CREATE INDEX IF NOT EXISTS ix_pengisian_hasil ON pengisian(hasil);
"""


def pastikan_skema(conn) -> None:
    import sqlite3
    try:
        conn.executescript(SKEMA)
        conn.commit()
    except sqlite3.OperationalError as e:
        if "readonly" not in str(e).lower():
            raise


def antrean(conn, hanya_pajak: bool = True, jenis: str | None = None,
            tahun_min: int | None = None, batas: int | None = None,
            lewat_ortax: bool = False) -> list[dict]:
    """Celah yang belum pernah dicoba diambil.

    `lewat_ortax` melepas batasan bentuk. Batasan itu hanya berlaku untuk
    repositori resmi, yang memang tidak memuat terbitan Dirjen Pajak; Ortax
    memuat semuanya, termasuk Surat Edaran yang tidak ada di katalog DJP.
    """
    pastikan_skema(conn)
    from .celah import _saring_pajak

    # Yang sudah pernah MASUK tidak diulang. Yang pernah gagal di sumber resmi
    # justru harus diulang ketika Ortax diizinkan — kegagalan itu menyatakan
    # "tidak ada di tiga repositori resmi", bukan "tidak ada di mana pun".
    sudah = ("SELECT sumber_id FROM pengisian" if not lewat_ortax else
             "SELECT sumber_id FROM pengisian WHERE hasil='masuk'")
    # "Ada di korpus" tidak sama dengan "naskahnya ada". 1.801 dokumen tercatat
    # lengkap metadatanya tetapi kosong isinya, dan 1.657 di antaranya justru
    # dimuat katalog luar — tidak pernah diambil karena penyaring hanya bertanya
    # apakah dokumennya ada, bukan apakah naskahnya ada. Dokumen semacam itu
    # tidak dapat dicari maupun dikutip; ia hanya terhitung dalam jumlah.
    punya_naskah = ("SELECT id FROM regulation WHERE has_body=1 "
                    "  AND body_text IS NOT NULL AND body_text<>''")
    where = ["k.sumber='ortax'", "k.tahun IS NOT NULL",
             f"(k.ada_di_kita=0 OR k.kunci NOT IN ({punya_naskah}))",
             f"k.sumber_id NOT IN ({sudah})"]
    if not lewat_ortax:
        daftar = ",".join(f"'{x}'" for x in sorted(JENIS_RESMI))
        where.append(f"k.jenis_code IN ({daftar})")
    arg: list = []
    if hanya_pajak:
        where.append(_saring_pajak().replace("kategori", "k.kategori"))
    if jenis:
        where.append("k.jenis_code=?"); arg.append(jenis)
    if tahun_min:
        where.append("k.tahun>=?"); arg.append(int(tahun_min))
    sql = ("SELECT k.sumber_id, k.jenis_code, k.nomor_teks, k.tahun, k.judul, "
           "       k.kategori FROM katalog_luar k WHERE " + " AND ".join(where) +
           # Terbaru dulu terasa masuk akal, tetapi dokumen bulan berjalan
           # justru paling sering belum terbit di repositori lain. Diurutkan
           # dari yang paling lama agar hasil awal mencerminkan peluang yang
           # sebenarnya, bukan kekosongan sesaat.
           " ORDER BY k.tahun, k.jenis_code")
    if batas:
        sql += f" LIMIT {int(batas)}"
    return [dict(r) for r in conn.execute(sql, arg)]


def _nomor_untuk_sumber(kode: str | None, nomor: str) -> str:
    """Nomor sederhana perlu awalan jenisnya agar dikenali penormal.

    Katalog luar menulis "43 Tahun 2026"; repositori resmi dan penormal kita
    sama-sama menuntut "PMK 43 TAHUN 2026". Tanpa penambahan ini pencarian
    selalu nihil, dan nihil yang disebabkan bentuk masukan tidak dapat
    dibedakan dari dokumen yang memang tidak ada.
    """
    n = (nomor or "").strip()
    if kode and re.match(r"^\d+\s*(?:TAHUN|Tahun|tahun)\s*\d{4}$", n):
        return f"{kode} {n}"
    return n


def ambil_satu(conn, fetcher, baris: dict, pakai_ortax: bool = False,
               sesi_ortax=None) -> dict:
    """Coba tiap repositori sampai salah satu memberi naskahnya.

    Sumber resmi selalu didahulukan meski Ortax diizinkan: salinan dari
    penerbitnya sendiri lebih berwenang, dan Ortax hanya dipakai untuk yang
    tidak ada di sana. Urutan ini juga menekan jumlah permintaan ke Ortax
    seminimal yang diperlukan.
    """
    pastikan_skema(conn)
    kode = baris["jenis_code"]
    nomor = _nomor_untuk_sumber(kode, baris["nomor_teks"])
    now = datetime.now().isoformat(timespec="seconds")
    dicoba, doc, dari = [], None, None

    # Bentuk terbitan Dirjen Pajak tidak ada di repositori resmi. Melewatinya
    # menghemat tiga permintaan sia-sia per dokumen — pada 3.000 dokumen itu
    # 9.000 permintaan yang hasilnya sudah diketahui nihil sejak awal.
    lewati_resmi = pakai_ortax and kode not in JENIS_RESMI

    for nama, mod in ([] if lewati_resmi else SUMBER):
        try:
            d = mod.fetch(fetcher, kode, nomor, baris["tahun"],
                          want_pdf=True, pdf_dir=PDF_DIR)
        except Exception as e:                                # noqa: BLE001
            dicoba.append(f"{nama}:galat({type(e).__name__})")
            continue
        if d is None:
            dicoba.append(f"{nama}:nihil")
            continue
        dicoba.append(f"{nama}:{'ada+naskah' if d.text else 'ada-tanpa-naskah'}")
        # Berhenti pada salinan pertama yang MEMBAWA naskah. Salinan tanpa
        # naskah tetap dicatat sebagai temuan, tetapi pencarian diteruskan —
        # metadata saja tidak menambah apa pun yang belum kita punya.
        if doc is None or (d.text and not doc.text):
            doc, dari = d, nama
        if d.text:
            break

    # Ortax hanya ditanya bila sumber resmi tidak memberi naskah.
    if pakai_ortax and (doc is None or not doc.text):
        o = ORTAX.ambil_dokumen(baris["sumber_id"], sesi=sesi_ortax,
                                jenis_code=kode)
        dicoba.append(f"ortax:{'ada+naskah' if o else 'nihil'}")
        if o:
            doc = _Salinan(url=o["url"], judul=o["judul"], text=o["teks"],
                           jenis=None, tanggal=None, status=None)
            dari = "ortax"

    if doc is None:
        hasil = "tidak_ditemukan"
    elif not doc.text:
        hasil = "tanpa_naskah"
    else:
        hasil = "masuk"

    reg_id = n_unit = None
    if hasil == "masuk":
        reg_id, n_unit = _simpan(conn, baris, doc, dari)
        # Naskahnya didapat, tetapi nomornya tidak dapat dinormalkan menjadi
        # kunci — jadi tidak ada yang tersimpan. Menyebutnya "masuk" membuat
        # laporan mengklaim keberhasilan yang tidak terjadi, dan celah yang
        # sebenarnya masih terbuka akan tampak sudah tertutup.
        if reg_id is None:
            hasil = "gagal_simpan"

    conn.execute(
        "INSERT OR REPLACE INTO pengisian"
        "(sumber_id,reg_id,jenis_code,nomor_teks,tahun,hasil,dari,url,dicoba,"
        " n_unit,waktu) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (baris["sumber_id"], reg_id, kode, baris["nomor_teks"], baris["tahun"],
         hasil, dari, doc.url if doc else None, "; ".join(dicoba),
         n_unit or 0, now))
    conn.commit()
    return {"hasil": hasil, "dari": dari, "reg_id": reg_id, "unit": n_unit,
            "dicoba": dicoba}


def _simpan(conn, baris: dict, doc, dari: str) -> tuple[str | None, int]:
    """Masukkan dokumen baru ke korpus, lalu urai jadi unit pasal."""
    kode = baris["jenis_code"]
    nomor = _nomor_untuk_sumber(kode, baris["nomor_teks"])
    rid = normalize_nomor(nomor, kode, baris["tahun"])
    if not rid:
        return None, 0
    # Dokumen yang sudah punya NASKAH tidak ditimpa: salinan DJP adalah rujukan
    # utama, dan menggantinya dengan salinan repositori lain akan menghapus
    # jejak asalnya tanpa alasan.
    #
    # Tetapi dokumen yang ada tanpa naskah adalah hal lain. Mengisi badan yang
    # kosong tidak mengganti apa pun; ia justru menyelesaikan catatan yang
    # selama ini hanya terhitung dalam jumlah tetapi tidak dapat dicari maupun
    # dikutip. `source` diberi tanda gabungan supaya tetap terbaca bahwa
    # metadatanya dari DJP sedangkan naskahnya dari tempat lain.
    ada = conn.execute(
        "SELECT source, has_body, LENGTH(COALESCE(body_text,'')) n "
        "  FROM regulation WHERE id=?", (rid.key,)).fetchone()
    if ada and (ada["has_body"] or ada["n"] > 0):
        return rid.key, 0
    if ada:
        conn.execute(
            "UPDATE regulation SET body_text=?, has_body=1, sha256=?, "
            "       source=?, url=COALESCE(url,?) WHERE id=?",
            (doc.text, hashlib.sha256((doc.text or "").encode()).hexdigest(),
             f'{ada["source"] or "?"}+{dari}', doc.url, rid.key))
        unit = parse_body(doc.text)
        return rid.key, store_units(conn, rid.key, unit)

    conn.execute(
        """INSERT INTO regulation
           (id,canonical,nomor_raw,jenis,jenis_code,kategori,tahun,tanggal,
            judul,url,status_site,has_body,body_text,source,sha256,fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        # Judul dari katalog didahulukan: judul halaman Ortax hanya mengulang
        # nomornya ("SURAT EDARAN DIRJEN PAJAK NOMOR: SE - 106/PJ/1984"),
        # sedangkan perihalnya — yang dicari orang — ada di daftar.
        (rid.key, rid.canonical, baris["nomor_teks"], doc.jenis or kode, kode,
         baris.get("kategori"), baris["tahun"], doc.tanggal,
         (baris.get("judul") or doc.judul or "").strip().upper(), doc.url,
         doc.status, 1, doc.text, dari,
         hashlib.sha256((doc.text or "").encode()).hexdigest(),
         datetime.now().isoformat(timespec="seconds")))

    unit = parse_body(doc.text)
    n = store_units(conn, rid.key, unit)
    return rid.key, n


def jalankan(conn, baris: list[dict], jeda: float = 0.8,
             pakai_ortax: bool = False, progress=print) -> dict:
    fetcher = Fetcher(delay=jeda)
    # Satu sesi dipakai ulang untuk seluruh pengambilan: membuka koneksi TLS
    # baru pada tiap dokumen memperlambat kita sekaligus membebani situsnya.
    sesi = ORTAX._klien() if pakai_ortax else None
    n: dict[str, int] = {}
    for i, b in enumerate(baris, 1):
        r = ambil_satu(conn, fetcher, b, pakai_ortax=pakai_ortax,
                       sesi_ortax=sesi)
        n[r["hasil"]] = n.get(r["hasil"], 0) + 1
        if progress and i % 25 == 0:
            progress(f"  {i}/{len(baris)} — {n}")
    conn.commit()
    return n


def ringkas(conn) -> dict:
    pastikan_skema(conn)
    per_hasil = {r[0]: r[1] for r in conn.execute(
        "SELECT hasil, COUNT(*) FROM pengisian GROUP BY hasil")}
    per_sumber = [dict(r) for r in conn.execute(
        "SELECT dari, COUNT(*) n, SUM(n_unit) unit FROM pengisian "
        " WHERE hasil='masuk' GROUP BY dari ORDER BY n DESC")]
    per_jenis = [dict(r) for r in conn.execute(
        """SELECT jenis_code, COUNT(*) dicoba, SUM(hasil='masuk') masuk
             FROM pengisian GROUP BY jenis_code ORDER BY masuk DESC""")]
    return {"per_hasil": per_hasil, "per_sumber": per_sumber,
            "per_jenis": per_jenis,
            "unit_baru": conn.execute(
                "SELECT COALESCE(SUM(n_unit),0) FROM pengisian").fetchone()[0]}


def jalankan_ortax(conn, baris: list[dict], pekerja: int = 3,
                   progress=print) -> dict:
    """Jalur khusus untuk bentuk yang TIDAK ADA di repositori resmi.

    `jalankan()` menanyai peraturan.go.id, JDIH Kemenkeu, dan JDIH BPK lebih
    dahulu, dan itu benar untuk bentuk yang mungkin ada di sana. Untuk terbitan
    Direktorat Jenderal Pajak — Surat Dirjen, Surat Edaran, Pengumuman — ketiga
    pertanyaan itu sudah diketahui nihil sejak awal, dan `ambil_satu` memang
    melewatinya.

    Yang tersisa satu permintaan per dokumen, dan itu menunggu jaringan. Pada
    6.642 Surat Dirjen, berurutan berarti satu setengah jam. Karena itu di sini
    pengambilan dijalankan paralel dan penyimpanan tetap satu — SQLite hanya
    punya satu penulis, dan menyebar penulisan hanya menukar tunggu jaringan
    dengan tunggu kunci.

    **Batasnya disebut terang:** fungsi ini tidak menanyai sumber resmi sama
    sekali. Memakainya untuk bentuk yang ada di sana akan mengambil salinan
    Ortax padahal salinan penerbitnya tersedia — dan itu menghapus jejak asal
    tanpa alasan. Pemanggilnya yang bertanggung jawab menyaring.
    """
    import threading
    from concurrent.futures import ThreadPoolExecutor

    pastikan_skema(conn)
    lokal = threading.local()

    def ambil(b: dict):
        if not hasattr(lokal, "sesi"):
            lokal.sesi = ORTAX._klien()
        try:
            o = ORTAX.ambil_dokumen(b["sumber_id"], sesi=lokal.sesi,
                                    jenis_code=b["jenis_code"])
            return b, o, None
        except Exception as e:                                # noqa: BLE001
            return b, None, f"{type(e).__name__}: {str(e)[:80]}"

    n: dict[str, int] = {}
    now = datetime.now().isoformat(timespec="seconds")
    with ThreadPoolExecutor(max_workers=pekerja) as pool:
        for i, (b, o, galat) in enumerate(pool.map(ambil, baris), 1):
            doc = dari = reg_id = n_unit = None
            if o:
                doc = _Salinan(url=o["url"], judul=o["judul"], text=o["teks"],
                               jenis=None, tanggal=None, status=None)
                dari = "ortax"
            hasil = ("galat" if galat else
                     "tidak_ditemukan" if doc is None else
                     "tanpa_naskah" if not doc.text else "masuk")
            if hasil == "masuk":
                reg_id, n_unit = _simpan(conn, b, doc, dari)
                if reg_id is None:
                    hasil = "gagal_simpan"
            conn.execute(
                "INSERT OR REPLACE INTO pengisian"
                "(sumber_id,reg_id,jenis_code,nomor_teks,tahun,hasil,dari,url,"
                " dicoba,n_unit,waktu) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (b["sumber_id"], reg_id, b["jenis_code"], b["nomor_teks"],
                 b["tahun"], hasil, dari, doc.url if doc else None,
                 galat or "ortax:hanya", n_unit or 0, now))
            n[hasil] = n.get(hasil, 0) + 1
            if i % 100 == 0 or i == len(baris):
                conn.commit()
                progress(f"  {i}/{len(baris)} — {n}")
    conn.commit()
    return n
