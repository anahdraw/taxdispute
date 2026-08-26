"""Verifikasi status keberlakuan ke repositori peraturan lain.

Sebagian kasus di antrean tinjauan tidak dapat diputus dari data yang sudah
dimiliki. Contoh yang paling banyak: telusur relasi menyimpulkan sebuah aturan
sudah dicabut, sementara situs DJP masih menyebutnya aktif. Menebak salah satu
sama saja melempar koin — dan salah tebak di sini berarti menyatakan aturan yang
hidup itu mati, atau sebaliknya.

Yang dapat memutuskannya adalah **penerbit lain yang memuat dokumen yang sama**.
Tiga repositori diperiksa berurutan:

    peraturan.go.id   — JDIH Nasional, sumber resmi lintas kementerian
    JDIH Kemenkeu     — penerbit langsung untuk PMK dan KMK
    JDIH BPK          — basis data peraturan dengan penandaan status yang rapi

**Yang menentukan bukan jumlah sumber, melainkan kesepakatannya.** Dua sumber
yang sepakat lebih berarti daripada tiga sumber yang berselisih. Bila mereka
berselisih, kasusnya tetap terbuka — perselisihan antar penerbit resmi bukan
sesuatu yang boleh diselesaikan dengan suara terbanyak oleh program.

**Dasar keputusan disimpan, bukan disimpulkan ulang.** Setiap pemeriksaan
mencatat nama sumber, URL persisnya, label status apa adanya, dan waktu
pengambilan. Enam bulan lagi, ketika seseorang bertanya "atas dasar apa ini
dinyatakan dicabut?", jawabannya harus dapat ditunjukkan, bukan dijalankan
ulang dan diharapkan sama.

**Hanya kasus yang benar-benar tidak dimuat sumber mana pun yang masuk ke
"belum terselesaikan".** Itu pun dengan alasan yang tercatat: bukan "gagal",
melainkan "tiga repositori diperiksa pada tanggal sekian, tidak satu pun
memuatnya".
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime

from .crawl import Fetcher
from .normalize import normalize_nomor
from .sources import bpk as BPK
from .sources import jdih_kemenkeu as JKM
from .sources import peraturan_go_id as PGI

SUMBER = [("peraturan.go.id", PGI), ("jdih-kemenkeu", JKM), ("jdih-bpk", BPK)]

# Repositori resmi — penerbitnya sendiri atau lembaga negara. Hanya sumber di
# daftar ini yang dapat menyelesaikan satu kasus sendirian.
#
# DDTC sengaja tidak masuk. Statusnya terkurasi dan berguna, tetapi ia penerbit
# swasta: bila hanya DDTC yang menyatakan sesuatu, yang kita punya adalah
# pembacaan pihak ketiga, bukan pernyataan penerbitnya. Karena itu ia
# menguatkan kesepakatan yang sudah ada dan menaikkan perkara ke perhatian
# peninjau, tetapi tidak memutus sendiri.
SUMBER_RESMI = {"peraturan.go.id", "jdih-kemenkeu", "jdih-bpk"}

SKEMA = """
CREATE TABLE IF NOT EXISTS verifikasi (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reg_id        TEXT NOT NULL,
  sumber        TEXT NOT NULL,
  ditemukan     INTEGER DEFAULT 0,
  status_mentah TEXT,        -- label apa adanya dari sumber, tanpa ditafsir
  status_baku   TEXT,        -- berlaku|dicabut|diubah|tidak_diketahui
  pencabut      TEXT,        -- dari relasi sumber, bila disebutkan
  url           TEXT,
  judul         TEXT,
  waktu         TEXT,
  galat         TEXT
);
CREATE INDEX IF NOT EXISTS ix_verif_reg ON verifikasi(reg_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_verif_unik ON verifikasi(reg_id, sumber);
"""

# Label status ditulis berbeda-beda di tiap repositori. Pemetaan ini sengaja
# konservatif: apa pun yang tidak dikenali menjadi 'tidak_diketahui', bukan
# 'berlaku'. Menganggap yang tak dikenal sebagai berlaku adalah cara diam-diam
# menghidupkan kembali aturan yang sudah mati.
# Urutannya menentukan. "Sebagian sudah tidak berlaku" harus diperiksa SEBELUM
# "tidak berlaku", karena kalau tidak, pencabutan sebagian terbaca sebagai
# pencabutan penuh — dan itu mematikan ketentuan yang justru masih berlaku.
# Melebihkan pencabutan sama merusaknya dengan melewatkannya; bedanya, yang ini
# tampak seperti kehati-hatian.
_PETA = [
    (r"sebagian\s+(?:sudah\s+)?tidak\s+berlaku|dicabut\s+sebagian",
     "dicabut_sebagian"),
    (r"tidak\s+berlaku|dicabut|dinyatakan\s+tidak\s+berlaku|revoked", "dicabut"),
    (r"diubah|diperbarui|amended|disempurnakan|penyempurnaan|perubahan",
     "diubah"),
    (r"berlaku|aktif|masih\s+berlaku|valid|in\s*force", "berlaku"),
]


def bakukan(label: str | None) -> str:
    t = (label or "").strip().lower()
    if not t:
        return "tidak_diketahui"
    for pola, hasil in _PETA:
        if re.search(pola, t):
            return hasil
    return "tidak_diketahui"


def _masih_hidup(s: str) -> bool | None:
    """None berarti sumbernya tidak menyatakan apa-apa tentang keberlakuan.

    `dicabut_sebagian` sengaja None, bukan True dan bukan False. Dokumennya
    sebagian masih berlaku dan sebagian tidak, jadi tidak ada satu jawaban yang
    benar pada tingkat dokumen — dan memaksakan salah satunya akan membuat
    pembacaan yang salah tampak pasti. Labelnya tetap tersimpan sebagai bukti
    bagi peninjau, yang dapat memeriksa pasal mana yang dicabut.
    """
    if s in ("berlaku", "diubah"):
        return True
    if s == "dicabut":
        return False
    return None


def pastikan_skema(conn) -> None:
    try:
        conn.executescript(SKEMA)
        kolom = [r[1] for r in conn.execute("PRAGMA table_info(temuan)")]
        if "sumber_resolusi" not in kolom:
            # Dasar keputusan disimpan bersama kasusnya, bukan hanya di tabel
            # verifikasi, agar kartu tinjauan dapat menunjukkannya tanpa
            # menyusun ulang riwayat pemeriksaan.
            conn.execute("ALTER TABLE temuan ADD COLUMN sumber_resolusi TEXT")
        conn.commit()
    except sqlite3.OperationalError as e:
        if "readonly" not in str(e).lower():
            raise


# --- pemeriksaan ke luar ---------------------------------------------------
def periksa_satu(conn, fetcher, reg: dict, sumber=None) -> list[dict]:
    """Tanyakan status satu peraturan ke setiap repositori.

    Semua sumber ditanya, bukan berhenti pada yang pertama menjawab. Untuk
    mengambil naskah, berhenti di sumber pertama memang benar — satu salinan
    sudah cukup. Untuk memutuskan status, justru kesepakatan antar sumber yang
    menjadi dasarnya, dan itu tidak dapat diketahui tanpa bertanya kepada
    semuanya.
    """
    pastikan_skema(conn)
    rid = normalize_nomor(reg["nomor_raw"] or "", None, reg["tahun"])
    nomor = rid.nomor if rid else (reg["nomor_raw"] or "")
    now = datetime.now().isoformat(timespec="seconds")
    hasil = []

    for nama, mod in (sumber or SUMBER):
        arg = nomor if mod is PGI else reg["nomor_raw"]
        baris = {"reg_id": reg["id"], "sumber": nama, "ditemukan": 0,
                 "status_mentah": None, "status_baku": "tidak_diketahui",
                 "pencabut": None, "url": None, "judul": None,
                 "waktu": now, "galat": None}
        try:
            doc = mod.fetch(fetcher, reg["jenis_code"], arg, reg["tahun"],
                            want_pdf=False, pdf_dir=None)
        except Exception as e:                                # noqa: BLE001
            baris["galat"] = f"{type(e).__name__}: {str(e)[:80]}"
            doc = None

        if doc is not None:
            # HANYA relasi masuk yang membuktikan dokumen ini dicabut.
            # `MENCABUT` menunjuk arah sebaliknya — peraturan yang DIA cabut —
            # dan memperlakukannya sama akan menyatakan setiap peraturan
            # pencabut sebagai dirinya sendiri telah dicabut. PMK 72/2023
            # mencabut empat PMK lama; ia sendiri masih berlaku.
            pencabut = [r.target_text for r in (doc.relations or [])
                        if r.type == "DICABUT_OLEH"]
            baris.update({
                "ditemukan": 1, "status_mentah": doc.status,
                "status_baku": bakukan(doc.status),
                "pencabut": "; ".join(pencabut[:3]) or None,
                "url": doc.url, "judul": doc.judul,
            })
            # Sebagian repositori tidak memasang label status sama sekali,
            # tetapi mencantumkan peraturan yang mencabutnya. Relasi itu bukti
            # yang lebih kuat daripada label kosong.
            if baris["status_baku"] == "tidak_diketahui" and pencabut:
                baris["status_baku"] = "dicabut"
                baris["status_mentah"] = (baris["status_mentah"] or
                                          "(tanpa label; disimpulkan dari relasi "
                                          "pencabutan yang tercantum)")
        hasil.append(baris)
        conn.execute(
            "INSERT OR REPLACE INTO verifikasi"
            "(reg_id,sumber,ditemukan,status_mentah,status_baku,pencabut,url,"
            " judul,waktu,galat) VALUES (?,?,?,?,?,?,?,?,?,?)",
            tuple(baris[k] for k in ("reg_id", "sumber", "ditemukan",
                                     "status_mentah", "status_baku", "pencabut",
                                     "url", "judul", "waktu", "galat")))
    conn.commit()
    return hasil


# --- penilaian -------------------------------------------------------------
def nilai(conn, reg_id: str) -> dict:
    """Simpulkan dari seluruh jawaban sumber untuk satu peraturan."""
    pastikan_skema(conn)
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM verifikasi WHERE reg_id=? ORDER BY sumber", (reg_id,))]
    ada = [r for r in rows if r["ditemukan"]]
    bersuara = [r for r in ada if _masih_hidup(r["status_baku"]) is not None]

    dasar = {"diperiksa": [r["sumber"] for r in rows],
             "memuat": [r["sumber"] for r in ada],
             "bukti": [{"sumber": r["sumber"], "status": r["status_mentah"],
                        "baku": r["status_baku"], "pencabut": r["pencabut"],
                        "url": r["url"], "waktu": r["waktu"]} for r in ada]}

    if not rows:
        return {"putusan": "belum_diperiksa", "keyakinan": 0.0, "dasar": dasar,
                "alasan": "belum ada pemeriksaan ke sumber lain"}

    if not ada:
        galat = [r for r in rows if r["galat"]]
        if galat:
            # Sumber tidak terjangkau berbeda dari sumber yang tidak memuat.
            # Menyamakan keduanya akan mengubah gangguan jaringan menjadi
            # pernyataan tentang isi repositori.
            return {"putusan": "tak_terjangkau", "keyakinan": 0.0, "dasar": dasar,
                    "alasan": f'{len(galat)} dari {len(rows)} sumber gagal '
                              f'dihubungi; hasilnya belum dapat dipakai'}
        return {"putusan": "tidak_ada_sumber_lain", "keyakinan": 0.0,
                "dasar": dasar,
                "alasan": f'{len(rows)} repositori diperiksa, tidak satu pun '
                          f'memuat dokumen ini'}

    if not bersuara:
        return {"putusan": "sumber_bisu", "keyakinan": 0.0, "dasar": dasar,
                "alasan": f'{len(ada)} sumber memuat dokumennya, tetapi tidak '
                          f'satu pun menyatakan status keberlakuannya'}

    hidup = {r["sumber"] for r in bersuara if _masih_hidup(r["status_baku"])}
    mati = {r["sumber"] for r in bersuara if not _masih_hidup(r["status_baku"])}

    if hidup and mati:
        return {"putusan": "sumber_berselisih", "keyakinan": 0.0, "dasar": dasar,
                "alasan": f'{", ".join(sorted(hidup))} menyatakan masih berlaku, '
                          f'sedangkan {", ".join(sorted(mati))} menyatakan '
                          f'dicabut. Perselisihan antar penerbit resmi tidak '
                          f'diputuskan oleh program.'}

    sepakat = sorted(hidup or mati)
    status = "berlaku" if hidup else "dicabut"
    # Keyakinan naik menurut jumlah sumber RESMI yang sepakat, dan tidak pernah
    # mencapai satu: repositori pun dapat tertinggal memperbarui. Sumber
    # sekunder yang ikut sepakat menambah sedikit, tetapi tanpa satu pun sumber
    # resmi keyakinannya tinggal di bawah ambang — kasusnya tetap ditinjau
    # manusia alih-alih diselesaikan program.
    resmi = [x for x in sepakat if x in SUMBER_RESMI]
    lain = [x for x in sepakat if x not in SUMBER_RESMI]
    keyakinan = {0: 0.62, 1: 0.88, 2: 0.94}.get(len(resmi), 0.96)
    if resmi and lain:
        keyakinan = min(0.97, keyakinan + 0.02)
    catatan = (f'{len(sepakat)} sumber sepakat ({", ".join(sepakat)}) '
               f'bahwa peraturan ini {status}')
    if not resmi:
        catatan += ("; tidak ada repositori resmi di antaranya, jadi belum "
                    "cukup untuk diselesaikan tanpa peninjau")
    return {"putusan": status, "keyakinan": keyakinan, "dasar": dasar,
            "alasan": catatan}


def jalankan(conn, reg_ids: list[str], progress=print,
             jeda: float = 1.0) -> dict:
    """Periksa sekumpulan peraturan, laporkan sebaran putusannya."""
    pastikan_skema(conn)
    fetcher = Fetcher(delay=jeda)
    ringkas: dict[str, int] = {}
    for i, rid in enumerate(reg_ids, 1):
        reg = conn.execute(
            "SELECT id,canonical,nomor_raw,jenis_code,tahun FROM regulation "
            "WHERE id=?", (rid,)).fetchone()
        if not reg:
            continue
        periksa_satu(conn, fetcher, dict(reg))
        p = nilai(conn, rid)["putusan"]
        ringkas[p] = ringkas.get(p, 0) + 1
        if progress and i % 5 == 0:
            progress(f"  {i}/{len(reg_ids)} — {ringkas}")
    return ringkas


# --- penyelesaian kasus ----------------------------------------------------
AMBANG_SUMBER = 0.88      # satu sumber resmi yang jelas sudah cukup


def selesaikan(conn, ambang: float = AMBANG_SUMBER) -> dict:
    """Tutup kasus status yang sudah dapat diputus oleh sumber luar.

    Hanya kasus `konflik_status` yang ditangani: hanya untuk itu jawaban
    repositori lain berarti langsung. Sumber luar tidak dapat memberi tahu
    apakah pengurai kita gagal, atau nomor mana yang benar pada kop naskah.

    Setiap kasus yang ditutup membawa `sumber_resolusi` berisi nama sumber,
    URL, label apa adanya, dan waktu pengambilan — sehingga dasarnya dapat
    ditunjukkan kembali, bukan dijalankan ulang dan diharapkan sama.
    """
    from .tinjau import _terapkan

    pastikan_skema(conn)
    now = datetime.now().isoformat(timespec="seconds")
    n = {"ditutup": 0, "kolom_diubah": 0, "tetap_terbuka": 0,
         "tanpa_sumber": 0, "berselisih": 0}

    rows = conn.execute(
        "SELECT DISTINCT reg_id FROM verifikasi").fetchall()
    for row in rows:
        rid = row["reg_id"]
        t = conn.execute(
            "SELECT id, status FROM temuan WHERE id=? AND periksa='konflik_status'",
            (f"status:{rid}",)).fetchone()
        if not t or t["status"] != "antre":
            continue

        v = nilai(conn, rid)
        catatan = json.dumps({"putusan": v["putusan"], "alasan": v["alasan"],
                              "keyakinan": v["keyakinan"], "diperiksa_pada": now,
                              **v["dasar"]}, ensure_ascii=False)
        conn.execute("UPDATE temuan SET sumber_resolusi=? WHERE id=?",
                     (catatan, t["id"]))

        if v["putusan"] not in ("berlaku", "dicabut") or v["keyakinan"] < ambang:
            n["tetap_terbuka"] += 1
            if v["putusan"] == "tidak_ada_sumber_lain":
                n["tanpa_sumber"] += 1
            elif v["putusan"] == "sumber_berselisih":
                n["berselisih"] += 1
            continue

        usul = [
            {"tabel": "validity", "baris_id": rid, "kolom": "status_derived",
             "ke": v["putusan"]},
            {"tabel": "validity", "baris_id": rid, "kolom": "reason",
             "ke": f'diverifikasi ke sumber lain: {v["alasan"]}'},
            {"tabel": "validity", "baris_id": rid, "kolom": "agrees_with_site",
             "ke": 1},
        ]
        n["kolom_diubah"] += _terapkan(conn, t["id"], usul, "auto")
        conn.execute("UPDATE temuan SET cara='auto-sumber' WHERE id=?", (t["id"],))
        n["ditutup"] += 1
    conn.commit()
    return n


def antrean(conn, batas: int | None = None) -> list[str]:
    """Kasus status yang menunggu dan belum pernah diperiksa ke sumber lain."""
    pastikan_skema(conn)
    sql = """SELECT t.entitas FROM temuan t
              WHERE t.periksa='konflik_status' AND t.status='antre'
                AND t.entitas NOT IN (SELECT DISTINCT reg_id FROM verifikasi)
              ORDER BY t.keyakinan"""
    if batas:
        sql += f" LIMIT {int(batas)}"
    return [r[0] for r in conn.execute(sql)]


def ringkas(conn) -> dict:
    pastikan_skema(conn)
    per_sumber = [dict(r) for r in conn.execute(
        """SELECT sumber, COUNT(*) diperiksa, SUM(ditemukan) memuat,
                  SUM(galat IS NOT NULL) galat
             FROM verifikasi GROUP BY sumber ORDER BY memuat DESC""")]
    return {
        "peraturan_diperiksa": conn.execute(
            "SELECT COUNT(DISTINCT reg_id) FROM verifikasi").fetchone()[0],
        "per_sumber": per_sumber,
        "belum_diperiksa": len(antrean(conn)),
        "ditutup_oleh_sumber": conn.execute(
            "SELECT COUNT(*) FROM temuan WHERE cara='auto-sumber'").fetchone()[0],
    }
