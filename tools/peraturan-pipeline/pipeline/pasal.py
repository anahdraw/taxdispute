"""Tampilan per-pasal: merakit unit-unit lepas menjadi satu pasal utuh.

Tabel `pasal` menyimpan unit terkecil yang dapat dikutip — satu baris per ayat,
huruf, atau angka. Bentuk itu tepat untuk pencarian, tetapi bukan bentuk yang
dibaca orang. Yang dibaca orang adalah **pasal utuh**: ayat (1) sampai (5)
berikut huruf-hurufnya, dalam urutan aslinya.

Modul ini merakit kembali unit-unit itu tanpa menduplikasi penyimpanan. Sumber
kebenarannya tetap satu, yaitu tabel `pasal`; yang berbeda hanya cara
menyajikannya.

Beberapa keputusan yang perlu dijelaskan:

- **Penjelasan tidak ikut ke dalam batang tubuh.** Ia dikembalikan di medan
  terpisah. Penjelasan menerangkan, tidak mengatur; menggabungkannya membuat
  kutipan menyesatkan.
- **Diktum diperlakukan setara pasal.** Pada Keputusan, satuan yang dikutip
  orang adalah "Diktum KESATU", bukan "Pasal 1". Keduanya menempati slot yang
  sama, dan label membedakannya.
- **Status hukum ikut pada setiap pasal.** Pasal dari peraturan yang sudah
  dicabut tetap boleh dibaca — untuk sengketa atas peristiwa lama — tetapi
  statusnya harus terbaca, bukan tersirat.
"""
from __future__ import annotations

import re

from datetime import date

from .graph import status_pada


def _urut_ayat(a: str | None) -> tuple:
    """Urutkan ayat dengan sisipan: (2), (2a), (2b), (3).

    Perubahan undang-undang menyisipkan ayat baru dengan akhiran huruf, jadi
    pengurutan leksikal biasa akan menaruh (2a) sesudah (20).
    """
    if not a:
        return (0, "")
    m = re.match(r"(\d+)([a-z]*)", a)
    return (int(m.group(1)), m.group(2)) if m else (0, a)


def daftar_pasal(conn, reg_id: str) -> list[dict]:
    """Semua pasal/diktum dalam satu peraturan, beserta ringkasannya."""
    rows = conn.execute(
        """SELECT pasal, bab, MIN(seq) seq, COUNT(*) n_unit,
                  SUM(bagian_dok='penjelasan') n_penjelasan,
                  MAX(amandemen) amandemen
             FROM pasal
            WHERE reg_id=? AND pasal IS NOT NULL
            GROUP BY pasal ORDER BY MIN(seq)""", (reg_id,)).fetchall()
    out = []
    for r in rows:
        label = r["pasal"]
        out.append({
            "pasal": label,
            "label": f"Diktum {label}" if label[:1].isalpha() else f"Pasal {label}",
            "bab": r["bab"],
            "n_unit": r["n_unit"],
            "ada_penjelasan": bool(r["n_penjelasan"]),
            "amandemen": r["amandemen"],
        })
    return out


def ambil_pasal(conn, reg_id: str, nomor: str, as_of: str | None = None) -> dict:
    """Satu pasal utuh: batang tubuh tersusun, penjelasan, status, provenance."""
    reg = conn.execute(
        "SELECT id,canonical,judul,jenis,jenis_code,tahun,tanggal,status_site,url "
        "FROM regulation WHERE id=?", (reg_id,)).fetchone()
    if not reg:
        return {}

    rows = conn.execute(
        "SELECT seq,path,ayat,huruf,angka,bagian_dok,text,amandemen "
        "FROM pasal WHERE reg_id=? AND pasal=? ORDER BY seq", (reg_id, nomor)
    ).fetchall()
    if not rows:
        return {}

    badan, penjelasan = [], []
    for r in rows:
        item = {
            "path": r["path"], "ayat": r["ayat"], "huruf": r["huruf"],
            "angka": r["angka"], "teks": r["text"], "amandemen": r["amandemen"],
            "tingkat": ("angka" if r["angka"] else "huruf" if r["huruf"]
                        else "ayat" if r["ayat"] else "pasal"),
        }
        (penjelasan if r["bagian_dok"] == "penjelasan" else badan).append(item)

    badan.sort(key=lambda x: (_urut_ayat(x["ayat"]), x["huruf"] or "",
                              int(x["angka"]) if (x["angka"] or "").isdigit() else 0))

    as_of = as_of or date.today().isoformat()
    st = status_pada(conn, reg_id, as_of)

    # Provenance pasal: tanda pada pasalnya sendiri bila ada, jika tidak
    # tanda paling sering di antara unit-unitnya. Dilaporkan apa adanya.
    tanda = [x["amandemen"] for x in badan if x["amandemen"]]
    asal = tanda[0] if tanda else None

    return {
        "reg_id": reg_id,
        "canonical": reg["canonical"],
        "judul": reg["judul"],
        "jenis": reg["jenis"],
        "jenis_code": reg["jenis_code"],
        "tahun": reg["tahun"],
        "url": reg["url"],
        "status_site": reg["status_site"],
        "status": st.get("status"),
        "status_alasan": st.get("reason"),
        "as_of": as_of,
        "valid_from": st.get("valid_from"),
        "valid_to": st.get("valid_to"),
        "pasal": nomor,
        "label": f"Diktum {nomor}" if nomor[:1].isalpha() else f"Pasal {nomor}",
        "bab": rows[0]["bab"] if "bab" in rows[0].keys() else None,
        "asal_rumusan": asal,
        "badan": badan,
        "penjelasan": penjelasan,
        "kutipan": f'{reg["canonical"]} '
                   f'{"Diktum" if nomor[:1].isalpha() else "Pasal"} {nomor}',
    }


def cari_pasal(conn, query: str, limit: int = 20, **kw) -> list[dict]:
    """Cari, lalu nilai ulang di tingkat pasal.

    Menggabungkan hasil unit saja tidak cukup. BM25 menilai tiap unit sendiri-
    sendiri, padahal istilah pertanyaan kerap tersebar di dalam satu pasal:
    "tarif ... wajib pajak badan" ada di ayat (1) dan huruf b UU PPh Pasal 17,
    tidak ada satu unit pun yang memuat keduanya. Akibatnya pasal tarif PPh —
    jawaban yang benar — tidak muncul sama sekali, kalah oleh unit lain yang
    kebetulan padat satu istilah.

    Karena itu pasal dinilai atas teks utuhnya: berapa banyak istilah
    pertanyaan yang benar-benar tercakup. Skor unit tetap dipakai sebagai
    sinyal kedekatan, tetapi cakupan istilah yang menentukan urutan.
    """
    from .search import STOP, search

    istilah = {w for w in re.findall(r"[\w]+", (query or "").lower())
               if len(w) > 3 and w not in STOP}

    # Kolam kandidat sengaja lebar: pasal yang jawabannya benar bisa saja
    # tidak punya satu unit pun berperingkat tinggi.
    unit = search(conn, query, limit=max(limit * 20, 300), **kw)

    per_pasal: dict[tuple, dict] = {}
    for u in unit:
        kunci = (u["reg_id"], u.get("pasal") or u["path"])
        slot = per_pasal.setdefault(kunci, {
            "reg_id": u["reg_id"], "canonical": u["canonical"],
            "judul": u["judul"], "pasal": u.get("pasal"),
            "jenis": u.get("jenis"), "jenis_code": u.get("jenis_code"),
            "tahun": u.get("tahun"), "kategori": u.get("kategori"),
            "status": u.get("status_pada_tanggal"), "as_of": u.get("as_of"),
            "url": u.get("url"), "skor_unit": 0.0, "cuplikan": [],
        })
        slot["skor_unit"] = max(slot["skor_unit"], u["skor"])
        if len(slot["cuplikan"]) < 3:
            slot["cuplikan"].append({"path": u["path"], "teks": u["cuplikan"]})

    for (reg_id, kunci2), slot in per_pasal.items():
        if slot["pasal"]:
            rows = conn.execute(
                "SELECT text FROM pasal WHERE reg_id=? AND pasal=? "
                "AND bagian_dok<>'penjelasan'", (reg_id, slot["pasal"])).fetchall()
        else:
            rows = conn.execute(
                "SELECT text FROM pasal WHERE reg_id=? AND path=?",
                (reg_id, kunci2)).fetchall()
        penuh = " ".join(r["text"] or "" for r in rows).lower()
        cocok = {t for t in istilah if t in penuh}
        slot["cakupan"] = len(cocok) / len(istilah) if istilah else 1.0
        slot["istilah_cocok"] = sorted(cocok)
        slot["istilah_hilang"] = sorted(istilah - cocok)
        # Cakupan penuh digandakan dua kali lipat; cakupan separuh nyaris tidak.
        slot["skor"] = round(slot["skor_unit"] * (0.4 + 1.6 * slot["cakupan"] ** 2), 2)

    hasil = _gabung_kembar(sorted(per_pasal.values(), key=lambda x: -x["skor"]))[:limit]
    for h in hasil:
        n = h.get("pasal")
        h["label"] = (f"Diktum {n}" if n and n[:1].isalpha()
                      else f"Pasal {n}" if n else "(bagian lain)")
        h["kutipan"] = f'{h["canonical"]} {h["label"]}' if n else h["canonical"]
    return hasil


def _gabung_kembar(hasil: list[dict]) -> list[dict]:
    """Satukan entri kembar menjadi satu hasil.

    Katalog memuat peraturan yang sama lebih dari sekali dengan jenis berbeda —
    satu dokumen terdaftar sebagai Perpres sekaligus Instruksi Dirjen. Bila
    dibiarkan, tiga kartu berisi pasal yang sama akan memenuhi hasil teratas
    dan mendesak jawaban lain keluar. Yang tampak sebagai tiga temuan
    sebenarnya satu.

    Entri yang disatukan tidak dibuang, melainkan disebut sebagai alias, agar
    pembaca tahu peraturan ini tercatat ganda — itu sendiri informasi yang
    perlu diketahui saat menyitir.
    """
    keluar: list[dict] = []
    indeks: dict[tuple, dict] = {}
    for h in hasil:
        # Hanya sah menggabung bila dokumennya memang berbeda dan pasalnya
        # sama. Tanpa syarat pasal, dua bagian berbeda dari satu dokumen yang
        # sama akan dianggap kembar padahal keduanya isi yang berlainan.
        if not h.get("pasal") or not (h.get("judul") or "").strip():
            keluar.append(h)
            continue
        kunci = (re.sub(r"\W+", "", h["judul"].lower())[:70],
                 h["pasal"], h.get("tahun"))
        induk = indeks.get(kunci)
        if induk is not None and induk["reg_id"] == h["reg_id"]:
            keluar.append(h)
            continue
        if induk is None:
            indeks[kunci] = h
            h["alias"] = []
            keluar.append(h)
        else:
            induk["alias"].append(h["canonical"])
    return keluar


def naskah_penuh(conn, reg_id: str) -> dict:
    """Seluruh naskah satu peraturan, berurut, siap dibaca dari atas ke bawah.

    Berbeda dari `daftar_pasal` yang hanya menyebut judul pasalnya, dan berbeda
    dari `ambil_pasal` yang mengambil satu pasal. Keduanya menjawab pertanyaan
    lain: yang pertama "pasal apa saja yang ada", yang kedua "apa bunyi pasal
    ini". Yang ini menjawab "apa isi peraturannya" — dan itu pertanyaan yang
    paling sering diajukan lebih dahulu.

    Setiap unit membawa **kutipannya sendiri**. Kutipan dibentuk di sini, bukan
    di antarmuka, karena ia bagian dari data: yang menyalinnya ke dokumen lain
    harus mendapat rujukan yang sama persis dengan yang tersimpan, bukan
    rangkaian teks yang kebetulan dirakit tampilan.
    """
    reg = conn.execute(
        "SELECT id, canonical, judul, jenis, jenis_code, kategori, tahun, "
        "       tanggal, status_site, url, source, has_body "
        "  FROM regulation WHERE id=?", (reg_id,)).fetchone()
    if not reg:
        return {}
    val = conn.execute(
        "SELECT status_derived, valid_from, valid_to, reason "
        "  FROM validity WHERE reg_id=?", (reg_id,)).fetchone()

    # Sebutan dasar untuk kutipan: nomor kanonik ditambah daerahnya bila ada.
    # Tanpa daerah, "Perda 1 Tahun 2024" menunjuk ratusan dokumen berbeda.
    dae = (reg["kategori"] or "").strip()
    berdaerah = dae.lower().startswith(("provinsi", "kab", "kota"))
    kepala = reg["canonical"] or reg["id"]
    # Daerah ditambahkan hanya bila sebutan kanoniknya belum memuatnya.
    # Sejak `canonical` diperbaiki, ia sudah memuat daerahnya — menambahkan
    # lagi menghasilkan "PERDA 9/Kab. Buleleng/2023 (Kab. Buleleng)".
    if berdaerah and dae.lower() not in kepala.lower():
        kepala = f"{kepala} ({dae})"

    unit = []
    for r in conn.execute(
            "SELECT seq, bab, bagian, pasal, ayat, huruf, angka, bagian_dok, "
            "       path, text, amandemen FROM pasal "
            " WHERE reg_id=? ORDER BY seq", (reg_id,)):
        u = dict(r)
        u["kutipan"] = f"{kepala} {r['path']}" if r["path"] else kepala
        unit.append(u)

    return {
        "peraturan": {**dict(reg), "kepala": kepala,
                      "berdaerah": berdaerah,
                      "status": (val["status_derived"] if val else None),
                      "berlaku_dari": (val["valid_from"] if val else None),
                      "berlaku_sampai": (val["valid_to"] if val else None),
                      "alasan_status": (val["reason"] if val else None)},
        "unit": unit,
        "jumlah_unit": len(unit),
        "jumlah_pasal": len({u["pasal"] for u in unit if u["pasal"]}),
    }
