"""Konektor Ortax Data Center — enumerasi katalog untuk analisis celah.

Ortax memuat 20.722 dokumen, jauh melampaui 6.029 di korpus kita. Sebagian
besar selisih itu bukan peraturan pajak yang kita lewatkan, melainkan lingkup
yang memang lebih luas: bea masuk, cukai, perdagangan, PNBP, OJK. Karena itu
selisih angka saja tidak berarti apa-apa — yang berarti adalah dokumen mana
yang *seharusnya* ada di korpus kita tetapi tidak ada.

Daftar publiknya dilayani `POST /api/search/aturan` — sudah terstruktur, jadi
tidak perlu mengurai HTML sama sekali.

**Tentang pengambilan naskah.** Halaman dokumen dilayani tanpa autentikasi dan
memuat naskah lengkapnya. Peraturan perundang-undangan dikecualikan dari hak
cipta oleh UU 28/2014 Pasal 42, dan ketikan ulang yang setia atas teks yang
sudah publik tidak melahirkan hak cipta baru karena tidak ada orisinalitas di
dalamnya. Ortax mencantumkan larangan pengambilan pada tiap halaman; itu
ketentuan layanan situs, bukan hak cipta atas peraturannya, dan menimbangnya
adalah keputusan pemilik pekerjaan yang memakai modul ini.

Yang dijaga di sisi teknis: jeda antar permintaan tidak dapat dinolkan lewat
pemakaian biasa, hasilnya disinggahkan agar satu dokumen tidak diambil dua
kali, dan tiap salinan ditandai `source='ortax'` sehingga asalnya tetap
terlacak dan dapat dibedakan dari salinan sumber resmi.
"""
from __future__ import annotations

import html as _html
import re
import time

from curl_cffi import requests

API = "https://datacenter.ortax.org/api/search/aturan"
RUJUKAN = "https://datacenter.ortax.org/ortax/aturan/list"
DOKUMEN = "https://datacenter.ortax.org/ortax/aturan/show/{id}"

# "Keputusan Menteri Keuangan Nomor: 37/MK/EF.2/2026"
# "Peraturan Dirjen Pajak Nomor: PER - 8/PJ/2026"
RE_JUDUL = re.compile(r"^(?P<jenis>.+?)\s+Nomor:\s*(?P<nomor>.+?)\s*$")


def _klien():
    return requests.Session(impersonate="chrome", timeout=30)


def halaman(page: int, per_page: int = 200, kueri: str = "",
            sesi=None) -> dict:
    s = sesi or _klien()
    r = s.post(API, json={"query": kueri, "page": page, "perPage": per_page},
               headers={"Content-Type": "application/json", "Referer": RUJUKAN})
    r.raise_for_status()
    return r.json()


def urai_judul(judul: str) -> tuple[str | None, str | None]:
    """Pisahkan "Peraturan Dirjen Pajak Nomor: PER - 8/PJ/2026".

    Ortax menulis nomor dengan spasi di sekitar tanda hubung ("PER - 8/PJ/2026")
    sedangkan katalog DJP menulisnya rapat ("PER-8/PJ/2026"). Spasi itu
    dirapatkan di sini, bukan di penormal umum, karena ia kekhasan satu sumber
    dan tidak boleh mempengaruhi pembacaan sumber lain.
    """
    # Spasi tak-putus (U+00A0) muncul di sebagian nomor dan terbawa sebagai
    # "Â" ketika halaman dibaca sebagai UTF-8. Dibersihkan di sini, di tepi
    # tempat kekhasan sumber ini berakhir, bukan di penormal umum.
    bersih = (judul or "").replace("\u00a0", " ").replace("\u00ad", "")
    m = RE_JUDUL.match(bersih.strip())
    if not m:
        return None, None
    nomor = re.sub(r"\s*-\s*", "-", m.group("nomor"))
    nomor = re.sub(r"\s+", " ", nomor).strip()
    return re.sub(r"\s+", " ", m.group("jenis")).strip(), nomor


def semua(per_page: int = 200, jeda: float = 0.4, batas_halaman: int | None = None,
          progress=print) -> list[dict]:
    """Ambil seluruh daftar sebagai metadata."""
    sesi = _klien()
    pertama = halaman(1, per_page, sesi=sesi)
    total = pertama.get("total", 0)
    n_hal = -(-total // per_page)
    if batas_halaman:
        n_hal = min(n_hal, batas_halaman)

    keluar = list(pertama.get("data", []))
    for p in range(2, n_hal + 1):
        time.sleep(jeda)
        try:
            keluar.extend(halaman(p, per_page, sesi=sesi).get("data", []))
        except Exception as e:                                # noqa: BLE001
            progress(f"  halaman {p} gagal: {type(e).__name__}: {str(e)[:60]}")
            continue
        if progress and p % 20 == 0:
            progress(f"  {len(keluar)}/{total}")
    return [_rapikan(x) for x in keluar]


def _rapikan(rec: dict) -> dict:
    jenis, nomor = urai_judul(rec.get("title") or rec.get("fullTitle") or "")
    return {
        "sumber_id": rec.get("id"),
        "url": DOKUMEN.format(id=rec.get("id")),
        "jenis_teks": jenis,
        "nomor_teks": nomor,
        "judul": (rec.get("description") or "").strip(),
        "tanggal": ((rec.get("raw") or {}).get("published_at") or "")[:10] or None,
        "kategori": ", ".join(c.get("title", "") for c in rec.get("categories") or []),
        "judul_penuh": rec.get("title"),
    }


# --- pengambilan naskah ----------------------------------------------------
# Naskah lengkapnya ada DUA KALI di halaman, dan yang mudah ditemukan bukan yang
# lengkap. Medan `articleBody` pada blok JSON-LD adalah cuplikan untuk mesin
# pencari — pada Surat Dirjen Pajak ia berakhir dengan "…" pada aksara ke-300,
# dan halaman itu sendiri menandainya `isFullContent: false`. Naskah sebenarnya
# ada di dalam `<div id="isiaturan">` pada payload RSC.
#
# Bahayanya bukan kegagalan: cuplikan 300 aksara tersimpan sebagai naskah yang
# sah, lengkap dengan judul dan nomor yang benar. Dokumennya terhitung masuk,
# dapat dicari, dapat dikutip — dan isinya potongan kalimat pertama.
RE_PUSH = re.compile(r'self\.__next_f\.push\(\[1,"')
PENANDA_ISI = '\\u003cdiv id=\\"isiaturan\\"'


def _isi_aturan(halaman: str) -> str | None:
    """Blok naskah terpanjang di dalam payload RSC, atau None bila tak ada."""
    kandidat = []
    for m in re.finditer(re.escape(PENANDA_ISI), halaman):
        a = halaman.rfind('self.__next_f.push([1,"', 0, m.start())
        if a < 0:
            continue
        b = halaman.find('"])', m.start())
        if b < 0:
            continue
        kandidat.append(halaman[a + len('self.__next_f.push([1,"'):b])
    return max(kandidat, key=len) if kandidat else None


RE_TAG_HTML = re.compile(r"<[^>]+>")
RE_BARIS_HTML = re.compile(r"</(?:tr|p|div|li|h[1-6])>|<br\s*/?>", re.I)
RE_SEL_HTML = re.compile(r"</t[dh]>", re.I)

# Butir daftar diberi nomornya kembali. Pada `<ol><li>` nomornya dirender oleh
# peramban dan TIDAK ada di dalam teks, jadi mengubah HTML menjadi teks apa
# adanya menghasilkan sederet kalimat tanpa penanda apa pun — dan pengurai
# struktur, yang bekerja dari penanda, tidak dapat memisahkannya. Surat Edaran
# 15/PJ.6/2005 berbaris 118 tetapi hanya menghasilkan 3 unit.
#
# Menomorinya bukan mengarang: nomor itu memang bagian dari dokumennya, hanya
# disimpan sebagai struktur alih-alih sebagai aksara. Daftar tak berurut diberi
# tanda hubung, karena di sana memang tidak ada nomor.
RE_LIST = re.compile(r"<(/?)(ol|ul|li)\b[^>]*>", re.I)


def _nomori_butir(v: str) -> str:
    """Kembalikan penanda butir yang hanya ada sebagai struktur HTML."""
    keluar, tumpuk, pos = [], [], 0
    for m in RE_LIST.finditer(v):
        keluar.append(v[pos:m.start()])
        pos = m.end()
        tutup, tag = m.group(1) == "/", m.group(2).lower()
        if tag in ("ol", "ul"):
            if tutup:
                if tumpuk:
                    tumpuk.pop()
            else:
                tumpuk.append([tag, 0])
        elif tag == "li" and not tutup:
            if tumpuk:
                tumpuk[-1][1] += 1
                jenis, n = tumpuk[-1]
                keluar.append(f"\n{n}. " if jenis == "ol" else "\n- ")
            else:
                keluar.append("\n- ")
        elif tag == "li" and tutup:
            keluar.append("\n")
    keluar.append(v[pos:])
    return "".join(keluar)


def _html_ke_teks(v: str) -> str:
    """Blok ter-escape RSC → naskah berbaris, penanda tetap di tempatnya."""
    v = (v.replace("\\u003c", "<").replace("\\u003e", ">")
          .replace("\\u0026", "&").replace('\\"', '"'))
    v = v.replace("\\\\n", "\n").replace("\\n", "\n").replace("\\r", "")
    v = _nomori_butir(v)
    v = RE_SEL_HTML.sub("\t", v)
    v = RE_BARIS_HTML.sub("\n", v)
    v = RE_TAG_HTML.sub("", v)
    v = _html.unescape(v)
    v = re.sub(r"[ \t]*\t[ \t]*", " ", v)
    v = re.sub(r"[ \u00a0]+", " ", v)
    v = re.sub(r" *\n *", "\n", v)
    return re.sub(r"\n{3,}", "\n\n", v).strip()


# Kalimat pengantar yang disisipkan pada tiap naskah — muncul DUA kali, di awal
# dan di akhir. Keduanya dibuang karena bukan bagian dari peraturannya;
# membiarkannya akan mencemari setiap pencarian dan setiap kutipan dengan teks
# yang bukan norma, dan yang di akhir akan terbaca sebagai penutup dokumen.
RE_PENGANTAR = re.compile(
    r"\s*Dokumen ini diketik ulang.*?tindakan ilegal\.\s*", re.S | re.I)

JEDA_MINIMUM = 0.8

# Naskah Ortax datang sebagai SATU baris panjang tanpa jeda baris sama sekali,
# sedangkan pengurai struktur bekerja per baris. Tanpa penataan ulang, setiap
# dokumen — berapa pun panjangnya — masuk sebagai satu unit dan tidak dapat
# dikutip per pasal maupun per diktum. Itu menghapus seluruh manfaat korpus ini.
#
# Penanda yang dipecah sengaja dibatasi pada yang bentuknya tegas: kata pembuka
# resmi, "Pasal N", "BAB N", dan kata urutan diktum. Ayat "(1)" dan huruf "a."
# TIDAK dipecah membabi buta — keduanya lazim muncul di tengah kalimat sebagai
# rujukan ("sebagaimana dimaksud pada ayat (2)"), dan memecahnya di sana justru
# mematahkan kalimat menjadi unit-unit palsu.
_ORDINAL_DIKTUM = (
    "KESATU|PERTAMA|KEDUA|KETIGA|KEEMPAT|KELIMA|KEENAM|KETUJUH|KEDELAPAN|"
    "KESEMBILAN|KESEPULUH|KESEBELAS")

RE_PECAH = re.compile(
    r"(?=\b(?:Menimbang|Mengingat|Memperhatikan|MEMUTUSKAN|Menetapkan)\s*:)"
    r"|(?=\bBAB\s+[IVXLC]+\b)"
    rf"|(?=\b(?:{_ORDINAL_DIKTUM})\s*:)", re.M)

# Pemecahan di "Pasal N" HANYA untuk bentuk yang benar-benar berpasal. Pada
# Surat Edaran — yang tidak berpasal sama sekali — setiap rujukan di tengah
# kalimat ("sebagaimana dimaksud dalam Pasal 17D Undang-Undang KUP") akan
# berubah menjadi judul pasal, dan korpus mendapat sitasi ke pasal yang tidak
# pernah ada. Mengarang struktur lebih buruk daripada kurang mengurai.
RE_PECAH_PASAL = re.compile(r"(?=\bPasal\s+\d+[A-Z]?\b\s*(?:[A-Z(]|$))", re.M)

# Butir bernomor pada bentuk narasi. Hanya dipecah sesudah akhir kalimat atau
# titik dua, sehingga "Pasal 21 ayat (1) huruf a." di tengah kalimat tidak ikut
# terpotong.
RE_PECAH_BUTIR = re.compile(
    r"(?<=[.;:])\s+(?=(?:[IVXL]{1,5}|[A-Za-z]|\d{1,2})\.\s+[A-Z])")

# Bentuk yang strukturnya butir bernomor, bukan pasal.
BENTUK_NARASI = {"SE", "S", "INS", "ND", "PENG", "S-PJ", "S-MK", "S-DJBC",
                 "S-DJA", "S-DJPB", "SE-DJBC", "SE-DJA", "SE-DJPB", "S-KAWAT"}

# Ayat dipecah hanya bila didahului akhir kalimat atau titik dua — itu menandai
# awal butir, bukan rujukan di tengah kalimat.
RE_PECAH_AYAT = re.compile(r"(?<=[.;:])\s+(?=\(\d+[a-z]?\)\s)")


def rapikan_naskah(teks: str, jenis_code: str | None = None) -> str:
    """Kembalikan jeda baris pada naskah yang datang sebagai satu paragraf.

    Cara memecah bergantung pada bentuk dokumennya. Yang berpasal dipecah di
    "Pasal N"; yang berbentuk narasi dipecah di butir bernomor dan justru TIDAK
    boleh dipecah di "Pasal N", karena di sana kata itu selalu rujukan.
    """
    t = (teks or "").replace("&nbsp;", " ").replace(" ", " ").replace("Â", "")
    t = re.sub(r"[ \t]+", " ", t)
    t = RE_PECAH.sub("\n", t)
    if (jenis_code or "").upper() in BENTUK_NARASI:
        t = RE_PECAH_BUTIR.sub("\n", t)
    else:
        t = RE_PECAH_PASAL.sub("\n", t)
    t = RE_PECAH_AYAT.sub("\n", t)
    # Ayat pertama menempel pada judul pasalnya ("Pasal 2 (1) Atas penyerahan
    # …") karena tidak didahului akhir kalimat. Dipisah di sini, sesudah
    # pemecahan baris, ketika "Pasal N" sudah pasti berada di awal baris —
    # sebelum itu ia tidak dapat dibedakan dari rujukan di tengah kalimat.
    t = re.sub(r"^(Pasal \d+[A-Z]?|BAB [IVXLC]+)\s+(?=\(\d+[a-z]?\)\s)",
               r"\1\n", t, flags=re.M)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


# Halaman dokumen memuat blok JSON-LD schema.org, dan `articleBody` di dalamnya
# berisi naskah lengkapnya. Yang menyulitkan bukan tempatnya melainkan
# **kedalaman escape-nya, yang berbeda antar dokumen**: pada sebagian halaman
# blok itu satu lapis, pada sebagian lain tiga lapis karena JSON-nya tertanam di
# dalam JSON lain.
#
# Pola berkedalaman tetap membuat separuhnya tak terbaca — dan tak terbacanya
# muncul sebagai "dokumen tidak ditemukan", bukan sebagai galat penguraian. Pada
# Surat Dirjen Pajak itu 11 dari 12 dokumen pertama, padahal naskahnya ada di
# halaman yang sama.
#
# Pola berkedalaman bebas pun tidak cukup: kutip di DALAM naskah ber-escape
# lebih dalam lagi, dan pola non-greedy berhenti di sana — 300 aksara untuk
# dokumen yang panjangnya ribuan. Karena itu ujung nilainya dicari dengan
# menghitung kedalaman, bukan dengan mencocokkan pola.
RE_KUNCI_BODY = re.compile(r'(\\*)"articleBody\\*"\s*:\s*(\\*)"')
RE_KUNCI_JUDUL = re.compile(r'(\\*)"headline\\*"\s*:\s*(\\*)"')


def _nilai_json(teks: str, kunci: re.Pattern) -> str | None:
    """Nilai satu medan JSON, apa pun kedalaman escape-nya.

    Nilainya berakhir pada runtun garis miring yang panjangnya SAMA dengan
    pembukanya dan tidak didahului garis miring lain. Kutip di dalam naskah
    selalu ber-escape lebih dalam, jadi ia tidak pernah keliru dianggap penutup.
    """
    m = kunci.search(teks)
    if not m:
        return None
    dalam = len(m.group(2))
    mulai = m.end()
    pos = mulai
    while True:
        i = teks.find('"', pos)
        if i < 0:
            return None
        # Garis miring persis di depan kutip ini. Penutup nilai adalah kutip
        # yang didahului tepat sebanyak pembukanya; kutip di dalam naskah selalu
        # ber-escape lebih dalam, jadi ia tidak pernah keliru dianggap penutup.
        j = i
        while j > 0 and teks[j - 1] == "\\":
            j -= 1
        if i - j == dalam:
            return teks[mulai:j]
        pos = i + 1


def ambil_dokumen(sumber_id: str, sesi=None, jeda: float = 1.0,
                  jenis_code: str | None = None) -> dict | None:
    """Ambil naskah satu dokumen dari halaman publiknya.

    Jeda tidak dapat ditekan di bawah `JEDA_MINIMUM` lewat pemakaian biasa:
    mengambil ribuan dokumen secepat mungkin membebani situs orang lain tanpa
    alasan, dan tidak mempercepat apa pun yang benar-benar penting.
    """
    s = sesi or _klien()
    try:
        r = s.get(DOKUMEN.format(id=sumber_id), headers={"Referer": RUJUKAN})
    except Exception:                                        # noqa: BLE001
        return None
    finally:
        time.sleep(max(jeda, JEDA_MINIMUM))

    if r.status_code != 200:
        return None
    # Blok `isiaturan` lebih dahulu; `articleBody` hanya cadangan. Urutan ini
    # yang membedakan naskah dari cuplikan.
    blok = _isi_aturan(r.text)
    if blok:
        mentah = _html_ke_teks(blok)
    else:
        mentah = _nilai_json(r.text, RE_KUNCI_BODY)
        if mentah is None:
            return None

    # Runtun garis miring dirapatkan lebih dahulu: pada blok tiga lapis, satu
    # kutip di dalam naskah tertulis sebagai enam garis miring, dan
    # `unicode_escape` sekali jalan menyisakannya sebagai sampah di tengah teks.
    while "\\\\" in mentah:
        rapat = mentah.replace("\\\\", "\\")
        if rapat == mentah:
            break
        mentah = rapat
    try:
        teks = mentah.encode("utf-8").decode("unicode_escape")
        teks = teks.encode("latin-1", "ignore").decode("utf-8", "ignore")
    except Exception:                                        # noqa: BLE001
        teks = mentah
    teks = rapikan_naskah(RE_PENGANTAR.sub("", teks), jenis_code)
    # Halaman yang gagal dirakit tetap mengembalikan blok JSON-LD dengan
    # articleBody nyaris kosong. Ambang ini memisahkannya dari dokumen sungguhan
    # tanpa perlu menebak dari kode status.
    if len(teks) < 200:
        return None

    judul = _nilai_json(r.text, RE_KUNCI_JUDUL)
    return {"sumber_id": str(sumber_id),
            "url": DOKUMEN.format(id=sumber_id),
            "judul": judul,
            "teks": teks,
            "panjang": len(teks)}
