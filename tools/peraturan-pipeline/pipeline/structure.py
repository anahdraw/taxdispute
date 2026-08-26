"""Pemecah badan peraturan menjadi unit terkecil yang dapat dikutip.

Seluruhnya berbasis aturan — tanpa LLM. Struktur peraturan Indonesia sangat
regular (UU 12/2011 tentang Pembentukan Peraturan Perundang-undangan
menstandarkan Menimbang / Mengingat / Menetapkan / BAB / Bagian / Pasal /
ayat / huruf / angka), sehingga parser deterministik lebih presisi *dan*
gratis dibanding LLM. LLM hanya menangani sisa yang gagal diurai.

Keluarannya adalah tabel `pasal`: setiap baris punya `path` yang dapat
dijadikan sitasi ("BAB II > Pasal 4 > ayat (2) > huruf a") — inilah unit
yang nanti diindeks dan dikutip oleh jawaban pencarian.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

RE_BAB = re.compile(r"^BAB\s+([IVXLC]+)\b(.*)$", re.I)
RE_BAGIAN = re.compile(r"^(Bagian\s+\w+)\b(.*)$", re.I)
RE_PARAGRAF = re.compile(r"^(Paragraf\s+\d+)\b(.*)$", re.I)
# Angka Romawi ikut diterima. Peraturan pengubah memakainya untuk rangkanya —
# "Pasal I" memuat perubahannya, "Pasal II" ketentuan mulai berlakunya —
# sedangkan pasal yang diubah di dalamnya tetap bernomor Arab. Tanpa ini
# rangkanya tidak terbaca sama sekali, dan akibatnya bukan sekadar dua judul
# yang hilang: klausul "mulai berlaku" pada Pasal II menempel ke pasal Arab
# terakhir sebelumnya, sehingga seluruh isi pasal yang diubah ditandai
# `penutup`. Pada Pergub Bali 14/2026, tujuh ayat Pasal 68 — inti perubahannya —
# tercatat sebagai ketentuan penutup.
#
# Daftarnya ditulis eksplisit, bukan `[IVXLC]+`: kelas terbuka juga menerima
# "Pasal C" dan "Pasal L", dan pasal bernomor Romawi tidak pernah sepanjang itu.
_ROMAWI = "I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII"
_RE_NOMOR_PASAL = re.compile(rf"\d+[A-Z]?|{_ROMAWI}", re.I)
RE_PASAL = re.compile(rf"^Pasal\s+(\d+[A-Z]?|{_ROMAWI})\s*$", re.I)
RE_PASAL_INLINE = re.compile(rf"^Pasal\s+(\d+[A-Z]?|{_ROMAWI})\b\s*(.+)$", re.I)
RE_AYAT = re.compile(r"^\((\d+[a-z]?)\)\s*(.*)$")
RE_HURUF = re.compile(r"^([a-z])\.\s+(.*)$")
RE_ANGKA = re.compile(r"^(\d{1,2})\.\s+(.*)$")

RE_MENIMBANG = re.compile(r"^Menimbang\s*:?", re.I)
RE_MENGINGAT = re.compile(r"^Mengingat\s*:?", re.I)
RE_MEMUTUSKAN = re.compile(r"^MEMUTUSKAN\s*:?", re.I)
RE_MENETAPKAN = re.compile(r"^Menetapkan\s*:?", re.I)
RE_PENJELASAN = re.compile(r"^PENJELASAN\b", re.I)

# Keputusan (KMK, KEP, KEPPRES) tidak berpasal — satuan operatifnya diktum:
# KESATU, KEDUA, KETIGA. Tanpa aturan ini, hampir separuh katalog (KMK sendiri
# 47,6%) terurai sebagai satu gumpalan teks tanpa unit yang dapat dikutip.
_ORDINAL = (r"KESATU|PERTAMA|KEDUA|KETIGA|KEEMPAT|KELIMA|KEENAM|KETUJUH|"
            r"KEDELAPAN|KESEMBILAN|KESEPULUH|KESEBELAS|KEDUA\s+BELAS|"
            r"KETIGA\s+BELAS|KEEMPAT\s+BELAS|KELIMA\s+BELAS|KEENAM\s+BELAS|"
            r"KETUJUH\s+BELAS|KEDELAPAN\s+BELAS|KESEMBILAN\s+BELAS|"
            r"KEDUA\s+PULUH")
RE_DIKTUM = re.compile(rf"^({_ORDINAL})\s*:?\s*$", re.I)
RE_DIKTUM_INLINE = re.compile(rf"^({_ORDINAL})\s*:\s*(.+)$", re.I)

RE_MULAI_BERLAKU = re.compile(
    r"mulai\s+berlaku\s+(?:pada\s+)?(?:tanggal\s+)?(diundangkan|ditetapkan|"
    r"(\d{1,2}\s+\w+\s+\d{4})|(\d{1,2}\s+\(\w+\)\s+\w+))", re.I)


@dataclass
class Unit:
    seq: int
    bab: str | None
    bagian: str | None
    pasal: str | None
    ayat: str | None
    huruf: str | None
    angka: str | None
    bagian_dok: str
    path: str
    text: str

    def unit_id(self, reg_id: str) -> str:
        """Identitas satu unit di dalam satu peraturan.

        Bagian dokumen ikut ke dalam kunci untuk SEMUA bagian selain batang
        tubuh — bukan hanya menimbang, mengingat, dan penutup_meta seperti
        sebelumnya. Yang tertinggal dahulu adalah `penjelasan`, dan akibatnya
        bukan sekadar unit yang bertumpuk: penjelasan Pasal 1 memakai kunci yang
        sama dengan batang tubuh Pasal 1, lalu `INSERT OR REPLACE` membuat yang
        datang belakangan menang. Pada Perda Buleleng 9/2023, pasal ketentuan
        umum, ruang lingkup, dan jenis pajak — Pasal 1, 2, dan 3 — hilang
        seluruhnya dan tinggal penjelasannya.

        Yang terkena adalah pasal yang batang tubuhnya tidak berayat, karena
        hanya itu yang berkunci sependek penjelasannya. Itu justru pasal-pasal
        yang paling sering dicari: definisi, ruang lingkup, dan penutup.
        """
        frag = []
        if self.bagian_dok != "batang_tubuh":
            frag.append(self.bagian_dok)
        if self.pasal:
            frag.append(f"pasal-{self.pasal}")
        if self.ayat:
            frag.append(f"ayat-{self.ayat}")
        if self.huruf:
            frag.append(f"huruf-{self.huruf}")
        if self.angka:
            frag.append(f"angka-{self.angka}")
        if not frag:
            frag.append(f"blok-{self.seq}")
        return f"{reg_id}#{'-'.join(frag)}"


def _lines(text: str) -> list[str]:
    out = []
    for raw in (text or "").split("\n"):
        s = re.sub(r"\s+", " ", raw).strip()
        if s:
            out.append(s)
    return out


def parse_body(text: str) -> list[Unit]:
    """Pecah teks peraturan menjadi daftar Unit yang berurutan."""
    units: list[Unit] = []
    bab = bagian = pasal = ayat = huruf = angka = None
    bab_judul = ""
    section = "kepala"
    seq = 0
    buf: list[str] = []

    def flush():
        nonlocal buf, seq
        # Pada Keputusan, label diktum dan titik dua kerap berada di baris
        # terpisah, sehingga sisa ":" menjadi unit kosong bila tidak dibuang.
        body = " ".join(buf).strip().lstrip(":").strip()
        buf = []
        if not body:
            return
        seq += 1
        parts = []
        if bab:
            parts.append(f"BAB {bab}" + (f" {bab_judul}" if bab_judul else ""))
        if bagian:
            parts.append(bagian)
        if pasal:
            # Label diktum berupa KATA urutan ("KESATU"); pasal berupa angka
            # Arab ("12") atau Romawi ("I"). Membedakannya lewat "huruf pertama
            # bukan angka" salah untuk yang Romawi: Pasal I pada peraturan
            # pengubah tercatat sebagai "Diktum I", padahal ia pasal — dan
            # diktum hanya ada pada Keputusan, yang tidak berpasal sama sekali.
            parts.append(f"Pasal {pasal}" if _RE_NOMOR_PASAL.fullmatch(pasal)
                         else f"Diktum {pasal}")
        if ayat:
            parts.append(f"ayat ({ayat})")
        if huruf:
            parts.append(f"huruf {huruf}")
        if angka:
            parts.append(f"angka {angka}")
        if not parts:
            parts.append(section)
        units.append(Unit(seq, bab, bagian, pasal, ayat, huruf, angka,
                          section, " > ".join(parts), body))

    for line in _lines(text):
        if RE_PENJELASAN.match(line):
            flush(); section = "penjelasan"
            pasal = ayat = huruf = angka = None
            continue
        if RE_MENIMBANG.match(line):
            flush(); section = "menimbang"
            buf.append(RE_MENIMBANG.sub("", line).strip()); continue
        if RE_MENGINGAT.match(line):
            flush(); section = "mengingat"
            buf.append(RE_MENGINGAT.sub("", line).strip()); continue
        if RE_MEMUTUSKAN.match(line) or RE_MENETAPKAN.match(line):
            flush(); section = "batang_tubuh"
            angka = huruf = ayat = None
            continue

        # Diktum diperlakukan setara pasal: keduanya satuan operatif yang
        # dikutip orang. Penamaan path membedakan keduanya.
        m = RE_DIKTUM.match(line)
        if m and section in ("batang_tubuh", "kepala"):
            flush()
            pasal = re.sub(r"\s+", " ", m.group(1).upper())
            ayat = huruf = angka = None
            section = "batang_tubuh"
            continue
        m = RE_DIKTUM_INLINE.match(line)
        if m and section in ("batang_tubuh", "kepala"):
            flush()
            pasal = re.sub(r"\s+", " ", m.group(1).upper())
            ayat = huruf = angka = None
            section = "batang_tubuh"
            buf.append(m.group(2))
            continue

        m = RE_BAB.match(line)
        if m:
            flush()
            bab, bab_judul = m.group(1).upper(), m.group(2).strip()
            bagian = pasal = ayat = huruf = angka = None
            section = "batang_tubuh"
            continue
        m = RE_BAGIAN.match(line) or RE_PARAGRAF.match(line)
        if m:
            flush()
            bagian = (m.group(1) + " " + m.group(2)).strip()
            pasal = ayat = huruf = angka = None
            continue

        m = RE_PASAL.match(line)
        if m:
            flush()
            pasal, ayat, huruf, angka = m.group(1), None, None, None
            if section in ("kepala", "menimbang", "mengingat"):
                section = "batang_tubuh"
            continue
        m = RE_PASAL_INLINE.match(line)
        if m and section != "mengingat":
            flush()
            pasal, ayat, huruf, angka = m.group(1), None, None, None
            if section in ("kepala", "menimbang"):
                section = "batang_tubuh"
            buf.append(m.group(2))
            continue

        if section in ("batang_tubuh", "penjelasan"):
            m = RE_AYAT.match(line)
            if m:
                flush(); ayat, huruf, angka = m.group(1), None, None
                buf.append(m.group(2)); continue
            m = RE_HURUF.match(line)
            if m:
                flush(); huruf, angka = m.group(1), None
                buf.append(m.group(2)); continue
            m = RE_ANGKA.match(line)
            if m and pasal:
                flush(); angka = m.group(1)
                buf.append(m.group(2)); continue

        if section == "mengingat":
            m = RE_ANGKA.match(line)
            if m:
                flush(); angka = m.group(1)
                buf.append(m.group(2)); continue

        buf.append(line)

    flush()
    units = _split_inline_enum(units)

    # Bentuk narasi — Surat Edaran, Surat, Instruksi — tidak berpasal sama
    # sekali; strukturnya butir bernomor dan berhuruf di tingkat teratas.
    # Pengurai di atas hanya memecah butir bila sudah ada pasal, sehingga
    # dokumen semacam itu masuk sebagai SATU unit berapa pun panjangnya:
    # SE-8/PJ/2026 sepanjang 291.276 aksara terurai menjadi satu.
    #
    # Diperiksa setelah penguraian, bukan ditebak sebelumnya: bentuk dokumen
    # tidak selalu sesuai jenisnya, dan yang menentukan adalah hasil nyatanya.
    badan = [u for u in units if u.bagian_dok == "batang_tubuh"]
    # Pemicunya struktur, bukan panjang. Ambang 2.000 aksara dipilih ketika yang
    # diurai baru peraturan; surat justru pendek — Surat Dirjen bermedian 2.059
    # aksara — sehingga 603 surat berbutir bernomor lebih dari 1.500 aksara
    # tersimpan sebagai satu unit tunggal, dan 43% seluruh Surat Dirjen hanya
    # punya satu unit. Yang menentukan seharusnya ada tidaknya butir, bukan
    # seberapa panjang dokumennya.
    if len(badan) < 3 and (len(text or "") > 2000 or _ada_butir(text or "")):
        narasi = _urai_narasi(text)
        if len(narasi) > len(badan):
            units = [u for u in units if u.bagian_dok != "batang_tubuh"] + narasi
            for i, u in enumerate(sorted(units, key=lambda x: x.seq), 1):
                u.seq = i

    # Tandai pasal penutup: pasal terakhir yang memuat frasa 'mulai berlaku'.
    for u in reversed(units):
        if u.bagian_dok == "batang_tubuh" and RE_MULAI_BERLAKU.search(u.text):
            for v in units:
                if v.pasal == u.pasal and v.bagian_dok == "batang_tubuh":
                    v.bagian_dok = "penutup"
            break
    return units


# Penanda butir pada bentuk narasi, dari yang terluar ke terdalam. Angka
# Romawi dipakai sebagai bab pada Surat Edaran, huruf besar sebagai sub-bab,
# lalu angka dan huruf kecil sebagai butir.
RE_N_ROMAWI = re.compile(r"^([IVXL]{1,5})\.\s+(.*)$")
RE_N_BESAR = re.compile(r"^([A-Z])\.\s+(.*)$")
RE_N_ANGKA = re.compile(r"^(\d{1,2})\.\s+(.*)$")
RE_N_HURUF = re.compile(r"^([a-z])\.\s+(.*)$")


def _urai_narasi(text: str) -> list[Unit]:
    """Urai dokumen berbentuk narasi bernomor menjadi unit yang dapat dikutip.

    Jalur ini hanya dipakai ketika penguraian biasa gagal — lihat pemanggilnya.
    Ia sengaja tidak mengenal pasal: bila dokumennya berpasal, penguraian biasa
    sudah berhasil dan jalur ini tidak pernah dijalankan.

    Angka Romawi dibedakan dari huruf besar dengan hati-hati: "I." dan "V."
    adalah keduanya, dan menebak salah membuat butir "I" bersarang di tempat
    yang keliru. Karena itu Romawi hanya diakui bila dokumen memang memuat
    urutan Romawi yang menaik.
    """
    baris = _lines(text)
    pakai_romawi = _ada_urutan_romawi(baris)

    units: list[Unit] = []
    romawi = besar = angka = huruf = None
    buf: list[str] = []
    seq = 0

    def flush():
        nonlocal buf, seq
        badan = " ".join(buf).strip()
        buf = []
        if len(badan) < 3:
            return
        seq += 1
        jalur = [x for x in (f"{romawi}." if romawi else None,
                             f"{besar}." if besar else None,
                             f"angka {angka}" if angka else None,
                             f"huruf {huruf}" if huruf else None) if x]
        units.append(Unit(seq, romawi, besar, None, None, huruf, angka,
                          "batang_tubuh", " > ".join(jalur) or "batang_tubuh",
                          badan))

    for b in baris:
        m = RE_N_ROMAWI.match(b) if pakai_romawi else None
        if m:
            flush(); romawi, besar, angka, huruf = m.group(1), None, None, None
            buf.append(m.group(2)); continue
        m = RE_N_BESAR.match(b)
        if m:
            flush(); besar, angka, huruf = m.group(1), None, None
            buf.append(m.group(2)); continue
        m = RE_N_ANGKA.match(b)
        if m:
            flush(); angka, huruf = m.group(1), None
            buf.append(m.group(2)); continue
        m = RE_N_HURUF.match(b)
        if m:
            flush(); huruf = m.group(1)
            buf.append(m.group(2)); continue
        buf.append(b)
    flush()
    return units


RE_BUTIR_AWAL = re.compile(
    r"^\s*(?:[0-9]{1,2}|[a-z]|[IVX]{1,4})\s*[.)]\s+\S", re.M)


def _ada_butir(text: str) -> bool:
    """Benar bila naskahnya memuat butir bernomor pada awal baris.

    Dua butir sudah cukup: satu bisa berasal dari kalimat yang kebetulan dibuka
    angka, dua yang berurutan menandai daftar. Batas ini lebih rendah daripada
    ambang panjang yang digantikannya, dan memang seharusnya — dokumen berbutir
    layak dipecah tanpa memandang panjangnya.
    """
    return len(RE_BUTIR_AWAL.findall(text or "")) >= 2


def _ada_urutan_romawi(baris: list[str]) -> bool:
    """Benarkah dokumen ini memakai angka Romawi sebagai penanda bab?"""
    urut = [m.group(1) for b in baris if (m := RE_N_ROMAWI.match(b))]
    return len(urut) >= 2 and urut[:2] == ["I", "II"]


RE_INLINE_ENUM = re.compile(r"(?:(?<=^)|(?<=[;.]\s))(\d{1,2})\.\s+(?=[A-Z])")


def _split_inline_enum(units: list[Unit]) -> list[Unit]:
    """Pecah blok Menimbang/Mengingat yang datang sebagai satu baris panjang.

    Situs DJP kadang menaruh daftar 'Mengingat' di dalam satu sel tabel, jadi
    penanda baris hilang. Tanpa langkah ini setiap dasar hukum kehilangan
    identitas butirnya dan tidak dapat dikutip per angka.
    """
    out: list[Unit] = []
    for u in units:
        if u.bagian_dok not in ("menimbang", "mengingat") or len(u.text) < 200:
            out.append(u); continue
        text = u.text.lstrip(": ").strip()
        marks = list(RE_INLINE_ENUM.finditer(text))
        if len(marks) < 2:
            u.text = text; out.append(u); continue
        for i, m in enumerate(marks):
            start = m.end()
            end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            body = text[start:end].strip(" ;.")
            if not body:
                continue
            out.append(Unit(u.seq, None, None, None, None, None, m.group(1),
                            u.bagian_dok, f"{u.bagian_dok} > angka {m.group(1)}", body))
    for i, u in enumerate(out, 1):
        u.seq = i
    return out


def tanggal_mulai_berlaku(units: list[Unit], tanggal_penetapan: str | None) -> tuple[str | None, str]:
    """Tentukan tanggal mulai berlaku dari klausul penutup.

    Mayoritas peraturan pajak berlaku 'pada tanggal diundangkan' (= tanggal
    penetapan pada praktik DJP) atau menyebut tanggal eksplisit. Bila tidak
    ditemukan, jatuh kembali ke tanggal penetapan dan tandai alasannya agar
    dapat diaudit.
    """
    from dateutil import parser as dtp

    BULAN = {"januari": 1, "februari": 2, "maret": 3, "april": 4, "mei": 5,
             "juni": 6, "juli": 7, "agustus": 8, "september": 9, "oktober": 10,
             "november": 11, "desember": 12}
    for u in units:
        if u.bagian_dok != "penutup":
            continue
        m = RE_MULAI_BERLAKU.search(u.text)
        if not m:
            continue
        if m.group(2):
            try:
                d, bln, y = m.group(2).split()
                if bln.lower() in BULAN:
                    return f"{int(y):04d}-{BULAN[bln.lower()]:02d}-{int(d):02d}", "eksplisit"
                return dtp.parse(m.group(2), dayfirst=True).date().isoformat(), "eksplisit"
            except Exception:                                   # noqa: BLE001
                pass
        return tanggal_penetapan, f"mengikuti tanggal {m.group(1).lower()}"
    return tanggal_penetapan, "default: tanggal penetapan (klausul tidak ditemukan)"


def store_units(conn, reg_id: str, units: list[Unit]) -> int:
    """Simpan unit satu peraturan; kembalikan jumlah yang SUNGGUH tersimpan.

    Bukan `len(units)`. Kunci yang bertabrakan membuat `INSERT OR REPLACE`
    menimpa, jadi melaporkan panjang masukan menyembunyikan tepat kegagalan yang
    paling perlu terlihat — 505 unit dilaporkan padahal 502 tersimpan, dan tiga
    yang hilang adalah pasal ketentuan umum.
    """
    conn.execute("DELETE FROM pasal WHERE reg_id=?", (reg_id,))
    # Nomor pasal dapat berulang di dalam satu dokumen. Kadang naskahnya memang
    # begitu, kadang penomorannya salah cetak, kadang penguraiannya keliru —
    # dan ketiganya menghasilkan kunci yang sama. Tanpa pembeda, yang datang
    # belakangan menimpa yang di depan: PMK 72/2023 memuat "Pasal 3" dua kali,
    # dan 12 dari 158 unitnya lenyap. Pada sampel 600 dokumen, 19,3% terkena,
    # dengan taksiran 189 ribu unit hilang di seluruh korpus.
    #
    # Pembedanya urutan kemunculan, bukan `seq`: `seq` bergeser setiap kali
    # penguraian berubah sedikit saja, dan kunci yang bergeser memutus setiap
    # rujukan yang pernah menunjuk ke sana.
    lihat: dict[str, int] = {}
    rows = []
    for u in units:
        uid = u.unit_id(reg_id)
        n = lihat.get(uid, 0) + 1
        lihat[uid] = n
        if n > 1:
            uid = f"{uid}~{n}"
        rows.append((uid, reg_id, u.seq, u.bab, u.bagian, u.pasal, u.ayat,
                     u.huruf, u.angka, u.bagian_dok, u.path, u.text))
    conn.executemany(
        "INSERT OR REPLACE INTO pasal(id,reg_id,seq,bab,bagian,pasal,ayat,huruf,"
        "angka,bagian_dok,path,text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    return conn.execute("SELECT COUNT(*) FROM pasal WHERE reg_id=?",
                        (reg_id,)).fetchone()[0]


def build_all(conn, limit=None, progress=print,
              ids: list[str] | None = None) -> int:
    """Pecah dokumen menjadi unit pasal.

    `ids` membatasi ke dokumen tertentu. Itu dipakai ketika penguraian sendiri
    yang berubah — misalnya saat pasal bernomor Romawi mulai dikenali — dan yang
    perlu diurai ulang hanya dokumen yang terkena, bukan sepuluh ribu.
    """
    q = "SELECT id,body_text FROM regulation WHERE body_text IS NOT NULL AND body_text<>''"
    param: tuple = ()
    if ids:
        q += " AND id IN (%s)" % ",".join("?" * len(ids))
        param = tuple(ids)
    if limit:
        q += f" LIMIT {int(limit)}"
    n = 0
    for row in conn.execute(q, param).fetchall():
        units = parse_body(row["body_text"])
        store_units(conn, row["id"], units)
        n += 1
        if n % 200 == 0:
            conn.commit(); progress(f"  {n} dokumen dipecah")
    conn.commit()
    return n


def reindex_fts(conn, progress=print) -> int:
    # Tabel FTS5 dibuat contentless (content=''), dan pada tabel semacam itu
    # `DELETE FROM` ditolak: "cannot DELETE from contentless fts5 table".
    # Perintah pengosongan yang benar adalah command khusus FTS5 di bawah ini.
    # Bug ini tidak terlihat selama korpus uji masih kecil karena tabelnya
    # memang belum pernah diisi ulang.
    conn.execute("INSERT INTO pasal_fts(pasal_fts) VALUES('delete-all')")
    conn.execute("DELETE FROM pasal_fts_map")
    rows = conn.execute(
        """SELECT p.id, p.text, p.path, r.canonical, r.judul
             FROM pasal p JOIN regulation r ON r.id=p.reg_id
            WHERE length(p.text) > 20"""
    ).fetchall()
    for i, r in enumerate(rows, 1):
        conn.execute("INSERT INTO pasal_fts_map(rowid,pasal_id) VALUES (?,?)", (i, r["id"]))
        conn.execute(
            "INSERT INTO pasal_fts(rowid,text,path,canonical,judul) VALUES (?,?,?,?,?)",
            (i, r["text"], r["path"], r["canonical"], r["judul"]))
    conn.commit()
    progress(f"  {len(rows)} unit terindeks")
    return len(rows)
