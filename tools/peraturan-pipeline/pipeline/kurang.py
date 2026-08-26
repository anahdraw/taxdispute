"""Apa yang masih kurang — dikumpulkan dari seluruh pemeriksaan yang ada.

Modul ini tidak menghitung apa pun yang baru. Ia menyatukan jawaban yang sudah
tersebar di `qc`, `celah`, `celah_urut`, `tinjau`, dan `verifikasi` menjadi satu
daftar, karena pertanyaan "apa lagi yang kurang" tidak dapat dijawab oleh satu
pemeriksaan mana pun.

Setiap baris menyebut **tindakannya**, bukan hanya angkanya. Angka tanpa
tindakan hanya menjadi laporan yang dibaca sekali; dan sebagian kekurangan di
sini memang tidak bisa ditindak oleh program — yang butuh keputusan lingkup atau
langganan disebut apa adanya, bukan disamarkan sebagai pekerjaan yang tertunda.
"""
from __future__ import annotations

import json
from pathlib import Path

TAK_DAPAT_DIPROGRAM = "keputusan manusia"


def _satu(nama, jumlah, dari, tindakan, catatan=""):
    return {"nama": nama, "jumlah": jumlah, "dari": dari,
            "tindakan": tindakan, "catatan": catatan}


def laporan(conn, data_dir: str | Path = "data") -> list[dict]:
    d = Path(data_dir)
    out = []
    n_dok = conn.execute("SELECT COUNT(*) FROM regulation").fetchone()[0]

    # --- naskah -----------------------------------------------------------
    out.append(_satu(
        "Dokumen tanpa naskah",
        conn.execute("SELECT COUNT(*) FROM regulation WHERE has_body=0"
                     ).fetchone()[0], n_dok,
        "sudah dicoba di peraturan.go.id, JDIH Kemenkeu, JDIH BPK, Ortax, dan "
        "DDTC — tidak ada sumber terjangkau yang memuatnya",
        "sisa ini kemungkinan hanya ada sebagai pindaian di penerbitnya"))

    ada_pdf = conn.execute(
        "SELECT COUNT(DISTINCT reg_id) FROM attachment "
        " WHERE local_path IS NOT NULL").fetchone()[0]
    out.append(_satu(
        "Dokumen tanpa PDF resmi tersimpan", n_dok - ada_pdf, n_dok,
        "PDF hanya terunduh sebagai efek samping verifikasi; belum ada langkah "
        "yang mengunduhnya secara sengaja",
        "naskah DDTC berupa teks; PDF aslinya di balik langganan "
        "(access_file_ori=false). Untuk kepastian hukum, pindaian resmi perlu "
        "diambil dari peraturan.go.id / JDIH per dokumen"))

    # --- identitas --------------------------------------------------------
    out.append(_satu(
        "Peraturan daerah tanpa daerah pada identitasnya",
        conn.execute(
            "SELECT COUNT(*) FROM regulation WHERE jenis_code='PERDA' "
            "  AND (kategori IS NULL OR (kategori NOT LIKE 'Provinsi%' "
            "   AND kategori NOT LIKE 'Kab%' AND kategori NOT LIKE 'Kota%'))"
        ).fetchone()[0],
        conn.execute("SELECT COUNT(*) FROM regulation WHERE jenis_code='PERDA'"
                     ).fetchone()[0],
        "naskahnya tidak menyebut daerah yang dapat dipadankan ke taksonomi, "
        "atau menyebut lebih dari satu",
        "tingkatnya pada tangga Pasal 7 belum dapat dipastikan (huruf f atau g)"))

    # --- cakupan daerah ---------------------------------------------------
    tercakup = conn.execute(
        "SELECT COUNT(DISTINCT kategori) FROM regulation "
        " WHERE kategori LIKE 'Provinsi%' OR kategori LIKE 'Kab%' "
        "    OR kategori LIKE 'Kota%'").fetchone()[0]
    tak = 0
    berkas_tak = d / "ddtc_taksonomi_daerah.json"
    if berkas_tak.exists():
        semua = json.loads(berkas_tak.read_text("utf-8"))
        tak = len(semua) - tercakup
        out.append(_satu(
            "Daerah tanpa satu pun peraturan di korpus", tak, len(semua),
            "katalog DDTC memang mencatatnya kosong untuk daerah-daerah ini",
            "bukan kekurangan pengambilan; daerahnya belum menerbitkan atau "
            "belum masuk ke DDTC"))

    # --- rujukan ----------------------------------------------------------
    gantung = conn.execute(
        "SELECT COUNT(*) FROM relation WHERE dst_id IS NULL").fetchone()[0]
    atas = [dict(r) for r in conn.execute(
        "SELECT dst_raw, COUNT(*) n FROM relation WHERE dst_id IS NULL "
        " GROUP BY dst_raw ORDER BY n DESC LIMIT 5")]
    out.append(_satu(
        "Rujukan yang sasarannya tidak ada di korpus", gantung,
        conn.execute("SELECT COUNT(*) FROM relation").fetchone()[0],
        "sasaran tersering adalah undang-undang non-pajak yang dikutip hampir "
        "setiap Perda sebagai dasar hukum",
        "; ".join(f'{r["dst_raw"]} ({r["n"]}x)' for r in atas)))

    # --- status -----------------------------------------------------------
    beda = conn.execute(
        "SELECT COUNT(*) FROM verifikasi v JOIN validity d ON d.reg_id=v.reg_id "
        " WHERE v.sumber='ddtc' AND v.status_baku='dicabut' "
        "   AND d.status_derived='berlaku'").fetchone()[0]
    out.append(_satu(
        "DDTC menyatakan dicabut, kita menghitung berlaku", beda, n_dok,
        "sudah masuk antrean tinjauan pada keyakinan 0,62 — DDTC penerbit "
        "swasta, tidak boleh memutus sendiri",
        "sebabnya peraturan pencabutnya belum ada di korpus, jadi relasi "
        "pencabutan tidak pernah terbentuk. Arah kekeliruan paling berbahaya"))

    # --- antrean ----------------------------------------------------------
    antre = conn.execute(
        "SELECT COUNT(*) FROM temuan WHERE status='antre'").fetchone()[0]
    out.append(_satu(
        "Temuan menunggu peninjau", antre,
        conn.execute("SELECT COUNT(*) FROM temuan").fetchone()[0],
        "buka tab Tinjauan pada server; yang aman sudah diselesaikan otomatis "
        "dan bertanda auto-resolve"))

    # --- lingkup ----------------------------------------------------------
    berkas_banding = d / "ddtc_banding_pusat.json"
    if berkas_banding.exists():
        b = json.loads(berkas_banding.read_text("utf-8"))
        lebih = [x for x in b if x["selisih"] > 0
                 and x["kode"] not in ("UU", "PERPU", "PP", "PERPRES",
                                       "INPRES", "KEPPRES")]
        out.append(_satu(
            "Dokumen DDTC di bentuk yang kita bawa, belum diambil",
            sum(x["selisih"] for x in lebih), None,
            TAK_DAPAT_DIPROGRAM,
            "mengambilnya memperluas lingkup korpus dari perpajakan menjadi "
            "fiskal umum (bea masuk, cukai, PNBP). "
            + ", ".join(f'{x["kode"]} +{x["selisih"]}'
                        for x in sorted(lebih, key=lambda y: -y["selisih"])[:4])))

    # --- Ortax ------------------------------------------------------------
    try:
        spj = conn.execute(
            "SELECT COUNT(*) FROM katalog_luar WHERE sumber='ortax' "
            "  AND jenis_code='S-PJ' AND ada_di_kita=0").fetchone()[0]
        if spj:
            out.append(_satu(
                "Surat Dirjen Pajak (S-PJ) di Ortax, belum diambil", spj, None,
                TAK_DAPAT_DIPROGRAM,
                "surat, bukan peraturan: mengikat penerima tertentu, bukan umum. "
                "Nilai rujukannya paling rendah di korpus ini"))
    except Exception:                                          # noqa: BLE001
        pass

    return [x for x in out if x["jumlah"]]
