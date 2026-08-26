"""Konektor JDIH BPK (peraturan.bpk.go.id).

Diverifikasi langsung terhadap situs pada 2026-08-09.

**Peran sumber ini: mengisi lapisan KMK/PMK.** peraturan.go.id kuat di level
UU/PP/Perpres dan punya `permenkeu`, tetapi tidak memuat Keputusan Menteri
Keuangan. BPK memuatnya, lengkap dengan relasi terstruktur — sehingga dua
sumber ini saling melengkapi, bukan menduplikasi.

**Batas cakupan yang harus diketahui sejak awal:** BPK TIDAK memuat peraturan
setingkat Direktorat Jenderal Pajak (PER / KEP / SE Dirjen). Jenis dokumen
"Peraturan Dirjen/Ka.Badan/Irjen" (id 142), "Keputusan Dirjen" (144), dan
"Peraturan dan Keputusan Dirjen" (150) ada di dropdown pencarian tetapi
mengembalikan nol hasil. Lihat README bagian 3c untuk implikasinya.

Tiga hal teknis:

1. **URL detail tidak dapat dibentuk** — formatnya `/Details/{id_internal}/{slug}`
   dengan id numerik internal BPK. Berbeda dengan peraturan.go.id, jalurnya
   wajib lewat pencarian lalu pencocokan.
2. **Pencarian bebas sangat longgar.** `tentang=Pedoman Teknis Tata Cara
   Pemotongan` mengembalikan undang-undang Pengadilan Tata Usaha Negara.
   Satu-satunya kombinasi yang presisi adalah `nomor` + `tahun` + `jenis`,
   dan hasilnya TETAP harus diverifikasi terhadap field "Nomor" di halaman
   detail — jangan pernah percaya hasil pencarian begitu saja.
3. **Relasi terstruktur tersedia** di blok STATUS PERATURAN: "Dicabut dengan",
   "Mengubah", "Mencabut", "Diubah dengan".
"""
from __future__ import annotations

import html
import re
from urllib.parse import quote, urljoin

from selectolax.parser import HTMLParser

from . import Doc, ExtRelation

BASE = "https://peraturan.bpk.go.id"
SOURCE = "peraturan.bpk.go.id"

# jenis_code kita -> id jenis di dropdown pencarian BPK.
# Nilai diambil dari <select name="jenis"> pada halaman depan.
JENIS_ID = {
    "UU": 8,
    "PERPU": 9,
    "PP": 10,
    "PERPRES": 11,
    "KEPPRES": 12,
    "INPRES": 13,
    "PMK": 42,
    "KMK": 66,
    "PERMENDAGRI": 40,
}

# Jenis yang ADA di dropdown tetapi terbukti kosong — disimpan eksplisit agar
# tidak ada yang mencoba lagi dan mengira konektornya rusak.
JENIS_KOSONG = {142: "Peraturan Dirjen/Ka.Badan/Irjen",
                144: "Keputusan Dirjen/Ka.Badan/Irjen",
                150: "Peraturan dan Keputusan Dirjen",
                138: "Keputusan Direktur Jenderal/Kepala Badan"}

LABEL_MAP = {
    "mengubah": "MENGUBAH",
    "diubah dengan": "DIUBAH_OLEH",
    "mencabut": "MENCABUT",
    "mencabut sebagian": "MENCABUT_SEBAGIAN",
    "dicabut dengan": "DICABUT_OLEH",
    "dicabut sebagian dengan": "DICABUT_SEBAGIAN_OLEH",
    "dasar hukum": "DASAR_HUKUM",
    "menetapkan": "MENETAPKAN",
}

RE_DETAIL = re.compile(r'href="(/Details/(\d+)/([^"]+))"')
RE_LABEL = re.compile(
    r">\s*(Mengubah|Mencabut(?:\s+[Ss]ebagian)?|Dicabut\s+[Dd]engan|"
    r"Dicabut\s+[Ss]ebagian\s+[Dd]engan|Diubah\s+[Dd]engan|Dasar\s+Hukum|"
    r"Menetapkan)\s*:?\s*<", re.I)


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def _nomor_kunci(nomor: str) -> str:
    """Bentuk pembanding yang tahan variasi tanda baca: '251/KMK.03/2002' -> '251kmk032002'."""
    return re.sub(r"[^a-z0-9]", "", (nomor or "").lower())


def search(fetcher, jenis_code: str | None, nomor: str, tahun: int | None) -> list[dict]:
    """Cari kandidat. Hanya nomor+tahun+jenis yang cukup presisi untuk dipakai."""
    jid = JENIS_ID.get((jenis_code or "").upper())
    if not jid or not tahun:
        return []
    m = re.match(r"\s*0*(\d+)", str(nomor))
    if not m:
        return []
    url = (f"{BASE}/Search?nomor={quote(m.group(1))}&tahun={tahun}&jenis={jid}")
    try:
        h = fetcher.get(url, cache_key=f"bpk-s-{jenis_code}-{m.group(1)}-{tahun}")
    except Exception:                                       # noqa: BLE001
        return []
    out, seen = [], set()
    for href, bpk_id, slug in RE_DETAIL.findall(h):
        if bpk_id in seen:
            continue
        seen.add(bpk_id)
        out.append({"path": href, "bpk_id": bpk_id, "slug": slug})
    return out


def _meta(tree) -> dict:
    """Metadata berbentuk pasangan div: col-lg-3 (label) + col-lg-9 (nilai)."""
    meta: dict[str, str] = {}
    for row in tree.css("div.row"):
        lab = row.css_first("div.col-lg-3")
        val = row.css_first("div.col-lg-9")
        if lab is not None and val is not None:
            k = _clean(lab.text()).rstrip(":").lower()
            if k:
                meta.setdefault(k, _clean(val.text()))
    return meta


def _relations(html_text: str) -> list[ExtRelation]:
    i = html_text.find("STATUS")
    seg = html_text[i:] if i > 0 else html_text
    labels = [(m.start(), _clean(m.group(1)).lower()) for m in RE_LABEL.finditer(seg)]
    out: list[ExtRelation] = []
    for idx, (pos, label) in enumerate(labels):
        end = labels[idx + 1][0] if idx + 1 < len(labels) else len(seg)
        blok = seg[pos:end]
        rtype = LABEL_MAP.get(label, label.upper().replace(" ", "_"))
        for href, _bid, slug in RE_DETAIL.findall(blok):
            teks = re.search(
                r'href="' + re.escape(href) + r'"[^>]*>(.*?)</a>', blok, re.S)
            out.append(ExtRelation(
                label=label, type=rtype, target_slug=href,
                target_text=_clean(re.sub(r"<[^>]+>", " ", teks.group(1)))
                if teks else slug))
    return out


BULAN = {"januari": 1, "februari": 2, "maret": 3, "april": 4, "mei": 5,
         "juni": 6, "juli": 7, "agustus": 8, "september": 9, "oktober": 10,
         "november": 11, "desember": 12}


def _tanggal(s: str | None) -> str | None:
    if not s:
        return None
    m = re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", s)
    if not m:
        return None
    d, bln, y = m.groups()
    if bln.lower() not in BULAN:
        return None
    return f"{int(y):04d}-{BULAN[bln.lower()]:02d}-{int(d):02d}"


def parse_detail(html_text: str, url: str, slug: str) -> Doc:
    tree = HTMLParser(html_text)
    meta = _meta(tree)
    doc = Doc(
        source=SOURCE, url=url, slug=slug,
        judul=meta.get("judul"),
        jenis=meta.get("bentuk"),
        nomor=meta.get("nomor"),
        tahun=int(meta["tahun"]) if (meta.get("tahun") or "").isdigit() else None,
        tanggal=_tanggal(meta.get("tanggal penetapan")),
        status=meta.get("status"),
        tempat=meta.get("tempat penetapan"),
        raw_meta=meta,
    )
    doc.pdf_urls = sorted({urljoin(BASE, u)
                           for u in re.findall(r'href="(/Download/[^"]+)"', html_text)})
    doc.relations = _relations(html_text)
    return doc


def fetch(fetcher, jenis_code: str | None, nomor: str, tahun: int | None,
          *, want_pdf=True, pdf_dir=None) -> Doc | None:
    """Cari lalu VERIFIKASI. Kandidat yang nomornya tidak persis sama dibuang.

    Verifikasi ini bukan formalitas: pencarian BPK mengembalikan hasil yang
    hanya mirip, jadi tanpa pencocokan ketat konektor akan diam-diam menempelkan
    dokumen yang salah ke node kita — kesalahan terburuk yang bisa terjadi pada
    korpus hukum.
    """
    target = _nomor_kunci(nomor)
    for cand in search(fetcher, jenis_code, nomor, tahun):
        # Saring murah lewat slug sebelum mengambil halaman detail.
        if target and target not in _nomor_kunci(cand["slug"]):
            continue
        url = BASE + cand["path"]
        try:
            h = fetcher.get(url, cache_key=f"bpk-d-{cand['bpk_id']}")
        except Exception:                                   # noqa: BLE001
            continue
        doc = parse_detail(h, url, cand["slug"])
        if _nomor_kunci(doc.nomor) != target:
            continue                                        # verifikasi gagal
        if want_pdf and pdf_dir is not None and doc.pdf_urls:
            doc.text = _ambil_teks(fetcher, doc, url, pdf_dir)
        return doc
    return None


def _ambil_teks(fetcher, doc: Doc, referer: str, pdf_dir) -> str | None:
    import subprocess
    from pathlib import Path
    teks = []
    for pu in doc.pdf_urls:
        name = re.sub(r"[^A-Za-z0-9._-]", "_", pu.rsplit("/", 1)[-1])[:80]
        dest = Path(pdf_dir) / f"bpk-{name}"
        if not dest.exists():
            try:
                fetcher.client.headers["Referer"] = referer
                fetcher.download(pu, dest)
            except Exception:                               # noqa: BLE001
                continue
            finally:
                fetcher.client.headers.pop("Referer", None)
        if not dest.exists() or dest.stat().st_size < 2000:
            continue
        with open(dest, "rb") as fh:
            if fh.read(5) != b"%PDF-":
                dest.unlink(missing_ok=True)
                continue
        r = subprocess.run(["pdftotext", "-layout", str(dest), "-"],
                           capture_output=True, text=True, timeout=600)
        if r.stdout.strip():
            teks.append(r.stdout)
    return "\n\n".join(teks) if teks else None
