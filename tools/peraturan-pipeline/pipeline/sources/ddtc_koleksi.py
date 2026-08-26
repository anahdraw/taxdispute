"""DDTC Perpajakan — konektor koleksi peraturan, pusat dan daerah.

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

**Pusat ikut terbuka.** Dugaan semula — naskah pusat berada di balik langganan —
ternyata keliru, dan kelirunya berasal dari tekniknya: yang dibaca dahulu adalah
markup yang dirakit JavaScript, bukan payload yang sudah ikut terkirim. Dengan
payload itu, PMK 72/2023 memberi 48.685 aksara naskah beserta status "Berlaku".
Katalog pusatnya 15.761 dokumen — angka yang layak dibandingkan dengan korpus.

**Batas yang dijaga.** Yang diambil hanya halaman yang terbuka tanpa masuk.
Tidak ada kredensial yang dipakai, tidak ada halaman berlangganan yang disentuh.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field

SITUS = "https://perpajakan.ddtc.co.id"
CARI = SITUS + "/id/sumber-hukum/peraturan/pencarian?kategori={kategori}"
PENCARIAN = CARI.format(kategori="daerah")   # jalan pintas untuk taksonomi daerah

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
    """Rangkai kembali payload RSC yang terserak pada `self.__next_f.push`.

    Kepingnya adalah isi literal string JavaScript, jadi yang benar melepasnya
    sebagai JSON — bukan lewat `unicode_escape`, yang memperlakukan tiap byte
    sebagai Latin-1 dan merusak setiap aksara non-ASCII. Kerusakannya nyaris
    tak terlihat pada naskah berbahasa Indonesia yang hampir seluruhnya ASCII;
    ia muncul sebagai "34 Tahun 2005Â" — satu spasi tanpa-pemisah yang cukup
    untuk membuat nomornya gagal diurai.
    """
    keping = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    out = []
    for k in keping:
        try:
            out.append(json.loads(f'"{k}"'))
        except json.JSONDecodeError:
            # Keping yang tidak utuh sebagai JSON dipakai apa adanya: lebih baik
            # satu keping mentah daripada seluruh payload hilang.
            out.append(k)
    return "".join(out)


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
    r'"target_url":"(/id/sumber-hukum/peraturan-(?:pusat|daerah)/[^"]+)"\}')
RE_TOTAL = re.compile(r'"total_data":(\d+),"total_page":(\d+),'
                      r'"total_data_limit":(\d+)')
RE_JUDUL = re.compile(r'"description":"((?:[^"\\]|\\.)*)"')
RE_STATUS = re.compile(r'"status":"((?:[^"\\]|\\.)*)"')
RE_BERLAKU = re.compile(r'"date_berlaku":"\$D([0-9T:\-.]+Z)"')


@dataclass
class Baris:
    slug: str
    kanal: str
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
    """Baca kartu-kartu hasil dari payload RSC.

    Kartunya tidak dipotong lewat penanda pembuka: kartu daerah punya medan
    `image`, kartu pusat tidak, dan memotong lewat medan yang hanya ada di satu
    sisi membuat sisi lain terbaca satu baris saja — sepuluh hasil per halaman
    menyusut menjadi satu, dan 35 Inpres menjadi 4. Yang dipakai di sini adalah
    jendela di antara kecocokan kepala kartu, yang ada di kedua sisi.

    Tanggal berlaku mendahului kepala kartu, sedangkan perihal dan status
    mengikutinya — jadi keduanya dicari di jendela yang berbeda.
    """
    m = RE_TOTAL.search(raw)
    info = {"total": int(m.group(1)), "halaman": int(m.group(2)),
            "batas": int(m.group(3))} if m else {}
    kepala = list(RE_KEPALA.finditer(raw))
    out: list[Baris] = []
    for i, k in enumerate(kepala):
        tampilan, jenis, nomor, url = (_bersih(x) for x in k.groups())
        maju = raw[k.end():kepala[i + 1].start() if i + 1 < len(kepala)
                   else min(len(raw), k.end() + 4000)]
        surut = raw[kepala[i - 1].end() if i else max(0, k.start() - 4000):k.start()]
        j, st, tg = (RE_JUDUL.search(maju), RE_STATUS.search(maju),
                     RE_BERLAKU.search(surut))
        out.append(Baris(
            slug=url.rsplit("/", 1)[-1], kanal=url.split("/")[-2],
            tampilan=tampilan, jenis_teks=jenis, nomor_teks=nomor,
            judul=_bersih(j.group(1)) if j else "",
            status=_bersih(st.group(1)) if st else "",
            tanggal=tg.group(1)[:10] if tg else None))
    return out, info


# Sengaja jauh ke belakang. Dengan batas 1970, penelusuran UU berhenti di
# 325 dari 352 — 27 yang hilang adalah undang-undang sebelum 1970, termasuk
# UU Darurat 1951 dan warisan kolonial yang masih dirujuk. Kekurangan itu tidak
# tampak sebagai galat; ia tampak sebagai daftar yang sudah selesai.
TAHUN_AWAL = 1800
TAHUN_KINI = 2026


# Urutan hasil dapat dibalik. Itu penting: daftar mentok di 100 hasil, tetapi
# 100 pertama menurut tanggal naik dan 100 pertama menurut tanggal turun adalah
# dua irisan yang berbeda. Untuk potongan yang tidak dapat dibelah lebih halus
# lagi — satu bentuk pada satu tahun — dua arah menaikkan jangkauannya menjadi
# 200 tanpa filter tambahan apa pun.
URUT_NAIK = "&sort=tgl_berlaku&order=ASC"
URUT_TURUN = "&sort=tgl_berlaku&order=DESC"


def _halaman(s, u: str, jeda: float, arah: str = "") -> tuple[list[Baris], dict]:
    """Semua halaman satu kueri, sampai habis atau sampai mentok di 100."""
    kumpul: dict[str, Baris] = {}
    info: dict = {}
    for p in range(1, BATAS_HASIL // PER_HALAMAN + 1):
        baris, i = _urai_daftar(_flight(
            s.get(u + arah + (f"&p={p}" if p > 1 else ""), timeout=60).text))
        info = info or i
        baru = [b for b in baris if b.slug not in kumpul]
        for b in baru:
            kumpul[b.slug] = b
        if not baru or (info.get("halaman") and p >= info["halaman"]):
            break
        time.sleep(jeda)
    return list(kumpul.values()), info


RE_ANGKA_POKOK = re.compile(r"^\D*0*(\d+)")


def _lengkapi_nomor(s, dasar: str, potong: dict, total: int,
                    jeda: float) -> list[int]:
    """Tambal potongan yang masih kurang dengan pencarian nomor tepat.

    Dipakai hanya sebagai jalan terakhir: satu bentuk pada satu tahun yang
    jumlahnya melebihi 200, sehingga dua arah urutan pun tidak menjangkaunya.
    PMK punya 3.516 dokumen di 23 tahun — rata-rata 153 setahun — jadi tanpa
    tahap ini yang hilang ribuan, bukan puluhan.

    `potong` adalah himpunan milik POTONGAN ini saja — satu bentuk pada satu
    tahun — bukan seluruh hasil penelusuran. Membandingkan jumlah global dengan
    `total` satu tahun membuat syarat berhentinya langsung terpenuhi, dan
    penambalan berhenti sebelum dimulai: PMK terkumpul 3.202 dari 3.516 dengan
    laporan "tambal 0", seolah tidak ada yang perlu ditambal.

    Yang dicari bukan seluruh nomor dari 1 sampai tertinggi, melainkan **nomor
    yang tidak ada** di antara yang sudah terkumpul. Untuk PMK 2008 itu 53
    permintaan, bukan 253. Kueri `nomor:` mencocokkan nomor secara utuh, jadi
    satu permintaan mengembalikan tepat satu dokumen bila ada.
    """
    punya = set()
    for b in potong.values():
        m = RE_ANGKA_POKOK.match(b.nomor_teks or "")
        if m:
            punya.add(int(m.group(1)))
    if not punya:
        return []
    lubang = [n for n in range(1, max(punya) + 1) if n not in punya]
    # Penambalan dibatasi. Bila penomoran satu tahun renggang — nomor mencapai
    # ratusan padahal dokumennya seratus — jumlah lubang jauh melampaui
    # kekurangannya, dan mengejarnya satu per satu menukar kelengkapan dengan
    # waktu yang tak terbatas. Batasnya beberapa kali kekurangan itu; sisanya
    # dilaporkan sebagai kurang, bukan dikejar tanpa ujung.
    sisa = max(0, total - len(potong))
    batas = max(60, sisa * 4)
    catat = []
    for n in lubang[:batas]:
        if len(potong) >= total:
            break
        baris, _ = _urai_daftar(_flight(
            s.get(f"{dasar}&q=nomor:{n}", timeout=60).text))
        for b in baris:
            potong.setdefault(b.slug, b)
        catat.append(n)
        time.sleep(jeda)
    return catat


def _jelajah(s, dasar: str, jeda: float,
             tahun_kini: int = TAHUN_KINI) -> tuple[list[Baris], dict]:
    """Satu potongan katalog, rentang tahunnya dibelah dua selama masih mentok.

    Daftar mentok di 100 hasil apa pun jumlah sebenarnya. Karena itu rentang
    tahunnya dibelah — bukan ditelusuri tahun demi tahun. Provinsi Jakarta yang
    punya 279 dokumen jadi butuh 9 permintaan, bukan 57; dan daerah yang di
    bawah batas tetap cukup satu.
    """
    kumpul: dict[str, Baris] = {}
    catat: dict = {"permintaan": 0, "mentok": []}

    def turun(a: int | None, z: int | None) -> None:
        u = dasar if a is None else f"{dasar}&from={a}&to={z}"
        baris, i = _halaman(s, u, jeda)
        catat["permintaan"] += 1
        if catat.get("total") is None:
            catat["total"] = i.get("total")
        # Himpunan milik potongan ini sendiri. Menghitung kelengkapan terhadap
        # `kumpul` yang global membandingkan ribuan dokumen dari seluruh tahun
        # dengan `total` satu tahun — dan perbandingan itu selalu terpenuhi,
        # sehingga setiap langkah pelengkap dilewati tanpa jejak.
        potong: dict[str, Baris] = {b.slug: b for b in baris}
        total, batas = i.get("total", 0), i.get("batas", BATAS_HASIL)
        if total <= batas:
            kumpul.update({k: v for k, v in potong.items()
                           if k not in kumpul})
            return
        a2, z2 = (TAHUN_AWAL, tahun_kini) if a is None else (a, z)
        if a2 >= z2:
            # Satu tahun, masih melebihi batas, dan rentangnya tidak dapat
            # dibelah lagi. Sebelum menyerah, ambil dari ujung yang lain:
            # urutan dibalik memberi 100 hasil yang berbeda. PMK 2008 punya 253
            # dokumen — dua arah menjangkau 200 di antaranya.
            for arah in (URUT_NAIK, URUT_TURUN):
                lagi, _ = _halaman(s, u, jeda, arah)
                catat["permintaan"] += 1
                for b in lagi:
                    potong.setdefault(b.slug, b)
                time.sleep(jeda)
            if len(potong) < total:
                dicari = _lengkapi_nomor(s, u, potong, total, jeda)
                catat["permintaan"] += len(dicari)
                catat["tambal"] = catat.get("tambal", 0) + len(dicari)
            kumpul.update({k: v for k, v in potong.items()
                           if k not in kumpul})
            if len(potong) < total:
                # Masih kurang setelah dua arah dan penambalan nomor. Katakan
                # berapa — angka yang terpotong tidak boleh terbaca sebagai
                # angka yang lengkap.
                catat["mentok"].append({"dasar": dasar, "tahun": a2,
                                        "total": total, "dapat": len(potong)})
            return
        kumpul.update({k: v for k, v in potong.items() if k not in kumpul})
        tengah = (a2 + z2) // 2
        time.sleep(jeda)
        turun(a2, tengah)
        time.sleep(jeda)
        turun(tengah + 1, z2)

    turun(None, None)
    catat["diambil"] = len(kumpul)
    return list(kumpul.values()), catat


def telusuri(s, daerah: Daerah, jeda: float = 0.6,
             tahun_kini: int = TAHUN_KINI) -> tuple[list[Baris], dict]:
    """Semua peraturan satu daerah."""
    baris, catat = _jelajah(s, f"{PENCARIAN}&daerah={daerah.id}", jeda,
                            tahun_kini)
    for b in baris:
        b.daerah, b.provinsi = daerah.nama, daerah.provinsi
    return baris, catat


# ---------------------------------------------------------------------------
# Sisi pusat: dipotong per bentuk, lalu per tahun bila perlu

RE_JENIS = re.compile(
    r'\{"id":"pusat-(\d+)","value":"\d+","title":"((?:[^"\\]|\\.)*)"\}')


@dataclass
class Bentuk:
    kode: str
    nama: str


def daftar_jenis(s) -> list[Bentuk]:
    """126 bentuk peraturan pusat beserta kodenya, dari taksonomi halaman cari."""
    raw = _flight(s.get(CARI.format(kategori="pusat"), timeout=60).text)
    lihat, out = set(), []
    for kode, nama in RE_JENIS.findall(raw):
        if kode in lihat:
            continue
        lihat.add(kode)
        out.append(Bentuk(kode, _bersih(nama)))
    return out


def telusuri_pusat(s, bentuk: Bentuk, jeda: float = 0.6,
                   tahun_kini: int = TAHUN_KINI) -> tuple[list[Baris], dict]:
    """Semua peraturan pusat satu bentuk."""
    dasar = f"{CARI.format(kategori='pusat')}&jenis={bentuk.kode}"
    return _jelajah(s, dasar, jeda, tahun_kini)


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


def ambil_dokumen(s, slug: str,
                  kanal: str = "peraturan-daerah") -> Dokumen | None:
    """Satu dokumen, atau None bila tidak lolos `_sah`."""
    r = s.get(f"{SITUS}/id/sumber-hukum/{kanal}/{slug}", timeout=90)
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


# ---------------------------------------------------------------------------
# Pembandingan jumlah: ukur dulu, telusuri hanya di mana ada selisih

def jumlah(s, kategori: str, jenis: str | None = None,
           tahun: int | None = None, daerah: str | None = None) -> int:
    """Berapa dokumen pada satu potongan katalog — satu permintaan, tanpa paginasi.

    Menelusuri seluruh katalog pusat menghabiskan jam: bentuk sepadat PMK punya
    3.516 dokumen di 23 tahun, dan setiap tahun yang melebihi 200 menuntut
    penambalan nomor satu per satu. Padahal yang ingin diketahui lebih dahulu
    bukan daftarnya, melainkan apakah ada selisih — dan `total_data` sudah
    menjawabnya dalam satu permintaan. Enumerasi penuh disimpan untuk potongan
    yang selisihnya nyata.
    """
    u = CARI.format(kategori=kategori)
    if jenis:
        u += f"&jenis={jenis}"
    if tahun:
        u += f"&from={tahun}&to={tahun}"
    if daerah:
        u += f"&daerah={daerah}"
    m = RE_TOTAL.search(_flight(s.get(u, timeout=60).text))
    return int(m.group(1)) if m else -1
