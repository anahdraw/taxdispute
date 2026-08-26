"""Konektor peraturan.go.id (JDIH Nasional).

Diverifikasi langsung terhadap situs pada 2026-08-09. Tiga hal membuat sumber
ini bernilai jauh melebihi sekadar penambal teks yang hilang:

1. **URL dapat dibentuk, tidak perlu scraping pencarian.**
   `/id/uu-no-7-tahun-2021`, `/id/pp-no-55-tahun-2022`, `/id/uu-no-6-tahun-1983`
   — polanya `{prefix}-no-{nomor}-tahun-{tahun}`, sehingga identitas kanonik
   kita bisa langsung dipetakan ke URL. Dokumen 1983 pun tersedia.

2. **PDF resmi terpisah batang tubuh dan penjelasan**, dengan text layer.
   `/files/uu7-2021bt.pdf` (114 halaman, teks terekstrak bersih) dan
   `/files/uu7-2021pjl.pdf`. Nol biaya OCR.

3. **Relasi antar-peraturan tersedia TERSTRUKTUR.** Bagian "Hubungan Antar
   Peraturan" memuat blok berlabel (`Mengubah`, `Mencabut`, `Dasar Hukum`)
   berisi tautan ke slug peraturan sasaran. Ini adalah sumber kebenaran
   independen — dipakai untuk memeriksa silang hasil ekstraksi teks kita dari
   DJP, dan menjadi tulang punggung gold set.

Cakupan yang TERBUKTI berguna: UU, Perpu, PP, Perpres, Keppres, Inpres.
Diuji n=8 pada PP: 8/8 ketemu.

Peraturan menteri sengaja TIDAK dipetakan meski situsnya punya jalur
`permenkeu-*`: penomorannya mengikuti format baru ("permenkeu-no-44-tahun-2026")
sedangkan PMK perpajakan memakai format lama ("133/PMK.01/2011"), dan pengujian
n=8 menghasilkan 0 kecocokan. KMK dan peraturan setingkat Dirjen juga tidak
ada di sini — untuk itu dipakai JDIH Kemenkeu dan JDIH BPK.
"""
from __future__ import annotations

import html
import re
from urllib.parse import urljoin

from selectolax.parser import HTMLParser

from . import Doc, ExtRelation

BASE = "https://peraturan.go.id"
SOURCE = "peraturan.go.id"

# jenis_code kita -> prefiks slug di peraturan.go.id
SLUG_PREFIX = {
    "UU": "uu",
    "PERPU": "perppu",
    "PP": "pp",
    "PERPRES": "perpres",
    "KEPPRES": "keppres",
    "INPRES": "inpres",
    # PMK dan peraturan menteri lain SENGAJA tidak dicantumkan. Situs ini
    # memakai penomoran baru ("permenkeu-no-44-tahun-2026"), sedangkan PMK
    # perpajakan memakai format lama "133/PMK.01/2011" — pengujian n=8
    # menghasilkan 0 kecocokan. Mencantumkannya hanya menghasilkan ribuan
    # permintaan yang pasti gagal.
}

# Label di situs -> kosakata relasi graf kita.
LABEL_MAP = {
    "mengubah": "MENGUBAH",
    "diubah dengan": "DIUBAH_OLEH",
    "diubah oleh": "DIUBAH_OLEH",
    "mencabut": "MENCABUT",
    "mencabut sebagian": "MENCABUT_SEBAGIAN",
    "dicabut dengan": "DICABUT_OLEH",
    "dicabut oleh": "DICABUT_OLEH",
    "dasar hukum": "DASAR_HUKUM",
    "menetapkan": "MENETAPKAN",
}

RE_SLUG = re.compile(r"^/id/([a-z0-9]+)-no-([0-9]+[a-z]?)-tahun-([0-9]{4})$", re.I)


def slug(jenis_code: str | None, nomor: str, tahun: int | None) -> str | None:
    """Bentuk slug dokumen. None bila jenis di luar cakupan situs ini."""
    pre = SLUG_PREFIX.get((jenis_code or "").upper())
    if not pre or not tahun or not nomor:
        return None
    # Nomor mentah dari katalog DJP bisa berbentuk "7 TAHUN 2021" atau "007";
    # ambil hanya komponen nomornya dan buang nol di depan.
    m = re.match(r"\s*0*(\d+[a-z]?)", str(nomor), re.I)
    if not m:
        return None
    return f"{pre}-no-{m.group(1).lower()}-tahun-{tahun}"


def slug_to_key(path: str):
    """Balik slug situs menjadi RegID kanonik kita."""
    from ..normalize import normalize_nomor
    m = RE_SLUG.match(path.strip())
    if not m:
        return None
    pre, nomor, tahun = m.groups()
    inv = {v: k for k, v in SLUG_PREFIX.items()}
    code = inv.get(pre.lower())
    if not code:
        return None
    return normalize_nomor(f"{code} {nomor} TAHUN {tahun}", None, int(tahun))


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def _meta_table(tree) -> dict:
    """Tabel metadata berbentuk <tr><th>label</th><td>nilai</td></tr>.

    Catatan: selektor koma pada selectolax (`row.css("td, th")`) TIDAK
    mengembalikan simpul dalam urutan dokumen — pada baris pertama ia
    mengembalikan ['UNDANG-UNDANG', 'Jenis/Bentuk Peraturan'], sehingga label
    dan nilai tertukar tanpa error. Karena itu th dan td diambil terpisah.
    """
    meta: dict[str, str] = {}
    for row in tree.css("table tr"):
        heads = [_clean(c.text()) for c in row.css("th")]
        vals = [_clean(c.text()) for c in row.css("td")]
        if heads and vals:
            meta.setdefault(heads[0].rstrip(":").lower(), vals[0])
    return meta


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


def parse_detail(html_text: str, url: str, doc_slug: str) -> Doc:
    tree = HTMLParser(html_text)
    meta = _meta_table(tree)
    judul = _clean((re.findall(r"<title>(.*?)</title>", html_text, re.S) or [""])[0])
    judul = re.sub(r"^.*?Tentang\s+", "", judul, flags=re.I) or judul

    doc = Doc(
        source=SOURCE, url=url, slug=doc_slug,
        judul=meta.get("tentang") or judul,
        jenis=meta.get("jenis/bentuk peraturan"),
        nomor=meta.get("nomor"),
        tahun=int(meta["tahun"]) if (meta.get("tahun") or "").isdigit() else None,
        tanggal=_tanggal(meta.get("ditetapkan tanggal")),
        status=meta.get("status"),
        tempat=meta.get("tempat penetapan"),
        ln_nomor=meta.get("nomor pengundangan"),
        tln_nomor=meta.get("nomor tambahan"),
        raw_meta=meta,
    )
    doc.pdf_urls = sorted({urljoin(BASE, u)
                           for u in re.findall(r'href="(/files/[^"]+\.pdf)"', html_text)})
    doc.relations = _parse_relations(html_text)
    return doc


def _parse_relations(html_text: str) -> list[ExtRelation]:
    """Bagian 'Hubungan Antar Peraturan': label -> daftar tautan sasaran.

    Situs menyusunnya sebagai heading label diikuti blok tautan. Batas antar
    blok ditentukan oleh posisi label berikutnya, bukan oleh struktur DOM yang
    konsisten — karena itu pemisahannya dilakukan berbasis offset.
    """
    i = html_text.find("Hubungan Antar Peraturan")
    if i < 0:
        return []
    seg = html_text[i:]
    labels = [(m.start(), _clean(m.group(1)).lower())
              for m in re.finditer(
                  r">\s*(Mengubah|Mencabut(?:\s+[Ss]ebagian)?|Dicabut\s+[Dd]engan|"
                  r"Dicabut\s+[Oo]leh|Diubah\s+[Dd]engan|Diubah\s+[Oo]leh|"
                  r"Dasar\s+Hukum|Menetapkan)\s*:?\s*<", seg)]
    if not labels:
        return []
    out: list[ExtRelation] = []
    for idx, (pos, label) in enumerate(labels):
        end = labels[idx + 1][0] if idx + 1 < len(labels) else len(seg)
        blok = seg[pos:end]
        rtype = LABEL_MAP.get(label, label.upper().replace(" ", "_"))
        for href, inner in re.findall(r'<a[^>]+href="(/id/[^"]+)"[^>]*>(.*?)</a>',
                                      blok, re.S):
            out.append(ExtRelation(label=label, type=rtype, target_slug=href,
                                   target_text=_clean(re.sub(r"<[^>]+>", " ", inner))))
    return out


def fetch(fetcher, jenis_code: str | None, nomor: str, tahun: int | None,
          *, want_pdf=True, pdf_dir=None) -> Doc | None:
    """Ambil satu dokumen. None bila slug tidak terbentuk atau 404."""
    s = slug(jenis_code, nomor, tahun)
    if not s:
        return None
    url = f"{BASE}/id/{s}"
    try:
        h = fetcher.get(url, cache_key=f"pgi-{s}")
    except Exception:                                       # noqa: BLE001
        return None
    if "Hubungan Antar Peraturan" not in h and "Jenis/Bentuk Peraturan" not in h:
        return None                                          # halaman error/redirect
    doc = parse_detail(h, url, s)

    if want_pdf and pdf_dir is not None and doc.pdf_urls:
        import subprocess
        from pathlib import Path
        teks = []
        for pu in doc.pdf_urls:
            name = pu.rsplit("/", 1)[-1]
            dest = Path(pdf_dir) / f"pgi-{name}"
            if not dest.exists():
                try:
                    # Referer diperlukan: unduhan langsung tanpa Referer
                    # dialihkan ke beranda dan menghasilkan HTML, bukan PDF.
                    fetcher.client.headers["Referer"] = url
                    fetcher.download(pu, dest)
                finally:
                    fetcher.client.headers.pop("Referer", None)
            if dest.exists() and dest.stat().st_size > 2000:
                with open(dest, "rb") as fh:
                    if fh.read(5) != b"%PDF-":
                        dest.unlink(missing_ok=True)
                        continue
                r = subprocess.run(["pdftotext", "-layout", str(dest), "-"],
                                   capture_output=True, text=True, timeout=600)
                if r.stdout.strip():
                    teks.append(r.stdout)
        if teks:
            doc.text = "\n\n".join(teks)
    return doc
