"""Gold set dan pengukuran akurasi ekstraksi relasi.

Dua tingkat, dan perbedaannya penting untuk tidak dilebih-lebihkan:

**silver** — rujukan silang otomatis dari peraturan.go.id. Independen dari
ekstraksi teks kita (situs itu menerbitkan relasi terstruktur, kita membaca
kalimat di DJP), tetapi TIDAK diverifikasi manusia. Situs pemerintah pun bisa
tidak lengkap atau keliru, jadi ini alat ukur kasar berskala besar — bukan
kebenaran.

**gold** — dilabeli manusia terhadap kalimat bukti. Hanya ini yang boleh
disebut kebenaran dan dipakai untuk mengklaim akurasi.

Alur yang disarankan:
  1. `build_silver()`  — gratis, langsung memberi gambaran precision/recall.
  2. `sample_for_review()` — ekspor CSV berstrata untuk dilabeli manusia.
     Sampel sengaja tidak acak murni: kasus sulit (kepercayaan rendah,
     pencabutan sebagian, kandidat-pengubah) diberi porsi lebih besar, karena
     di situlah kesalahan berada.
  3. `import_labels()` + `evaluate()` — metrik nyata per jenis relasi.
"""
from __future__ import annotations

import csv
import random
from collections import defaultdict

TIPE_INTI = ("MENCABUT", "MENCABUT_SEBAGIAN", "MENGUBAH")


# --- 1. Silver: rujukan silang otomatis ------------------------------------
def build_silver(conn, progress=print) -> dict:
    """Jadikan relasi terstruktur dari sumber eksternal sebagai acuan banding.

    Hanya dokumen yang ADA di kedua sumber yang dipakai; kalau tidak, "tidak
    ditemukan" akan tercampur antara "relasi memang tidak ada" dan "dokumennya
    memang tidak ada di sana", dan recall menjadi tidak bermakna.
    """
    beririsan = {r["reg_id"] for r in conn.execute(
        "SELECT DISTINCT reg_id FROM external_doc").fetchall()}
    if not beririsan:
        progress("  belum ada dokumen eksternal — jalankan 'sources fetch' dulu")
        return {"dokumen_beririsan": 0}

    n = 0
    for row in conn.execute(
        """SELECT src_id,dst_id,dst_raw,type,evidence FROM relation
            WHERE method LIKE '%external%' AND type IN
                  ('MENCABUT','MENCABUT_SEBAGIAN','MENGUBAH')""").fetchall():
        if row["src_id"] not in beririsan and row["dst_id"] not in beririsan:
            continue
        conn.execute(
            """INSERT INTO goldset(tier,src_id,dst_id,dst_raw,type,label,sumber,evidence)
               VALUES ('silver',?,?,?,?,1,'peraturan.go.id',?)
               ON CONFLICT(tier,src_id,IFNULL(dst_id,dst_raw),type) DO NOTHING""",
            (row["src_id"], row["dst_id"], row["dst_raw"], row["type"],
             row["evidence"]))
        n += 1
    conn.commit()
    progress(f"  {n} relasi silver dari {len(beririsan)} dokumen beririsan")
    return {"silver": n, "dokumen_beririsan": len(beririsan)}


# --- 2. Sampel untuk pelabelan manusia --------------------------------------
STRATA = [
    ("pencabutan_sebagian", "type='MENCABUT_SEBAGIAN'", 0.15),
    ("kandidat_pengubah", "conflict LIKE '%kandidat-pengubah%' "
                          "OR evidence LIKE '%sebagaimana telah diubah%'", 0.20),
    ("kepercayaan_rendah", "confidence < 0.80", 0.25),
    ("belum_terpaut", "dst_id IS NULL", 0.15),
    ("kepercayaan_tinggi", "confidence >= 0.92", 0.25),
]


def sample_for_review(conn, path, n=250, seed=7, progress=print) -> dict:
    """Ekspor CSV berstrata untuk dilabeli manusia.

    Sampel acak murni akan didominasi kasus mudah dan memberi kesan akurasi
    yang terlalu bagus. Strata di bawah memusatkan tenaga pelabelan pada
    tempat kesalahan sebenarnya berada.
    """
    rnd = random.Random(seed)
    dipilih: dict[int, dict] = {}
    ringkas = {}
    for nama, cond, porsi in STRATA:
        target = max(int(n * porsi), 1)
        rows = conn.execute(
            f"""SELECT r.id,r.src_id,r.dst_id,r.dst_raw,r.type,r.scope,
                       r.confidence,r.method,r.evidence,r.conflict,
                       s.canonical src_can, s.judul src_judul,
                       d.canonical dst_can
                  FROM relation r
                  LEFT JOIN regulation s ON s.id=r.src_id
                  LEFT JOIN regulation d ON d.id=r.dst_id
                 WHERE r.type IN ('MENCABUT','MENCABUT_SEBAGIAN','MENGUBAH')
                   AND r.method NOT LIKE '%external%' AND ({cond})""").fetchall()
        rows = [dict(r) for r in rows if r["id"] not in dipilih]
        rnd.shuffle(rows)
        for r in rows[:target]:
            r["strata"] = nama
            dipilih[r["id"]] = r
        ringkas[nama] = min(len(rows), target)

    kolom = ["relation_id", "strata", "sumber_peraturan", "judul_sumber",
             "sasaran", "jenis_relasi", "lingkup", "kepercayaan", "metode",
             "kalimat_bukti", "catatan_parser", "LABEL(1=benar,0=salah)",
             "JENIS_SEHARUSNYA", "CATATAN_PELABEL"]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(kolom)
        for r in dipilih.values():
            w.writerow([
                r["id"], r["strata"], r["src_can"] or r["src_id"],
                (r["src_judul"] or "")[:110],
                r["dst_can"] or r["dst_raw"], r["type"], r["scope"] or "",
                f'{r["confidence"]:.2f}', r["method"],
                (r["evidence"] or "").replace("\n", " ")[:700],
                (r["conflict"] or "")[:120], "", "", "",
            ])
    progress(f"  {len(dipilih)} baris → {path}")
    progress(f"  komposisi strata: {ringkas}")
    return {"total": len(dipilih), "strata": ringkas, "path": str(path)}


def import_labels(conn, path, progress=print) -> dict:
    """Muat CSV yang sudah dilabeli manusia menjadi gold set."""
    n = kosong = 0
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            lab = (row.get("LABEL(1=benar,0=salah)") or "").strip()
            if lab not in ("0", "1"):
                kosong += 1
                continue
            rel = conn.execute("SELECT * FROM relation WHERE id=?",
                               (int(row["relation_id"]),)).fetchone()
            if not rel:
                continue
            tipe = (row.get("JENIS_SEHARUSNYA") or "").strip() or rel["type"]
            conn.execute(
                """INSERT INTO goldset(tier,src_id,dst_id,dst_raw,type,scope,
                        label,sumber,evidence,catatan)
                   VALUES ('gold',?,?,?,?,?,?,'manusia',?,?)
                   ON CONFLICT(tier,src_id,IFNULL(dst_id,dst_raw),type)
                   DO UPDATE SET label=excluded.label, catatan=excluded.catatan""",
                (rel["src_id"], rel["dst_id"], rel["dst_raw"], tipe, rel["scope"],
                 int(lab), rel["evidence"],
                 (row.get("CATATAN_PELABEL") or "")[:300]))
            n += 1
    conn.commit()
    progress(f"  {n} label dimuat, {kosong} baris belum dilabeli")
    return {"dimuat": n, "belum": kosong}


# --- 3. Evaluasi ------------------------------------------------------------
def _key(src, dst, dst_raw, tipe):
    return (src, dst or (dst_raw or "").upper(), tipe)


def evaluate(conn, tier="silver", min_conf=0.75) -> dict:
    """Bandingkan ekstraksi berbasis teks kita dengan gold/silver set.

    Untuk tier 'silver', recall dihitung HANYA pada dokumen yang ada di kedua
    sumber; di luar itu ketidakhadiran relasi tidak dapat ditafsirkan.
    """
    gold = conn.execute(
        "SELECT src_id,dst_id,dst_raw,type,label FROM goldset WHERE tier=?",
        (tier,)).fetchall()
    if not gold:
        return {"error": f"gold set tier '{tier}' kosong"}

    positif = {_key(g["src_id"], g["dst_id"], g["dst_raw"], g["type"])
               for g in gold if g["label"] == 1}
    negatif = {_key(g["src_id"], g["dst_id"], g["dst_raw"], g["type"])
               for g in gold if g["label"] == 0}

    # Recall hanya bermakna bila KEDUA ujung relasi ada di korpus kita dan
    # dokumen sumbernya punya badan teks — kalau tidak, "terlewat" bercampur
    # antara "pola kita gagal" dan "dokumennya memang belum di-crawl".
    dapat_dinilai = {
        _key(r["src_id"], r["dst_id"], r["dst_raw"], r["type"])
        for r in conn.execute(
            """SELECT g.src_id,g.dst_id,g.dst_raw,g.type FROM goldset g
                 JOIN regulation s ON s.id=g.src_id
                 JOIN regulation d ON d.id=g.dst_id
                WHERE g.tier=? AND g.label=1 AND s.has_body=1""", (tier,)).fetchall()}

    lingkup_src = {g["src_id"] for g in gold}
    milik_kita = set()
    per_tipe_kita = defaultdict(set)
    for r in conn.execute(
        """SELECT src_id,dst_id,dst_raw,type FROM relation
            WHERE method NOT LIKE '%external%' AND confidence>=?
              AND type IN ('MENCABUT','MENCABUT_SEBAGIAN','MENGUBAH')""",
            (min_conf,)).fetchall():
        if r["src_id"] not in lingkup_src:
            continue
        k = _key(r["src_id"], r["dst_id"], r["dst_raw"], r["type"])
        milik_kita.add(k)
        per_tipe_kita[r["type"]].add(k)

    tp = len(milik_kita & positif)
    fp_diketahui = len(milik_kita & negatif)
    fn = len(positif - milik_kita)
    fp_dugaan = len(milik_kita - positif - negatif)

    def _bagi(a, b):
        return round(a / b, 3) if b else None

    pos_dinilai = positif & dapat_dinilai
    tp_dinilai = len(milik_kita & pos_dinilai)

    hasil = {
        "tier": tier,
        "acuan_positif": len(positif),
        "dapat_dinilai (kedua ujung ada di korpus)": len(pos_dinilai),
        "recall_pada_lingkup_dapat_dinilai": _bagi(tp_dinilai, len(pos_dinilai)),
        "acuan_negatif": len(negatif),
        "ekstraksi_kita_dalam_lingkup": len(milik_kita),
        "benar (TP)": tp,
        "salah_terkonfirmasi (FP)": fp_diketahui,
        "terlewat (FN)": fn,
        "tidak_ada_di_acuan": fp_dugaan,
        "recall_kasar_semua_acuan": _bagi(tp, len(positif)),
        "precision_terhadap_label": _bagi(tp, tp + fp_diketahui),
    }
    hasil["catatan_metode"] = (
        "Pakai 'recall_pada_lingkup_dapat_dinilai'. Angka kasar ikut menghitung "
        "relasi yang sasarannya belum di-crawl, sehingga terlalu pesimistis.")
    if tier == "silver":
        hasil["catatan"] = (
            "'tidak_ada_di_acuan' BUKAN otomatis salah: peraturan.go.id tidak "
            "mencatat relasi tingkat Dirjen dan tidak selalu lengkap. "
            "Precision sebenarnya hanya bisa diukur dengan tier 'gold'.")
    hasil["per_tipe"] = {t: len(v) for t, v in sorted(per_tipe_kita.items())}
    return hasil


def disagreements(conn, limit=40) -> list[dict]:
    """Kasus paling informatif: acuan bilang ada, kita tidak menemukannya."""
    rows = conn.execute(
        """SELECT g.src_id, g.dst_id, g.type, g.evidence,
                  s.canonical src_can, d.canonical dst_can, s.has_body
             FROM goldset g
             LEFT JOIN regulation s ON s.id=g.src_id
             LEFT JOIN regulation d ON d.id=g.dst_id
            WHERE g.label=1 AND NOT EXISTS (
                  SELECT 1 FROM relation r
                   WHERE r.src_id=g.src_id AND r.type=g.type
                     AND (r.dst_id=g.dst_id OR UPPER(r.dst_raw)=UPPER(g.dst_raw))
                     AND r.method NOT LIKE '%external%')
            LIMIT ?""", (limit,)).fetchall()
    return [dict(r) for r in rows]
