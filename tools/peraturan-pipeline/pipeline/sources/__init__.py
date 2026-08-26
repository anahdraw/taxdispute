"""Konektor sumber sekunder.

DJP hanya menyediakan badan teks untuk ~47% korpus. Sisanya diambil dari
penerbit resmi. Setiap konektor mengimplementasikan antarmuka yang sama:

    slug(regid)        -> path dokumen di situs sumber (atau None)
    fetch(fetcher, regid) -> Doc | None

`Doc` membawa teks, metadata, relasi terstruktur (bila situs menyediakannya),
dan tautan PDF. Relasi dari sumber sekunder disimpan dengan `method='external'`
sehingga tidak tercampur dengan hasil ekstraksi teks — justru itu yang membuat
keduanya bisa saling diperiksa.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class ExtRelation:
    label: str                 # label apa adanya dari situs, mis. "Mengubah"
    type: str                  # dipetakan ke kosakata graf kita
    target_slug: str | None
    target_text: str


@dataclass
class Doc:
    source: str
    url: str
    slug: str
    judul: str | None = None
    jenis: str | None = None
    nomor: str | None = None
    tahun: int | None = None
    tanggal: str | None = None
    status: str | None = None
    tempat: str | None = None
    ln_nomor: str | None = None
    tln_nomor: str | None = None
    pdf_urls: list[str] = field(default_factory=list)
    relations: list[ExtRelation] = field(default_factory=list)
    text: str | None = None
    raw_meta: dict = field(default_factory=dict)


def probe_site(fetcher, url: str, kata_kunci=("peraturan", "nomor", "tahun")) -> dict:
    """Diagnostik untuk situs yang belum terverifikasi.

    Dipakai untuk JDIH Kemenkeu, yang tidak dapat dijangkau dari lingkungan
    pengembangan ini (DNS resolve ke 103.196.166.252, HTTP 301 ke HTTPS, lalu
    koneksi TLS gagal — kemungkinan pembatasan wilayah). Jalankan dari jaringan
    Indonesia untuk mendapatkan struktur nyatanya sebelum menulis selector.
    """
    out = {"url": url, "terjangkau": False}
    try:
        html_text = fetcher.get(url, cache_key=None)
    except Exception as e:                                  # noqa: BLE001
        out["error"] = str(e)[:300]
        return out
    out["terjangkau"] = True
    out["ukuran"] = len(html_text)
    out["judul"] = (re.findall(r"<title>(.*?)</title>", html_text, re.S) or [""])[0].strip()[:120]
    out["form"] = re.findall(r"<form[^>]*action=\"([^\"]*)\"[^>]*>", html_text)[:6]
    out["input_names"] = sorted(set(re.findall(r'name="([^"]+)"', html_text)))[:30]
    out["kandidat_api"] = sorted(set(re.findall(
        r'["\'](/(?:api|rest|service)/[^"\']{3,90})["\']', html_text)))[:15]
    out["tautan_pdf"] = sorted(set(re.findall(r'href="([^"]*\.pdf)"', html_text)))[:8]
    out["kelas_daftar"] = sorted(set(re.findall(
        r'class="([^"]*(?:list|item|card|row|result)[^"]*)"', html_text)))[:15]
    out["punya_kata_kunci"] = {k: (k in html_text.lower()) for k in kata_kunci}
    return out
