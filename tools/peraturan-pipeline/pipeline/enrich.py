"""Pengayaan korpus dari sumber sekunder.

Menutup dua lubang sekaligus untuk dokumen yang tidak punya badan teks di DJP:
  1. **Teks** — diambil dari PDF resmi penerbit (umumnya ber-text-layer,
     sehingga nol biaya OCR).
  2. **Relasi terstruktur** — peraturan.go.id menerbitkan blok "Hubungan Antar
     Peraturan" yang eksplisit. Relasi ini disimpan dengan `method='external'`
     dan sengaja TIDAK dicampur dengan hasil ekstraksi teks kita, supaya
     keduanya dapat saling memeriksa (lihat goldset.py).

Relasi berarah-balik dari situs (`Diubah dengan`, `Dicabut dengan`) dibalik
menjadi sisi maju agar arah graf konsisten: "A dicabut dengan B" disimpan
sebagai "B MENCABUT A".
"""
from __future__ import annotations

from .config import PDF_DIR
from .normalize import normalize_nomor
from .sources import bpk as BPK
from .sources import jdih_kemenkeu as JKM
from .sources import peraturan_go_id as PGI

# Urutan percobaan, dari yang paling murah dan paling kaya:
#   1. peraturan.go.id — URL dapat dibentuk langsung (satu permintaan, tanpa
#      pencarian) dan paling lengkap untuk UU/PP/Perpres.
#   2. JDIH Kemenkeu  — API JSON sungguhan, teks lengkap berformat HTM, dan
#      relasi terstruktur; penerbit asli untuk KMK/PMK.
#   3. JDIH BPK       — cadangan untuk KMK/PMK yang tidak ada di JDIH Kemenkeu.
# Jatah waktu satu dokumen untuk seluruh cascade tiga sumber. Dokumen yang
# melampaui ini dilewati; karena tahap ini resumable, ia dapat dicoba lagi
# pada putaran berikutnya tanpa kehilangan apa pun.
BATAS_PER_DOKUMEN = 30

SUMBER = [
    ("peraturan.go.id", PGI),
    ("jdih.kemenkeu.go.id", JKM),
    ("peraturan.bpk.go.id", BPK),
]

# Relasi berarah-balik -> (tipe maju, tukar arah?)
INVERT = {
    "DIUBAH_OLEH": ("MENGUBAH", True),
    "DICABUT_OLEH": ("MENCABUT", True),
    "DICABUT_SEBAGIAN_OLEH": ("MENCABUT_SEBAGIAN", True),
    "MENGUBAH": ("MENGUBAH", False),
    "MENCABUT": ("MENCABUT", False),
    "MENCABUT_SEBAGIAN": ("MENCABUT_SEBAGIAN", False),
    "DASAR_HUKUM": ("DASAR_HUKUM", False),
}


class BatasWaktu(Exception):
    """Satu dokumen melampaui jatah waktunya."""


def _dengan_batas(detik: int, fn, *a, **kw):
    """Jalankan fn dengan batas waktu keras.

    Pengawas ini WAJIB berada di tingkat dokumen, bukan di tiap konektor.
    Setiap pustaka HTTP punya perilaku timeout sendiri dan tak satu pun
    menjamin batas total: curl_cffi pernah menahan 78 detik meski timeout
    disetel 30, dan httpx menghitung timeout per-operasi baca sehingga respons
    yang menetes pelan bisa berjalan tanpa batas. Gejalanya sama dan sulit
    dikenali — proses hidup, CPU nyaris nol, tidak ada berkas baru, tidak ada
    pesan error. Membungkus seluruh cascade sekali di sini menutup semua jalur
    itu sekaligus.
    """
    import signal

    # Windows does not expose SIGALRM.  Each connector still has its own HTTP
    # timeout, so use that portable boundary there instead of failing before a
    # request starts.  Unix keeps the stronger whole-cascade deadline below.
    if not hasattr(signal, "SIGALRM"):
        return fn(*a, **kw)

    def _bel(signum, frame):
        raise BatasWaktu()

    lama = signal.signal(signal.SIGALRM, _bel)
    signal.alarm(detik)
    try:
        return fn(*a, **kw)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, lama)


def _indeks_slug(conn) -> dict:
    """Kunci korpus tanpa awalan jenisnya, untuk memadankan slug sumber luar."""
    import collections
    idx = collections.defaultdict(list)
    for (i,) in conn.execute("SELECT id FROM regulation"):
        if "-" in i:
            idx[i.split("-", 1)[1]].append(i)
    return idx


def enrich_one(conn, fetcher, reg: dict, *, ambil_teks=True,
               sumber=None) -> dict:
    """Coba tiap sumber berurutan sampai dokumennya ketemu."""
    rid = normalize_nomor(reg["nomor_raw"] or "", None, reg["tahun"])
    # Nomor lengkap dipakai untuk BPK (yang memverifikasi '251/KMK.03/2002'
    # secara utuh); komponen angkanya dipakai untuk membentuk slug PGI.
    nomor_penuh = rid.canonical if rid else (reg["nomor_raw"] or "")
    nomor = rid.nomor if rid else (reg["nomor_raw"] or "")

    doc = None
    dicoba = []
    for nama, mod in (sumber or SUMBER):
        # PGI perlu komponen angkanya saja untuk membentuk slug; JDIH Kemenkeu
        # dan BPK mencocokkan nomor lengkap ("251/KMK.03/2002").
        arg = nomor if mod is PGI else reg["nomor_raw"]

        try:
            doc = mod.fetch(fetcher, reg["jenis_code"], arg, reg["tahun"],
                            want_pdf=ambil_teks, pdf_dir=PDF_DIR)
        except Exception as e:                              # noqa: BLE001
            dicoba.append(f"{nama}:error({str(e)[:40]})")
            continue
        dicoba.append(f"{nama}:{'ok' if doc else 'nihil'}")
        if doc is not None:
            break
    if doc is None:
        return {"reg_id": reg["id"], "status": "tidak ditemukan",
                "dicoba": dicoba}

    conn.execute(
        """INSERT INTO external_doc(reg_id,source,url,slug,judul,jenis,tanggal,
                status,ln_nomor,tln_nomor,n_relasi,text_len)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(reg_id,source) DO UPDATE SET
                url=excluded.url, judul=excluded.judul, jenis=excluded.jenis,
                tanggal=excluded.tanggal, status=excluded.status,
                ln_nomor=excluded.ln_nomor, tln_nomor=excluded.tln_nomor,
                n_relasi=excluded.n_relasi, text_len=excluded.text_len,
                fetched_at=datetime('now')""",
        (reg["id"], doc.source, doc.url, doc.slug, doc.judul, doc.jenis,
         doc.tanggal, doc.status, doc.ln_nomor, doc.tln_nomor,
         len(doc.relations), len(doc.text or "")))

    if ambil_teks and doc.text and not reg.get("body_text"):
        conn.execute(
            "UPDATE regulation SET body_text=?, has_body=1, source=?,"
            " tanggal=COALESCE(tanggal,?) WHERE id=?",
            (doc.text, doc.source, doc.tanggal, reg["id"]))

    n_rel = 0
    idx_slug = _indeks_slug(conn)
    for r in doc.relations:
        target = PGI.slug_to_key(r.target_slug or "")
        tipe, balik = INVERT.get(r.type, (r.type, False))
        if tipe not in ("MENGUBAH", "MENCABUT", "MENCABUT_SEBAGIAN", "DASAR_HUKUM"):
            continue
        # `slug_to_key` hanya mengenal bentuk slug peraturan.go.id. JDIH
        # Kemenkeu dan BPK memakai bentuknya sendiri, sehingga sasarannya selalu
        # gagal dikenali dan relasinya tersimpan menggantung — padahal
        # dokumennya ada di korpus. Cadangan di bawah memadankan slug apa adanya
        # dengan kunci korpus tanpa awalan jenisnya, dan hanya bila cocok tepat
        # satu; yang ambigu sengaja dibiarkan menggantung daripada ditebak.
        dst = target.key if target else None
        if dst is None:
            for kandidat in (r.target_slug or "", r.target_text or ""):
                k = (kandidat or "").strip().strip("/").split("/")[-1].lower()
                cocok = idx_slug.get(k, [])
                if len(cocok) == 1:
                    dst = cocok[0]
                    break
        src = reg["id"]
        if balik:
            if not dst:
                continue                      # tak bisa membalik tanpa sasaran
            src, dst = dst, reg["id"]
        conn.execute(
            """INSERT INTO relation(src_id,dst_id,dst_raw,type,evidence,method,
                    confidence,verified)
               VALUES (?,?,?,?,?,'external',0.97,1)
               ON CONFLICT(src_id,dst_raw,type,IFNULL(scope,'')) DO UPDATE SET
                    dst_id=COALESCE(excluded.dst_id,relation.dst_id),
                    method=CASE WHEN relation.method='external' THEN 'external'
                                ELSE relation.method||'+external' END,
                    confidence=MAX(relation.confidence,excluded.confidence)""",
            (src, dst, r.target_text, tipe,
             f"[{doc.source}] {r.label}: {r.target_text}"))
        n_rel += 1

    return {"reg_id": reg["id"], "status": "ok", "slug": doc.slug,
            "sumber": doc.source, "relasi": n_rel, "teks": len(doc.text or "")}


def run(conn, fetcher, *, hanya_tanpa_teks=True, limit=None, ambil_teks=True,
        jenis=None, progress=print) -> dict:
    q = ("SELECT id,nomor_raw,jenis_code,tahun,body_text FROM regulation "
         "WHERE jenis_code IS NOT NULL")
    if hanya_tanpa_teks:
        q += " AND has_body=0"
    if jenis:
        q += f" AND jenis_code='{jenis.upper()}'"
    q += " ORDER BY tahun DESC"
    if limit:
        q += f" LIMIT {int(limit)}"
    rows = [dict(r) for r in conn.execute(q).fetchall()]

    stat = {"dicoba": 0, "ketemu": 0, "diluar_cakupan": 0, "tidak_ada": 0,
            "kehabisan_waktu": 0, "error": 0,
            "relasi": 0, "karakter_teks": 0, "per_sumber": {}}
    for i, reg in enumerate(rows, 1):
        if not dijangkau_sumber(reg["jenis_code"]):
            stat["diluar_cakupan"] += 1
            continue
        stat["dicoba"] += 1
        try:
            res = _dengan_batas(BATAS_PER_DOKUMEN, enrich_one, conn, fetcher,
                                reg, ambil_teks=ambil_teks)
        except BatasWaktu:
            stat["kehabisan_waktu"] = stat.get("kehabisan_waktu", 0) + 1
            res = {"status": "batas waktu"}
        except Exception as e:                              # noqa: BLE001
            stat["error"] = stat.get("error", 0) + 1
            res = {"status": f"error: {str(e)[:60]}"}
        if res["status"] == "ok":
            stat["ketemu"] += 1
            stat["relasi"] += res.get("relasi", 0)
            stat["karakter_teks"] += res.get("teks", 0)
            src = res.get("sumber", "?")
            stat["per_sumber"][src] = stat["per_sumber"].get(src, 0) + 1
        else:
            stat["tidak_ada"] += 1
        if i % 25 == 0:
            conn.commit()
            progress(f"  {i}/{len(rows)} — ketemu {stat['ketemu']}/{stat['dicoba']}"
                     f" (lewat-waktu {stat['kehabisan_waktu']}, error {stat['error']})")
    conn.commit()
    return stat


def dijangkau_sumber(jenis_code: str | None) -> str | None:
    """Sumber pertama yang secara prinsip memuat jenis dokumen ini."""
    jc = (jenis_code or "").upper()
    if jc in PGI.SLUG_PREFIX:
        return "peraturan.go.id"
    if jc in JKM.JENIS_DIDUKUNG:
        return "jdih.kemenkeu.go.id"
    if jc in BPK.JENIS_ID:
        return "peraturan.bpk.go.id"
    return None


def coverage(conn) -> list[dict]:
    """Berapa banyak dokumen tanpa teks yang bisa dijangkau tiap sumber."""
    rows = conn.execute(
        """SELECT jenis_code, COUNT(*) n,
                  SUM(CASE WHEN has_body=0 THEN 1 ELSE 0 END) tanpa_teks
             FROM regulation WHERE jenis_code IS NOT NULL
            GROUP BY jenis_code ORDER BY tanpa_teks DESC""").fetchall()
    out = []
    for r in rows:
        jc = (r["jenis_code"] or "").upper()
        out.append({
            "jenis": jc,
            "total": r["n"],
            "tanpa_teks": r["tanpa_teks"],
            "pgi": "ya" if jc in PGI.SLUG_PREFIX else "-",
            "jkm": "ya" if jc in JKM.JENIS_DIDUKUNG else "-",
            "bpk": "ya" if jc in BPK.JENIS_ID else "-",
            "terjangkau": dijangkau_sumber(jc) or "TIDAK ADA SUMBER",
        })
    return out


def measure_coverage(conn, fetcher, per_jenis=6, seed=11, progress=print) -> dict:
    """Uji ketersediaan nyata: ambil sampel, lalu benar-benar coba tiap sumber.

    Tabel `coverage()` hanya menyatakan jenis dokumen apa yang *secara prinsip*
    dimuat sebuah situs. Itu belum menjawab "apakah dokumen ini ada di sana".
    Fungsi ini menjawabnya secara empiris: untuk sampel berstrata per jenis
    dokumen, setiap sumber benar-benar dihubungi dan hasilnya dicatat —
    termasuk ketersediaan teksnya, bukan sekadar ada/tidak halamannya.
    """
    import random
    rnd = random.Random(seed)
    jenis_list = [r["jenis_code"] for r in conn.execute(
        "SELECT jenis_code, COUNT(*) n FROM regulation WHERE jenis_code IS NOT NULL"
        " GROUP BY jenis_code ORDER BY n DESC").fetchall()]

    hasil = {}
    for jc in jenis_list:
        rows = [dict(r) for r in conn.execute(
            "SELECT id,nomor_raw,jenis_code,tahun,canonical FROM regulation"
            " WHERE jenis_code=? AND tahun IS NOT NULL", (jc,)).fetchall()]
        if not rows:
            continue
        rnd.shuffle(rows)
        sampel = rows[:per_jenis]
        catatan = {"n": len(sampel), "pgi": 0, "jkm": 0, "bpk": 0, "ada_teks": 0,
                   "relasi": 0, "contoh_gagal": []}
        for reg in sampel:
            rid = normalize_nomor(reg["nomor_raw"] or "", None, reg["tahun"])
            nomor = rid.nomor if rid else (reg["nomor_raw"] or "")
            ketemu = False
            for nama, mod in SUMBER:
                # PGI perlu komponen angkanya saja untuk membentuk slug; JDIH Kemenkeu
                # dan BPK mencocokkan nomor lengkap.
                arg = nomor if mod is PGI else reg["nomor_raw"]
                try:
                    doc = mod.fetch(fetcher, jc, arg, reg["tahun"],
                                    want_pdf=False, pdf_dir=None)
                except Exception:                           # noqa: BLE001
                    doc = None
                if doc is None:
                    continue
                ketemu = True
                kunci = {PGI: "pgi", JKM: "jkm", BPK: "bpk"}.get(mod, "lain")
                catatan[kunci] = catatan.get(kunci, 0) + 1
                catatan["relasi"] += len(doc.relations)
                if doc.pdf_urls:
                    catatan["ada_teks"] += 1
                break
            if not ketemu and len(catatan["contoh_gagal"]) < 3:
                catatan["contoh_gagal"].append(reg["canonical"])
        catatan["ketemu"] = catatan["pgi"] + catatan["jkm"] + catatan["bpk"]
        hasil[jc] = catatan
        progress(f"  {jc:10s} {catatan['ketemu']}/{catatan['n']} ketemu "
                 f"(pgi={catatan['pgi']} jkm={catatan['jkm']} bpk={catatan['bpk']})")
    return hasil
