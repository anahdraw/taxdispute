"""Tautkan ulang relasi yang sasarannya sebenarnya ada di korpus.

Sebagian sumber luar menyebut peraturan sasaran memakai *slug* mereka sendiri —
JDIH Kemenkeu menulis `563-kmk-03-2003` untuk dokumen yang di korpus kita
bernomor `563/KMK.03/2003` dan berkunci `kmk-563-kmk-03-2003`. Slug itu tersimpan
apa adanya sebagai `dst_raw`, sehingga relasinya tidak pernah tertaut meski
dokumennya jelas ada.

Akibatnya terlihat di graf: satu sasaran muncul dua kali — satu simpul utuh dan
satu simpul berbayang "belum ada di korpus" — padahal keduanya dokumen yang sama.
Selain membingungkan, itu membuat jumlah relasi menggantung tampak jauh lebih
besar daripada kekosongan yang sebenarnya.

**Pemadanan hanya diterima bila tepat satu dokumen cocok.** Slug tanpa awalan
jenis dapat, pada prinsipnya, menunjuk lebih dari satu dokumen; menautkannya
dalam keadaan itu berarti menebak. Yang ambigu dibiarkan tetap menggantung dan
ditandai, bukan ditautkan ke salah satu.
"""
from __future__ import annotations

import collections


def _indeks_akhiran(conn) -> dict[str, list[str]]:
    """Kunci korpus tanpa awalan jenisnya: 'kmk-563-kmk-03-2003' -> '563-kmk-03-2003'."""
    idx = collections.defaultdict(list)
    for (i,) in conn.execute("SELECT id FROM regulation"):
        if "-" in i:
            idx[i.split("-", 1)[1]].append(i)
    return idx


def periksa(conn) -> dict:
    """Hitung berapa yang dapat ditautkan, tanpa mengubah apa pun."""
    idx = _indeks_akhiran(conn)
    tepat, ambigu, tetap = [], [], 0
    for (raw,) in conn.execute(
            "SELECT DISTINCT dst_raw FROM relation "
            " WHERE dst_id IS NULL AND dst_raw IS NOT NULL AND dst_raw<>''"):
        n = len(idx.get(raw, []))
        if n == 1:
            tepat.append(raw)
        elif n > 1:
            ambigu.append(raw)
        else:
            tetap += 1
    n_rel = 0
    if tepat:
        ph = ",".join("?" * len(tepat))
        n_rel = conn.execute(
            f"SELECT COUNT(*) FROM relation WHERE dst_id IS NULL "
            f"  AND dst_raw IN ({ph})", tepat).fetchone()[0]
    return {"rujukan_dapat_ditautkan": len(tepat), "relasi_terdampak": n_rel,
            "ambigu": len(ambigu), "tetap_menggantung": tetap}


def jalankan(conn) -> dict:
    """Tautkan yang cocok tepat satu; catat alasannya pada kolom method."""
    idx = _indeks_akhiran(conn)
    ubah = []
    for (raw,) in conn.execute(
            "SELECT DISTINCT dst_raw FROM relation "
            " WHERE dst_id IS NULL AND dst_raw IS NOT NULL AND dst_raw<>''"):
        cocok = idx.get(raw, [])
        if len(cocok) == 1:
            ubah.append((cocok[0], raw))
    with conn:
        conn.executemany(
            # `method` ditambahi penanda supaya asal pemadanan ini tetap
            # terlihat: ia lebih longgar daripada pemadanan kunci penuh, dan
            # pembaca berhak tahu mana yang tertaut lewat jalur mana.
            "UPDATE relation SET dst_id=?, "
            "  method=COALESCE(method,'')||'+slug' "
            " WHERE dst_id IS NULL AND dst_raw=?", ubah)
    return {"rujukan": len(ubah),
            "relasi_tertaut": conn.total_changes,
            "sisa_menggantung": conn.execute(
                "SELECT COUNT(*) FROM relation WHERE dst_id IS NULL").fetchone()[0]}
