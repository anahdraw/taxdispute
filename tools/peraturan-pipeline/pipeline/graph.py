"""Knowledge graph + masa berlaku (point-in-time).

Yang membuat graf ini akurat bukan jumlah relasinya, melainkan tiga disiplin:

1. **Verifikasi dua arah.** Setiap klaim pencabutan diuji dari dua sisi:
   (a) teks peraturan pencabut, (b) label status resmi DJP pada peraturan
   yang dicabut. Bila keduanya sejalan, kepercayaan naik. Bila bertentangan,
   relasi ditandai konflik dan masuk antrean tinjauan — tidak pernah
   diam-diam dipilih salah satu.

2. **Waktu, bukan sekadar label.** "Aktif" adalah status hari ini. Untuk
   sengketa pajak yang menyangkut Tahun Pajak 2019, yang dibutuhkan adalah
   status pada 2019. Karena itu setiap dokumen menyimpan valid_from/valid_to,
   dan seluruh pencarian dapat difilter "sebagaimana berlaku pada tanggal X".

3. **Versi konsolidasi.** UU 6/1983 s.t.d.t.d. UU 6/2023 bukan enam dokumen
   terpisah, melainkan satu rantai. Graf menyimpan rantai itu agar jawaban
   selalu menunjuk versi terkini yang relevan.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date

from .structure import parse_body, tanggal_mulai_berlaku

STATUS_SITUS_DICABUT = ("dicabut",)
STATUS_SITUS_DIUBAH = ("diubah", "disempurnakan")


# Hierarki peraturan perundang-undangan (UU 12/2011 Pasal 7) — angka lebih
# kecil berarti lebih tinggi. Dipakai sebagai penyaring akal sehat.
HIERARKI = {
    "UUD": 0, "UU": 1, "PERPU": 1, "PP": 2, "PERPRES": 3, "KEPPRES": 3,
    "INPRES": 3, "PERDA": 4,
    "PMK": 5, "KMK": 5, "IMK": 5, "PERMENDAG": 5, "PERMENPERIN": 5,
    "PERMENDAGRI": 5, "PERMENKUMHAM": 5,
    "PER": 6, "KEP": 6, "SE": 7, "INS": 7, "PENG": 7, "ND": 7,
}


def langgar_hierarki(src_jenis: str | None, dst_jenis: str | None,
                     tipe: str) -> bool:
    """True bila relasi melanggar hierarki perundang-undangan.

    Peraturan yang lebih rendah tidak dapat mencabut atau mengubah yang lebih
    tinggi. Penyaring ini menangkap kesalahan dari sumber mana pun — termasuk
    dari data terstruktur pemerintah: peraturan.go.id mencatat
    "PP 50/2022 Mencabut UU 6/1983", yang secara hukum mustahil.
    """
    if tipe not in ("MENCABUT", "MENCABUT_SEBAGIAN", "MENGUBAH"):
        return False
    a, b = HIERARKI.get((src_jenis or "").upper()), HIERARKI.get((dst_jenis or "").upper())
    if a is None or b is None:
        return False
    return a > b


def _norm_status(s: str | None) -> str:
    s = (s or "").lower()
    if "dicabut sebagian" in s:
        return "dicabut_sebagian"
    if "dicabut" in s:
        return "dicabut"
    if "diubah" in s or "disempurnakan" in s:
        return "diubah"
    if "aktif" in s:
        return "berlaku"
    return "tidak_diketahui"


def compute_validity(conn, min_conf=0.75, progress=print) -> dict:
    """Hitung valid_from / valid_to / status untuk setiap peraturan."""
    regs = {r["id"]: dict(r) for r in conn.execute(
        "SELECT id,tanggal,status_site,body_text,judul,jenis_code FROM regulation").fetchall()}

    # valid_from: dari klausul penutup bila ada, kalau tidak tanggal penetapan.
    mulai: dict[str, tuple[str | None, str]] = {}
    for rid, r in regs.items():
        if r["body_text"]:
            units = parse_body(r["body_text"])
            mulai[rid] = tanggal_mulai_berlaku(units, r["tanggal"])
        else:
            mulai[rid] = (r["tanggal"], "tanpa badan teks: memakai tanggal penetapan")

    # Kumpulkan aksi terhadap tiap sasaran.
    aksi: dict[str, list[dict]] = defaultdict(list)
    n_langgar = 0
    for row in conn.execute(
        """SELECT id,src_id,dst_id,type,scope,confidence FROM relation
            WHERE dst_id IS NOT NULL AND confidence>=?
              AND type IN ('MENCABUT','MENCABUT_SEBAGIAN','MENGUBAH')""",
            (min_conf,)).fetchall():
        sj = (regs.get(row["src_id"]) or {}).get("jenis_code")
        dj = (regs.get(row["dst_id"]) or {}).get("jenis_code")
        if langgar_hierarki(sj, dj, row["type"]):
            # Jangan pakai relasi ini untuk menghitung masa berlaku; tandai
            # agar muncul di antrean tinjauan berikut alasannya.
            conn.execute(
                "UPDATE relation SET conflict=? WHERE id=?",
                (f"melanggar hierarki: {sj} tidak dapat {row['type']} {dj}",
                 row["id"]))
            n_langgar += 1
            continue
        aksi[row["dst_id"]].append(dict(row))

    stats = {"total": 0, "konflik": 0, "langgar_hierarki": n_langgar,
             "dicabut": 0, "berlaku": 0,
             "diubah": 0, "dicabut_sebagian": 0, "tidak_diketahui": 0}

    for rid, r in regs.items():
        vf = mulai[rid][0]
        alasan = [mulai[rid][1]]
        vt = None
        status = "berlaku"
        superseded = None

        pencabut = [a for a in aksi.get(rid, []) if a["type"] == "MENCABUT"]
        sebagian = [a for a in aksi.get(rid, []) if a["type"] == "MENCABUT_SEBAGIAN"]
        pengubah = [a for a in aksi.get(rid, []) if a["type"] == "MENGUBAH"]

        if pencabut:
            # Pencabutan paling awal yang menentukan akhir masa berlaku.
            kandidat = [(mulai.get(a["src_id"], (None, ""))[0], a) for a in pencabut]
            kandidat = [(d, a) for d, a in kandidat if d] or kandidat
            kandidat.sort(key=lambda x: (x[0] or "9999-99-99"))
            vt, pilih = kandidat[0]
            status = "dicabut"
            superseded = pilih["src_id"]
            alasan.append(f"dicabut oleh {superseded}"
                          + (f" berlaku {vt}" if vt else ""))
        elif sebagian:
            status = "dicabut_sebagian"
            alasan.append("dicabut sebagian oleh " +
                          ", ".join(sorted({a['src_id'] for a in sebagian})))
        elif pengubah:
            status = "diubah"
            superseded = sorted(
                pengubah, key=lambda a: mulai.get(a["src_id"], ("", ""))[0] or "")[-1]["src_id"]
            alasan.append("diubah oleh " +
                          ", ".join(sorted({a['src_id'] for a in pengubah})))

        situs = _norm_status(r["status_site"])
        setuju = None
        if situs != "tidak_diketahui":
            if situs == status:
                setuju = 1
            elif situs == "diubah" and status == "berlaku" and not aksi.get(rid):
                # Situs tahu ada perubahan yang belum kita temukan di teks.
                setuju = 0
                alasan.append("KONFLIK: situs menyatakan diubah, "
                              "graf belum menemukan peraturan pengubah")
            elif situs == "dicabut" and status != "dicabut":
                setuju = 0
                alasan.append("KONFLIK: situs menyatakan dicabut, "
                              "pencabutnya belum teridentifikasi di teks")
            elif status == "dicabut" and situs not in ("dicabut", "dicabut_sebagian"):
                setuju = 0
                alasan.append(f"KONFLIK: graf menyatakan dicabut, situs '{r['status_site']}'")
            else:
                setuju = 0
                alasan.append(f"beda derajat: situs='{situs}' graf='{status}'")
        if setuju == 0:
            stats["konflik"] += 1

        conn.execute(
            """INSERT INTO validity(reg_id,valid_from,valid_to,status_derived,
                    superseded_by,agrees_with_site,reason)
               VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(reg_id) DO UPDATE SET
                    valid_from=excluded.valid_from, valid_to=excluded.valid_to,
                    status_derived=excluded.status_derived,
                    superseded_by=excluded.superseded_by,
                    agrees_with_site=excluded.agrees_with_site,
                    reason=excluded.reason""",
            (rid, vf, vt, status, superseded, setuju, " | ".join(alasan)))
        stats["total"] += 1
        stats[status] = stats.get(status, 0) + 1

    conn.commit()
    progress(json.dumps(stats, ensure_ascii=False))
    return stats


def status_pada(conn, reg_id: str, tanggal: str) -> dict:
    """Status sebuah peraturan pada tanggal tertentu (point-in-time)."""
    v = conn.execute("SELECT * FROM validity WHERE reg_id=?", (reg_id,)).fetchone()
    if not v:
        return {"reg_id": reg_id, "status": "tidak_diketahui"}
    vf, vt = v["valid_from"], v["valid_to"]
    if vf and tanggal < vf:
        st = "belum_berlaku"
    elif vt and tanggal >= vt:
        st = "sudah_dicabut"
    else:
        st = v["status_derived"]
    return {"reg_id": reg_id, "status": st, "valid_from": vf, "valid_to": vt,
            "superseded_by": v["superseded_by"], "alasan": v["reason"]}


def rantai_konsolidasi(conn, reg_id: str, max_depth=12) -> list[dict]:
    """Telusuri rantai amandemen: induk -> pengubah 1 -> pengubah 2 -> ...."""
    chain, seen, cur = [], set(), reg_id
    for _ in range(max_depth):
        r = conn.execute(
            "SELECT r.id,r.canonical,r.judul,r.tanggal,v.status_derived "
            "FROM regulation r LEFT JOIN validity v ON v.reg_id=r.id WHERE r.id=?",
            (cur,)).fetchone()
        if not r:
            break
        chain.append(dict(r))
        seen.add(cur)
        nxt = conn.execute(
            """SELECT src_id FROM relation
                WHERE dst_id=? AND type IN ('MENGUBAH','MENCABUT')
                  AND confidence>=0.75 ORDER BY confidence DESC LIMIT 1""",
            (cur,)).fetchone()
        if not nxt or nxt["src_id"] in seen:
            break
        cur = nxt["src_id"]
    return chain


def versi_terkini(conn, reg_id: str) -> str:
    """Peraturan efektif terkini untuk sebuah rujukan lama."""
    chain = rantai_konsolidasi(conn, reg_id)
    return chain[-1]["id"] if chain else reg_id


def antrean_tinjauan(conn, limit=200) -> list[dict]:
    """Daftar prioritas untuk tinjauan manusia — inilah cara akurasi dijaga."""
    rows = conn.execute(
        """SELECT v.reg_id, r.canonical, r.judul, r.status_site,
                  v.status_derived, v.reason
             FROM validity v JOIN regulation r ON r.id=v.reg_id
            WHERE v.agrees_with_site=0
            ORDER BY (r.tahun IS NULL), r.tahun DESC LIMIT ?""", (limit,)).fetchall()
    return [dict(r) for r in rows]


def relasi_belum_terpaut(conn, limit=200) -> list[dict]:
    rows = conn.execute(
        """SELECT src_id,dst_raw,type,confidence,substr(evidence,1,180) bukti
             FROM relation WHERE dst_id IS NULL AND type<>'DASAR_HUKUM'
            ORDER BY confidence DESC LIMIT ?""", (limit,)).fetchall()
    return [dict(r) for r in rows]


def export_graph(conn, path, min_conf=0.75) -> dict:
    """Ekspor node+edge (JSON) untuk divisualisasikan atau dimuat ke Neo4j."""
    nodes = [dict(r) for r in conn.execute(
        """SELECT r.id,r.canonical,r.jenis_code,r.kategori,r.tahun,r.judul,
                  v.status_derived,v.valid_from,v.valid_to
             FROM regulation r LEFT JOIN validity v ON v.reg_id=r.id""").fetchall()]
    edges = [dict(r) for r in conn.execute(
        """SELECT src_id,dst_id,type,scope,confidence,method,
                  substr(evidence,1,300) evidence
             FROM relation WHERE dst_id IS NOT NULL AND confidence>=?""",
        (min_conf,)).fetchall()]
    payload = {"generated_at": date.today().isoformat(),
               "nodes": nodes, "edges": edges}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    return {"nodes": len(nodes), "edges": len(edges), "path": str(path)}
