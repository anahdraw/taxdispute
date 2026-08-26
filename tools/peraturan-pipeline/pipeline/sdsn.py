"""Parser SDSN — Susunan Dalam Satu Naskah (teks konsolidasi resmi DJP).

**Mengapa dokumen ini penting dan berbeda dari sisa korpus.**

Korpus utama berisi naskah ASLI (UU 6/1983, UU 7/1983, UU 8/1983) dan
undang-undang PENGUBAHnya secara terpisah. Yang tidak dimiliki siapa pun di
korpus itu adalah **teks sebagaimana berbunyi sekarang** — hasil semua
perubahan digabung. Padahal itulah yang dikutip praktisi.

SDSN adalah teks konsolidasi itu, diterbitkan resmi oleh DJP. Ia mengisi
lapisan yang selama ini kosong: `graph.rantai_konsolidasi()` bisa menelusuri
rantai perubahan, tetapi tidak punya naskah gabungannya.

**Penanda bintang = jejak amandemen per ayat.**

Berkas ini memakai konvensi "pakai bintang": setiap ketentuan diberi tanda
`*)` sampai `*******)` yang menunjukkan perubahan keberapa yang melahirkan
rumusan tersebut. Contoh pada UU KUP:

    *)       Perubahan Pertama  (UU 9/1994)
    **)      Perubahan Kedua    (UU 16/2000)
    ***)     Perubahan Ketiga   (UU 28/2007)
    ****)    Perubahan Keempat  (UU 16/2009)
    *****)   Perubahan Kelima   (UU 11/2020)
    ******)  Perubahan Keenam   (UU 7/2021)
    *******) Perubahan Ketujuh  (UU 6/2023)

Ini adalah provenance tingkat ayat — presisi yang tidak tersedia dari sumber
mana pun yang sudah dipakai. Dengan ini pertanyaan "rumusan Pasal 4 ayat (2)
ini berasal dari perubahan yang mana?" dapat dijawab tanpa membandingkan
naskah secara manual.

**Legenda berbeda untuk tiap undang-undang** (KUP punya tujuh perubahan, PBB
hanya satu), jadi legenda diurai per-bagian, bukan sekali untuk seluruh berkas.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path

# --- model leveling --------------------------------------------------------
# Hierarki resmi menurut UU 12/2011 Pasal 1 angka 2 dan lampiran teknisnya.
# Angka level dipakai agar urutan induk-anak dapat dihitung tanpa menebak.
LEVEL = {
    "undang_undang": 0,
    "bab": 1,
    "bagian": 2,
    "paragraf": 3,
    "pasal": 4,
    "ayat": 5,
    "huruf": 6,
    "angka": 7,
}

RE_UU_HEAD = re.compile(
    r"UNDANG-UNDANG\s+REPUBLIK\s+INDONESIA\s+NOMOR\s+(\d+)\s*(?:TAHUN\s*(\d{4}))?",
    re.I)
RE_SDSN = re.compile(r"SUSUNAN\s+DALAM\s+SATU\s+NASKAH", re.I)
# Judul BAB dan PASAL bisa membawa penanda amandemen ("PASAL 9 *******)").
# Menuntut baris berisi judul saja akan membuang pasal-pasal itu sekaligus
# provenance-nya — justru sinyal paling berharga di dokumen ini.
RE_BAB = re.compile(r"^\s*BAB\s+([IVXL]+[A-Z]?)\s*(\*{1,8}\))?\s*$", re.I)
RE_BAGIAN = re.compile(r"^\s*(Bagian\s+\w+)\s*$", re.I)
RE_PARAGRAF = re.compile(r"^\s*(Paragraf\s+\w+)\s*$", re.I)
RE_PASAL = re.compile(r"^\s*PASAL\s+(\d+[A-Z]*)\s*(\*{1,8}\))?\s*$", re.I)
RE_AYAT = re.compile(r"^\s*\((\d+[a-z]?)\)\s*(.*)$")
RE_HURUF = re.compile(r"^\s*([a-z])\.\s+(.*)$")
RE_ANGKA = re.compile(r"^\s*(\d{1,2})\.\s+(.*)$")
RE_BINTANG = re.compile(r"(\*{1,8})\)")
# SDSN menyelipkan penjelasan tepat setelah tiap pasal. Penjelasan bukan norma:
# ia menerangkan, tidak mengatur. Bila tidak dibedakan, kutipan bisa menyodorkan
# penjelasan seolah bunyi pasalnya.
RE_PENJELASAN = re.compile(r"^\s*Penjelasan\s+Pasal\s+(\d+[A-Z]*)\s*$", re.I)
RE_LEGENDA = re.compile(
    r"(\*{1,8})\)\s*:?\s*Perubahan\s+(\w+)\s*\(?\s*(UU|Undang-Undang)?\s*"
    r"Nomor\s+(\d+)\s+Tahun\s+(\d{4})", re.I)

TAHUN_EDISI = 2023          # edisi SDSN yang diurai berkas ini

URUTAN = {"pertama": 1, "kedua": 2, "ketiga": 3, "keempat": 4, "kelima": 5,
          "keenam": 6, "ketujuh": 7, "kedelapan": 8}


@dataclass
class Node:
    """Satu simpul dalam pohon peraturan."""
    tipe: str                       # bab | bagian | pasal | ayat | huruf | angka | teks
    level: int
    label: str                      # 'I', 'Pasal 4', '(2)', 'a', '1'
    judul: str | None = None        # judul BAB/Bagian
    teks: str = ""
    amandemen: str | None = None    # 'UU 7 TAHUN 2021' — asal rumusan
    bagian_dok: str = "batang_tubuh"   # batang_tubuh | penjelasan
    bintang: str | None = None      # penanda mentah, mis. '******'
    halaman: int | None = None
    anak: list["Node"] = field(default_factory=list)

    def path(self, induk: str = "") -> str:
        sendiri = {"bab": f"BAB {self.label}", "bagian": self.label,
                   "penjelasan": f"Penjelasan Pasal {self.label}",
                   "paragraf": self.label, "pasal": f"Pasal {self.label}",
                   "ayat": f"ayat ({self.label})", "huruf": f"huruf {self.label}",
                   "angka": f"angka {self.label}"}.get(self.tipe, self.label)
        return f"{induk} > {sendiri}" if induk else sendiri


@dataclass
class UndangUndang:
    """Satu undang-undang konsolidasi di dalam berkas SDSN."""
    nomor: str
    tahun: int
    judul: str
    konsolidasi_sampai: str | None = None   # perubahan terakhir yang tercakup
    legenda: dict = field(default_factory=dict)   # '***' -> 'UU 28 TAHUN 2007'
    # Penanda yang TIDAK tercetak di legenda dan hanya disimpulkan dari judul.
    # Dipisah agar pembaca tahu mana yang dikutip dan mana yang disimpulkan.
    legenda_disimpulkan: dict = field(default_factory=dict)
    anak: list[Node] = field(default_factory=list)

    @property
    def id(self) -> str:
        return f"uu-{self.nomor}-{self.tahun}"

    @property
    def id_konsolidasi(self) -> str:
        return f"{self.id}@konsolidasi-2023"


# --- pemecahan berkas ------------------------------------------------------
def _bersih(baris: str) -> str:
    return re.sub(r"\s+", " ", baris).strip()


def _buang_derau(teks: str) -> list[str]:
    """Buang nomor halaman berdiri sendiri dan baris kosong berlebih."""
    out = []
    for b in teks.split("\n"):
        s = b.rstrip()
        if not s.strip():
            continue
        if re.fullmatch(r"\s*\d{1,3}\s*", s):        # nomor halaman
            continue
        out.append(s)
    return out


def pisah_undang_undang(teks: str) -> list[tuple[str, str]]:
    """Pecah berkas menjadi (judul_blok, isi) per undang-undang.

    Penanda batas adalah 'SUSUNAN DALAM SATU NASKAH' atau judul UU yang
    berdiri sendiri. Daftar isi di depan sengaja dilewati dengan mensyaratkan
    posisi kemunculan yang cukup jauh dari awal berkas.
    """
    batas = []
    for m in RE_SDSN.finditer(teks):
        batas.append(m.start())
    for m in re.finditer(
            r"^\s*UNDANG-UNDANG\s+REPUBLIK\s+INDONESIA(?:\s+NOMOR\s+\d+"
            r"(?:\s+TAHUN\s+\d{4})?)?\s*$", teks, re.M):
        batas.append(m.start())
    batas = sorted(set(b for b in batas if b > 3000))
    if not batas:
        return [("(seluruh berkas)", teks)]
    potong = []
    for i, b in enumerate(batas):
        akhir = batas[i + 1] if i + 1 < len(batas) else len(teks)
        blok = teks[b:akhir]
        if len(blok) < 2000:                 # penanda palsu / daftar isi
            continue
        kepala = "\n".join(_buang_derau(blok)[:8])
        potong.append((kepala, blok))
    return potong


def urai_legenda(blok: str) -> tuple[dict, str | None]:
    """Baca legenda bintang di kepala satu undang-undang.

    Legenda dibangun dari KATA URUTAN ("Perubahan Ketiga"), bukan dari
    menghitung bintang pada barisnya. Alasannya: glif bintang rusak saat
    diekstrak dari PDF dua kolom — "****)" terbaca "i*****)", "***)" terbaca
    "ii *)", dan penanda kerap terpisah baris dari keterangannya. Kata
    urutannya justru selalu utuh, dan konvensinya mutlak: Perubahan Ketiga
    berarti tiga bintang, tanpa kecuali. Membaca dari kata urutan membuat
    legenda tahan terhadap kerusakan tata letak.
    """
    kepala = blok[:6000]
    # "Per ub a han" — spasi jatuh di posisi acak, jadi versi tanpa spasi sama
    # sekali dipakai sebagai kandidat terakhir.
    rapat = re.sub(r"(?<=\w) (?=\w\b)", "", kepala)
    tanpa_spasi = re.sub(r"[ \t]+", "", kepala)
    legenda: dict[str, str] = {}
    tertinggi = 0
    terakhir = None
    for kandidat in (kepala, rapat, tanpa_spasi):
        for m in re.finditer(
                r"Perubahan\s*(Pertama|Kedua|Ketiga|Keempat|Kelima|Keenam|"
                r"Ketujuh|Kedelapan)\s*\(?\s*(?:UU|Undang-Undang)?\s*"
                r"Nomor\s*(\d+)\s*Tahun\s*(\d{4})", kandidat, re.I):
            urut = URUTAN[m.group(1).lower()]
            nilai = f"UU {m.group(2)} TAHUN {m.group(3)}"
            legenda["*" * urut] = nilai
            if urut > tertinggi:
                tertinggi, terakhir = urut, nilai
    return legenda, terakhir


def _urut_dari(legenda: dict, nilai: str | None) -> str:
    if not nilai:
        return ""
    for k, v in legenda.items():
        if v == nilai:
            return {1: "pertama", 2: "kedua", 3: "ketiga", 4: "keempat",
                    5: "kelima", 6: "keenam", 7: "ketujuh"}.get(len(k), "")
    return ""


# --- pembangun pohon -------------------------------------------------------
def urai_batang_tubuh(blok: str, legenda: dict) -> list[Node]:
    """Bangun pohon BAB > Bagian > Pasal > ayat > huruf > angka."""
    akar: list[Node] = []
    tumpukan: list[Node] = []            # jalur induk aktif

    def taruh(n: Node):
        while tumpukan and tumpukan[-1].level >= n.level:
            tumpukan.pop()
        (tumpukan[-1].anak if tumpukan else akar).append(n)
        tumpukan.append(n)

    baris = _buang_derau(blok)
    i, terakhir_judul = 0, None
    seksi = "batang_tubuh"

    def taruh_seksi(n: Node):
        n.bagian_dok = seksi
        taruh(n)

    while i < len(baris):
        s = _bersih(baris[i])

        m = RE_PENJELASAN.match(s)
        if m:
            seksi = "penjelasan"
            # Penjelasan bergantung pada pasalnya, jadi disimpan sebagai anak
            # pasal yang sama — bukan sebagai pasal baru.
            n = Node("penjelasan", LEVEL["pasal"] + 1, m.group(1).upper())
            n.bagian_dok = seksi
            taruh(n)
            i += 1
            continue

        m = RE_BAB.match(s)
        if m:
            judul = _bersih(baris[i + 1]) if i + 1 < len(baris) else None
            if judul and not (RE_PASAL.match(judul) or RE_BAGIAN.match(judul)):
                i += 1
            else:
                judul = None
            seksi = "batang_tubuh"
            taruh_seksi(Node("bab", LEVEL["bab"], m.group(1).upper(), judul))
            i += 1
            continue

        m = RE_BAGIAN.match(s) or RE_PARAGRAF.match(s)
        if m:
            tipe = "bagian" if RE_BAGIAN.match(s) else "paragraf"
            judul = _bersih(baris[i + 1]) if i + 1 < len(baris) else None
            if judul and not RE_PASAL.match(judul):
                i += 1
            else:
                judul = None
            taruh_seksi(Node(tipe, LEVEL[tipe], m.group(1), judul))
            i += 1
            continue

        m = RE_PASAL.match(s)
        if m:
            n = Node("pasal", LEVEL["pasal"], m.group(1).upper())
            if m.group(2):
                n.bintang = m.group(2).rstrip(")")
                n.amandemen = legenda.get(n.bintang)
            seksi = "batang_tubuh"
            taruh_seksi(n)
            i += 1
            continue

        m = RE_AYAT.match(s)
        if m:
            taruh_seksi(_isi_node("ayat", m.group(1), m.group(2), legenda))
            i += 1
            continue

        m = RE_HURUF.match(s)
        if m:
            taruh_seksi(_isi_node("huruf", m.group(1), m.group(2), legenda))
            i += 1
            continue

        m = RE_ANGKA.match(s)
        if m and tumpukan:
            taruh_seksi(_isi_node("angka", m.group(1), m.group(2), legenda))
            i += 1
            continue

        # baris lanjutan: sambungkan ke simpul aktif terdalam yang punya teks
        if tumpukan:
            n = tumpukan[-1]
            n.teks = (n.teks + " " + s).strip() if n.teks else s
            _tandai_bintang(n, legenda)
        i += 1
    return akar


def _isi_node(tipe: str, label: str, teks: str, legenda: dict) -> Node:
    n = Node(tipe, LEVEL[tipe], label, teks=_bersih(teks))
    _tandai_bintang(n, legenda)
    return n


def _tandai_bintang(n: Node, legenda: dict) -> None:
    m = RE_BINTANG.search(n.teks)
    if not m:
        return
    b = m.group(1)
    n.bintang = b
    n.amandemen = legenda.get(b)
    n.teks = _bersih(RE_BINTANG.sub("", n.teks))


# --- API utama -------------------------------------------------------------
def urai_berkas(path_txt: str | Path) -> list[UndangUndang]:
    teks = Path(path_txt).read_text("utf-8", errors="replace")
    hasil = []
    for kepala, blok in pisah_undang_undang(teks):
        m = RE_UU_HEAD.search(kepala) or RE_UU_HEAD.search(blok[:4000])
        if not m:
            continue
        nomor, tahun = m.group(1), m.group(2)
        if not tahun:
            m2 = re.search(r"TAHUN\s+(\d{4})", blok[:4000], re.I)
            tahun = m2.group(1) if m2 else None
        if not tahun:
            continue
        legenda, terakhir = urai_legenda(blok)
        judul_m = re.search(r"TENTANG\s+(.{5,160}?)(?:\n\n|SEBAGAIMANA)",
                            blok[:5000], re.S | re.I)
        judul = _bersih(judul_m.group(1)) if judul_m else "(judul tidak terbaca)"
        # Sebagian naskah konsolidasi berkepala UU PENGUBAH ("UU 12/1994 tentang
        # Perubahan atas UU 12/1985 tentang PBB"). Identitas naskah gabungan
        # tetap UU yang diubah — memakai nomor pengubah akan memutus tautan ke
        # peraturan lain yang menyebut "UU PBB" sebagai UU 12/1985.
        ubah = re.match(
            r"PERUBAHAN\s+ATAS\s+UNDANG-UNDANG\s+NOMOR\s+(\d+)\s+TAHUN\s+"
            r"(\d{4})\s+TENTANG\s+(.+)", judul, re.I)
        if ubah:
            terakhir = f"UU {nomor} TAHUN {tahun}"
            nomor, tahun, judul = ubah.group(1), ubah.group(2), _bersih(ubah.group(3))
        pengubah_terakhir = None
        jm = re.search(r"DIUBAH\s+TERAKHIR\s+DENGAN\s+UNDANG-?\s*UNDANG\s+"
                       r"NOMOR\s+(\d+)\s+TAHUN\s+(\d{4})",
                       re.sub(r"[ \t]*\n[ \t]*", " ", blok[:2500]), re.I)
        if jm:
            pengubah_terakhir = f"UU {jm.group(1)} TAHUN {jm.group(2)}"
        uu = UndangUndang(
            nomor=nomor, tahun=int(tahun),
            judul=judul, konsolidasi_sampai=terakhir, legenda=legenda,
            anak=urai_batang_tubuh(blok, legenda))
        _lengkapi_legenda(uu, pengubah_terakhir)
        hasil.append(uu)
    return hasil


def _lengkapi_legenda(uu: UndangUndang, pengubah_terakhir: str | None) -> None:
    """Isi penanda yang dipakai batang tubuh tetapi tidak tercetak di legenda.

    Legenda SDSN 2023 untuk UU KUP hanya mencantumkan enam perubahan, padahal
    batang tubuhnya memakai tujuh bintang. Ini cacat pada dokumen sumber, bukan
    pada pembacaan. Nilainya dipulihkan dari judul ("...diubah terakhir dengan
    Undang-Undang Nomor 6 Tahun 2023") dan disimpan di `legenda_disimpulkan`,
    terpisah dari yang benar-benar tercetak, supaya dapat ditelusuri kembali.
    """
    dipakai = set()

    def telusuri(ns):
        for n in ns:
            if n.bintang:
                dipakai.add(n.bintang)
            telusuri(n.anak)
    telusuri(uu.anak)

    hilang = sorted((b for b in dipakai if b not in uu.legenda), key=len)
    if hilang and pengubah_terakhir:
        tertinggi = max(dipakai, key=len)
        if tertinggi in hilang and pengubah_terakhir not in uu.legenda.values():
            uu.legenda_disimpulkan[tertinggi] = pengubah_terakhir
            uu.konsolidasi_sampai = pengubah_terakhir

    gabungan = {**uu.legenda, **uu.legenda_disimpulkan}

    def terapkan(ns):
        for n in ns:
            if n.bintang and not n.amandemen:
                n.amandemen = gabungan.get(n.bintang)
            terapkan(n.anak)
    terapkan(uu.anak)


# --- ekspor ----------------------------------------------------------------
def ke_json(uu_list: list[UndangUndang], path: str | Path) -> dict:
    """Pohon bersarang — bentuk kanonik, menyimpan seluruh atribut per simpul."""
    data = {
        "sumber": "SDSN Undang-Undang Perpajakan, DJP, Edisi 2023",
        "skema_level": LEVEL,
        "undang_undang": [asdict(u) for u in uu_list],
    }
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    return {"undang_undang": len(uu_list), "path": str(path)}


def ke_jsonl(uu_list: list[UndangUndang], path: str | Path) -> int:
    """Satu baris per unit yang dapat dikutip — bentuk untuk indeks & graf."""
    n = 0
    with open(path, "w", encoding="utf-8") as fh:
        for u in uu_list:
            def turun(node: Node, induk_path: str):
                nonlocal n
                p = node.path(induk_path)
                if node.teks:
                    fh.write(json.dumps({
                        "id": f"{u.id_konsolidasi}#{_slug(p)}",
                        "uu_id": u.id,
                        "uu": f"UU {u.nomor} TAHUN {u.tahun}",
                        "konsolidasi_sampai": u.konsolidasi_sampai,
                        "tipe": node.tipe, "level": node.level,
                        "path": p, "teks": node.teks,
                        "bagian_dok": node.bagian_dok,
                        "amandemen": node.amandemen,
                    }, ensure_ascii=False) + "\n")
                    n += 1
                for a in node.anak:
                    turun(a, p)
            for top in u.anak:
                turun(top, "")
    return n


def ke_markdown(uu_list: list[UndangUndang], path: str | Path) -> int:
    """Bentuk turunan untuk dibaca manusia dan di-diff di git."""
    baris = ["# SDSN Undang-Undang Perpajakan — Edisi 2023",
             "", "> Teks konsolidasi resmi DJP. Tanda amandemen pada tiap",
             "> ketentuan menunjukkan perubahan yang melahirkan rumusannya.", ""]
    for u in uu_list:
        baris += [f"\n## UU {u.nomor} Tahun {u.tahun} — {u.judul}", ""]
        if u.konsolidasi_sampai:
            baris.append(f"*Konsolidasi sampai: {u.konsolidasi_sampai}*\n")
        gabungan = {**u.legenda, **u.legenda_disimpulkan}
        if gabungan:
            baris.append("| Tanda | Perubahan | Sumber |")
            baris.append("|---|---|---|")
            for b, v in sorted(gabungan.items(), key=lambda x: len(x[0])):
                asal = ("disimpulkan dari judul" if b in u.legenda_disimpulkan
                        else "legenda dokumen")
                baris.append(f"| `{b})` | {v} | {asal} |")
            baris.append("")

        def turun(node: Node, dalam: int):
            pad = "  " * max(dalam - 4, 0)
            jejak = f"  `[{node.amandemen}]`" if node.amandemen else ""
            if node.tipe == "bab":
                baris.append(f"\n### BAB {node.label}"
                             + (f" — {node.judul}" if node.judul else ""))
            elif node.tipe in ("bagian", "paragraf"):
                baris.append(f"\n#### {node.label}"
                             + (f" — {node.judul}" if node.judul else ""))
            elif node.tipe == "pasal":
                baris.append(f"\n**Pasal {node.label}**{jejak}\n")
            elif node.teks:
                tanda = {"ayat": f"({node.label})", "huruf": f"{node.label}.",
                         "angka": f"{node.label}."}.get(node.tipe, "-")
                baris.append(f"{pad}{tanda} {node.teks}{jejak}")
            for a in node.anak:
                turun(a, a.level)
        for top in u.anak:
            turun(top, top.level)
    Path(path).write_text("\n".join(baris), "utf-8")
    return len(baris)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# --- integrasi ke basis data & graf -----------------------------------------
# Naskah konsolidasi TIDAK menggantikan naskah asli di korpus; ia lapisan
# tambahan. UU 6/1983 versi asli dan UU 6/1983 versi konsolidasi 2023 adalah
# dua dokumen berbeda yang keduanya sah dikutip — yang pertama untuk sengketa
# atas peristiwa lama, yang kedua untuk keadaan sekarang. Karena itu ia disimpan
# dengan id sendiri (`uu-6-1983@konsolidasi-2023`) dan ditautkan ke naskah asli
# lewat relasi KONSOLIDASI_DARI, bukan ditimpa.
def muat_ke_db(uu_list: list[UndangUndang], db_path: str | Path) -> dict:
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    # Provenance amandemen butuh kolomnya sendiri. Menumpangkannya ke
    # `bagian_dok` akan merusak pembobotan seksi di pencarian, karena kolom itu
    # dipakai untuk membedakan batang tubuh dari konsideran.
    if "amandemen" not in [r[1] for r in conn.execute("PRAGMA table_info(pasal)")]:
        conn.execute("ALTER TABLE pasal ADD COLUMN amandemen TEXT")
    n_reg = n_unit = n_rel = 0
    with conn:
        for u in uu_list:
            rid = u.id_konsolidasi
            conn.execute(
                "INSERT OR REPLACE INTO regulation "
                "(id, canonical, nomor_raw, jenis, jenis_code, tahun, judul, "
                " status_site, has_body, body_text, source) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                # `canonical` adalah bentuk yang ditampilkan dan disitir, jadi
                # ia harus terbaca sebagai kutipan — bukan id internal.
                (rid, f"UU {u.nomor} TAHUN {u.tahun} (konsolidasi {TAHUN_EDISI})",
                 f"{u.nomor} TAHUN {u.tahun}", "UNDANG-UNDANG", "UU",
                 TAHUN_EDISI, f"{u.judul} (naskah konsolidasi s.d. "
                 f"{u.konsolidasi_sampai or 'asli'})",
                 "Konsolidasi", 1, "", "sdsn-djp-2023"))
            n_reg += 1

            # relation.id auto-increment, jadi idempotensi dijaga dengan
            # membuang sisi lama dari sumber ini sebelum menulis ulang.
            conn.execute("DELETE FROM relation WHERE src_id=? AND method LIKE 'sdsn%'",
                         (rid,))
            conn.execute("DELETE FROM pasal WHERE reg_id=?", (rid,))

            # Naskah konsolidasi ini berasal dari naskah asli.
            conn.execute(
                "INSERT INTO relation "
                "(src_id, dst_id, dst_raw, type, method, confidence, verified) "
                "VALUES (?,?,?,?,?,?,?)",
                (rid, u.id, f"UU {u.nomor} TAHUN {u.tahun}", "KONSOLIDASI_DARI",
                 "sdsn", 1.0, 1))
            n_rel += 1

            # Tiap perubahan yang tercakup jadi sisi tersendiri, sehingga
            # pertanyaan "perubahan mana yang sudah masuk naskah ini?" terjawab
            # dari graf, bukan dari membaca legenda.
            for bintang, nilai in {**u.legenda, **u.legenda_disimpulkan}.items():
                pasti = bintang not in u.legenda_disimpulkan
                conn.execute(
                    "INSERT INTO relation "
                    "(src_id, dst_id, dst_raw, type, scope, method, "
                    " confidence, verified) VALUES (?,?,?,?,?,?,?,?)",
                    (rid, None, nilai,
                     "MENCAKUP_PERUBAHAN", f"tanda {bintang})",
                     "sdsn" if pasti else "sdsn-inferensi",
                     1.0 if pasti else 0.75, 1 if pasti else 0))
                n_rel += 1

            seq = 0

            def turun(node: Node, induk: str, ctx: dict):
                nonlocal seq, n_unit
                p = node.path(induk)
                c = dict(ctx)
                if node.tipe in ("bab", "bagian", "pasal", "ayat", "huruf", "angka"):
                    c[node.tipe] = node.label
                # Simpul struktural tanpa teks (judul pasal) tetap disimpan
                # bila membawa tanda amandemen — tanda itulah yang menjawab
                # "rumusan ini berasal dari perubahan mana", dan tanpa barisnya
                # penelusuran ke leluhur akan buntu.
                if node.teks or node.amandemen:
                    seq += 1
                    n_unit += 1
                    conn.execute(
                        "INSERT OR REPLACE INTO pasal "
                        "(id, reg_id, seq, bab, bagian, pasal, ayat, huruf, "
                        " angka, bagian_dok, path, text, amandemen) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (f"{rid}#{_slug(p)}", rid, seq, c.get("bab"),
                         c.get("bagian"), c.get("pasal"), c.get("ayat"),
                         c.get("huruf"), c.get("angka"),
                         node.bagian_dok, p, node.teks, node.amandemen))
                for a in node.anak:
                    turun(a, p, c)
            for top in u.anak:
                turun(top, "", {})
        # Tanpa baris validity, pencarian memperlakukan naskah ini sebagai
        # "status tidak diketahui" dan menurunkan peringkatnya — padahal justru
        # inilah bunyi yang berlaku sekarang.
        for u in uu_list:
            conn.execute(
                "INSERT OR REPLACE INTO validity "
                "(reg_id, status_derived, valid_from, valid_to, "
                " agrees_with_site, reason) VALUES (?,?,?,?,?,?)",
                (u.id_konsolidasi, "berlaku", f"{TAHUN_EDISI}-01-01", None, 1,
                 f"naskah konsolidasi SDSN s.d. {u.konsolidasi_sampai or 'asli'}"))
    conn.close()
    return {"peraturan": n_reg, "unit": n_unit, "relasi": n_rel}


def asal_rumusan(conn, pasal_id: str) -> dict:
    """Telusuri asal rumusan satu unit sampai ke leluhur bertanda terdekat.

    Tanda amandemen hanya dibubuhkan di tingkat tempat dokumen membubuhkannya.
    Pasal 4 UU PPh bertanda `******)`, tetapi huruf-huruf di dalamnya tidak
    bertanda sendiri. Menyalin tanda induk ke setiap anak akan mengklaim lebih
    dari yang tertulis — huruf tertentu bisa saja berasal dari perubahan yang
    lebih tua. Karena itu warisan dilaporkan sebagai warisan, bukan sebagai
    tanda milik unit itu sendiri.
    """
    r = conn.execute(
        "SELECT reg_id, path, amandemen, bagian_dok FROM pasal WHERE id=?",
        (pasal_id,)).fetchone()
    if not r:
        return {}
    if r["amandemen"]:
        return {"asal": r["amandemen"], "dasar": "ditandai pada unit ini",
                "path": r["path"], "bagian_dok": r["bagian_dok"]}
    bagian = r["path"].split(" > ")
    for n in range(len(bagian) - 1, 0, -1):
        induk = " > ".join(bagian[:n])
        a = conn.execute(
            "SELECT amandemen FROM pasal WHERE reg_id=? AND path=? "
            "AND amandemen IS NOT NULL", (r["reg_id"], induk)).fetchone()
        if a:
            return {"asal": a["amandemen"], "dasar": f"diwarisi dari {induk}",
                    "path": r["path"], "bagian_dok": r["bagian_dok"]}
    return {"asal": None, "dasar": "tidak bertanda — rumusan asli 1983",
            "path": r["path"], "bagian_dok": r["bagian_dok"]}
