"""Pencarian sadar-waktu dan sadar-graf.

Kegagalan khas mesin pencari peraturan bukan "tidak menemukan dokumen",
melainkan "menemukan dokumen yang sudah dicabut dan menyajikannya sebagai
hukum yang berlaku". Karena itu urutan pemeringkatan di sini menempatkan
status hukum sebagai faktor utama, bukan sekadar kemiripan teks.

Empat lapis:
  1. Leksikal (FTS5/BM25)  — presisi tinggi untuk istilah teknis dan nomor
     pasal; gratis; bahasa Indonesia hukum sangat kaya istilah baku sehingga
     BM25 sudah kuat. Ini basis, bukan pelengkap.
  2. Filter metadata        — jenis, kategori, tag katalog, rentang tahun.
  3. Filter waktu           — "sebagaimana berlaku pada tanggal X".
  4. Perluasan graf         — bila kena dokumen lama, sajikan versi
     penggantinya; bila kena dokumen pelaksana, sajikan dasar hukumnya.

Embedding bersifat opsional (lihat `hybrid`): jalankan hanya bila kebutuhan
pencarian semantik terbukti, karena BM25 + filter sudah menutup mayoritas
kasus dengan biaya nol.
"""
from __future__ import annotations

import re
from datetime import date

from .graph import status_pada, versi_terkini

STOP = {"yang", "dan", "atau", "dengan", "untuk", "pada", "dalam", "dari",
        "atas", "oleh", "ini", "itu", "adalah", "sebagaimana", "tentang"}


def to_fts_query(q: str) -> str:
    """Ubah pertanyaan bebas menjadi query FTS5 yang aman.

    Nomor pasal dan nomor peraturan diperlakukan sebagai frasa utuh agar
    'Pasal 21' tidak cocok dengan sembarang '21'.
    """
    q = (q or "").strip()
    frasa = []
    for m in re.finditer(r"pasal\s+\d+[A-Za-z]?", q, re.I):
        frasa.append(f'"{m.group(0)}"')
    for m in re.finditer(r"\b[A-Z]{2,6}-?\s?\d+[/\-][A-Za-z0-9./]+\b", q):
        frasa.append(f'"{m.group(0)}"')
    kata = [w for w in re.findall(r"[\w]+", q.lower())
            if len(w) > 2 and w not in STOP]
    terms = frasa + [f"{w}*" if len(w) > 4 else w for w in kata]
    return " OR ".join(dict.fromkeys(terms)) if terms else '""'


def search(conn, query: str, *, as_of: str | None = None, limit=20,
           kategori=None, jenis=None, tahun_min=None, tahun_max=None,
           tag=None, sertakan_dicabut=False, perluas_graf=True) -> list[dict]:
    """Cari unit pasal; kembalikan hasil dengan sitasi dan status hukum."""
    as_of = as_of or date.today().isoformat()
    fq = to_fts_query(query)

    sql = """
      SELECT m.pasal_id, bm25(pasal_fts, 8.0, 1.0, 4.0, 3.0) AS skor
        FROM pasal_fts f
        JOIN pasal_fts_map m ON m.rowid = f.rowid
       WHERE pasal_fts MATCH ?
       ORDER BY skor LIMIT ?"""
    raw = conn.execute(sql, (fq, limit * 8)).fetchall()
    if not raw:
        return []

    ids = [r["pasal_id"] for r in raw]
    skor = {r["pasal_id"]: r["skor"] for r in raw}
    ph = ",".join("?" * len(ids))
    rows = conn.execute(f"""
      SELECT p.id, p.reg_id, p.path, p.text, p.bagian_dok, p.pasal, p.ayat,
             r.canonical, r.judul, r.jenis, r.jenis_code, r.kategori,
             r.tahun, r.tanggal, r.status_site, r.url,
             v.status_derived, v.valid_from, v.valid_to, v.superseded_by
        FROM pasal p
        JOIN regulation r ON r.id = p.reg_id
        LEFT JOIN validity v ON v.reg_id = p.reg_id
       WHERE p.id IN ({ph})""", ids).fetchall()

    hasil = []
    for row in rows:
        d = dict(row)
        if kategori and (d["kategori"] or "").split(" -")[0].upper() != kategori.upper():
            continue
        if jenis and (d["jenis_code"] or "").upper() != jenis.upper():
            continue
        if tahun_min and (d["tahun"] or 0) < tahun_min:
            continue
        if tahun_max and (d["tahun"] or 9999) > tahun_max:
            continue
        if tag:
            hit = conn.execute(
                "SELECT 1 FROM reg_tag WHERE reg_id=? AND (tag_code=? OR tag_name LIKE ?)",
                (d["reg_id"], tag, f"%{tag}%")).fetchone()
            if not hit:
                continue

        st = status_pada(conn, d["reg_id"], as_of)
        d["status_pada_tanggal"] = st["status"]
        d["as_of"] = as_of
        if not sertakan_dicabut and st["status"] in ("sudah_dicabut", "belum_berlaku"):
            continue

        # Skor akhir: relevansi teks + bobot status hukum + kebaruan.
        base = -skor[d["id"]]                       # bm25 makin kecil makin baik
        bonus = {"berlaku": 1.35, "diubah": 1.15, "dicabut_sebagian": 1.05,
                 "sudah_dicabut": 0.55, "belum_berlaku": 0.6}.get(st["status"], 0.9)
        recency = 1.0 + min((d["tahun"] or 1990) - 1983, 45) / 300
        # Ketentuan operatif lebih relevan daripada konsideran.
        seksi = {"batang_tubuh": 1.0, "penutup": 0.9, "penjelasan": 0.85,
                 "menimbang": 0.55, "mengingat": 0.45}.get(d["bagian_dok"], 0.8)
        d["skor"] = round(base * bonus * recency * seksi, 4)
        d["kutipan"] = f'{d["canonical"]} — {d["path"]}'
        d["cuplikan"] = _cuplikan(d["text"], query)

        if perluas_graf and st["status"] in ("sudah_dicabut", "diubah"):
            terkini = versi_terkini(conn, d["reg_id"])
            if terkini != d["reg_id"]:
                t = conn.execute(
                    "SELECT canonical,judul,url FROM regulation WHERE id=?",
                    (terkini,)).fetchone()
                if t:
                    d["lihat_juga"] = {"id": terkini, "canonical": t["canonical"],
                                       "judul": t["judul"], "url": t["url"],
                                       "alasan": "versi terkini dari rantai perubahan"}
        hasil.append(d)

    hasil.sort(key=lambda x: x["skor"], reverse=True)
    return hasil[:limit]


def _cuplikan(text: str, query: str, width=280) -> str:
    kata = [w for w in re.findall(r"\w+", (query or "").lower())
            if len(w) > 3 and w not in STOP]
    low = text.lower()
    pos = min((low.find(w) for w in kata if low.find(w) >= 0), default=-1)
    if pos < 0:
        return text[:width] + ("…" if len(text) > width else "")
    a = max(0, pos - width // 3)
    return ("…" if a else "") + text[a:a + width] + ("…" if a + width < len(text) else "")


def konteks_untuk_llm(hasil: list[dict], max_chars=12000) -> str:
    """Rakit konteks siap-pakai untuk RAG, lengkap dengan sitasi dan status.

    Setiap potongan membawa status hukumnya. Ini yang mencegah model menjawab
    berdasarkan pasal yang sudah dicabut tanpa memberi tahu penggunanya.
    """
    bagian, total = [], 0
    for h in hasil:
        blok = (f"[{h['kutipan']}]\n"
                f"Status per {h['as_of']}: {h['status_pada_tanggal']}"
                + (f" (lihat juga: {h['lihat_juga']['canonical']})" if h.get("lihat_juga") else "")
                + f"\nJudul: {h['judul']}\n{h['text']}\n")
        if total + len(blok) > max_chars:
            break
        bagian.append(blok)
        total += len(blok)
    return "\n---\n".join(bagian)


# --- Opsional: pencarian hibrida -------------------------------------------
def hybrid(conn, query: str, embed_fn=None, alpha=0.65, **kw) -> list[dict]:
    """Gabungkan BM25 dengan kemiripan vektor bila embedding tersedia.

    `embed_fn(list[str]) -> list[list[float]]` sengaja disuntikkan dari luar
    agar pipeline tidak memaksa satu penyedia embedding tertentu. Tanpa
    embed_fn, fungsi ini setara dengan `search()` — sengaja, supaya sistem
    tetap berjalan penuh tanpa biaya tambahan.
    """
    dasar = search(conn, query, **kw)
    if embed_fn is None or not dasar:
        return dasar
    import math
    qv = embed_fn([query])[0]
    dv = embed_fn([d["text"][:2000] for d in dasar])

    def cos(a, b):
        na = math.sqrt(sum(x * x for x in a)) or 1.0
        nb = math.sqrt(sum(x * x for x in b)) or 1.0
        return sum(x * y for x, y in zip(a, b)) / (na * nb)

    smax = max(abs(d["skor"]) for d in dasar) or 1.0
    for d, v in zip(dasar, dv):
        d["skor_semantik"] = round(cos(qv, v), 4)
        d["skor"] = round(alpha * (d["skor"] / smax) + (1 - alpha) * d["skor_semantik"], 4)
    dasar.sort(key=lambda x: x["skor"], reverse=True)
    return dasar
