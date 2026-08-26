"""Perbaiki naskah bentuk narasi yang terlanjur dipecah sebagai berpasal.

Penataan ulang naskah Ortax semula memecah baris di setiap "Pasal N". Untuk
Peraturan Menteri itu benar. Untuk Surat Edaran — yang tidak berpasal sama
sekali — setiap rujukan di tengah kalimat ("sebagaimana dimaksud dalam Pasal
17D Undang-Undang KUP") berubah menjadi judul pasal, dan korpus mendapat sitasi
ke pasal yang tidak pernah ada.

Mengarang struktur lebih berbahaya daripada kurang mengurai: yang kurang terurai
tampak jelas kurang, sedangkan pasal palsu terlihat sah dan akan dikutip orang.

Modul ini memperbaikinya dari naskah yang sudah tersimpan, tanpa mengunduh
ulang 2.754 dokumen. Yang dilakukan: menyambung kembali jeda baris yang keliru
di depan "Pasal N", lalu memecah ulang pada butir bernomor sesuai bentuknya.
"""
from __future__ import annotations

import re

from .sources.ortax import BENTUK_NARASI, rapikan_naskah
from .structure import parse_body, store_units

# Jeda baris yang dahulu disisipkan di depan "Pasal N" disambung kembali.
# Hanya di depan "Pasal", bukan di depan penanda lain — sisanya memang benar.
RE_SAMBUNG_PASAL = re.compile(r"\n(?=Pasal\s+\d+[A-Z]?\b)")


def perbaiki_satu(conn, reg_id: str, jenis_code: str) -> dict:
    r = conn.execute(
        "SELECT body_text FROM regulation WHERE id=?", (reg_id,)).fetchone()
    if not r or not r["body_text"]:
        return {"reg_id": reg_id, "hasil": "tanpa_naskah"}

    lama = r["body_text"]
    # Naskah dikembalikan mendekati bentuk satu paragraf lebih dulu, lalu
    # ditata ulang dengan aturan yang benar untuk bentuknya. Menambal jeda baris
    # yang salah satu per satu akan meninggalkan sisa yang sulit ditemukan.
    datar = RE_SAMBUNG_PASAL.sub(" ", lama)
    baru = rapikan_naskah(datar, jenis_code)

    unit = parse_body(baru)
    n = store_units(conn, reg_id, unit)
    conn.execute("UPDATE regulation SET body_text=? WHERE id=?", (baru, reg_id))

    palsu = sum(1 for u in unit if u.pasal)
    return {"reg_id": reg_id, "hasil": "diperbaiki", "unit": n,
            "pasal_tersisa": palsu}


def jalankan(conn, progress=print) -> dict:
    """Perbaiki seluruh dokumen berbentuk narasi yang berasal dari Ortax."""
    daftar = ",".join(f"'{x}'" for x in sorted(BENTUK_NARASI))
    rows = conn.execute(
        f"SELECT id, jenis_code FROM regulation "
        f" WHERE source='ortax' AND jenis_code IN ({daftar}) "
        f"   AND body_text IS NOT NULL AND body_text<>''").fetchall()

    n = {"dokumen": len(rows), "unit_sebelum": 0, "unit_sesudah": 0,
         "pasal_palsu_sebelum": 0, "pasal_palsu_sesudah": 0}
    n["unit_sebelum"] = conn.execute(
        f"SELECT COUNT(*) FROM pasal WHERE reg_id IN "
        f"(SELECT id FROM regulation WHERE source='ortax' "
        f" AND jenis_code IN ({daftar}))").fetchone()[0]
    n["pasal_palsu_sebelum"] = conn.execute(
        f"SELECT COUNT(*) FROM pasal WHERE pasal IS NOT NULL AND reg_id IN "
        f"(SELECT id FROM regulation WHERE source='ortax' "
        f" AND jenis_code IN ({daftar}))").fetchone()[0]

    for i, r in enumerate(rows, 1):
        h = perbaiki_satu(conn, r["id"], r["jenis_code"])
        n["unit_sesudah"] += h.get("unit", 0)
        n["pasal_palsu_sesudah"] += h.get("pasal_tersisa", 0)
        if progress and i % 400 == 0:
            conn.commit()
            progress(f"  {i}/{len(rows)}")
    conn.commit()
    return n
