"""Pemeriksaan mutu atas peraturan yang sudah masuk.

Korpus yang besar tanpa pemeriksaan hanya memindahkan ketidakpastian, bukan
menguranginya. Modul ini menjalankan pemeriksaan yang masing-masing menjawab
satu pertanyaan yang dapat ditindaklanjuti, dan melaporkan contohnya — bukan
sekadar angka.

Setiap pemeriksaan mengembalikan bentuk yang sama: nama, pertanyaan yang
dijawabnya, jumlah temuan, tingkat keparahan, dan daftar contoh. Keseragaman itu
membuat antarmuka tidak perlu tahu isi tiap pemeriksaan.

Yang sengaja TIDAK dilakukan: menyembunyikan temuan di balik satu skor tunggal.
"Mutu korpus 87%" tidak memberi tahu apa yang harus diperbaiki. Yang berguna
adalah "1.005 Keputusan tidak punya unit yang dapat dikutip", karena kalimat itu
menunjuk pekerjaan.
"""
from __future__ import annotations

import hashlib
import re

from . import profil

BERAT = "berat"        # membuat jawaban salah bila dibiarkan
SEDANG = "sedang"      # menurunkan mutu, tidak menyesatkan
RINGAN = "ringan"      # perlu diketahui, belum tentu perlu diperbaiki


def _hasil(nama, pertanyaan, keparahan, jumlah, dari, contoh, tindakan=""):
    return {"nama": nama, "pertanyaan": pertanyaan, "keparahan": keparahan,
            "jumlah": jumlah, "dari": dari, "contoh": contoh,
            "tindakan": tindakan,
            "rasio": round(jumlah / dari, 4) if dari else 0.0}


def cakupan_teks(conn) -> dict:
    """Berapa peraturan yang sama sekali tidak punya naskah?"""
    total = conn.execute("SELECT COUNT(*) FROM regulation").fetchone()[0]
    kosong = conn.execute(
        "SELECT canonical, jenis, judul FROM regulation "
        "WHERE (body_text IS NULL OR body_text='') "
        "AND id NOT LIKE '%@konsolidasi%' ORDER BY tahun DESC LIMIT 40"
    ).fetchall()
    n = conn.execute(
        "SELECT COUNT(*) FROM regulation WHERE (body_text IS NULL OR body_text='') "
        "AND id NOT LIKE '%@konsolidasi%'").fetchone()[0]
    return _hasil(
        "Naskah tidak tersedia",
        "Peraturan mana yang hanya punya metadata, tanpa isi?",
        BERAT, n, total,
        [{"canonical": r["canonical"], "jenis": r["jenis"],
          "keterangan": (r["judul"] or "")[:90]} for r in kosong],
        "Sebagian besar KMK memang tidak diterbitkan naskahnya di sumber mana pun "
        "yang sudah diuji. Pertanyaannya bukan cara mengurai, melainkan cara "
        "memperolehnya.")


def parsing_ganjil(conn) -> dict:
    """Dokumen mana yang hasil parsingnya tidak wajar bagi bentuknya?"""
    rows = conn.execute(
        """SELECT r.canonical, r.jenis, r.jenis_code, r.judul,
                  SUM(p.pasal IS NOT NULL AND p.pasal GLOB '[0-9]*') np,
                  SUM(p.pasal IS NOT NULL AND p.pasal GLOB '[A-Z]*') nd,
                  SUM(p.bagian_dok='penjelasan') pj, COUNT(p.id) tot,
                  LENGTH(r.body_text) panjang
             FROM regulation r JOIN pasal p ON p.reg_id=r.id
            WHERE r.has_body=1 GROUP BY r.id""").fetchall()
    contoh, n = [], 0
    for r in rows:
        g = profil.periksa_kewajaran(
            r["jenis_code"], {"pasal": r["np"], "diktum": r["nd"],
                              "penjelasan": r["pj"], "total": r["tot"],
                              "panjang_naskah": r["panjang"]})
        if g:
            n += 1
            if len(contoh) < 40:
                contoh.append({"canonical": r["canonical"], "jenis": r["jenis"],
                               "keterangan": "; ".join(g)})
    return _hasil(
        "Parsing tidak wajar",
        "Hasil urai mana yang menyimpang dari bentuk peraturannya?",
        SEDANG, n, len(rows), contoh,
        "Tidak ada pasal di Keputusan itu wajar; tidak ada pasal di "
        "undang-undang berarti pengurainya gagal.")


def naskah_kembar(conn) -> dict:
    """Dokumen mana yang tercatat lebih dari sekali?

    Dua pola dicari, karena satu saja tidak cukup:

    1. **Naskah identik.** Sidik jari isi setelah spasi dirapikan.
    2. **Nomor dan tahun sama, jenis berselisih.** Ini pola yang paling sering
       muncul di katalog: satu peraturan yang sama terdaftar sebagai Perpres,
       Instruksi Dirjen, sekaligus Peraturan Pemerintah. Sidik jari isi tidak
       menangkapnya karena naskahnya berbeda beberapa ratus aksara — hasil
       pindaian yang tidak sama persis — padahal dokumennya satu.

    Judul biasanya menyebut jenis yang benar ("PERUBAHAN ATAS PERATURAN
    PEMERINTAH..."), sehingga label yang keliru dapat dikoreksi tanpa menebak.
    """
    rows = conn.execute(
        "SELECT id, canonical, jenis, jenis_code, nomor_raw, tahun, judul, "
        "       body_text FROM regulation "
        " WHERE has_body=1 AND length(body_text)>400").fetchall()

    sidik_kelompok: dict[str, list] = {}
    nomor_kelompok: dict[tuple, list] = {}
    for r in rows:
        sidik = hashlib.sha1(
            re.sub(r"\s+", " ", r["body_text"]).strip().lower().encode()
        ).hexdigest()
        sidik_kelompok.setdefault(sidik, []).append(r)
        nomor = re.sub(r"\s+", "", (r["nomor_raw"] or "").lower())
        if nomor and r["tahun"]:
            nomor_kelompok.setdefault((nomor, r["tahun"]), []).append(r)

    contoh, terlihat, n = [], set(), 0

    def catat(anggota, sebab):
        nonlocal n
        kunci = tuple(sorted(a["id"] for a in anggota))
        if kunci in terlihat:
            return
        terlihat.add(kunci)
        n += len(anggota) - 1
        if len(contoh) < 40:
            contoh.append({
                "canonical": " = ".join(a["canonical"] for a in anggota),
                "jenis": ", ".join(sorted({a["jenis_code"] or "?" for a in anggota})),
                "keterangan": f'{sebab} — {(anggota[0]["judul"] or "")[:80]}',
            })

    for anggota in sidik_kelompok.values():
        if len(anggota) > 1:
            catat(anggota, "naskah identik")

    for anggota in nomor_kelompok.values():
        if len(anggota) < 2:
            continue
        jenis = {a["jenis_code"] for a in anggota}
        if len(jenis) < 2:
            continue
        judul = {re.sub(r"\W+", "", (a["judul"] or "").lower())[:80]
                 for a in anggota}
        if len(judul) == 1:
            catat(anggota, "nomor & judul sama, jenis berselisih")

    return _hasil(
        "Naskah kembar",
        "Peraturan mana yang tercatat lebih dari sekali?",
        SEDANG, n, len(rows), contoh,
        "Judulnya biasanya menyebut jenis yang benar. Entri kembar membuat satu "
        "aturan terhitung berkali-kali dan muncul berulang di hasil pencarian.")


def identitas_meragukan(conn) -> dict:
    """Nomor pada naskah mana yang berbeda dari nomor pada katalog?"""
    total = conn.execute(
        "SELECT COUNT(*) FROM regulation WHERE id_body IS NOT NULL").fetchone()[0]
    rows = conn.execute(
        "SELECT canonical, canonical_body, jenis, judul FROM regulation "
        "WHERE identity_ok=0 LIMIT 40").fetchall()
    n = conn.execute(
        "SELECT COUNT(*) FROM regulation WHERE identity_ok=0").fetchone()[0]
    return _hasil(
        "Identitas tidak cocok",
        "Nomor di kop naskah mana yang berbeda dari nomor di katalog?",
        BERAT, n, total or 1,
        [{"canonical": r["canonical"], "jenis": r["jenis"],
          "keterangan": f'kop naskah berbunyi {r["canonical_body"]}'}
         for r in rows],
        "Bila kop naskah dan katalog berselisih, salah satu salah — dan kutipan "
        "yang dihasilkan akan menunjuk peraturan yang keliru.")


def konflik_status(conn) -> dict:
    """Status hasil telusur mana yang berlawanan dengan label situs?"""
    total = conn.execute("SELECT COUNT(*) FROM validity").fetchone()[0]
    rows = conn.execute(
        """SELECT r.canonical, r.jenis, r.status_site, v.status_derived, v.reason
             FROM validity v JOIN regulation r ON r.id=v.reg_id
            WHERE v.agrees_with_site=0 LIMIT 40""").fetchall()
    n = conn.execute(
        "SELECT COUNT(*) FROM validity WHERE agrees_with_site=0").fetchone()[0]
    return _hasil(
        "Status berselisih",
        "Status mana yang berbeda antara telusur relasi dan label situs?",
        BERAT, n, total or 1,
        [{"canonical": r["canonical"], "jenis": r["jenis"],
          "keterangan": f'situs="{r["status_site"]}" vs telusur='
                        f'"{r["status_derived"]}" — {(r["reason"] or "")[:70]}'}
         for r in rows],
        "Perselisihan ini yang paling berbahaya bagi pengguna: satu peraturan "
        "dinyatakan berlaku di satu tempat dan dicabut di tempat lain.")


def langgar_hierarki(conn) -> dict:
    """Relasi mana yang mustahil secara hukum?"""
    total = conn.execute("SELECT COUNT(*) FROM relation").fetchone()[0]
    rows = conn.execute(
        """SELECT s.canonical src, d.canonical dst, rel.type, rel.conflict
             FROM relation rel
             JOIN regulation s ON s.id=rel.src_id
             JOIN regulation d ON d.id=rel.dst_id
            WHERE rel.conflict LIKE '%hierarki%' LIMIT 40""").fetchall()
    n = conn.execute(
        "SELECT COUNT(*) FROM relation WHERE conflict LIKE '%hierarki%'"
    ).fetchone()[0]
    return _hasil(
        "Melanggar hierarki",
        "Relasi mana yang mustahil menurut UU 12/2011 Pasal 7?",
        BERAT, n, total or 1,
        [{"canonical": f'{r["src"]} → {r["dst"]}', "jenis": r["type"],
          "keterangan": r["conflict"] or ""} for r in rows],
        "Peraturan yang lebih rendah tidak dapat mencabut yang lebih tinggi. "
        "Sebagian temuan ini berasal dari data resmi, bukan dari salah urai.")


def relasi_menggantung(conn) -> dict:
    """Sitasi mana yang belum tertaut ke dokumen di korpus?"""
    total = conn.execute("SELECT COUNT(*) FROM relation").fetchone()[0]
    rows = conn.execute(
        """SELECT r.canonical src, rel.dst_raw, rel.type, COUNT(*) n
             FROM relation rel JOIN regulation r ON r.id=rel.src_id
            WHERE rel.dst_id IS NULL
            GROUP BY rel.dst_raw ORDER BY n DESC LIMIT 40""").fetchall()
    n = conn.execute(
        "SELECT COUNT(*) FROM relation WHERE dst_id IS NULL").fetchone()[0]
    return _hasil(
        "Sitasi menggantung",
        "Peraturan yang dirujuk mana yang tidak ada di korpus?",
        RINGAN, n, total or 1,
        [{"canonical": r["dst_raw"] or "(kosong)", "jenis": r["type"],
          "keterangan": f'dirujuk {r["n"]}x, a.l. oleh {r["src"]}'} for r in rows],
        "Sebagian karena peraturannya di luar lingkup katalog pajak "
        "(mis. UU Kepabeanan); sebagian karena nomornya belum ternormalkan.")


PEMERIKSAAN = [cakupan_teks, parsing_ganjil, naskah_kembar, identitas_meragukan,
               konflik_status, langgar_hierarki, relasi_menggantung]


def jalankan(conn, hanya: str | None = None) -> list[dict]:
    out = []
    for fn in PEMERIKSAAN:
        if hanya and fn.__name__ != hanya:
            continue
        try:
            out.append(fn(conn))
        except Exception as e:                                   # noqa: BLE001
            out.append(_hasil(fn.__name__, "(pemeriksaan gagal dijalankan)",
                              RINGAN, 0, 0, [], f"{type(e).__name__}: {e}"))
    return out


def ringkas(conn) -> dict:
    """Angka pokok korpus — untuk kepala halaman, bukan untuk menilai mutu."""
    q = lambda s: conn.execute(s).fetchone()[0]                   # noqa: E731
    return {
        "peraturan": q("SELECT COUNT(*) FROM regulation"),
        "berbadan_teks": q("SELECT COUNT(*) FROM regulation WHERE has_body=1"),
        "unit": q("SELECT COUNT(*) FROM pasal"),
        "pasal": q("SELECT COUNT(DISTINCT reg_id||'#'||pasal) FROM pasal "
                   "WHERE pasal IS NOT NULL"),
        "diktum": q("SELECT COUNT(*) FROM pasal WHERE pasal GLOB '[A-Z]*'"),
        "konsolidasi": q("SELECT COUNT(*) FROM regulation "
                         "WHERE id LIKE '%@konsolidasi%'"),
        "berprovenance": q("SELECT COUNT(*) FROM pasal WHERE amandemen IS NOT NULL"),
        "relasi": q("SELECT COUNT(*) FROM relation"),
        # "Terpaut" berarti sasarannya ADA DI KORPUS, bukan sekadar bahwa
        # kuncinya sudah dihitung. 165 relasi bersumber repositori resmi
        # (`method='external'`) membawa kunci sasaran yang sah menurut hukum —
        # "UU 8/1983 mencabut UU 35/1953" memang benar — tetapi dokumennya
        # tidak ada di sini. Menghitungnya sebagai terpaut membuat angka
        # keterhubungan melebihkan diri sendiri, dan justru pada relasi yang
        # paling berwenang.
        "relasi_terpaut": q("SELECT COUNT(*) FROM relation x "
                            " JOIN regulation r ON r.id = x.dst_id"),
        "berlaku": q("SELECT COUNT(*) FROM validity WHERE status_derived='berlaku'"),
        "dicabut": q("SELECT COUNT(*) FROM validity WHERE status_derived='dicabut'"),
    }
