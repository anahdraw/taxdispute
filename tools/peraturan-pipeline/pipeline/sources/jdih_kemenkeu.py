"""Konektor JDIH Kementerian Keuangan (jdih.kemenkeu.go.id).

Sebelumnya situs ini saya laporkan "tidak dapat dijangkau": `curl` selalu gagal
di jabat tangan TLS (`Recv failure`), pada semua varian `--tlsv1.2`, `-4`,
`--http1.1`. Dugaan awal saya — pembatasan wilayah — **salah**.

Penyebab sebenarnya adalah **penyaringan sidik jari TLS** (anti-bot): situs
menolak klien yang jabat tangannya bukan browser sungguhan. Dibuka lewat
browser, situs terbuka normal; dan dari Python ia terjangkau begitu TLS-nya
menyamar sebagai Chrome (`curl_cffi` dengan `impersonate="chrome"`). Karena itu
konektor ini memakai `curl_cffi`, bukan `httpx` seperti konektor lain.

Yang ditemukan setelah bisa masuk — ini sumber terkaya dari ketiganya:

1. **API JSON sungguhan**: `/api/search?q=...&size=...&tahun=...&bentuk=...`
   mengembalikan `{page:{current,size,total,total_pages}, data:[...]}` dengan
   field lengkap: `nomor`, `bentuk`, `status`, `judul`, `tanggal_penetapan`,
   `tanggal_pengundangan`, `konsolidasi`, `label` (subjek), `jumlah_pasal`,
   `blocks` (segmentasi pasal siap pakai, terisi pada sebagian dokumen), dan
   `full_text_pdf`.
2. **Teks lengkap sebagai HTM**, bukan hasil pindaian — `full_text_pdf`
   menunjuk `/api/download/{uuid}/{nama}.HTM`. Nol biaya OCR.
3. **Relasi terstruktur** di halaman `/dok/{slug}`: "Dicabut dengan",
   "Mengubah", dan seterusnya.

Dua jebakan yang ditangani:

* **Soft 404.** `/dok/{slug}` yang tidak ada tetap membalas HTTP 200 dengan
  halaman "Silakan coba langkah-langkah berikut". Status HTTP tidak boleh
  dipakai sebagai penanda keberadaan dokumen — isinya wajib diperiksa.
* **Aturan slug tidak seragam.** Sebagian dokumen memakai
  `251-kmk-03-2002` (non-alfanumerik jadi tanda hubung), sebagian lain
  `48mkbc2026` (non-alfanumerik dibuang). Karena itu jalur utamanya adalah
  API pencarian dengan pencocokan nomor yang dinormalkan, bukan menebak slug.
"""
from __future__ import annotations

import html
import re
from urllib.parse import quote

from . import Doc, ExtRelation

BASE = "https://jdih.kemenkeu.go.id"
SOURCE = "jdih.kemenkeu.go.id"
IMPERSONATE = "chrome"

# Cakupan yang terukur (sampel n=32, lihat README bagian 3d):
#   seri klasik  N/KMK.0x/YYYY  -> ~56% ada, seluruhnya berteks lengkap
#   seri KM.xx / "N TAHUN YYYY" -> hampir seluruhnya tidak ada
JENIS_DIDUKUNG = {"KMK", "PMK", "IMK"}

LABEL_MAP = {
    "mengubah": "MENGUBAH",
    "diubah dengan": "DIUBAH_OLEH",
    "mencabut": "MENCABUT",
    "mencabut sebagian": "MENCABUT_SEBAGIAN",
    "dicabut dengan": "DICABUT_OLEH",
    "dicabut sebagian dengan": "DICABUT_SEBAGIAN_OLEH",
}
# Halaman adalah React Server Components: teks label dan href tersebar di
# potongan __next_f.push yang berbeda, sehingga label "Dicabut dengan" yang
# PERTAMA muncul bisa berjarak 65 ribu karakter dari tautan mana pun.
# Pencocokan karena itu dilakukan MUNDUR — dari tiap tautan /dok/ ke belakang
# mencari label terdekat — bukan maju dari label.
RE_DOK_LINK = re.compile(r"/dok/([a-z0-9\-]+)")
RE_LABEL_DEKAT = re.compile(
    r"(Mengubah|Mencabut\s+[Ss]ebagian|Mencabut|Dicabut\s+[Ss]ebagian\s+[Dd]engan|"
    r"Dicabut\s+[Dd]engan|Diubah\s+[Dd]engan)(?!.*(?:Mengubah|Mencabut|Dicabut|Diubah))",
    re.S)
JARAK_LABEL_MAKS = 200

# Deteksi keberadaan dokumen HARUS memakai penanda POSITIF. Kalimat halaman
# error ("Silakan coba langkah-langkah berikut") ikut terbundel di payload
# Next.js dan muncul juga pada halaman yang valid — memakainya sebagai penanda
# negatif membuat setiap halaman dianggap tidak ada, tanpa error apa pun.
RE_ADA_DOKUMEN = re.compile(r"Tanggal\s+Penetapan|Tipe\s+Dokumen", re.I)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


# Katalog DJP menulis nomor tanpa awalan jenis ("72 TAHUN 2023"), sedangkan
# JDIH Kemenkeu menulisnya lengkap ("PMK 72 TAHUN 2023"). Membandingkan kedua
# bentuk sebagai string membuat pencocokan selalu gagal — dan kegagalan itu
# tidak terlihat, ia hanya tampak sebagai "dokumen tidak ada di sumber lain".
RE_NOMOR_TAHUN = re.compile(r"^(?:[A-Z]+\s+)?(\d+)\s*TAHUN\s*(\d{4})$", re.I)

# Padanan kode jenis dengan sebutan bentuk di JDIH. Tanpa pemeriksaan ini,
# "PMK 72 TAHUN 2023" dapat tercocokkan dengan "KMK 72 TAHUN 2023" — nomor dan
# tahunnya sama, dokumennya berlainan.
_BENTUK = {"PMK": "peraturan menteri", "KMK": "keputusan menteri",
           "IMK": "instruksi menteri"}


def _cocok(jenis_code: str | None, nomor: str, tahun, rec: dict) -> bool:
    """Cocokkan lewat komponen nomor, bukan lewat rangkaian aksaranya.

    Perbandingan akhiran (`endswith`) sempat dipertimbangkan dan ditolak:
    "172tahun2023" berakhiran "72tahun2023", sehingga PMK 72 akan tercocokkan
    dengan PMK 172. Kesalahan semacam itu justru menghasilkan bukti palsu yang
    tampak meyakinkan.
    """
    if tahun and str(rec.get("tahun")) != str(tahun):
        return False
    bentuk = (rec.get("bentuk") or "").lower()
    harus = _BENTUK.get((jenis_code or "").upper())
    if harus and harus not in bentuk:
        return False
    m = RE_NOMOR_TAHUN.match((nomor or "").strip())
    if m:
        return str(rec.get("no")) == str(int(m.group(1))) and \
               str(rec.get("tahun")) == m.group(2)
    return _norm(rec.get("nomor")) == _norm(nomor)


class _Client:
    """Pembungkus curl_cffi. Dibuat malas agar impor modul tidak memaksa depedensi."""

    # Timeout sengaja pendek. Situs ini kadang menerima koneksi lalu diam
    # tanpa mengirim respons; dengan timeout 60 dtk dan 2 percobaan ulang,
    # SATU dokumen bermasalah memblokir antrean selama 3 menit. Pada pekerjaan
    # 4.000 dokumen itu berarti berhari-hari. Lebih baik menyerah cepat dan
    # lanjut — dokumen yang terlewat dapat diambil ulang belakangan.
    def __init__(self, delay=0.6, timeout=15, deadline=25):
        from curl_cffi import requests as cr
        self._cr = cr
        self._sess = cr.Session(impersonate=IMPERSONATE, timeout=timeout)
        self.delay = delay
        self.deadline = deadline      # batas keras via SIGALRM
        self._last = 0.0

    def get(self, path: str, retries=1):
        """Ambil satu URL dengan BATAS WAKTU KERAS.

        `timeout` pada curl_cffi ternyata bukan batas total transfer: situs ini
        pernah menahan satu permintaan 78 detik meski timeout disetel 30, dan
        pada pekerjaan massal satu dokumen semacam itu membekukan seluruh
        antrean tanpa pesan error apa pun (gejalanya: proses hidup, CPU nyaris
        nol, tidak ada berkas baru). SIGALRM memberi jaminan yang tidak
        diberikan pustakanya — tidak ada permintaan yang boleh melampaui
        DEADLINE detik, apa pun yang terjadi di lapisan bawah.

        Kegagalan dikembalikan sebagai None; dokumen yang terlewat dapat
        diambil ulang belakangan karena tahap ini resumable.
        """
        import signal
        import time

        class _Lewat(Exception):
            pass

        def _bel(signum, frame):
            raise _Lewat()

        for percobaan in range(retries + 1):
            gap = time.monotonic() - self._last
            if gap < self.delay:
                time.sleep(self.delay - gap)
            pakai_alarm = hasattr(signal, "SIGALRM")
            lama = signal.signal(signal.SIGALRM, _bel) if pakai_alarm else None
            if pakai_alarm:
                signal.alarm(self.deadline)
            try:
                r = self._sess.get(BASE + path, timeout=self.deadline)
                self._last = time.monotonic()
                return r
            except Exception:                               # noqa: BLE001
                self._last = time.monotonic()
                if percobaan == retries:
                    return None
                time.sleep(1)
            finally:
                if pakai_alarm:
                    signal.alarm(0)
                    signal.signal(signal.SIGALRM, lama)
        return None


_client: _Client | None = None


def client(delay=0.6) -> _Client:
    global _client
    if _client is None:
        _client = _Client(delay)
    return _client


def api_search(q: str, *, size=10, tahun=None, bentuk=None, page=1) -> dict:
    qs = [f"q={quote(q)}", f"size={size}", f"page={page}"]
    if tahun:
        qs.append(f"tahun={tahun}")
    if bentuk:
        qs.append(f"bentuk={quote(bentuk)}")
    r = client().get("/api/search?" + "&".join(qs))
    if r is None or r.status_code != 200 or "json" not in (r.headers.get("content-type") or ""):
        return {"page": {"total": 0}, "data": []}
    try:
        return r.json()
    except Exception:                                       # noqa: BLE001
        return {"page": {"total": 0}, "data": []}


def _fulltext(path: str) -> str | None:
    """Ambil teks lengkap dari berkas HTM (ekspor Word, bukan pindaian)."""
    if not path:
        return None
    r = client().get(path)
    if r is None or r.status_code != 200:
        return None
    t = r.text
    t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", t)
    t = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    t = re.sub(r"[ \t\xa0]+", " ", t)
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    return t.strip() or None


def _relations(slug: str) -> list[ExtRelation]:
    r = client().get(f"/dok/{slug}")
    if r is None or r.status_code != 200 or not RE_ADA_DOKUMEN.search(r.text):
        return []
    teks = r.text
    out, seen = [], set()
    for m in RE_DOK_LINK.finditer(teks):
        target = m.group(1)
        if target == slug:
            continue
        awal = max(0, m.start() - JARAK_LABEL_MAKS)
        konteks = teks[awal:m.start()]
        lm = RE_LABEL_DEKAT.search(konteks)
        if not lm:
            continue          # tautan "Produk Hukum Terkait" — bukan relasi bertipe
        lab = re.sub(r"\s+", " ", lm.group(1)).strip().lower()
        tipe = LABEL_MAP.get(lab)
        key = (lab, target)
        if not tipe or key in seen:
            continue
        seen.add(key)
        out.append(ExtRelation(label=lab, type=tipe,
                               target_slug=f"/dok/{target}", target_text=target))
    return out


def _to_doc(rec: dict, *, ambil_teks: bool) -> Doc:
    doc = Doc(
        source=SOURCE, url=f"{BASE}/dok/{rec.get('slug','')}",
        slug=rec.get("slug", ""),
        judul=rec.get("judul"), jenis=rec.get("bentuk"), nomor=rec.get("nomor"),
        tahun=int(rec["tahun"]) if str(rec.get("tahun", "")).isdigit() else None,
        tanggal=(rec.get("tanggal_penetapan") or "")[:10] or None,
        status=rec.get("status"), tempat=rec.get("tempat_terbit"),
        raw_meta={k: rec.get(k) for k in
                  ("produk_hukum_id", "konsolidasi", "label", "jumlah_pasal",
                   "tanggal_pengundangan", "teu")},
    )
    if rec.get("full_text_pdf"):
        doc.pdf_urls = [BASE + rec["full_text_pdf"]]
    doc.relations = _relations(doc.slug) if doc.slug else []
    if ambil_teks:
        doc.text = _fulltext(rec.get("full_text_pdf") or "")
    return doc


def fetch(fetcher, jenis_code: str | None, nomor: str, tahun: int | None,
          *, want_pdf=True, pdf_dir=None) -> Doc | None:
    """Cari lewat API lalu VERIFIKASI nomor yang dinormalkan.

    Parameter `fetcher` diabaikan — konektor ini memakai klien TLS-nya sendiri
    karena situs menolak klien HTTP biasa (lihat docstring modul).
    """
    if (jenis_code or "").upper() not in JENIS_DIDUKUNG or not nomor:
        return None
    if not _norm(nomor):
        return None
    j = api_search(nomor, size=8, tahun=tahun)
    for rec in j.get("data", []):
        if _cocok(jenis_code, nomor, tahun, rec):
            return _to_doc(rec, ambil_teks=want_pdf)
    return None


def hitung(bentuk: str | None = None, tahun: int | None = None) -> int:
    """Jumlah dokumen menurut API — untuk mengukur cakupan tanpa mengunduh."""
    j = api_search("", size=1, tahun=tahun, bentuk=bentuk)
    return (j.get("page") or {}).get("total", 0)
