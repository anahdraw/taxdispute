"""Antrean tinjauan: mengubah temuan mutu menjadi kasus yang dapat diputuskan.

Melaporkan "1.604 status berselisih" tidak menolong siapa pun. Yang menolong
adalah satu kasus pada satu waktu, lengkap dengan: apa yang salah, bukti apa
yang mendasarinya, apa usul perbaikannya, dan seberapa yakin usul itu.

Tiga prinsip yang menentukan bentuk modul ini:

**Perbaikan otomatis harus dapat dibatalkan.** Setiap perubahan menulis baris
audit berisi nilai lamanya. Tanpa itu, "perbaikan otomatis" hanyalah kerusakan
yang tidak tercatat. Tidak ada yang dihapus — entri kembar ditandai, bukan
dibuang, karena menghapus data resmi berdasarkan tebakan kita sendiri adalah
kerugian yang tidak dapat dipulihkan.

**Keyakinan harus punya alasan.** Angka 0,93 tanpa kalimat penjelas tidak dapat
diperiksa. Karena itu setiap kasus membawa `keyakinan_alasan` yang menyebutkan
dasar angkanya.

**Arah kesalahan menentukan boleh-tidaknya otomatis.** Bila graf menemukan LEBIH
SEDIKIT daripada situs — misalnya situs bilang dicabut, graf tidak menemukan
pencabutnya — itu keterbatasan yang sudah diketahui: relasinya belum ternormalkan
atau pencabutnya di luar korpus. Mengikuti situs aman. Sebaliknya, bila graf
mengklaim LEBIH BANYAK — graf bilang dicabut padahal situs bilang aktif — itu
arah berbahaya: kita menyatakan sebuah aturan mati berdasarkan telusur kita
sendiri. Kasus semacam itu tidak pernah diselesaikan otomatis.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime

from . import profil

AMBANG_AUTO = 0.90        # di bawah ini selalu menunggu manusia

SKEMA = """
CREATE TABLE IF NOT EXISTS temuan (
  id            TEXT PRIMARY KEY,   -- deterministik, agar bangun ulang tidak menggandakan
  periksa       TEXT NOT NULL,
  keparahan     TEXT,
  entitas       TEXT,               -- reg_id / id relasi / kunci kelompok
  judul         TEXT,
  penjelasan    TEXT,               -- apa yang salah dan mengapa itu penting
  bukti         TEXT,               -- JSON: data mentah yang mendasarinya
  usul          TEXT,               -- JSON: daftar perubahan yang diusulkan
  usul_teks     TEXT,               -- usul dalam bahasa manusia
  keyakinan     REAL,
  keyakinan_alasan TEXT,
  -- antre = menunggu manusia. Ada-tidaknya usul otomatis adalah SIFAT kasus
  -- (kolom ada_usul), bukan status: kasus tanpa usul tetap perlu dikerjakan.
  status        TEXT DEFAULT 'antre',  -- antre|auto_selesai|diterima|ditolak|ditunda
  ada_usul      INTEGER DEFAULT 0,
  cara          TEXT,               -- auto | manual
  catatan       TEXT,
  dibuat        TEXT,
  diputus       TEXT
);
CREATE INDEX IF NOT EXISTS ix_temuan_status ON temuan(status, keparahan);
CREATE INDEX IF NOT EXISTS ix_temuan_periksa ON temuan(periksa);

CREATE TABLE IF NOT EXISTS perbaikan (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  temuan_id   TEXT NOT NULL,
  tabel       TEXT NOT NULL,
  baris_id    TEXT NOT NULL,
  kolom       TEXT NOT NULL,
  nilai_lama  TEXT,
  nilai_baru  TEXT,
  waktu       TEXT,
  dibatalkan  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_perbaikan_temuan ON perbaikan(temuan_id);
"""


@dataclass
class Temuan:
    id: str
    periksa: str
    keparahan: str
    entitas: str
    judul: str
    penjelasan: str
    keyakinan: float
    keyakinan_alasan: str
    bukti: dict = field(default_factory=dict)
    usul: list = field(default_factory=list)   # [{tabel,baris_id,kolom,ke}]
    usul_teks: str = ""


def pastikan_skema(conn) -> None:
    """Buat tabel bila belum ada.

    Pembacaan memakai koneksi baca-saja, dan di sana pembuatan tabel pasti
    gagal. Kegagalan itu tidak berarti apa-apa: kalau koneksinya baca-saja,
    tabelnya sudah pasti ada — tidak ada cara membaca dari tabel yang belum
    pernah dibuat. Jadi galat ini diabaikan, bukan dilaporkan.
    """
    try:
        conn.executescript(SKEMA)
        conn.commit()
    except sqlite3.OperationalError as e:
        if "readonly" not in str(e).lower():
            raise


# --- pembangkit kasus ------------------------------------------------------
# Setiap pembangkit menghasilkan Temuan, bukan angka. Idnya deterministik agar
# menjalankan ulang tidak melahirkan kasus kembar dan tidak menghapus keputusan
# manusia yang sudah diambil.

_URUT_BERLAKU = {"berlaku": 0, "diubah": 1, "dicabut_sebagian": 2, "dicabut": 3,
                 "sudah_dicabut": 3}


def _masih_berlaku(status: str | None) -> bool:
    """Apakah status ini berarti aturannya masih hidup?

    Perubahan tidak mengakhiri keberlakuan: aturan yang diubah tetap berlaku
    dalam rumusannya yang baru. Hanya pencabutan yang mengakhiri. Membedakan
    keduanya membuat sebagian besar "konflik" hilang — karena memang bukan
    konflik, melainkan dua cara menyebut keadaan yang sama.
    """
    return _URUT_BERLAKU.get(status or "", 0) < 3


def _situs_ke_status(label: str | None) -> str:
    t = (label or "").lower()
    if "sudah dicabut" in t or t.strip() == "dicabut":
        return "dicabut"
    if "dicabut sebagian" in t:
        return "dicabut_sebagian"
    if "diubah" in t or "disempurnakan" in t:
        return "diubah"
    if "aktif" in t or "berlaku" in t:
        return "berlaku"
    return "tidak_diketahui"


def dari_konflik_status(conn) -> list[Temuan]:
    out = []
    for r in conn.execute(
            """SELECT v.reg_id, r.canonical, r.jenis, r.judul, r.status_site,
                      v.status_derived, v.reason, v.superseded_by
                 FROM validity v JOIN regulation r ON r.id=v.reg_id
                WHERE v.agrees_with_site=0""").fetchall():
        situs = _situs_ke_status(r["status_site"])
        graf = r["status_derived"]
        bukti = {"label_situs": r["status_site"], "situs_dibaca": situs,
                 "status_graf": graf, "alasan_graf": r["reason"],
                 "digantikan_oleh": r["superseded_by"]}
        tid = f"status:{r['reg_id']}"

        if _masih_berlaku(situs) and _masih_berlaku(graf):
            out.append(Temuan(
                tid, "konflik_status", "ringan", r["reg_id"],
                f'{r["canonical"]} — bukan konflik, hanya beda derajat',
                f'Situs menyebut "{r["status_site"]}", telusur relasi menyimpulkan '
                f'"{graf}". Keduanya sama-sama berarti aturan ini MASIH BERLAKU — '
                f'perubahan tidak mengakhiri keberlakuan, hanya mengubah rumusan. '
                f'Selisihnya ada pada derajat, bukan pada berlaku atau tidaknya.',
                0.97, "kedua status sama-sama berarti masih berlaku; tidak ada "
                      "pertentangan yang berakibat pada jawaban",
                bukti,
                [{"tabel": "validity", "baris_id": r["reg_id"],
                  "kolom": "agrees_with_site", "ke": 1}],
                "Tandai cocok — perbedaannya hanya penamaan derajat."))

        elif not _masih_berlaku(situs) and _masih_berlaku(graf):
            out.append(Temuan(
                tid, "konflik_status", "berat", r["reg_id"],
                f'{r["canonical"]} — situs menyatakan dicabut, graf belum menemukan pencabutnya',
                f'Situs DJP menyebut "{r["status_site"]}", tetapi telusur relasi '
                f'masih menyimpulkan "{graf}" karena tidak ada satu pun relasi '
                f'MENCABUT yang mengarah ke dokumen ini. Ketiadaan relasi bukan '
                f'bukti bahwa pencabutan tidak terjadi — pencabutnya bisa berada '
                f'di luar korpus, atau nomornya belum ternormalkan. Dalam arah '
                f'ini penerbitnya lebih tahu daripada telusur kita.',
                0.93, "arah aman: graf menemukan lebih sedikit dari situs, dan "
                      "ketiadaan sisi relasi adalah keterbatasan yang sudah dikenal",
                bukti,
                [{"tabel": "validity", "baris_id": r["reg_id"],
                  "kolom": "status_derived", "ke": situs},
                 {"tabel": "validity", "baris_id": r["reg_id"],
                  "kolom": "reason", "ke": "mengikuti label situs; graf tidak "
                                           "menemukan pencabutnya"},
                 {"tabel": "validity", "baris_id": r["reg_id"],
                  "kolom": "agrees_with_site", "ke": 1}],
                f'Ikuti situs: ubah status menjadi "{situs}".'))

        else:
            out.append(Temuan(
                tid, "konflik_status", "berat", r["reg_id"],
                f'{r["canonical"]} — graf menyatakan dicabut, situs menyebut masih aktif',
                f'Telusur relasi menyimpulkan "{graf}" berdasarkan {r["reason"] or "—"}, '
                f'tetapi situs DJP masih menyebut "{r["status_site"]}". Ini arah '
                f'yang berbahaya: kita akan menyatakan sebuah aturan mati '
                f'berdasarkan telusur sendiri, melawan penerbitnya. Bisa jadi '
                f'relasi pencabutnya salah arah, pencabutnya belum berlaku, atau '
                f'situsnya yang belum diperbarui. Ketiganya menuntut pemeriksaan '
                f'naskah, bukan tebakan.',
                0.40, "arah berbahaya: graf mengklaim lebih dari situs; salah "
                      "putus di sini membuat aturan yang hidup tampak mati",
                bukti, [],
                "Periksa naskah pencabutnya, lalu putuskan manual."))
    return out


def dari_naskah_kembar(conn) -> list[Temuan]:
    """Entri ganda — ditandai, tidak pernah dihapus."""
    out = []
    rows = conn.execute(
        "SELECT id, canonical, jenis, jenis_code, nomor_raw, tahun, judul, "
        "       body_text FROM regulation "
        " WHERE has_body=1 AND length(body_text)>400").fetchall()
    kel: dict[tuple, list] = {}
    sidik: dict[str, list] = {}
    for r in rows:
        nomor = re.sub(r"\s+", "", (r["nomor_raw"] or "").lower())
        if nomor and r["tahun"]:
            kel.setdefault((nomor, r["tahun"]), []).append(r)
        h = hashlib.sha1(
            re.sub(r"\s+", " ", r["body_text"]).strip().lower().encode()).hexdigest()
        sidik.setdefault(h, []).append(r)

    # Naskah yang identik aksara demi aksara tetapi bernomor berbeda. Ini pola
    # yang berlainan dari jenis berselisih, dan tidak boleh diputus dengan cara
    # yang sama: di sini nomornya memang berbeda, sehingga tidak ada dasar
    # untuk menyatakan salah satunya keliru. Yang pasti hanyalah bahwa isinya
    # sama, dan itu sendiri perlu diketahui saat menyitir.
    for anggota in sidik.values():
        if len(anggota) < 2:
            continue
        ids = sorted(a["id"] for a in anggota)
        out.append(Temuan(
            "kembar-isi:" + "|".join(ids), "naskah_kembar", "sedang", ids[0],
            f'{anggota[0]["canonical"]} — naskah identik dengan '
            f'{len(anggota) - 1} entri lain',
            f'{len(anggota)} entri memuat naskah yang sama persis: '
            f'{", ".join(a["canonical"] for a in anggota)}. Nomornya berbeda, '
            f'jadi tidak ada dasar untuk menyatakan salah satunya keliru — bisa '
            f'jadi memang dua penomoran resmi untuk dokumen yang sama, bisa juga '
            f'berkas yang tertukar saat pengunduhan. Yang pasti: mencari '
            f'peraturan ini akan memunculkannya berkali-kali, dan angka jumlah '
            f'peraturan menghitungnya lebih dari sekali.',
            0.55, "keidentikan isi dapat dipastikan; yang tidak dapat dipastikan "
                  "adalah entri mana yang seharusnya ada",
            {"anggota": [{"id": a["id"], "canonical": a["canonical"],
                          "jenis_code": a["jenis_code"]} for a in anggota],
             "judul": anggota[0]["judul"]},
            [], "Bandingkan dengan katalog DJP, tentukan nomor yang benar."))

    # Judul peraturan menyebut jenisnya sendiri. Itu bukti dari dokumen, bukan
    # tebakan dari pola penomoran, jadi ia yang dipakai memutus label mana yang
    # benar di antara entri yang berselisih.
    JENIS_DARI_JUDUL = [
        (r"^PERUBAHAN\s+ATAS\s+PERATURAN\s+PEMERINTAH\b", "PP"),
        (r"^PERUBAHAN\s+ATAS\s+PERATURAN\s+PRESIDEN\b", "PERPRES"),
        (r"^PERUBAHAN\s+ATAS\s+PERATURAN\s+MENTERI\s+KEUANGAN\b", "PMK"),
        (r"^PERUBAHAN\s+ATAS\s+UNDANG-UNDANG\b", "UU"),
    ]

    for (nomor, tahun), anggota in kel.items():
        if len(anggota) < 2:
            continue
        jenis = {a["jenis_code"] for a in anggota}
        judul_sama = len({re.sub(r"\W+", "", (a["judul"] or "").lower())[:80]
                          for a in anggota}) == 1
        if len(jenis) < 2 or not judul_sama:
            continue

        judul = anggota[0]["judul"] or ""
        benar = None
        for pola, kode in JENIS_DARI_JUDUL:
            if re.match(pola, judul.strip(), re.I):
                benar = kode
                break

        ids = sorted(a["id"] for a in anggota)
        tid = "kembar:" + "|".join(ids)
        bukti = {"anggota": [{"id": a["id"], "canonical": a["canonical"],
                              "jenis_code": a["jenis_code"]} for a in anggota],
                 "judul": judul, "jenis_dari_judul": benar}

        if benar and benar in jenis:
            salah = [a for a in anggota if a["jenis_code"] != benar]
            induk = next(a for a in anggota if a["jenis_code"] == benar)
            out.append(Temuan(
                tid, "naskah_kembar", "sedang", induk["id"],
                f'{induk["canonical"]} tercatat {len(anggota)}x dengan jenis berbeda',
                f'Nomor {nomor} tahun {tahun} terdaftar sebagai '
                f'{", ".join(sorted(x for x in jenis if x))} dengan judul yang '
                f'sama persis. Judulnya sendiri berbunyi "{judul[:70]}", yang '
                f'menyebut jenisnya secara tegas: {benar}. Entri lain berlabel '
                f'keliru. Yang keliru TIDAK dihapus — hanya ditandai sebagai '
                f'duplikat, karena menghapus catatan resmi berdasarkan simpulan '
                f'kita sendiri tidak dapat dipulihkan bila ternyata salah.',
                0.94, "judul dokumen menyebut jenisnya sendiri secara eksplisit; "
                      "ini bukti dari naskah, bukan tebakan dari pola nomor",
                bukti,
                [{"tabel": "regulation", "baris_id": a["id"],
                  "kolom": "status_site", "ke": f'Duplikat dari {induk["canonical"]}'}
                 for a in salah],
                f'Tandai {len(salah)} entri sebagai duplikat dari '
                f'{induk["canonical"]}; tidak ada yang dihapus.'))
        else:
            out.append(Temuan(
                tid, "naskah_kembar", "sedang", anggota[0]["id"],
                f'{anggota[0]["canonical"]} tercatat {len(anggota)}x — jenis mana yang benar?',
                f'Nomor {nomor} tahun {tahun} terdaftar sebagai '
                f'{", ".join(sorted(x for x in jenis if x))}, tetapi judulnya '
                f'("{judul[:70]}") tidak menyebut jenisnya, sehingga tidak ada '
                f'dasar dari dokumen untuk memutus mana yang benar.',
                0.50, "judul tidak menyebut jenis; memutus berarti menebak",
                bukti, [], "Buka naskahnya, tentukan jenis yang benar."))
    return out


def dari_identitas(conn) -> list[Temuan]:
    """Nomor di kop naskah berbeda dari nomor di katalog."""
    out = []
    for r in conn.execute(
            "SELECT id, canonical, canonical_body, jenis, judul, url "
            "FROM regulation WHERE identity_ok=0").fetchall():
        kat, kop = r["canonical"] or "", r["canonical_body"] or ""
        # Angka pokok dan tahun adalah inti identitas; kode unit di tengah
        # ("KM.10", "MK") adalah penamaan internal yang kerap ditulis berbeda
        # antara kop dan katalog tanpa mengubah dokumen yang ditunjuk.
        ak = re.findall(r"\d+", kat)
        ap = re.findall(r"\d+", kop)
        inti_sama = bool(ak and ap and ak[0] == ap[0] and ak[-1] == ap[-1])
        bukti = {"katalog": kat, "kop_naskah": kop, "url": r["url"],
                 "angka_katalog": ak, "angka_kop": ap}
        tid = f"identitas:{r['id']}"

        if inti_sama:
            out.append(Temuan(
                tid, "identitas", "ringan", r["id"],
                f'{kat} — beda penulisan, bukan beda dokumen',
                f'Kop naskah berbunyi "{kop}", katalog mencatat "{kat}". Nomor '
                f'pokok ({ak[0]}) dan tahunnya ({ak[-1]}) sama; yang berbeda '
                f'hanya kode unit di tengahnya, yang memang ditulis tidak seragam '
                f'antara kop dan katalog. Ini bukan dokumen yang berlainan.',
                0.92, "nomor pokok dan tahun cocok; hanya kode unit yang berbeda "
                      "penulisan, dan itu tidak mengubah dokumen yang ditunjuk",
                bukti,
                [{"tabel": "regulation", "baris_id": r["id"],
                  "kolom": "identity_ok", "ke": 1}],
                "Tandai cocok — perbedaannya pada penulisan kode unit."))
        else:
            out.append(Temuan(
                tid, "identitas", "berat", r["id"],
                f'{kat} — kop naskah menyebut nomor lain: {kop}',
                f'Katalog mencatat "{kat}" tetapi kop naskahnya berbunyi "{kop}". '
                f'Nomor pokoknya berbeda, jadi salah satu pasti keliru: entah '
                f'berkas yang terlampir bukan peraturan ini, entah pembacaan kop '
                f'menangkap kutipan di badan naskah. Selama belum diputus, setiap '
                f'sitasi dari dokumen ini berisiko menunjuk peraturan yang salah.',
                0.35, "nomor pokok berbeda; menentukan mana yang benar menuntut "
                      "membuka naskahnya",
                bukti, [],
                "Buka naskah, bandingkan dengan katalog, lalu putuskan."))
    return out


def dari_hierarki(conn) -> list[Temuan]:
    """Relasi yang mustahil menurut UU 12/2011 Pasal 7."""
    out = []
    for r in conn.execute(
            """SELECT rel.id, rel.src_id, rel.dst_id, rel.type, rel.conflict,
                      rel.evidence, rel.method, rel.confidence,
                      s.canonical src, s.jenis_code sj,
                      d.canonical dst, d.jenis_code dj
                 FROM relation rel
                 JOIN regulation s ON s.id=rel.src_id
                 JOIN regulation d ON d.id=rel.dst_id
                WHERE rel.conflict LIKE '%hierarki%'""").fetchall():
        # Id kasus dibentuk dari ISI relasinya, bukan dari `relation.id`.
        # Kolom itu autoincrement dan diberi ulang setiap kali relasi dibangun
        # ulang, sehingga pelanggaran BARU dapat mewarisi id — dan karenanya
        # status "sudah diselesaikan" — milik kasus lama yang tidak berhubungan.
        # Akibatnya 51 pelanggaran lolos tanpa pernah ditangani.
        kunci = f'hierarki:{r["src_id"]}~{r["type"]}~{r["dst_id"]}'
        out.append(Temuan(
            kunci, "hierarki", "berat", str(r["id"]),
            f'{r["src"]} {r["type"]} {r["dst"]} — mustahil secara hukum',
            f'Relasi ini menyatakan {r["sj"]} ({r["src"]}) {r["type"].lower()} '
            f'{r["dj"]} ({r["dst"]}). Menurut UU 12/2011 Pasal 7, peraturan yang '
            f'lebih rendah tidak dapat mencabut atau mengubah yang lebih tinggi. '
            f'Sumbernya adalah {r["method"] or "aturan ekstraksi"}, dan sebagian '
            f'temuan semacam ini berasal dari data resmi DJP sendiri — bukan '
            f'salah urai.\n\nPerhitungan masa berlaku SUDAH melewati relasi ini, '
            f'jadi statusnya tidak terpengaruh. Yang belum: konsumen lain '
            f'(ekspor graf, perluasan hasil pencarian) menyaring berdasarkan '
            f'`confidence`, dan relasi ini masih berkeyakinan '
            f'{r["confidence"] or 0:.2f} sehingga masih lolos. Menurunkannya di '
            f'bawah ambang 0,75 membuat pengecualian itu berlaku di semua '
            f'tempat, bukan hanya di satu fungsi. Relasinya tidak dihapus: '
            f'catatannya tetap menjadi bukti bahwa sumbernya memang berkata '
            f'demikian.',
            0.91, "pelanggaran hierarki dapat dipastikan dari jenis kedua "
                  "dokumen tanpa menafsir isinya; yang tidak pasti hanyalah "
                  "penyebabnya, dan itu tidak diputuskan di sini",
            {"src": r["src"], "dst": r["dst"], "type": r["type"],
             "jenis_src": r["sj"], "jenis_dst": r["dj"],
             "confidence": r["confidence"],
             "bukti_teks": (r["evidence"] or "")[:300], "method": r["method"]},
            # Relasi yang sama dapat tercatat lebih dari sekali dengan
            # keyakinan berbeda. Kunci kasus menyatukannya, jadi usulnya harus
            # menyasar SELURUH baris kembar — kalau tidak, satu diperbaiki dan
            # sisanya lolos dengan keyakinan penuh.
            [{"tabel": "relation", "baris_id": str(x[0]),
              "kolom": "confidence", "ke": 0.2}
             for x in conn.execute(
                 "SELECT id FROM relation WHERE src_id=? AND dst_id=? AND type=?",
                 (r["src_id"], r["dst_id"], r["type"])).fetchall()],
            "Turunkan keyakinan ke 0,20 agar relasi ini tersaring di semua "
            "konsumen; catatan tetap disimpan."))
    return out


# Kode unit yang menandai peraturan di luar lingkup perpajakan: KMK.01 dan
# KM.01 adalah organisasi dan tata kerja, sedangkan "N/P" dan "N/M" adalah
# Keputusan Presiden tentang pengangkatan. Semuanya memang tidak ada di katalog
# pajak, jadi ketidakhadirannya bukan cacat.
_LUAR_LINGKUP = re.compile(r"(KMK\.01|KM\.01|/PMK\.01|^\d+/[PM]$)", re.I)


def dari_sitasi_menggantung(conn) -> list[Temuan]:
    """Rujukan yang tidak tertaut, dikelompokkan per teks rujukan."""
    out = []
    for r in conn.execute(
            """SELECT rel.dst_raw, COUNT(*) n, MIN(rel.type) tipe,
                      MIN(s.canonical) contoh_src
                 FROM relation rel JOIN regulation s ON s.id=rel.src_id
                WHERE rel.dst_id IS NULL AND rel.dst_raw IS NOT NULL
                  AND rel.dst_raw<>''
                GROUP BY rel.dst_raw ORDER BY n DESC""").fetchall():
        raw = r["dst_raw"]
        # Slug yang dipotong panjang membuat rujukan berbeda bertabrakan
        # menjadi satu kasus, dan yang kedua diam-diam hilang. Sidik jari
        # pendek dari teks aslinya menjaga tiap rujukan tetap punya kasusnya
        # sendiri.
        tid = ("gantung:" + re.sub(r"\W+", "-", raw.lower())[:40] + "-"
               + hashlib.sha1(raw.encode()).hexdigest()[:8])
        bukti = {"rujukan": raw, "jumlah_relasi": r["n"], "tipe": r["tipe"],
                 "contoh_perujuk": r["contoh_src"]}
        if _LUAR_LINGKUP.search(raw):
            out.append(Temuan(
                tid, "sitasi_menggantung", "ringan", raw,
                f'"{raw}" dirujuk {r["n"]}x — di luar lingkup katalog pajak',
                f'Rujukan ini muncul {r["n"]} kali tetapi tidak ada di korpus, '
                f'dan memang seharusnya tidak ada: kode unitnya menunjukkan '
                f'peraturan organisasi dan tata kerja atau keputusan pengangkatan, '
                f'bukan peraturan perpajakan. Katalog yang diunduh hanya memuat '
                f'peraturan pajak, jadi ketidakhadiran ini bukan cacat data.',
                0.90, "kode unit pada nomornya menandai ranah non-perpajakan; "
                      "penilaian ini dari pola penomoran resmi, bukan dari isi",
                bukti,
                [],   # tidak ada yang perlu diubah; hanya diklasifikasikan
                "Tandai selesai sebagai di luar lingkup — tidak ada yang perlu diperbaiki."))
        else:
            out.append(Temuan(
                tid, "sitasi_menggantung", "ringan", raw,
                f'"{raw}" dirujuk {r["n"]}x — belum tertaut',
                f'Rujukan ini muncul {r["n"]} kali, antara lain dari '
                f'{r["contoh_src"] or "—"}, tetapi belum tertaut ke dokumen mana '
                f'pun di korpus. Penyebabnya bisa dua: peraturannya belum diunduh, '
                f'atau nomornya tertulis dalam bentuk yang belum dikenali '
                f'penormal. Keduanya perlu diperiksa sebelum diputuskan.',
                0.45, "tidak dapat dipastikan apakah dokumennya hilang atau "
                      "nomornya sekadar belum ternormalkan",
                bukti, [], "Cari nomornya di katalog; bila ada, perbaiki penormalan."))
    return out


def dari_parsing(conn) -> list[Temuan]:
    """Dokumen yang hasil uraiannya tidak wajar bagi bentuknya."""
    out = []
    for r in conn.execute(
            """SELECT r.id, r.canonical, r.jenis, r.jenis_code, r.judul, r.url,
                      SUM(p.pasal IS NOT NULL AND p.pasal GLOB '[0-9]*') np,
                      SUM(p.pasal IS NOT NULL AND p.pasal GLOB '[A-Z]*') nd,
                      SUM(p.bagian_dok='penjelasan') pj, COUNT(p.id) tot,
                      length(r.body_text) panjang
                 FROM regulation r JOIN pasal p ON p.reg_id=r.id
                WHERE r.has_body=1 GROUP BY r.id""").fetchall():
        g = profil.periksa_kewajaran(
            r["jenis_code"], {"pasal": r["np"], "diktum": r["nd"],
                              "penjelasan": r["pj"], "total": r["tot"],
                              "panjang_naskah": r["panjang"]})
        if not g:
            continue
        p = profil.untuk(r["jenis_code"])
        out.append(Temuan(
            f"parsing:{r['id']}", "parsing", "sedang", r["id"],
            f'{r["canonical"]} — {g[0].split(":")[-1].strip()}',
            f'Bentuk {p.nama} biasanya dikutip per {p.satuan_kutipan}, tetapi '
            f'dokumen ini menghasilkan {r["np"]} pasal dan {r["nd"]} diktum dari '
            f'{r["panjang"] or 0} aksara naskah. Keganjilan yang tercatat: '
            f'{"; ".join(g)}. Penyebab yang paling sering: naskah di situs hanya '
            f'memuat ringkasan, isinya berada di lampiran PDF, atau tata letaknya '
            f'tidak mengikuti pola yang dikenali pengurai. Memperbaikinya menuntut '
            f'melihat naskahnya — memaksakan pengurai lain tanpa melihat justru '
            f'dapat menghasilkan pasal yang tidak ada.',
            0.30, "keganjilan dapat dipastikan, tetapi penyebabnya tidak; "
                  "perbaikan otomatis berisiko mengarang struktur",
            {"pasal": r["np"], "diktum": r["nd"], "penjelasan": r["pj"],
             "unit": r["tot"], "panjang_naskah": r["panjang"],
             "keganjilan": g, "url": r["url"]},
            [], "Buka naskahnya; bila isi sebenarnya ada di lampiran, jalankan OCR."))
    return out


def dari_naskah_kosong(conn) -> list[Temuan]:
    """Peraturan yang hanya punya metadata."""
    out = []
    for r in conn.execute(
            "SELECT id, canonical, jenis, jenis_code, judul, url, tahun "
            "FROM regulation WHERE (body_text IS NULL OR body_text='') "
            "AND id NOT LIKE '%@konsolidasi%'").fetchall():
        out.append(Temuan(
            f"kosong:{r['id']}", "naskah_kosong", "berat", r["id"],
            f'{r["canonical"]} — tidak ada naskah, hanya metadata',
            f'Katalog mencatat peraturan ini tetapi tidak menyediakan isinya, dan '
            f'sumber pembanding yang sudah diuji (peraturan.go.id, JDIH Kemenkeu, '
            f'JDIH BPK) juga tidak memuatnya. Selama isinya tidak ada, peraturan '
            f'ini tidak dapat dicari maupun dikutip — ia hanya terhitung dalam '
            f'jumlah. Ini bukan cacat pengolahan, melainkan soal pengadaan naskah.',
            0.0, "tidak ada perbaikan otomatis yang mungkin; naskahnya memang "
                 "tidak dimiliki",
            {"jenis": r["jenis"], "tahun": r["tahun"], "url": r["url"],
             "judul": r["judul"]},
            [], "Perlu diperoleh dari sumber lain (Ortax, permintaan resmi ke DJP)."))
    return out


# Nama pemeriksaan per pembangkit, untuk menutup kasus usang ketika sebuah
# pembangkit tidak menghasilkan temuan sama sekali.
_NAMA_PERIKSA = {
    "dari_konflik_status": "konflik_status", "dari_naskah_kembar": "naskah_kembar",
    "dari_identitas": "identitas", "dari_hierarki": "hierarki",
    "dari_sitasi_menggantung": "sitasi_menggantung", "dari_parsing": "parsing",
    "dari_naskah_kosong": "naskah_kosong", "dari_celah_urut": "celah_urut",
    "dari_penomoran": "penomoran",
}

PEMBANGKIT = [dari_konflik_status, dari_naskah_kembar, dari_identitas,
              dari_hierarki, dari_sitasi_menggantung, dari_parsing,
              dari_naskah_kosong]


# --- penyimpanan & keputusan ----------------------------------------------
def bangun(conn, hanya: str | None = None) -> dict:
    """Bangun ulang antrean.

    Kasus yang sudah diputus manusia tidak ditimpa: keputusan manusia adalah
    data yang paling mahal di sistem ini dan tidak boleh hilang karena
    pemeriksaan dijalankan lagi.
    """
    pastikan_skema(conn)
    now = datetime.now().isoformat(timespec="seconds")
    baru = dilewati = 0
    dihasilkan: set[str] = set()
    dijalankan: set[str] = set()
    for fn in PEMBANGKIT:
        if hanya and fn.__name__ != hanya:
            continue
        temuan_fn = fn(conn)
        dijalankan.add(temuan_fn[0].periksa if temuan_fn else _NAMA_PERIKSA.get(fn.__name__, ""))
        dihasilkan.update(t.id for t in temuan_fn)
        for t in temuan_fn:
            ada = conn.execute("SELECT status FROM temuan WHERE id=?",
                               (t.id,)).fetchone()
            if ada and ada[0] != "antre":
                dilewati += 1
                continue
            conn.execute(
                """INSERT OR REPLACE INTO temuan
                   (id,periksa,keparahan,entitas,judul,penjelasan,bukti,usul,
                    usul_teks,keyakinan,keyakinan_alasan,status,ada_usul,dibuat)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (t.id, t.periksa, t.keparahan, t.entitas, t.judul, t.penjelasan,
                 json.dumps(t.bukti, ensure_ascii=False),
                 json.dumps(t.usul, ensure_ascii=False), t.usul_teks,
                 t.keyakinan, t.keyakinan_alasan, "antre",
                 1 if t.usul else 0, now))
            baru += 1

    # Kasus yang tidak dihasilkan lagi oleh pemeriksaannya berarti masalahnya
    # sudah tidak ada — entah karena diperbaiki di tempat lain, entah karena
    # datanya berubah. Membiarkannya di antrean membuat peninjau mengerjakan
    # 1.134 dokumen yang naskahnya sebenarnya sudah terisi. Ia ditutup, bukan
    # dihapus: riwayat bahwa masalah itu pernah ada tetap berguna.
    usang = 0
    for periksa in dijalankan:
        if not periksa:
            continue
        ada = [r[0] for r in conn.execute(
            "SELECT id FROM temuan WHERE periksa=? AND status='antre'", (periksa,))]
        mati = [i for i in ada if i not in dihasilkan]
        if mati:
            conn.executemany(
                "UPDATE temuan SET status='tidak_berlaku_lagi', cara='auto', "
                "  diputus=?, catatan='pemeriksaan tidak lagi menemukannya' "
                " WHERE id=?", [(now, i) for i in mati])
            usang += len(mati)
    conn.commit()
    return {"dibangun": baru, "dipertahankan": dilewati, "usang_ditutup": usang}


def _terapkan(conn, tid: str, usul: list, cara: str) -> int:
    """Terapkan perubahan, catat nilai lamanya lebih dulu."""
    now = datetime.now().isoformat(timespec="seconds")
    n = 0
    for u in usul:
        tabel, baris, kolom = u["tabel"], u["baris_id"], u["kolom"]
        kunci = "reg_id" if tabel == "validity" else "id"
        lama = conn.execute(
            f"SELECT {kolom} FROM {tabel} WHERE {kunci}=?", (baris,)).fetchone()
        if lama is None:
            continue
        conn.execute(
            "INSERT INTO perbaikan(temuan_id,tabel,baris_id,kolom,nilai_lama,"
            "nilai_baru,waktu) VALUES (?,?,?,?,?,?,?)",
            (tid, tabel, baris, kolom, str(lama[0]), str(u["ke"]), now))
        conn.execute(f"UPDATE {tabel} SET {kolom}=? WHERE {kunci}=?",
                     (u["ke"], baris))
        n += 1
    conn.execute(
        "UPDATE temuan SET status=?, cara=?, diputus=? WHERE id=?",
        ("auto_selesai" if cara == "auto" else "diterima", cara, now, tid))
    return n


def auto_selesai(conn, ambang: float = AMBANG_AUTO) -> dict:
    """Terapkan semua usul berkeyakinan tinggi, tandai sebagai otomatis.

    Ambang bukan angka yang dipilih agar hasilnya banyak. Ia batas tempat
    keyakinan bersandar pada bukti yang dapat diperiksa ulang — judul yang
    menyebut jenisnya sendiri, nomor pokok yang cocok, dua status yang sama-sama
    berarti berlaku. Di bawah itu, yang tersisa adalah tebakan, dan tebakan
    tidak boleh dijalankan tanpa manusia.
    """
    pastikan_skema(conn)
    rows = conn.execute(
        "SELECT id, usul, keyakinan FROM temuan "
        "WHERE status='antre' AND ada_usul=1 AND keyakinan>=?", (ambang,)).fetchall()
    n_temuan = n_ubah = 0
    for r in rows:
        usul = json.loads(r["usul"] or "[]")
        if not usul:
            continue
        n_ubah += _terapkan(conn, r["id"], usul, "auto")
        n_temuan += 1
    # Kasus tanpa usul yang keyakinannya tinggi hanya diklasifikasikan —
    # tidak ada yang diubah, tetapi ia keluar dari antrean kerja.
    diklasifikasi = conn.execute(
        "UPDATE temuan SET status='auto_selesai', cara='auto', diputus=? "
        "WHERE status='antre' AND ada_usul=0 AND keyakinan>=?",
        (datetime.now().isoformat(timespec="seconds"), ambang)).rowcount
    conn.commit()
    return {"temuan_diselesaikan": n_temuan, "kolom_diubah": n_ubah,
            "diklasifikasikan": diklasifikasi, "ambang": ambang}


def putuskan(conn, tid: str, keputusan: str, catatan: str = "") -> dict:
    """Keputusan manusia: terima usulnya, tolak, atau tunda."""
    pastikan_skema(conn)
    r = conn.execute("SELECT usul, status FROM temuan WHERE id=?", (tid,)).fetchone()
    if not r:
        return {"galat": "temuan tidak ada"}
    now = datetime.now().isoformat(timespec="seconds")
    if keputusan == "terima":
        usul = json.loads(r["usul"] or "[]")
        n = _terapkan(conn, tid, usul, "manual") if usul else 0
        conn.execute("UPDATE temuan SET catatan=? WHERE id=?", (catatan, tid))
        conn.commit()
        return {"status": "diterima", "kolom_diubah": n}
    conn.execute("UPDATE temuan SET status=?, cara='manual', catatan=?, "
                 "diputus=? WHERE id=?",
                 ({"tolak": "ditolak", "tunda": "ditunda"}.get(keputusan, "baru"),
                  catatan, now, tid))
    conn.commit()
    return {"status": keputusan}


def batalkan(conn, tid: str) -> dict:
    """Kembalikan nilai lama — inilah yang membuat perbaikan otomatis aman."""
    pastikan_skema(conn)
    rows = conn.execute(
        "SELECT * FROM perbaikan WHERE temuan_id=? AND dibatalkan=0 "
        "ORDER BY id DESC", (tid,)).fetchall()
    n = 0
    for p in rows:
        kunci = "reg_id" if p["tabel"] == "validity" else "id"
        lama = p["nilai_lama"]
        if lama in ("None", None):
            lama = None
        elif re.fullmatch(r"-?\d+", lama or ""):
            lama = int(lama)
        conn.execute(f"UPDATE {p['tabel']} SET {p['kolom']}=? WHERE {kunci}=?",
                     (lama, p["baris_id"]))
        conn.execute("UPDATE perbaikan SET dibatalkan=1 WHERE id=?", (p["id"],))
        n += 1
    conn.execute("UPDATE temuan SET status='antre', cara=NULL, diputus=NULL "
                 "WHERE id=?", (tid,))
    conn.commit()
    return {"dikembalikan": n}


def daftar(conn, status=None, periksa=None, keparahan=None, cara=None,
           limit=50, offset=0) -> dict:
    pastikan_skema(conn)
    where, arg = ["1=1"], []
    if cara:
        # Peninjau perlu dapat memisahkan "diputus oleh sumber lain" dari
        # "diselesaikan dari data sendiri": keduanya otomatis, tetapi dasarnya
        # berbeda jauh dan yang pertama membawa tautan yang dapat diperiksa.
        where.append("cara=?"); arg.append(cara)
    if status:
        where.append("status=?"); arg.append(status)
    if periksa:
        where.append("periksa=?"); arg.append(periksa)
    if keparahan:
        where.append("keparahan=?"); arg.append(keparahan)
    w = " AND ".join(where)
    total = conn.execute(f"SELECT COUNT(*) FROM temuan WHERE {w}", arg).fetchone()[0]
    rows = conn.execute(
        f"""SELECT * FROM temuan WHERE {w}
            ORDER BY CASE keparahan WHEN 'berat' THEN 0 WHEN 'sedang' THEN 1
                     ELSE 2 END, keyakinan DESC, id LIMIT ? OFFSET ?""",
        arg + [limit, offset]).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["bukti"] = json.loads(d["bukti"] or "{}")
        d["usul"] = json.loads(d["usul"] or "[]")
        out.append(d)
    return {"total": total, "hasil": out}


def ringkas(conn) -> dict:
    pastikan_skema(conn)
    per_status = {r[0]: r[1] for r in conn.execute(
        "SELECT status, COUNT(*) FROM temuan GROUP BY status")}
    per_periksa = [dict(r) for r in conn.execute(
        """SELECT periksa, COUNT(*) n,
                  SUM(status='antre') antre,
                  SUM(status='antre' AND ada_usul=1) antre_berusul,
                  SUM(status='auto_selesai') otomatis,
                  SUM(status IN ('diterima','ditolak')) manual,
                  ROUND(AVG(keyakinan),3) keyakinan_rata
             FROM temuan GROUP BY periksa ORDER BY antre DESC""")]
    return {"per_status": per_status, "per_periksa": per_periksa,
            "perbaikan_aktif": conn.execute(
                "SELECT COUNT(*) FROM perbaikan WHERE dibatalkan=0").fetchone()[0]}


def dari_celah_urut(conn) -> list[Temuan]:
    """Nomor yang bolong di dalam satu seri penomoran.

    Satu kasus untuk satu seri (jenis + tahun), bukan satu kasus per nomor:
    peninjau memutuskan "apakah seri ini benar-benar bolong" sekali, lalu
    menindaklanjuti seluruh nomornya. Memecahnya per nomor akan melahirkan
    ratusan kasus yang jawabannya sama.
    """
    from .celah_urut import periksa

    out = []
    for s in periksa(conn)["seri"]:
        hilang = ", ".join(str(x) for x in s["hilang"])
        dapat = s["ada_di_ortax"]
        # Daerah ikut ke dalam kunci dan judul kasus. Seri peraturan daerah
        # berjalan per daerah, jadi "PERDA 2024" bukan seri — ia gabungan
        # ratusan seri, dan temuan tanpa daerahnya tidak dapat ditindak siapa
        # pun: tidak jelas seri penomoran mana yang harus diperiksa.
        wil = s.get("wilayah") or ""
        sebut = f'{s["jenis"]} {s["tahun"]}' + (f' — {wil}' if wil else "")
        kunci_wil = f'-{wil.lower().replace(" ", "-")}' if wil else ""
        out.append(Temuan(
            f'urut:{s["jenis"]}-{s["tahun"]}{kunci_wil}', "celah_urut",
            "sedang" if dapat else "ringan", sebut,
            f'{sebut} — {s["n_hilang"]} nomor bolong di seri {s["rentang"]}',
            f'Korpus memuat {s["punya"]} dokumen bernomor {s["rentang"]} dengan '
            f'kepadatan {s["kepadatan"]:.0%}. Nomor yang tidak ada: {hilang}.\n\n'
            f'Pada seri sepadat ini, lompatan nomor lebih mungkin berarti '
            f'dokumennya hilang daripada berarti penomorannya memang melompat. '
            f'Tetapi keduanya mungkin: sebagian nomor memang tidak pernah '
            f'terbit karena dibatalkan sebelum diundangkan, dan itu hanya dapat '
            f'dipastikan dengan memeriksa seri aslinya di penerbitnya.'
            + (f'\n\n{len(dapat)} di antaranya ADA di katalog Ortax '
               f'({", ".join(str(x) for x in dapat)}) — itu berarti dokumennya '
               f'nyata dan masih dapat diambil.'
               if dapat else
               '\n\nTidak satu pun ada di katalog Ortax, jadi tidak ada sumber '
               'terjangkau yang memuatnya.'),
            0.62 if dapat else 0.35,
            ("sebagian nomor yang hilang terbukti ada di katalog lain, jadi "
             "kekosongannya nyata" if dapat else
             "kepadatan seri menunjukkan kekosongan, tetapi tidak ada bukti "
             "dari luar bahwa dokumennya pernah terbit"),
            {"jenis": s["jenis"], "tahun": s["tahun"], "wilayah": wil,
             "punya": s["punya"],
             "rentang": s["rentang"], "kepadatan": s["kepadatan"],
             "nomor_hilang": hilang, "ada_di_ortax": dapat},
            [],
            (f'Ambil {len(dapat)} dokumen yang ada di Ortax; sisanya perlu '
             f'dipastikan ke penerbitnya.' if dapat else
             'Periksa seri aslinya di penerbit untuk memastikan nomor-nomor '
             'itu memang pernah terbit.')))
    return out


# Nomor pada kop naskah dibaca dari 400 aksara pertama — di luar itu yang
# ditemukan hampir selalu kutipan, bukan identitas dokumennya sendiri.
RE_KOP_NOMOR = re.compile(
    r"NOMOR\s*:?\s*([A-Z0-9][A-Z0-9\-\./ ]{2,32}?)\s*(?:TENTANG|$)", re.I)


def dari_penomoran(conn) -> list[Temuan]:
    """Nomor katalog yang tidak cocok dengan nomor di kop naskahnya sendiri.

    Berbeda dari pemeriksaan `identitas` yang memakai kolom `id_body` hasil
    perayapan DJP, pemeriksaan ini membaca ulang kop dari naskah apa adanya —
    sehingga ia juga menjangkau dokumen yang datang dari sumber lain.
    """
    def rapat(s):
        return re.sub(r"[^a-z0-9]", "", (s or "").lower())

    out = []
    for r in conn.execute(
            "SELECT id, canonical, nomor_raw, judul, source, url, body_text "
            "  FROM regulation WHERE body_text IS NOT NULL AND body_text<>''"
            "   AND source<>'djp'"):
        m = RE_KOP_NOMOR.search(r["body_text"][:400])
        if not m:
            continue
        kop, kat, raw = rapat(m.group(1)), rapat(r["canonical"]), rapat(r["nomor_raw"])
        if not kop or kop in kat or kat in kop or kop in raw or raw in kop:
            continue
        out.append(Temuan(
            f'nomor:{r["id"]}', "penomoran", "berat", r["id"],
            f'{r["canonical"]} — kop naskah berbunyi {m.group(1).strip()}',
            f'Katalog mencatat nomor "{r["canonical"]}", tetapi kop naskah yang '
            f'tersimpan berbunyi "{m.group(1).strip()}". Salinan ini berasal dari '
            f'{r["source"]}.\n\nSalah satunya keliru, dan selama belum diputus '
            f'setiap sitasi dari dokumen ini berisiko menunjuk peraturan yang '
            f'lain. Penyebab yang lazim: katalog sumber salah menuliskan nomor, '
            f'atau naskah yang terpasang memang milik peraturan yang berbeda.',
            0.40, "perbedaan nomornya pasti, tetapi mana yang benar hanya dapat "
                  "ditentukan dengan membaca naskahnya",
            {"katalog": r["canonical"], "kop_naskah": m.group(1).strip(),
             "nomor_mentah": r["nomor_raw"], "sumber": r["source"],
             "url": r["url"], "judul": (r["judul"] or "")[:120]},
            [], "Buka naskahnya, bandingkan dengan katalog, lalu putuskan."))
    return out


PEMBANGKIT += [dari_celah_urut, dari_penomoran]
