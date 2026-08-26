"""Graf di sekitar satu peraturan — bentuk yang dapat dibaca manusia.

Korpus memuat 10.535 simpul dan 44.495 sisi. Menggambar semuanya sekaligus
menghasilkan gumpalan yang tidak menjawab pertanyaan apa pun; yang berguna
adalah graf di sekitar SATU peraturan, karena itulah bentuk pertanyaan yang
sebenarnya diajukan orang: "aturan ini bersandar pada apa, mencabut apa, dan
siapa yang melaksanakannya".

**Arah sisi adalah isi pesannya.** Relasi keluar menyatakan apa yang dilakukan
peraturan ini terhadap yang lain; relasi masuk menyatakan apa yang dilakukan
peraturan lain terhadapnya. Menggambar keduanya di sisi yang sama membuat
"mencabut" dan "dicabut oleh" tidak terbedakan — dan itu justru pembedaan yang
paling menentukan.

**Sisi yang belum tertaut tetap ditampilkan.** Rujukan ke dokumen yang tidak ada
di korpus digambar sebagai simpul berbayang. Menyembunyikannya membuat graf
tampak lebih lengkap daripada kenyataannya, dan pembaca menyangka sudah melihat
seluruh sandaran hukum sebuah aturan padahal belum.
"""
from __future__ import annotations

# Ambang keyakinan yang sama dengan perhitungan masa berlaku, supaya graf yang
# dilihat orang adalah graf yang dipakai sistem — bukan versi yang lebih longgar.
MIN_CONF = 0.75

ARAH = {
    "MENCABUT": ("mencabut", "dicabut oleh"),
    "MENCABUT_SEBAGIAN": ("mencabut sebagian", "dicabut sebagian oleh"),
    "MENGUBAH": ("mengubah", "diubah oleh"),
    "DASAR_HUKUM": ("bersandar pada", "menjadi dasar bagi"),
    "MELAKSANAKAN": ("melaksanakan", "dilaksanakan oleh"),
    "KONSOLIDASI_DARI": ("konsolidasi dari", "dikonsolidasikan menjadi"),
    "MENCAKUP_PERUBAHAN": ("mencakup perubahan", "tercakup dalam"),
}

# Urutan tampil: yang mengakhiri keberlakuan lebih dulu, sandaran hukum terakhir.
# DASAR_HUKUM paling banyak jumlahnya tetapi paling sedikit akibatnya; menaruhnya
# di atas akan mengubur pencabutan yang justru menentukan.
URUT = ["MENCABUT", "MENCABUT_SEBAGIAN", "MENGUBAH", "KONSOLIDASI_DARI",
        "MELAKSANAKAN", "MENCAKUP_PERUBAHAN", "DASAR_HUKUM"]


def _simpul(conn, reg_id: str) -> dict | None:
    r = conn.execute(
        """SELECT r.id, r.canonical, r.judul, r.jenis_code, r.tahun, r.url,
                  v.status_derived
             FROM regulation r LEFT JOIN validity v ON v.reg_id=r.id
            WHERE r.id=?""", (reg_id,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["status"] = d.pop("status_derived") or "tidak_diketahui"
    return d


def sekitar(conn, reg_id: str, batas_per_jenis: int = 8) -> dict:
    """Simpul dan sisi di sekeliling satu peraturan, dipisah menurut arah.

    `batas_per_jenis` memotong tiap kelompok relasi. Satu peraturan dapat
    menjadi dasar hukum bagi ratusan yang lain — menggambar semuanya membuat
    gambarnya tidak terbaca, sedangkan memotongnya tanpa mengatakan berapa yang
    dipotong membuat pembaca menyangka itu seluruhnya. Karena itu jumlah penuh
    selalu ikut dikembalikan.
    """
    pusat = _simpul(conn, reg_id)
    if not pusat:
        return {}

    keluar, masuk = {}, {}

    for r in conn.execute(
            """SELECT rel.type, rel.dst_id, rel.dst_raw, rel.confidence,
                      rel.scope, rel.conflict
                 FROM relation rel
                WHERE rel.src_id=? AND rel.confidence>=?""",
            (reg_id, MIN_CONF)):
        keluar.setdefault(r["type"], []).append(dict(r))

    for r in conn.execute(
            """SELECT rel.type, rel.src_id, rel.confidence, rel.scope,
                      rel.conflict
                 FROM relation rel
                WHERE rel.dst_id=? AND rel.confidence>=?""",
            (reg_id, MIN_CONF)):
        masuk.setdefault(r["type"], []).append(dict(r))

    def rakit(kelompok: dict, arah: str) -> list[dict]:
        out = []
        for tipe in URUT:
            baris = kelompok.get(tipe)
            if not baris:
                continue
            simpul = []
            for b in baris[:batas_per_jenis]:
                lawan = b.get("dst_id") if arah == "keluar" else b.get("src_id")
                s = _simpul(conn, lawan) if lawan else None
                if s is None:
                    # Rujukan yang belum tertaut tetap digambar, sebagai simpul
                    # berbayang — bukan dihilangkan.
                    s = {"id": None, "canonical": b.get("dst_raw") or "(tidak dikenal)",
                         "judul": None, "jenis_code": None, "tahun": None,
                         "status": "belum_tertaut", "url": None}
                simpul.append({**s, "confidence": b["confidence"],
                               "scope": b["scope"], "conflict": b["conflict"]})
            out.append({
                "tipe": tipe,
                "label": ARAH.get(tipe, (tipe, tipe))[0 if arah == "keluar" else 1],
                "jumlah": len(baris), "ditampilkan": len(simpul),
                "simpul": simpul,
            })
        return out

    return {"pusat": pusat,
            "keluar": rakit(keluar, "keluar"),
            "masuk": rakit(masuk, "masuk"),
            "batas": batas_per_jenis}


def tersibuk(conn, batas: int = 20) -> list[dict]:
    """Peraturan dengan sisi terbanyak — titik masuk yang berguna.

    Tanpa daftar ini, graf hanya dapat dibuka bila penggunanya sudah tahu
    peraturan mana yang ingin dilihat. Yang paling banyak tersambung biasanya
    justru undang-undang pokok dan peraturan pelaksana utamanya.
    """
    return [dict(r) for r in conn.execute(
        """SELECT r.id, r.canonical, r.judul, r.jenis_code, r.tahun,
                  v.status_derived status,
                  (SELECT COUNT(*) FROM relation WHERE src_id=r.id
                    AND confidence>=?) n_keluar,
                  (SELECT COUNT(*) FROM relation WHERE dst_id=r.id
                    AND confidence>=?) n_masuk
             FROM regulation r LEFT JOIN validity v ON v.reg_id=r.id
            WHERE r.berkala IS NULL
            ORDER BY (n_keluar + n_masuk) DESC LIMIT ?""",
        (MIN_CONF, MIN_CONF, batas))]
