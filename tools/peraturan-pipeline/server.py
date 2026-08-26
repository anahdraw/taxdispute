#!/usr/bin/env python3
"""Server lokal untuk menelusuri, membaca, dan memeriksa korpus peraturan.

Memakai `http.server` dari pustaka baku — tanpa kerangka kerja tambahan. Ini
alat lokal atas basis data yang juga lokal; menambah dependensi hanya akan
menambah hal yang bisa rusak, tanpa memberi apa pun yang belum ada.

Tidak ada pemanggilan LLM di sini. Jawaban dirakit dari kutipan pasal yang
sebenarnya ada di basis data, bukan dikarang: setiap potongan yang tampil
membawa sitasi dan status hukumnya. Bila jawabannya tidak ada di korpus,
yang benar adalah mengatakannya, bukan menambalnya dengan kalimat yang
terdengar meyakinkan.

Jalankan:
    ./.venv/bin/python server.py            # http://127.0.0.1:8765
    ./.venv/bin/python server.py --port 9000
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import traceback
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

AKAR = Path(__file__).resolve().parent
sys.path.insert(0, str(AKAR))

from pipeline import berkala as mod_berkala      # noqa: E402
from pipeline import graf_view as mod_graf       # noqa: E402
from pipeline import tanya as mod_tanya         # noqa: E402
from pipeline import hierarki as mod_hier        # noqa: E402
from pipeline import pasal as mod_pasal          # noqa: E402
from pipeline import qc as mod_qc                # noqa: E402
from pipeline import tinjau as mod_tinjau        # noqa: E402
from pipeline import verifikasi as mod_verif     # noqa: E402
from pipeline.config import DATA, DB_PATH        # noqa: E402

WEB = AKAR / "web"


def koneksi(tulis: bool = False) -> sqlite3.Connection:
    """Koneksi baru per permintaan.

    SQLite tidak aman dipakai lintas utas dengan satu koneksi bersama, dan
    membuka koneksi baru pada berkas lokal murah.

    Bacaan memakai mode baca-saja sehingga tidak mungkin mengubah korpus —
    pemeriksaan mutu harus membaca keadaan apa adanya. Hanya titik akhir
    keputusan yang membuka koneksi yang dapat menulis, dan setiap tulisan di
    sana melewati `tinjau` yang mencatat nilai lamanya.
    """
    conn = sqlite3.connect(str(DB_PATH) if tulis
                           else f"file:{DB_PATH}?mode=ro", uri=not tulis)
    conn.row_factory = sqlite3.Row
    return conn


# --- titik akhir -----------------------------------------------------------
def api_ringkas(_):
    with koneksi() as conn:
        return mod_qc.ringkas(conn)


def api_cari(p):
    q = (p.get("q") or [""])[0].strip()
    if not q:
        return {"hasil": [], "catatan": "pertanyaan kosong"}
    kw = {}
    if p.get("jenis", [""])[0]:
        kw["jenis"] = p["jenis"][0]
    if p.get("kategori", [""])[0]:
        kw["kategori"] = p["kategori"][0]
    if p.get("as_of", [""])[0]:
        kw["as_of"] = p["as_of"][0]
    if (p.get("dicabut", ["0"])[0]) == "1":
        kw["sertakan_dicabut"] = True
    limit = int((p.get("limit") or ["15"])[0])
    with koneksi() as conn:
        hasil = mod_pasal.cari_pasal(conn, q, limit=limit, **kw)
    catatan = None
    if not hasil:
        catatan = ("Tidak ada pasal yang cocok di korpus. Ini jawaban yang "
                   "sebenarnya, bukan kegagalan — bisa jadi peraturannya "
                   "termasuk yang naskahnya belum tersedia.")
    elif hasil and hasil[0]["cakupan"] < 0.6:
        catatan = ("Tidak ada pasal yang memuat seluruh istilah pertanyaan. "
                   "Hasil di bawah hanya cocok sebagian — periksa sendiri "
                   "sebelum dipakai.")
    return {"hasil": hasil, "catatan": catatan, "pertanyaan": q}


def api_pasal(p):
    reg_id = (p.get("reg_id") or [""])[0]
    nomor = (p.get("pasal") or [""])[0]
    as_of = (p.get("as_of") or [None])[0]
    with koneksi() as conn:
        d = mod_pasal.ambil_pasal(conn, reg_id, nomor, as_of=as_of)
        if d:
            d["relasi"] = [dict(r) for r in conn.execute(
                """SELECT rel.type, rel.scope, rel.dst_raw, rel.confidence,
                          rel.conflict, d.canonical dst_canonical, d.id dst_id
                     FROM relation rel
                     LEFT JOIN regulation d ON d.id=rel.dst_id
                    WHERE rel.src_id=? ORDER BY rel.type LIMIT 60""",
                (reg_id,)).fetchall()]
        return d


def api_daftar_pasal(p):
    with koneksi() as conn:
        reg_id = (p.get("reg_id") or [""])[0]
        reg = conn.execute(
            "SELECT id,canonical,judul,jenis,jenis_code,tahun,tanggal,"
            "status_site,url,source FROM regulation WHERE id=?",
            (reg_id,)).fetchone()
        return {"peraturan": dict(reg) if reg else None,
                "pasal": mod_pasal.daftar_pasal(conn, reg_id)}


def api_tanya(p):
    """Satu putaran percakapan: pertanyaan → pasal nyata beserta tafsirnya."""
    q = (p.get("q") or [""])[0].strip()
    if not q:
        return {"hasil": [], "jumlah": 0, "tafsir": [],
                "cara_kerja": "pertanyaan kosong"}
    tambahan = {}
    # Penyaring yang dipilih pengguna dari percakapan sebelumnya menang atas
    # yang dibaca dari kalimatnya — yang eksplisit mengalahkan yang ditafsirkan.
    for k, kunci in (("jenis", "jenis"), ("daerah", "kategori")):
        if (p.get(k) or [""])[0]:
            tambahan[kunci] = p[k][0]
    if (p.get("tahun") or [""])[0].isdigit():
        tambahan["tahun"] = int(p["tahun"][0])
    if (p.get("dicabut") or [""])[0] == "1":
        tambahan["sertakan_dicabut"] = True
    limit = min(int((p.get("limit") or ["8"])[0]), 30)
    with koneksi() as conn:
        return mod_tanya.jawab(conn, q, limit=limit, saring_tambahan=tambahan)


def api_naskah(p):
    """Seluruh naskah satu peraturan, berurut, setiap unit dengan kutipannya.

    Dipisah dari `/api/pasal` (satu pasal) dan `/api/daftar-pasal` (judul saja)
    karena menjawab pertanyaan yang berbeda — dan yang paling sering diajukan
    lebih dahulu: apa isi peraturannya.
    """
    with koneksi() as conn:
        return mod_pasal.naskah_penuh(conn, (p.get("reg_id") or [""])[0])


# Relasi dipisah menjadi dua panel, karena keduanya menjawab pertanyaan yang
# berbeda. "Riwayat" adalah nasib peraturan ini: apa yang mencabut dan mengubahnya,
# dan apa yang ia cabut. "Peraturan terkait" adalah tempatnya berdiri: dasar
# hukumnya dan apa yang melaksanakannya. Menyatukan keduanya membuat pembaca
# harus memilah sendiri mana yang mengubah keberlakuan dan mana yang tidak.
RIWAYAT = ("MENCABUT", "MENCABUT_SEBAGIAN", "MENGUBAH",
           "KONSOLIDASI_DARI", "MENCAKUP_PERUBAHAN")


def api_konteks(p):
    """Riwayat dan peraturan terkait untuk satu peraturan."""
    reg_id = (p.get("reg_id") or [""])[0]
    with koneksi() as conn:
        d = mod_graf.sekitar(conn, reg_id, batas_per_jenis=12)
    if not d:
        return {"pusat": None, "riwayat": [], "terkait": []}
    riwayat, terkait = [], []
    for arah, kel in (("keluar", d["keluar"]), ("masuk", d["masuk"])):
        for g in kel:
            g = {**g, "arah": arah}
            (riwayat if g["tipe"] in RIWAYAT else terkait).append(g)
    return {"pusat": d["pusat"], "riwayat": riwayat, "terkait": terkait,
            "batas": d.get("batas")}


def api_peraturan(p):
    """Daftar peraturan dengan penyaring — untuk 'aturan mana saja yang ada'."""
    where, arg = ["1=1"], []
    if (p.get("q") or [""])[0].strip():
        where.append("(canonical LIKE ? OR judul LIKE ?)")
        arg += [f"%{p['q'][0]}%"] * 2
    if (p.get("jenis") or [""])[0]:
        where.append("jenis_code=?"); arg.append(p["jenis"][0])
    if (p.get("tahun") or [""])[0]:
        where.append("tahun=?"); arg.append(int(p["tahun"][0]))
    # Daerah. Untuk peraturan daerah, ini bukan penyaring tambahan melainkan
    # bagian identitasnya: "Perda 1 Tahun 2024" tanpa daerahnya menunjuk ke
    # ratusan dokumen yang berbeda.
    if (p.get("daerah") or [""])[0]:
        where.append("kategori LIKE ?"); arg.append(f"%{p['daerah'][0]}%")
    if (p.get("teks") or [""])[0] == "1":
        where.append("has_body=1")
    elif (p.get("teks") or [""])[0] == "0":
        where.append("has_body=0")
    # Terbitan berkala (1.428 KMK kurs dan tarif bunga) disisihkan secara baku.
    # Keduanya tetap ada dan tetap dapat dikutip, tetapi memenuhi daftar dengan
    # dokumen yang tidak pernah dibaca sebagai norma membuat daftar ini nyaris
    # tidak dapat ditelusuri.
    mode_berkala = (p.get("berkala") or ["tanpa"])[0]
    if mode_berkala == "tanpa":
        where.append("(berkala IS NULL)")
    elif mode_berkala in ("kurs", "tarif_bunga"):
        where.append("berkala=?"); arg.append(mode_berkala)
    limit = min(int((p.get("limit") or ["60"])[0]), 300)
    with koneksi() as conn:
        sql = f"""SELECT r.id, r.canonical, r.jenis, r.jenis_code, r.tahun,
                         r.tanggal, r.judul, r.status_site, r.has_body, r.url,
                         r.kategori, v.status_derived,
                         (SELECT COUNT(DISTINCT pasal) FROM pasal
                           WHERE reg_id=r.id AND pasal IS NOT NULL) n_pasal
                    FROM regulation r
                    LEFT JOIN validity v ON v.reg_id=r.id
                   WHERE {' AND '.join(where)}
                   ORDER BY r.tahun DESC, r.canonical LIMIT ?"""
        rows = conn.execute(sql, arg + [limit]).fetchall()
        total = conn.execute(
            f"SELECT COUNT(*) FROM regulation WHERE {' AND '.join(where)}",
            arg).fetchone()[0]
        return {"total": total, "ditampilkan": len(rows),
                "hasil": [dict(r) for r in rows]}


def api_jenis(_):
    with koneksi() as conn:
        return {"jenis": [dict(r) for r in conn.execute(
            """SELECT jenis_code kode, jenis nama, COUNT(*) n,
                      SUM(has_body) berteks
                 FROM regulation WHERE jenis_code IS NOT NULL
                GROUP BY jenis_code ORDER BY n DESC""").fetchall()]}


def api_daerah(_):
    """Daftar daerah beserta jumlah peraturannya, untuk penyaring di antarmuka.

    Hanya diambil dari bentuk peraturan daerah: kolom `kategori` juga dipakai
    untuk kategori topik pada dokumen pusat, dan mencampur keduanya akan
    menyajikan "PPh" sebagai nama daerah.
    """
    with koneksi() as conn:
        return {"daerah": [dict(r) for r in conn.execute(
            """SELECT kategori nama, COUNT(*) n
                 FROM regulation
                WHERE kategori IS NOT NULL AND kategori<>''
                  AND (kategori LIKE 'Provinsi%' OR kategori LIKE 'Kab.%'
                       OR kategori LIKE 'Kota%')
                GROUP BY kategori ORDER BY n DESC, nama""").fetchall()]}


def api_qc(p):
    hanya = (p.get("hanya") or [None])[0]
    with koneksi() as conn:
        return {"ringkas": mod_qc.ringkas(conn),
                "pemeriksaan": mod_qc.jalankan(conn, hanya=hanya)}


def api_berkala(p):
    """Angka kurs atau tarif bunga yang berlaku pada satu tanggal."""
    jenis = (p.get("jenis") or ["kurs"])[0]
    tanggal = (p.get("tanggal") or [date.today().isoformat()])[0]
    with koneksi() as conn:
        d = mod_berkala.pada(conn, jenis, tanggal)
        d["diminta"] = tanggal
        d["jenis"] = jenis
        d["rentang"] = mod_berkala.rentang(conn, jenis)
        if d.get("terbitan"):
            d["tetangga"] = mod_berkala.tetangga(conn, jenis,
                                                 d["terbitan"]["mulai"])
        return d


def api_berkala_deret(p):
    with koneksi() as conn:
        return {"kode": (p.get("kode") or ["USD"])[0].upper(),
                "deret": mod_berkala.deret(
                    conn, (p.get("kode") or ["USD"])[0],
                    (p.get("dari") or ["2020-01-01"])[0],
                    (p.get("sampai") or [date.today().isoformat()])[0])}


def api_mata_uang(_):
    with koneksi() as conn:
        return {"mata_uang": mod_berkala.mata_uang(conn)}


def api_hierarki(p):
    with koneksi() as conn:
        return mod_hier.peta(
            conn, sertakan_berkala=(p.get("berkala") or ["0"])[0] == "1")


def api_graf(p):
    with koneksi() as conn:
        reg_id = (p.get("reg_id") or [""])[0]
        if not reg_id:
            return {"tersibuk": mod_graf.tersibuk(conn, 20)}
        d = mod_graf.sekitar(conn, reg_id,
                             batas_per_jenis=int((p.get("batas") or ["8"])[0]))
        d["tersibuk"] = mod_graf.tersibuk(conn, 20)
        return d


def api_hierarki_tangga(p):
    with koneksi() as conn:
        return mod_hier.tangga(
            conn, sertakan_berkala=(p.get("berkala") or ["0"])[0] == "1")


def api_hierarki_rincian(p):
    with koneksi() as conn:
        return mod_hier.rincian(
            conn, (p.get("kode") or [""])[0],
            status=(p.get("status") or [None])[0] or None,
            tahun=(p.get("tahun") or [None])[0] or None,
            sertakan_berkala=(p.get("berkala") or ["0"])[0] == "1",
            limit=min(int((p.get("limit") or ["100"])[0]), 300))


def api_tinjau(p):
    with koneksi() as conn:
        return mod_tinjau.daftar(
            conn,
            status=(p.get("status") or ["antre"])[0] or None,
            periksa=(p.get("periksa") or [None])[0] or None,
            keparahan=(p.get("keparahan") or [None])[0] or None,
            cara=(p.get("cara") or [None])[0] or None,
            limit=min(int((p.get("limit") or ["25"])[0]), 100),
            offset=int((p.get("offset") or ["0"])[0]))


def api_tinjau_ringkas(_):
    with koneksi() as conn:
        return mod_tinjau.ringkas(conn)


def api_verif_ringkas(_):
    with koneksi() as conn:
        return mod_verif.ringkas(conn)


def api_verif_satu(body):
    """Periksa satu peraturan ke seluruh repositori, lalu simpulkan.

    Pemeriksaan ini menyentuh jaringan, jadi ia hanya berjalan bila diminta —
    tidak pernah sebagai efek samping membuka halaman.
    """
    with koneksi(tulis=True) as conn:
        reg = conn.execute(
            "SELECT id,canonical,nomor_raw,jenis_code,tahun FROM regulation "
            "WHERE id=?", (body["reg_id"],)).fetchone()
        if not reg:
            return {"galat": "peraturan tidak ada"}
        mod_verif.periksa_satu(conn, mod_verif.Fetcher(delay=0.8), dict(reg))
        hasil = mod_verif.nilai(conn, body["reg_id"])
        if body.get("selesaikan"):
            hasil["penutupan"] = mod_verif.selesaikan(conn)
        return hasil


def api_putuskan(body):
    with koneksi(tulis=True) as conn:
        return mod_tinjau.putuskan(conn, body["id"], body["keputusan"],
                                   body.get("catatan", ""))


def api_batalkan(body):
    with koneksi(tulis=True) as conn:
        return mod_tinjau.batalkan(conn, body["id"])


def api_bangun_ulang(body):
    """Bangun ulang antrean lalu selesaikan yang berkeyakinan tinggi.

    Keputusan manusia yang sudah diambil tidak ikut dibangun ulang — itu
    dijaga di lapisan `tinjau`, bukan di sini.
    """
    with koneksi(tulis=True) as conn:
        hasil = {"bangun": mod_tinjau.bangun(conn)}
        if body.get("auto"):
            hasil["otomatis"] = mod_tinjau.auto_selesai(conn)
        return hasil


RUTE_POST = {
    "/api/verifikasi/satu": api_verif_satu,
    "/api/tinjau/putuskan": api_putuskan,
    "/api/tinjau/batalkan": api_batalkan,
    "/api/tinjau/bangun": api_bangun_ulang,
}

RUTE = {
    "/api/graf": api_graf,
    "/api/hierarki": api_hierarki,
    "/api/hierarki/tangga": api_hierarki_tangga,
    "/api/hierarki/rincian": api_hierarki_rincian,
    "/api/verifikasi/ringkas": api_verif_ringkas,
    "/api/berkala": api_berkala,
    "/api/berkala/deret": api_berkala_deret,
    "/api/berkala/mata-uang": api_mata_uang,
    "/api/tinjau": api_tinjau,
    "/api/tinjau/ringkas": api_tinjau_ringkas,
    "/api/ringkas": api_ringkas,
    "/api/cari": api_cari,
    "/api/pasal": api_pasal,
    "/api/daftar-pasal": api_daftar_pasal,
    "/api/naskah": api_naskah,
    "/api/tanya": api_tanya,
    "/api/konteks": api_konteks,
    "/api/peraturan": api_peraturan,
    "/api/jenis": api_jenis,
    "/api/daerah": api_daerah,
    "/api/qc": api_qc,
}


class Handler(BaseHTTPRequestHandler):
    server_version = "peraturan/1.0"

    def log_message(self, fmt, *args):
        # Bawaan menulis ke stderr untuk tiap permintaan; terlalu berisik.
        pass

    def _kirim(self, kode, isi, tipe="application/json; charset=utf-8"):
        badan = isi if isinstance(isi, bytes) else json.dumps(
            isi, ensure_ascii=False).encode()
        self.send_response(kode)
        self.send_header("Content-Type", tipe)
        self.send_header("Content-Length", str(len(badan)))
        self.end_headers()
        self.wfile.write(badan)

    def do_POST(self):                                           # noqa: N802
        u = urlparse(self.path)
        if u.path not in RUTE_POST:
            self._kirim(404, {"galat": "tidak ditemukan"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            self._kirim(200, RUTE_POST[u.path](body))
        except Exception as e:                                    # noqa: BLE001
            traceback.print_exc()
            self._kirim(500, {"galat": f"{type(e).__name__}: {e}"})

    def _unduh(self, berkas, nama_unduh, tipe):
        """Kirim berkas sebagai unduhan, bukan sebagai isi halaman.

        `Content-Disposition: attachment` yang membedakan keduanya. Tanpa itu,
        peramban mencoba menampilkan berkas biner di dalam tab dan yang terlihat
        pengguna adalah layar penuh sampah — bukan berkas yang tersimpan.
        """
        badan = berkas.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", tipe)
        self.send_header("Content-Disposition",
                         f'attachment; filename="{nama_unduh}"')
        self.send_header("Content-Length", str(len(badan)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(badan)

    def do_GET(self):                                            # noqa: N802
        u = urlparse(self.path)

        if u.path == "/unduh/statistik.xlsx":
            try:
                from pipeline import statistik
                keluar = DATA / "Statistik_Korpus.xlsx"
                q = parse_qs(u.query)
                # Dibuat ulang secara baku: statistik yang basi lebih buruk
                # daripada tidak ada, karena ia tetap terbaca seperti keadaan
                # sekarang. `?segar=0` menyajikan berkas terakhir apa adanya.
                if (q.get("segar") or ["1"])[0] != "0" or not keluar.exists():
                    with koneksi() as conn:
                        statistik.tulis(statistik.kumpulkan(conn), keluar)
                self._unduh(keluar, "Statistik_Korpus_Peraturan.xlsx",
                            "application/vnd.openxmlformats-officedocument."
                            "spreadsheetml.sheet")
            except Exception as e:                               # noqa: BLE001
                traceback.print_exc()
                self._kirim(500, {"galat": f"{type(e).__name__}: {e}"})
            return

        if u.path in RUTE:
            try:
                self._kirim(200, RUTE[u.path](parse_qs(u.query)))
            except Exception as e:                               # noqa: BLE001
                traceback.print_exc()
                self._kirim(500, {"galat": f"{type(e).__name__}: {e}"})
            return

        nama = "index.html" if u.path in ("/", "") else u.path.lstrip("/")
        berkas = (WEB / nama).resolve()
        if not str(berkas).startswith(str(WEB.resolve())) or not berkas.is_file():
            self._kirim(404, {"galat": "tidak ditemukan"})
            return
        tipe = {".html": "text/html; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".js": "text/javascript; charset=utf-8"}.get(
                    berkas.suffix, "application/octet-stream")
        self._kirim(200, berkas.read_bytes(), tipe)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    if not Path(DB_PATH).exists():
        sys.exit(f"basis data tidak ada: {DB_PATH}")
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"  siap  →  http://{a.host}:{a.port}")
    print(f"  data  →  {DB_PATH}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  berhenti")


if __name__ == "__main__":
    main()
