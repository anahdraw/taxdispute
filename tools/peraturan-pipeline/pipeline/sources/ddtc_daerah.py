"""DDTC Perpajakan — konektor peraturan pajak daerah.

Modul tetangganya, `ddtc.py`, sengaja bukan konektor: percobaan pertama dahulu
mengembalikan status "Berlaku" untuk alamat yang jelas-jelas palsu, karena kata
itu berasal dari kerangka halaman dan bukan dari dokumennya. Catatan itu masih
berlaku dan dijaga di sana.

Yang berubah di sini bukan sikapnya, melainkan apa yang ditemukan: untuk
peraturan pajak **daerah**, DDTC menyajikan daftar dan naskahnya di dalam
payload React Server Component yang ikut terkirim pada HTML — terstruktur,
lengkap, dan tanpa perlu masuk. Jadi yang dibaca di sini adalah data, bukan
kerangka; dan setiap dokumen wajib melewati `_sah()` sebelum diterima, tepat
supaya kekeliruan lama tidak terulang dalam bentuk lain.

**Mengapa daerah butuh sumber sendiri.** Ortax mencatat peraturan daerah tanpa
daerahnya. Akibatnya "Perda 1 Tahun 2024" dari Bali dan dari Buleleng menjadi
satu identitas — 28 tabrakan pada 532 dokumen, 56 naskah yang saling menimpa —
dan sebagian bahkan salah bentuk ("peraturan bupati" bertanda PERDA). DDTC
menyimpan daerahnya pada slug, pada judul tampilan, dan pada taksonominya, jadi
identitasnya dapat dibuat utuh.

**Batas yang dijaga.** Yang diambil hanya halaman yang terbuka tanpa masuk.
Tidak ada kredensial yang dipakai, tidak ada halaman berlangganan yang disentuh.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field

PENCARIAN = ("https://perpajakan.ddtc.co.id/id/sumber-hukum/peraturan/"
             "pencarian?kategori=daerah")
DOKUMEN = "https://perpajakan.ddtc.co.id/id/sumber-hukum/peraturan-daerah/{slug}"

# Paginasi berhenti di 100 hasil (10 halaman) apa pun jumlah sebenarnya. Itu
# sebabnya penelusuran dipotong per daerah, bukan dijalankan sebagai satu daftar
# 8.285 baris — dan sebabnya `total_data` di payload harus selalu diperiksa
# terhadap batas ini, agar pemotongan yang masih kurang halus terlihat sebagai
# peringatan alih-alih lewat sebagai "sudah lengkap".
PER_HALAMAN = 10
BATAS_HASIL = 100


def sesi():
    from curl_cffi import requests
    return requests.Session(impersonate="chrome")


def _flight(html: str) -> str:
    """Rangkai kembali payload RSC yang terserak pada `self.__next_f.push`."""
    keping = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    return "".join(keping).encode("utf-8", "replace").decode("unicode_escape",
                                                             "replace")


# ---------------------------------------------------------------------------
# Taksonomi daerah

RE_PROV = re.compile(
    r'\{"id":"(parent_\d+)","value":"[^"]*","title":"((?:[^"\\]|\\.)*)",'
    r'"childs":\[(.*?)\]')
RE_ANAK = re.compile(r'\{"id":"(\d+)","value":"\d+","title":"((?:[^"\\]|\\.)*)"\}')


@dataclass
class Daerah:
    id: str
    nama: str
    provinsi: str


def daftar_daerah(s) -> list[Daerah]:
    """553 daerah beserta provinsinya, dibaca dari taksonomi di halaman cari."""
    raw = _flight(s.get(PENCARIAN, timeout=60).text)
    out: list[Daerah] = []
    for m in RE_PROV.finditer(raw):
        prov = m.group(2)
        for i, nama in RE_ANAK.findall(m.group(3)):
            out.append(Daerah(i, nama, prov))
    return out


# ---------------------------------------------------------------------------
# Penelusuran daftar

RE_KEPALA = re.compile(
    r'\{"title":"((?:[^"\\]|\\.)*)","jenis_peraturan":"((?:[^"\\]|\\.)*)",'
    r'"nomor":"((?:[^"\\]|\\.)*)","locale":"[^"]*",'
    r'"target_url":"(/id/sumber-hukum/peraturan-daerah/[^"]+)"\}')
RE_TOTAL = re.compile(r'"total_data":(\d+),"total_page":(\d+),'
                      r'"total_data_limit":(\d+)')
RE_JUDUL = re.compile(r'"description":"((?:[^"\\]|\\.)*)"')
RE_STATUS = re.compile(r'"status":"((?:[^"\\]|\\.)*)"')
RE_BERLAKU = re.compile(r'"date_berlaku":"\$D([0-9T:\-.]+Z)"')
PISAH = re.compile(r'\{"image":"https://')


@dataclass
class Baris:
    slug: str
    tampilan: str          # "Perda Kabupaten Buleleng Nomor: 9 Tahun 2023"
    jenis_teks: str        # "Peraturan Daerah"
    nomor_teks: str        # "9 Tahun 2023"
    judul: str = ""
    status: str = ""
    tanggal: str | None = None
    daerah: str = ""
    provinsi: str = ""


def _bersih(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace('\\"', '"')).strip()


def _urai_daftar(raw: str) -> tuple[list[Baris], dict]:
    m = RE_TOTAL.search(raw)
    info = {"total": int(m.group(1)), "halaman": int(m.group(2)),
            "batas": int(m.group(3))} if m else {}
    out: list[Baris] = []
    for keping in PISAH.split(raw):
        k = RE_KEPALA.search(keping)
        if not k:
            continue
        tampilan, jenis, nomor, url = (_bersih(x) for x in k.groups())
        ekor = keping[k.end():]
        j = RE_JUDUL.search(ekor)
        st = RE_STATUS.search(ekor)
        tg = RE_BERLAKU.search(keping)
        out.append(Baris(
            slug=url.rsplit("/", 1)[-1], tampilan=tampilan, jenis_teks=jenis,
            nomor_teks=nomor, judul=_bersih(j.group(1)) if j else "",
            status=_bersih(st.group(1)) if st else "",
            tanggal=tg.group(1)[:10] if tg else None))
    return out, info


TAHUN_AWAL = 1970


def _halaman(s, u: str, jeda: float) -> tuple[list[Baris], dict]:
    """Semua halaman satu kueri, sampai habis atau sampai mentok di 100."""
    kumpul: dict[str, Baris] = {}
    info: dict = {}
    for p in range(1, BATAS_HASIL // PER_HALAMAN + 1):
        baris, i = _urai_daftar(_flight(
            s.get(u + (f"&p={p}" if p > 1 else ""), timeout=60).text))
        info = info or i
        baru = [b for b in baris if b.slug not in kumpul]
        for b in baru:
            kumpul[b.slug] = b
        if not baru or (info.get("halaman") and p >= info["halaman"]):
            break
        time.sleep(jeda)
    return list(kumpul.values()), info


def telusuri(s, daerah: Daerah, jeda: float = 0.6,
             tahun_kini: int = 2026) -> tuple[list[Baris], dict]:
    """Semua peraturan satu daerah, dipotong per tahun bila perlu.

    Daftar mentok di 100 hasil, sedangkan satu daerah bisa punya 279. Karena itu
    rentang tahunnya dibelah dua selama jumlahnya masih melebihi batas — bukan
    ditelusuri tahun demi tahun. Provinsi Jakarta jadi butuh belasan permintaan,
    bukan 57; dan daerah yang di bawah batas tetap cukup satu.
    """
    dasar = f"{PENCARIAN}&daerah={daerah.id}"
    kumpul: dict[str, Baris] = {}
    catat = {"permintaan": 0, "mentok": []}

    def jelajah(a: int | None, z: int | None) -> None:
        u = dasar if a is None else f"{dasar}&from={a}&to={z}"
        baris, i = _halaman(s, u, jeda)
        catat["permintaan"] += 1
        for b in baris:
            kumpul.setdefault(b.slug, b)
        total, batas = i.get("total", 0), i.get("batas", BATAS_HASIL)
        if total <= batas:
            return
        # Masih mentok. Belah rentangnya; bila sudah tidak bisa dibelah lagi,
        # katakan — jangan biarkan angka yang terpotong terbaca sebagai lengkap.
        a2, z2 = (TAHUN_AWAL, tahun_kini) if a is None else (a, z)
        if a2 >= z2:
            catat["mentok"].append((a2, z2, total))
            return
        tengah = (a2 + z2) // 2
        time.sleep(jeda)
        jelajah(a2, tengah)
        time.sleep(jeda)
        jelajah(tengah + 1, z2)

    jelajah(None, None)
    for b in kumpul.values():
        b.daerah, b.provinsi = daerah.nama, daerah.provinsi
    catat["diambil"] = len(kumpul)
    return list(kumpul.values()), catat


# ---------------------------------------------------------------------------
# Naskah

RE_TAG = re.compile(r"<[^>]+>")
RE_BARIS = re.compile(r"</(?:tr|p|h[1-6]|li|div)>|<br\s*/?>", re.I)
RE_SEL = re.compile(r"</t[dh]>", re.I)
RE_ISI = re.compile(r'<div[^>]+id="detail__content"(.*)', re.S)
RE_MULAI = re.compile(r"Mulai berlaku pada tanggal\s+([0-9]{1,2}\s+\w+\s+\d{4})")


def _teks(html: str) -> str:
    """Tabel HTML → naskah berbaris, penanda huruf/angka tetap di tempatnya.

    Inilah keunggulan sumber ini dibanding Ortax, yang mengirim naskah tanpa
    satu pun baris baru sehingga seluruh dokumen menjadi satu unit. Di sini
    batas barisnya sudah ada di markup; yang perlu hanya tidak menghapusnya.
    """
    h = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    h = RE_SEL.sub("\t", h)
    h = RE_BARIS.sub("\n", h)
    t = RE_TAG.sub("", h)
    import html as _h
    t = _h.unescape(t)
    # Penanda pada selnya sendiri ("a.\tbahwa …") dirapatkan menjadi satu baris.
    t = re.sub(r"[ \t]*\t[ \t]*", " ", t)
    t = re.sub(r"[ \u00a0]+", " ", t)
    t = re.sub(r" *\n *", "\n", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


@dataclass
class Dokumen:
    slug: str
    judul: str = ""          # perihal, mis. "PAJAK DAERAH DAN RETRIBUSI DAERAH"
    tampilan: str = ""       # "Peraturan Gubernur Provinsi Bali Nomor: 14 Tahun 2026"
    nomor_teks: str = ""     # "14 Tahun 2026"
    tahun: int | None = None
    status: str = ""
    tanggal: str | None = None
    naskah: str = ""
    penanda: list[str] = field(default_factory=list)
    kepala: str = ""


# Objek metadata dokumen di dalam payload; dibaca sebagai JSON, bukan diraih
# dengan regex per medan. Halaman ini memuatnya utuh — judul, perihal, nomor,
# tahun, tanggal efektif, dan status — jadi tidak ada alasan menebak dari
# markup, tempat percobaan pertama tadi memungut nama menu sebagai status.
RE_META = re.compile(r'\{"slug":"([a-z0-9\-]+)","data":\{')


def _objek(raw: str, mulai: int) -> dict | None:
    """Ambil satu objek JSON berimbang mulai dari kurung buka di `mulai`."""
    dalam = 0
    petik = False
    lolos = False
    for i in range(mulai, len(raw)):
        c = raw[i]
        if lolos:
            lolos = False
            continue
        if c == "\\":
            lolos = True
        elif c == '"':
            petik = not petik
        elif not petik:
            if c == "{":
                dalam += 1
            elif c == "}":
                dalam -= 1
                if dalam == 0:
                    try:
                        return json.loads(raw[mulai:i + 1])
                    except json.JSONDecodeError:
                        return None
    return None


def _meta(raw: str, slug: str) -> dict | None:
    for m in RE_META.finditer(raw):
        if m.group(1) != slug:
            continue
        o = _objek(raw, m.end() - 1)
        if o:
            return o
    return None


def _sah(d: Dokumen, slug: str) -> tuple[bool, str]:
    """Terima hanya bila dokumennya sungguh ada, bukan cangkang halaman.

    Modul tetangga `ddtc.py` mencatat kekeliruan yang membuat penjaga ini ada:
    dahulu alamat yang jelas-jelas palsu pun mengembalikan "Berlaku", karena
    kata itu milik kerangka halaman. Karena itu syaratnya positif semuanya —
    metadata dokumen ada dan slug-nya cocok, naskahnya panjang, dan penanda
    strukturnya ada. Satu syarat gagal, dokumennya ditolak.
    """
    if not d.tampilan:
        return False, "tanpa metadata"
    if len(d.naskah) < 400:
        return False, f"naskah {len(d.naskah)} aksara"
    if not d.penanda:
        return False, "tanpa penanda struktur"
    return True, ""


def ambil_dokumen(s, slug: str) -> Dokumen | None:
    """Satu dokumen daerah, atau None bila tidak lolos `_sah`."""
    r = s.get(DOKUMEN.format(slug=slug), timeout=90)
    if r.status_code != 200:
        return None
    b = r.text
    m = RE_ISI.search(b)
    naskah = _teks(m.group(1)) if m else ""
    d = Dokumen(slug=slug, naskah=naskah,
                penanda=re.findall(r'<h[23] id="([^"]+)"', b))
    d.kepala = "\n".join(naskah.split("\n")[:6])
    o = _meta(_flight(b), slug) or {}
    d.tampilan = _bersih(o.get("title") or "")
    d.judul = _bersih(o.get("subtitle") or "")
    d.nomor_teks = _bersih(o.get("nomor") or "")
    d.tahun = o.get("tahun")
    st = o.get("status") or {}
    d.status = _bersih(st.get("title") or "") if isinstance(st, dict) else ""
    tg = o.get("tanggal_efektif") or o.get("publish_date") or ""
    d.tanggal = tg[:10] if isinstance(tg, str) and len(tg) >= 10 else None
    ok, _ = _sah(d, slug)
    return d if ok else None
