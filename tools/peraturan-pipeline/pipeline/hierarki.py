"""Pemetaan hierarki peraturan yang dapat dirinci.

Korpus ini memuat 6.029 dokumen dari 30-an bentuk yang berbeda, dan bentuknya
menentukan kekuatan hukumnya. Menaruh semuanya dalam satu daftar rata membuat
Keputusan Menteri tampak setara Undang-Undang, padahal keduanya tidak berada di
tangga yang sama — bahkan tidak berada di tangga yang sama sekali.

**Tiga golongan yang tidak boleh dicampur.**

*Pengaturan* (regeling) — norma yang mengikat umum. Inilah yang disusun UU
12/2011 Pasal 7 ayat (1) menjadi tujuh tingkat, dari UUD 1945 sampai Perda
Kabupaten/Kota. Peraturan Menteri dan Peraturan Dirjen tidak disebut di tangga
itu, tetapi Pasal 8 ayat (1) mengakui keberadaannya sepanjang diperintahkan
peraturan yang lebih tinggi atau dibentuk berdasarkan kewenangan.

*Penetapan* (beschikking) — Keputusan. Sifatnya konkret, individual, dan
sekali-selesai: menunjuk orang atau hal tertentu, bukan mengatur perilaku umum.
KMK penetapan kurs adalah contohnya. Mengutipnya sebagai dasar norma umum adalah
kekeliruan yang lazim dan berakibat nyata.

*Kebijakan internal* — Surat Edaran, Instruksi, Nota Dinas, Pengumuman. Mengikat
ke dalam organisasi, bukan kepada Wajib Pajak. Ia menjelaskan cara aparat
menjalankan norma; ia bukan normanya.

Pembedaan ini bukan kerapian akademik. Ia yang menentukan apakah sebuah dokumen
boleh dipakai sebagai dasar hukum dalam sengketa, dan itulah pertanyaan yang
paling sering ditanyakan atas korpus semacam ini.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

PENGATURAN = "pengaturan"
PENETAPAN = "penetapan"
INTERNAL = "kebijakan_internal"

SIFAT_NAMA = {
    PENGATURAN: "Pengaturan — norma yang mengikat umum",
    PENETAPAN: "Penetapan — konkret, individual, sekali-selesai",
    INTERNAL: "Kebijakan internal — mengikat ke dalam organisasi",
}
SIFAT_URUT = {PENGATURAN: 0, PENETAPAN: 1, INTERNAL: 2}


@dataclass(frozen=True)
class Lapis:
    kode: str
    nama: str
    sifat: str
    tingkat: int | None      # 1..7 menurut Pasal 7; None bila di luar tangga
    dasar: str               # pasal yang menjadi dasar kedudukannya
    penerbit: str
    catatan: str = ""


def _P(kode, nama, tingkat, dasar, penerbit, catatan=""):
    return Lapis(kode, nama, PENGATURAN, tingkat, dasar, penerbit, catatan)


# Dasar kedudukan golongan di luar tangga Pasal 7. Keduanya disebut lengkap
# supaya pembaca dapat memeriksa sendiri, bukan mempercayai penggolongan ini
# begitu saja — dan supaya terlihat mana yang bersandar pada bunyi undang-undang
# dan mana yang bersandar pada doktrin.
DASAR_PENETAPAN = (
    "UU 30/2014 Pasal 1 angka 7 — Keputusan Administrasi Pemerintahan "
    "bersifat konkret, individual, dan final; karena itu bukan peraturan "
    "perundang-undangan menurut UU 12/2011 Pasal 1 angka 2")
DASAR_INTERNAL = (
    "tidak memenuhi UU 12/2011 Pasal 1 angka 2 (tidak mengikat umum); "
    "dalam doktrin hukum administrasi disebut peraturan kebijakan "
    "(beleidsregel) — mengikat aparat penerbitnya, bukan warga")


def _K(kode, nama, penerbit, catatan=""):
    return Lapis(kode, nama, PENETAPAN, None, DASAR_PENETAPAN, penerbit, catatan)


def _I(kode, nama, penerbit, catatan=""):
    return Lapis(kode, nama, INTERNAL, None, DASAR_INTERNAL, penerbit, catatan)


_P7 = "UU 12/2011 Pasal 7 ayat (1)"


def tingkat_perda(daerah: str | None) -> int:
    """6 untuk Perda provinsi, 7 untuk Perda kabupaten/kota.

    Pasal 7 ayat (1) memisahkan keduanya — huruf f dan huruf g — dan pemisahan
    itu bukan tata letak: Perda kabupaten/kota tidak boleh bertentangan dengan
    Perda provinsi. Karena korpus menyimpan keduanya di bawah satu kode,
    tingkatnya hanya dapat dijawab oleh daerahnya.
    """
    d = (daerah or "").strip().lower()
    return 6 if d.startswith("provinsi") else 7
_P8 = ("UU 12/2011 Pasal 8 ayat (1) dan (2) — diakui keberadaannya dan mengikat "
       "sepanjang diperintahkan peraturan yang lebih tinggi atau dibentuk "
       "berdasarkan kewenangan")

# Tangga Pasal 7 ayat (1) selengkapnya, termasuk tingkat yang TIDAK terwakili di
# korpus ini. Tingkat yang kosong tetap ditampilkan pada peta: tangga yang
# dipotong sampai tingkat yang kebetulan kita punya akan membuat pembaca
# menyangka Perda tidak ada dalam hierarki, padahal ia hanya tidak ada di sini.
TANGGA = [
    (1, "Undang-Undang Dasar 1945", "huruf a"),
    (2, "Ketetapan MPR", "huruf b"),
    (3, "Undang-Undang / Perppu", "huruf c"),
    (4, "Peraturan Pemerintah", "huruf d"),
    (5, "Peraturan Presiden", "huruf e"),
    (6, "Peraturan Daerah Provinsi", "huruf f"),
    (7, "Peraturan Daerah Kabupaten/Kota", "huruf g"),
]

LAPIS: dict[str, Lapis] = {}
for _l in [
    # --- tangga Pasal 7 ---
    _P("UUD", "Undang-Undang Dasar 1945", 1, f"{_P7} huruf a", "MPR"),
    _P("UU", "Undang-Undang", 3, f"{_P7} huruf c", "DPR bersama Presiden"),
    _P("PERPU", "Peraturan Pemerintah Pengganti Undang-Undang", 3,
       f"{_P7} huruf c", "Presiden",
       "setingkat undang-undang; harus mendapat persetujuan DPR"),
    _P("PP", "Peraturan Pemerintah", 4, f"{_P7} huruf d", "Presiden",
       "menjalankan undang-undang sebagaimana mestinya"),
    _P("PERPRES", "Peraturan Presiden", 5, f"{_P7} huruf e", "Presiden"),
    # Perda menempati DUA tingkat sekaligus: huruf f untuk provinsi, huruf g
    # untuk kabupaten/kota. Korpus menyimpan keduanya di bawah satu kode dan
    # membedakannya lewat daerahnya, jadi tingkatnya ditentukan oleh daerah —
    # bukan oleh kodenya. `tingkat_perda()` di bawah yang menjawabnya.
    _P("PERDA", "Peraturan Daerah", 6, f"{_P7} huruf f dan g",
       "DPRD bersama Kepala Daerah",
       "tingkat 6 bila provinsi, tingkat 7 bila kabupaten/kota"),
    _P("QANUN", "Qanun", 6,
       f"{_P7} huruf f dan g, jo. UU 11/2006 tentang Pemerintahan Aceh "
       f"Pasal 1 angka 21", "DPRA/DPRK bersama Gubernur/Bupati/Wali Kota",
       "sebutan Peraturan Daerah di Aceh; kedudukannya sama"),

    # --- Pasal 8: peraturan kepala daerah ---
    # Pasal 8 ayat (1) menyebut gubernur dan bupati/wali kota secara eksplisit,
    # sejajar dengan menteri dan kepala lembaga. Jadi peraturan kepala daerah
    # bukan berada di bawah tangga Pasal 7 sebagai tingkat kedelapan; ia diakui
    # di luar tangga, mengikat sepanjang diperintahkan Perda atau dibentuk
    # berdasarkan kewenangannya.
    _P("PER-GUBERN", "Peraturan Gubernur", None, _P8, "Gubernur"),
    _P("PER-BUPATI", "Peraturan Bupati", None, _P8, "Bupati"),
    _P("PER-WALIKO", "Peraturan Wali Kota", None, _P8, "Wali Kota"),

    # --- Pasal 8: peraturan menteri dan lembaga ---
    _P("PMK", "Peraturan Menteri Keuangan", None, _P8, "Menteri Keuangan",
       "bentuk terbanyak yang benar-benar mengatur di bidang perpajakan"),
    _P("PERMENDAG", "Peraturan Menteri Perdagangan", None, _P8, "Menteri Perdagangan"),
    _P("PERMENDAGRI", "Peraturan Menteri Dalam Negeri", None, _P8,
       "Menteri Dalam Negeri"),
    _P("PERMENPERIN", "Peraturan Menteri Perindustrian", None, _P8,
       "Menteri Perindustrian"),
    _P("PB-M", "Peraturan Bersama Menteri", None, _P8, "beberapa menteri"),
    _P("PER", "Peraturan Direktur Jenderal Pajak", None, _P8,
       "Direktur Jenderal Pajak",
       "mengatur teknis pelaksanaan; kedudukannya di bawah PMK"),
    _P("PERDJBC", "Peraturan Dirjen Bea dan Cukai", None, _P8,
       "Direktur Jenderal Bea dan Cukai"),
    _P("PER-DJPB", "Peraturan Dirjen Perbendaharaan", None, _P8,
       "Direktur Jenderal Perbendaharaan"),
    _P("PB-DJ", "Peraturan Bersama Direktur Jenderal", None, _P8,
       "beberapa direktur jenderal"),
    _P("PER-BKPM", "Peraturan Badan Koordinasi Penanaman Modal", None, _P8,
       "Kepala BKPM"),

    # --- penetapan (beschikking) ---
    _K("KEPPRES", "Keputusan Presiden", "Presiden",
       "sejak UU 12/2011 keputusan presiden yang bersifat mengatur "
       "dituangkan sebagai Peraturan Presiden"),
    _K("KMK", "Keputusan Menteri Keuangan", "Menteri Keuangan",
       "termasuk penetapan kurs mingguan dan tarif bunga bulanan"),
    _K("KEP", "Keputusan Direktur Jenderal Pajak", "Direktur Jenderal Pajak"),
    _K("KEPDJBC", "Keputusan Dirjen Bea dan Cukai",
       "Direktur Jenderal Bea dan Cukai"),
    _K("KEPMENDAGRI", "Keputusan Menteri Dalam Negeri", "Menteri Dalam Negeri"),
    _K("KEP-GUBERN", "Keputusan Gubernur", "Gubernur",
       "banyak dipakai untuk pembebasan dan pengurangan pajak daerah"),
    _K("KEP-BUPATI", "Keputusan Bupati", "Bupati"),
    _K("KEP-WALIKO", "Keputusan Wali Kota", "Wali Kota"),
    _K("KEP-DPRD", "Keputusan DPRD", "DPRD"),
    _K("KEP-PENDAP", "Keputusan Kepala Badan Pendapatan Daerah",
       "Kepala Badan Pendapatan Daerah"),
    _K("KEPMENDAG", "Keputusan Menteri Perdagangan", "Menteri Perdagangan"),
    _K("KEPMENPERIN", "Keputusan Menteri Perindustrian", "Menteri Perindustrian"),
    _K("KEPMENAKER", "Keputusan Menteri Tenaga Kerja", "Menteri Tenaga Kerja"),
    _K("KEP-PP", "Keputusan Ketua Pengadilan Pajak", "Ketua Pengadilan Pajak"),
    _K("SKB-M", "Keputusan Bersama Menteri", "beberapa menteri"),
    _K("SKB-DJ", "Keputusan Bersama Direktur Jenderal",
       "beberapa direktur jenderal"),

    # --- kebijakan internal ---
    _I("SE", "Surat Edaran Direktur Jenderal Pajak", "Direktur Jenderal Pajak",
       "menjelaskan cara aparat menjalankan norma; tidak mengikat Wajib Pajak"),
    _I("INS", "Instruksi Direktur Jenderal Pajak", "Direktur Jenderal Pajak"),
    _I("IMK", "Instruksi Menteri Keuangan", "Menteri Keuangan"),
    _I("INPRES", "Instruksi Presiden", "Presiden"),
    _I("INS-GUBERN", "Instruksi Gubernur", "Gubernur"),
    _I("SE-GUBERN", "Surat Edaran Gubernur", "Gubernur"),
    _I("ND", "Nota Dinas Direktur Jenderal Pajak", "Direktur Jenderal Pajak"),
    _I("PENG", "Pengumuman", "Direktorat Jenderal Pajak"),
    _I("S", "Surat", "pejabat penerbit"),
    _I("S-DJBC", "Surat Dirjen Bea dan Cukai", "Direktur Jenderal Bea dan Cukai"),
    _I("S-DJA", "Surat Dirjen Anggaran", "Direktur Jenderal Anggaran"),
    _I("S-DJPB", "Surat Dirjen Perbendaharaan",
       "Direktur Jenderal Perbendaharaan"),
]:
    LAPIS[_l.kode] = _l


def untuk(jenis_code: str | None) -> Lapis | None:
    return LAPIS.get((jenis_code or "").upper())


def _tak_dikenal(kode: str) -> Lapis:
    """Bentuk yang belum dipetakan tetap ditampilkan, tidak disembunyikan.

    Menyembunyikannya membuat jumlah pada peta tidak pernah cocok dengan jumlah
    di korpus, dan selisih yang tidak dijelaskan itu justru menghapus
    kepercayaan pada seluruh angkanya.
    """
    return Lapis(kode, f"({kode}) — bentuk belum dipetakan", PENETAPAN, None,
                 "belum ditentukan kedudukannya", "belum diketahui",
                 "perlu ditetapkan golongan dan kedudukannya secara manual")


def peta(conn, sertakan_berkala: bool = False) -> dict:
    """Rincian korpus menurut golongan, tingkat, dan bentuk.

    Terbitan berkala (kurs dan tarif bunga) disisihkan secara baku. Bila ikut,
    KMK membengkak menjadi 2.806 dan seluruh peta tampak seolah korpus ini
    sebagian besar berisi penetapan kurs — yang secara jumlah memang benar,
    tetapi menutupi bentuk-bentuk yang sebenarnya dibaca orang.
    """
    saring = "" if sertakan_berkala else " WHERE berkala IS NULL"
    # Perda dan Qanun dipisah menurut ranah daerahnya, bukan disatukan di bawah
    # satu tingkat. Pasal 7 ayat (1) memisahkannya — huruf f untuk provinsi,
    # huruf g untuk kabupaten/kota — dan pemisahan itu berakibat: Perda
    # kabupaten/kota tidak boleh bertentangan dengan Perda provinsi. Menaruh
    # 1.214 Perda seluruhnya pada "Tingkat 6 — Provinsi" akan menampilkan tangga
    # yang salah justru pada bagian yang paling mudah dipercaya.
    rows = conn.execute(f"""
        SELECT COALESCE(NULLIF(jenis_code,''),'(kosong)') kode,
               CASE WHEN jenis_code IN ('PERDA','QANUN')
                    THEN CASE
                      WHEN LOWER(COALESCE(kategori,'')) LIKE 'provinsi%'
                        THEN 'provinsi'
                      WHEN LOWER(COALESCE(kategori,'')) LIKE 'kab%'
                        OR LOWER(COALESCE(kategori,'')) LIKE 'kota%'
                        THEN 'kabkota'
                      -- Daerahnya tidak diketahui. Ini bukan hal yang bisa
                      -- ditebak: memasukkannya ke kabupaten/kota karena bukan
                      -- provinsi akan menampilkan 316 Perda pada tingkat yang
                      -- tidak pernah dipastikan siapa pun.
                      ELSE 'tak_diketahui' END
                    ELSE '' END ranah,
               COUNT(*) n,
               SUM(has_body) berteks,
               MIN(tahun) th_awal, MAX(tahun) th_akhir
          FROM regulation{saring}
         GROUP BY kode, ranah""").fetchall()

    status = {}
    for r in conn.execute(f"""
        SELECT COALESCE(NULLIF(r.jenis_code,''),'(kosong)') kode,
               v.status_derived s, COUNT(*) n
          FROM regulation r LEFT JOIN validity v ON v.reg_id=r.id
          {'' if sertakan_berkala else 'WHERE r.berkala IS NULL'}
         GROUP BY kode, s"""):
        status.setdefault(r["kode"], {})[r["s"] or "tidak_diketahui"] = r["n"]

    golongan: dict[str, dict] = {}
    total = 0
    for r in rows:
        lap = untuk(r["kode"]) or _tak_dikenal(r["kode"])
        ranah = r["ranah"] if "ranah" in r.keys() else ""
        if ranah:
            from dataclasses import replace as _ganti
            _RANAH = {
                "provinsi": (6, "Provinsi", "huruf f"),
                "kabkota": (7, "Kabupaten/Kota", "huruf g"),
                "tak_diketahui": (None, "daerah tidak diketahui",
                                  "huruf f atau g — belum dapat dipastikan"),
            }
            tk, sebutan, huruf = _RANAH[ranah]
            lap = _ganti(
                lap, tingkat=tk, nama=f"{lap.nama} — {sebutan}",
                dasar=lap.dasar.replace("huruf f dan g", huruf),
                catatan=("identitasnya tidak menyebut daerah, jadi tingkatnya "
                         "belum dapat dipastikan"
                         if ranah == "tak_diketahui" else lap.catatan))
        total += r["n"]
        g = golongan.setdefault(lap.sifat, {
            "sifat": lap.sifat, "nama": SIFAT_NAMA.get(lap.sifat, lap.sifat),
            "urut": SIFAT_URUT.get(lap.sifat, 9), "jumlah": 0, "tingkat": {}})
        g["jumlah"] += r["n"]
        kunci = lap.tingkat if lap.tingkat is not None else 99
        t = g["tingkat"].setdefault(kunci, {
            "tingkat": lap.tingkat,
            "label": (f"Tingkat {lap.tingkat} — {_NAMA_TINGKAT.get(lap.tingkat, '')}"
                      if lap.tingkat else "Di luar tangga Pasal 7"),
            "jumlah": 0, "bentuk": []})
        t["jumlah"] += r["n"]
        t["bentuk"].append({
            **asdict(lap), "jumlah": r["n"], "berteks": r["berteks"],
            "tahun_awal": r["th_awal"], "tahun_akhir": r["th_akhir"],
            "status": status.get(r["kode"], {}),
        })

    for g in golongan.values():
        g["tingkat"] = sorted(g["tingkat"].values(),
                              key=lambda x: x["tingkat"] or 99)
        for t in g["tingkat"]:
            t["bentuk"].sort(key=lambda x: -x["jumlah"])
    return {"total": total,
            "berkala_disertakan": sertakan_berkala,
            "golongan": sorted(golongan.values(), key=lambda g: g["urut"])}


_NAMA_TINGKAT = {
    1: "Undang-Undang Dasar", 2: "Ketetapan MPR",
    3: "Undang-Undang / Perppu", 4: "Peraturan Pemerintah",
    5: "Peraturan Presiden", 6: "Peraturan Daerah Provinsi",
    7: "Peraturan Daerah Kabupaten/Kota",
}


def rincian(conn, kode: str, *, status=None, tahun=None, limit=100,
            sertakan_berkala=False) -> dict:
    """Dokumen di dalam satu bentuk — langkah terakhir penelusuran."""
    where = ["COALESCE(NULLIF(r.jenis_code,''),'(kosong)')=?"]
    arg: list = [kode]
    if not sertakan_berkala:
        where.append("r.berkala IS NULL")
    if status:
        where.append("v.status_derived=?"); arg.append(status)
    if tahun:
        where.append("r.tahun=?"); arg.append(int(tahun))
    w = " AND ".join(where)
    total = conn.execute(
        f"SELECT COUNT(*) FROM regulation r LEFT JOIN validity v "
        f"ON v.reg_id=r.id WHERE {w}", arg).fetchone()[0]
    rows = conn.execute(
        f"""SELECT r.id, r.canonical, r.judul, r.tahun, r.has_body,
                   v.status_derived,
                   (SELECT COUNT(DISTINCT pasal) FROM pasal
                     WHERE reg_id=r.id AND pasal IS NOT NULL) n_pasal
              FROM regulation r LEFT JOIN validity v ON v.reg_id=r.id
             WHERE {w} ORDER BY r.tahun DESC, r.canonical LIMIT ?""",
        arg + [limit]).fetchall()
    lap = untuk(kode) or _tak_dikenal(kode)
    return {"bentuk": asdict(lap), "total": total,
            "hasil": [dict(r) for r in rows]}


def tangga(conn, sertakan_berkala: bool = False) -> dict:
    """Susun tangga Pasal 7 lengkap beserta isian korpus di tiap tingkat.

    Tingkat yang kosong tetap dikembalikan. Tangga yang dipotong sampai tingkat
    yang kebetulan kita punya akan membuat pembaca menyangka Peraturan Daerah
    tidak ada dalam hierarki — padahal ia hanya tidak ada di korpus ini, dan
    perbedaan itu penting.
    """
    p = peta(conn, sertakan_berkala=sertakan_berkala)
    isi: dict[int, list] = {}
    pasal8: list = []
    lain: dict[str, list] = {}

    for g in p["golongan"]:
        for t in g["tingkat"]:
            for b in t["bentuk"]:
                if g["sifat"] == PENGATURAN and b["tingkat"]:
                    isi.setdefault(b["tingkat"], []).append(b)
                elif g["sifat"] == PENGATURAN:
                    pasal8.append(b)
                else:
                    lain.setdefault(g["sifat"], []).append(b)

    anak = [{
        "tingkat": n, "nama": nama, "huruf": huruf,
        "dasar": f"{_P7} {huruf}",
        "bentuk": sorted(isi.get(n, []), key=lambda x: -x["jumlah"]),
        "jumlah": sum(x["jumlah"] for x in isi.get(n, [])),
        "ada_di_korpus": bool(isi.get(n)),
    } for n, nama, huruf in TANGGA]

    return {
        "dasar_tangga": _P7,
        "dasar_pasal8": _P8,
        "tangga": anak,
        "pasal8": {"dasar": _P8, "jumlah": sum(x["jumlah"] for x in pasal8),
                   "bentuk": sorted(pasal8, key=lambda x: -x["jumlah"])},
        "di_luar": [{
            "sifat": s, "nama": SIFAT_NAMA[s],
            "dasar": DASAR_PENETAPAN if s == PENETAPAN else DASAR_INTERNAL,
            "jumlah": sum(x["jumlah"] for x in v),
            "bentuk": sorted(v, key=lambda x: -x["jumlah"]),
        } for s, v in sorted(lain.items(), key=lambda kv: SIFAT_URUT[kv[0]])],
        "total": p["total"],
    }
