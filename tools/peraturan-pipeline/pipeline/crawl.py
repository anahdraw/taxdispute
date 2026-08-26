"""Pengunduh katalog & dokumen peraturan dari pajak.go.id.

Situs DJP adalah Drupal 8/9. Tidak ada JSON:API (endpoint /jsonapi mengembalikan
404 HTML), jadi jalur resmi adalah View bernama `search_peraturan` di
/index-peraturan — 5 baris per halaman, paginasi ?page=0..N.

Temuan penting yang membentuk seluruh strategi:
  * Halaman detail menyimpan TEKS LENGKAP peraturan sebagai HTML bersih di
    field `field--name-field-body-dalam-html`. Untuk dokumen pasca-2000,
    OCR tidak diperlukan sama sekali.
  * Dokumen pra-2000 umumnya hanya punya metadata (judul, nomor, tanggal,
    status, kategori, tag) tanpa badan teks -> perlu sumber sekunder + OCR.
  * Lampiran diterbitkan terpisah di /sites/default/files/lampiran/*.pdf dan
    (untuk terbitan modern) sudah memiliki text layer.
"""
from __future__ import annotations

import hashlib
import html
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from urllib.parse import quote, urljoin

import httpx
from selectolax.parser import HTMLParser

from . import db
from .config import (BASE, INDEX_PATH, MAX_WORKERS, PDF_DIR, RAW_HTML,
                     REQUEST_DELAY, RETRIES, TIMEOUT, UA)
from .normalize import identity_from_body, jenis_to_code, normalize_nomor

# --- selector yang diverifikasi terhadap HTML asli -------------------------
SEL_ROW = "div.peraturan-content"
SEL_ROW_NOMOR = "div.views-field-field-nomor-dokumen a"
SEL_ROW_JUDUL = "div.views-field-title .field-content"
SEL_ROW_JENIS = "span.views-field-field-jenis-dokumen .field-content"
SEL_ROW_STATUS = "span.views-field-field-status-peraturan .field-content"

SEL_BODY = "div.field--name-field-body-dalam-html"
SEL_NOMOR = ".field--name-field-nomor-dokumen"
SEL_JENIS = ".field--name-field-jenis-dokumen"
SEL_TANGGAL = ".field--name-field-tanggal-peraturan"
SEL_STATUS = ".field--name-field-status-peraturan"
SEL_KATEGORI = ".field--name-field-kategori-peraturan"
SEL_TAG = ".field--name-field-tag-peraturan"

RE_LAMPIRAN = re.compile(r'href="([^"]*/sites/default/files/[^"]*\.(?:pdf|PDF|zip|docx?|xlsx?))"')
RE_TAG_TERM = re.compile(r'href="(/id/taxonomy/term/(\d+))"[^>]*>([^<]*)</a>')


class TidakDitemukan(Exception):
    """Sumber menjawab 4xx — dokumen memang tidak ada di sana."""


# ---------------------------------------------------------------------------
@dataclass
class Fetcher:
    """Klien HTTP sopan: 1 req/detik, retry eksponensial, cache di disk."""
    delay: float = REQUEST_DELAY
    _last: float = field(default=0.0, repr=False)

    def __post_init__(self):
        self.client = httpx.Client(
            headers={"User-Agent": UA, "Accept-Language": "id,en;q=0.8"},
            timeout=TIMEOUT, follow_redirects=True, http2=False,
        )

    def get(self, url: str, cache_key: str | None = None, refresh=False) -> str:
        # Cache disimpan ter-gzip: HTML Drupal mampat ke ~17% ukuran aslinya,
        # jadi cache seluruh korpus turun dari ~860 MB menjadi ~150 MB. Berkas
        # .html lama tetap dibaca agar cache yang sudah ada tidak terbuang.
        if cache_key:
            pz = RAW_HTML / f"{cache_key}.html.gz"
            if pz.exists() and not refresh:
                import gzip
                with gzip.open(pz, "rt", encoding="utf-8", errors="replace") as fh:
                    return fh.read()
            p = RAW_HTML / f"{cache_key}.html"
            if p.exists() and not refresh:
                return p.read_text("utf-8", errors="replace")
        gap = time.monotonic() - self._last
        if gap < self.delay:
            time.sleep(self.delay - gap)
        last_err = None
        for attempt in range(RETRIES):
            try:
                r = self.client.get(url)
                self._last = time.monotonic()
                if r.status_code == 200:
                    text = r.text
                    if cache_key:
                        import gzip
                        with gzip.open(RAW_HTML / f"{cache_key}.html.gz", "wt",
                                       encoding="utf-8") as fh:
                            fh.write(text)
                    return text
                if r.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError("retryable", request=r.request, response=r)
                # 4xx bersifat final: mengulanginya tidak akan mengubah jawaban.
                # Sebelum ini setiap 404 menghabiskan 19 detik (backoff 2+3+5+9)
                # sebelum menyerah — dan peraturan.go.id membalas 404 untuk
                # setiap slug yang tidak ada, sehingga ribuan dokumen yang wajar
                # tidak ketemu justru menjadi penyebab utama pipeline melambat.
                if 400 <= r.status_code < 500:
                    raise TidakDitemukan(f"{r.status_code} {url}")
                r.raise_for_status()
            except TidakDitemukan:
                raise                                       # jangan diulang
            except Exception as e:                          # noqa: BLE001
                last_err = e
                time.sleep(2 ** attempt + 1)
        raise RuntimeError(f"gagal mengambil {url}: {last_err}")

    def download(self, url: str, dest) -> int:
        gap = time.monotonic() - self._last
        if gap < self.delay:
            time.sleep(self.delay - gap)
        with self.client.stream("GET", url) as r:
            r.raise_for_status()
            n = 0
            with open(dest, "wb") as fh:
                for chunk in r.iter_bytes(65536):
                    fh.write(chunk)
                    n += len(chunk)
        self._last = time.monotonic()
        return n


def _txt(node) -> str:
    return re.sub(r"\s+", " ", node.text(strip=True)) if node is not None else ""


# --- 1. Crawl indeks -------------------------------------------------------
def index_url(page: int, *, tgl_min: str | None = None, tgl_max: str | None = None) -> str:
    q = [f"page={page}"]
    if tgl_min:
        q.append(f"field_tanggal_peraturan_value%5Bmin%5D={quote(tgl_min)}")
    if tgl_max:
        q.append(f"field_tanggal_peraturan_value%5Bmax%5D={quote(tgl_max)}")
    return f"{BASE}{INDEX_PATH}?" + "&".join(q)


def parse_index_page(html_text: str) -> list[dict]:
    tree = HTMLParser(html_text)
    rows = []
    for node in tree.css(SEL_ROW):
        a = node.css_first(SEL_ROW_NOMOR)
        if a is None:
            continue
        href = a.attributes.get("href", "")
        # Situs kadang menyisipkan /index.php di URL — samakan.
        href = href.replace("/index.php/", "/")
        t = node.css_first("time")
        rows.append({
            "nomor_raw": _txt(a),
            "url": urljoin(BASE, href),
            "judul": _txt(node.css_first(SEL_ROW_JUDUL)),
            "jenis": _txt(node.css_first(SEL_ROW_JENIS)),
            "tanggal": (t.attributes.get("datetime", "")[:10] if t is not None else None),
            "status_site": _txt(node.css_first(SEL_ROW_STATUS)),
        })
    return rows


def last_page(fetcher: Fetcher, **kw) -> int:
    """Nomor halaman terakhir dari pager Drupal.

    Perhatikan `&amp;` di dalam atribut href: pola `[?&]page=` tidak akan
    cocok karena karakter sebelum 'page' adalah ';'. Entitas HTML harus
    dinormalkan lebih dulu, kalau tidak seluruh crawl terfilter berhenti di
    halaman 0 tanpa error.
    """
    h = html.unescape(fetcher.get(index_url(0, **kw), cache_key=None))
    pages = [int(x) for x in re.findall(r"[?&]page=(\d+)", h)]
    return max(pages) if pages else 0


def crawl_index(conn, fetcher: Fetcher, *, start=0, end=None, refresh=False,
                tgl_min=None, tgl_max=None, progress=print) -> int:
    """Isi tabel regulation dengan metadata dari halaman indeks.

    Filter tanggal opsional memungkinkan pengambilan sebagian korpus tanpa
    menyusuri seluruh 1.260 halaman.
    """
    filt = {"tgl_min": tgl_min, "tgl_max": tgl_max}
    end = end if end is not None else last_page(fetcher, **filt)
    total = 0
    for page in range(start, end + 1):
        ck = (f"index-{page:05d}" if not (tgl_min or tgl_max)
              else f"index-{tgl_min}-{tgl_max}-{page:04d}")
        h = fetcher.get(index_url(page, **filt), cache_key=ck, refresh=refresh)
        rows = parse_index_page(h)
        if not rows:
            progress(f"  halaman {page}: kosong (indeks mungkin bergeser)")
        for r in rows:
            tahun = int(r["tanggal"][:4]) if r["tanggal"] else None
            rid = normalize_nomor(r["nomor_raw"], r["jenis"], tahun)
            key = rid.key if rid else _fallback_key(r)
            conn.execute(
                """INSERT INTO regulation
                     (id,canonical,nomor_raw,jenis,jenis_code,tahun,tanggal,judul,
                      url,status_site,fetched_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
                   ON CONFLICT(id) DO UPDATE SET
                     status_site=excluded.status_site,
                     judul=COALESCE(NULLIF(excluded.judul,''),regulation.judul),
                     url=excluded.url""",
                (key, rid.canonical if rid else r["nomor_raw"], r["nomor_raw"],
                 r["jenis"], jenis_to_code(r["jenis"]), tahun, r["tanggal"],
                 r["judul"], r["url"], r["status_site"]),
            )
            total += 1
        conn.commit()
        if page % 25 == 0:
            progress(f"  halaman {page}/{end} — {total} dokumen")
    return total


def _fallback_key(row) -> str:
    """Kunci cadangan bila nomor tidak dapat diurai — tandai untuk tinjauan."""
    seed = f"{row['nomor_raw']}|{row['tanggal']}|{row['url']}"
    return "unparsed-" + hashlib.sha1(seed.encode()).hexdigest()[:16]


# --- 2. Crawl detail -------------------------------------------------------
def parse_detail(html_text: str) -> dict:
    tree = HTMLParser(html_text)
    body_node = tree.css_first(SEL_BODY)
    body_html = body_node.html if body_node is not None else None

    def field_val(sel):
        n = tree.css_first(sel)
        if n is None:
            return ""
        item = n.css_first(".field__item")
        return _txt(item if item is not None else n)

    tanggal = field_val(SEL_TANGGAL)
    if re.match(r"^\d{2}-\d{2}-\d{4}$", tanggal):
        d, m, y = tanggal.split("-")
        tanggal = f"{y}-{m}-{d}"

    tags = []
    tag_node = tree.css_first(SEL_TAG)
    if tag_node is not None:
        for href, term, name in RE_TAG_TERM.findall(tag_node.html or ""):
            code = name.split("-", 1)[0] if re.match(r"^\d{4}-", name) else None
            tags.append({"term_id": term, "tag_name": html.unescape(name).strip(),
                         "tag_code": code})

    lampiran = sorted({urljoin(BASE, u) for u in RE_LAMPIRAN.findall(html_text)
                       if "/lampiran/" in u or "/peraturan" in u.lower()})

    return {
        "body_html": body_html,
        "body_text": _html_to_text(body_html) if body_html else None,
        "nomor_raw": field_val(SEL_NOMOR),
        "jenis": field_val(SEL_JENIS),
        "tanggal": tanggal or None,
        "status_site": field_val(SEL_STATUS),
        "kategori": field_val(SEL_KATEGORI),
        "tags": tags,
        "lampiran": lampiran,
    }


def _html_to_text(h: str) -> str:
    tree = HTMLParser(h)
    for tag in ("script", "style"):
        for n in tree.css(tag):
            n.decompose()
    # Pertahankan batas blok agar pembagian pasal tidak menyatu.
    for n in tree.css("br, p, div, tr, li, h1, h2, h3, h4"):
        n.insert_after("\n")
    text = tree.text()
    text = html.unescape(text)
    text = re.sub(r"[ \t\xa0]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip()


def crawl_details(conn, fetcher: Fetcher, *, limit=None, refresh=False,
                  only_missing=True, progress=print) -> int:
    q = "SELECT id,url,tahun FROM regulation WHERE url IS NOT NULL"
    if only_missing:
        q += " AND (body_text IS NULL AND has_body=0)"
    q += " ORDER BY tahun DESC, id"
    if limit:
        q += f" LIMIT {int(limit)}"
    rows = conn.execute(q).fetchall()
    done = 0
    for row in rows:
        try:
            h = fetcher.get(row["url"], cache_key=f"det-{row['id']}", refresh=refresh)
        except Exception as e:                            # noqa: BLE001
            progress(f"  ! {row['id']}: {e}")
            continue
        d = parse_detail(h)
        # Periksa silang identitas terhadap kop surat dokumen.
        body_id = identity_from_body(d["body_text"] or "", row["tahun"])
        ok = None
        if body_id:
            ok = 1 if body_id.key == row["id"] else 0
        conn.execute(
            """UPDATE regulation SET body_text=?, has_body=?, kategori=?,
                   status_site=COALESCE(NULLIF(?,''),status_site),
                   tanggal=COALESCE(?,tanggal),
                   id_body=?, canonical_body=?, identity_ok=?,
                   sha256=?, fetched_at=datetime('now') WHERE id=?""",
            (d["body_text"], 1 if d["body_text"] else 0, d["kategori"],
             d["status_site"], d["tanggal"],
             body_id.key if body_id else None,
             body_id.canonical if body_id else None, ok,
             hashlib.sha256((d["body_text"] or "").encode()).hexdigest(), row["id"]),
        )
        conn.execute("DELETE FROM reg_tag WHERE reg_id=?", (row["id"],))
        for t in d["tags"]:
            conn.execute(
                "INSERT OR IGNORE INTO reg_tag(reg_id,tag_code,tag_name,term_id)"
                " VALUES (?,?,?,?)",
                (row["id"], t["tag_code"], t["tag_name"], t["term_id"]))
        for url in d["lampiran"]:
            aid = hashlib.sha1(url.encode()).hexdigest()[:16]
            conn.execute(
                "INSERT OR IGNORE INTO attachment(id,reg_id,url,route)"
                " VALUES (?,?,?,'pending')", (aid, row["id"], url))
        done += 1
        if done % 50 == 0:
            conn.commit()
            progress(f"  {done}/{len(rows)} detail diambil")
    conn.commit()
    return done


def download_attachments(conn, fetcher: Fetcher, limit=None, progress=print) -> int:
    q = "SELECT id,url FROM attachment WHERE local_path IS NULL"
    if limit:
        q += f" LIMIT {int(limit)}"
    n = 0
    for row in conn.execute(q).fetchall():
        dest = PDF_DIR / f"{row['id']}.pdf"
        try:
            size = fetcher.download(row["url"], dest)
        except Exception as e:                            # noqa: BLE001
            progress(f"  ! lampiran {row['id']}: {e}")
            continue
        conn.execute("UPDATE attachment SET local_path=? WHERE id=?",
                     (str(dest), row["id"]))
        n += 1
        if n % 20 == 0:
            conn.commit()
    conn.commit()
    return n


# --- 3. Crawl inkremental --------------------------------------------------
def crawl_recent(conn, fetcher: Fetcher, days=30, progress=print) -> int:
    """Untuk penjadwalan harian: hanya rentang tanggal terakhir.

    Filter tanggal (`field_tanggal_peraturan_value[min|max]`) lebih stabil
    daripada filter tahun, yang memakai indeks delta (1=tahun berjalan) dan
    bergeser maknanya setiap pergantian tahun.
    """
    tgl_min = (date.today() - timedelta(days=days)).isoformat()
    tgl_max = (date.today() + timedelta(days=1)).isoformat()
    end = last_page(fetcher, tgl_min=tgl_min, tgl_max=tgl_max)
    total = 0
    for page in range(end + 1):
        h = fetcher.get(index_url(page, tgl_min=tgl_min, tgl_max=tgl_max))
        for r in parse_index_page(h):
            tahun = int(r["tanggal"][:4]) if r["tanggal"] else None
            rid = normalize_nomor(r["nomor_raw"], r["jenis"], tahun)
            key = rid.key if rid else _fallback_key(r)
            cur = conn.execute("SELECT status_site FROM regulation WHERE id=?", (key,)).fetchone()
            conn.execute(
                """INSERT INTO regulation
                     (id,canonical,nomor_raw,jenis,jenis_code,tahun,tanggal,judul,
                      url,status_site,fetched_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
                   ON CONFLICT(id) DO UPDATE SET status_site=excluded.status_site""",
                (key, rid.canonical if rid else r["nomor_raw"], r["nomor_raw"],
                 r["jenis"], jenis_to_code(r["jenis"]), tahun, r["tanggal"],
                 r["judul"], r["url"], r["status_site"]))
            if cur is None or cur["status_site"] != r["status_site"]:
                total += 1
                progress(f"  baru/berubah: {r['nomor_raw']} [{r['status_site']}]")
    conn.commit()
    return total
