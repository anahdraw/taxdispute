"""Ekstraksi relasi antar-peraturan — inti dari knowledge graph.

Katalog DJP hanya memberi satu label status per dokumen ("Aktif", "Dicabut",
"Diubah/Disempurnakan/Dicabut sebagian"). Label itu TIDAK memberi tahu
*peraturan mana* yang mencabut, *pasal mana* yang diubah, atau *sejak kapan*.
Semua itu hanya ada di dalam teks — terutama di klausul penutup dan judul.

Strategi tiga lapis:
  Lapis 0 (aturan)   — pola tekstual berkepercayaan tinggi; menangani ~90%
                       kasus dengan biaya nol dan hasil yang dapat diaudit.
  Lapis 1 (LLM murah)— hanya kandidat ambigu (daftar pencabutan panjang,
                       pencabutan sebagian, rujukan tak ter-resolve).
  Lapis 2 (LLM kuat) — hanya bila lapis 0 dan lapis 1 saling bertentangan,
                       atau bertentangan dengan status resmi situs.

Setiap relasi menyimpan kalimat buktinya, sehingga klaim apa pun di aplikasi
hilir dapat ditelusuri kembali ke sumbernya.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from .config import RULE_CONFIDENCE_AUTO
from .normalize import alias_key, extract_refs, normalize_nomor, urutan_perubahan

MENCABUT = "MENCABUT"
MENCABUT_SEBAGIAN = "MENCABUT_SEBAGIAN"
MENGUBAH = "MENGUBAH"
DASAR_HUKUM = "DASAR_HUKUM"
MELAKSANAKAN = "MELAKSANAKAN"

# Frasa pemicu di klausul penutup.
TRIG_CABUT = re.compile(
    r"(dicabut\s+dan\s+dinyatakan\s+tidak\s+berlaku|dinyatakan\s+tidak\s+berlaku|"
    r"dicabut(?!\s+sebagian))", re.I)
TRIG_CABUT_SEBAGIAN = re.compile(
    r"(dicabut\s+sebagian|sepanjang\s+mengatur|kecuali\s+ketentuan)", re.I)
TRIG_TETAP_BERLAKU = re.compile(
    r"(tetap\s+berlaku|dinyatakan\s+masih\s+berlaku|masih\s+tetap\s+berlaku)", re.I)
# "sebagaimana telah diubah (beberapa kali) (terakhir) dengan X"
TRIG_STDD = re.compile(
    r"sebagaimana\s+telah\s+(?:beberapa\s+kali\s+)?diubah\s*(?:terakhir\s*)?dengan",
    re.I)
TRIG_PELAKSANAAN = re.compile(
    r"(sebagai\s+pelaksanaan\s+ketentuan|untuk\s+melaksanakan\s+ketentuan|"
    r"dalam\s+rangka\s+melaksanakan\s+ketentuan)", re.I)
RE_SCOPE = re.compile(r"(Pasal\s+\d+[A-Z]?(?:\s+ayat\s+\(\d+\))?"
                      r"(?:\s+huruf\s+[a-z])?)", re.I)


@dataclass
class Cand:
    src_id: str
    dst_raw: str
    type: str
    evidence: str
    evidence_pasal_id: str | None = None
    scope: str | None = None
    confidence: float = 0.5
    method: str = "rule"
    dst_id: str | None = None
    # Kunci hasil normalisasi saat rujukan diekstrak. Wajib dibawa: teks mentah
    # sering hanya "6 Tahun 1983" tanpa jenis dokumen, sehingga penguraian
    # ulang di tahap resolusi pasti gagal — jenisnya hanya diketahui dari
    # kalimat asalnya ("Undang-Undang Nomor 6 Tahun 1983").
    dst_key_hint: str | None = None
    note: str = ""
    meta: dict = field(default_factory=dict)


def _sentences(text: str) -> list[str]:
    # Jangan pecah pada titik di dalam nomor (PMK.03) atau singkatan.
    parts = re.split(r"(?<=[a-z0-9\)])\.\s+(?=[A-Z(])|;\s+(?=[a-z0-9]\.|\()", text)
    return [p.strip() for p in parts if p and p.strip()]


# --- Lapis 0: aturan --------------------------------------------------------
def from_judul(reg: dict) -> list[Cand]:
    """Judul peraturan perubahan menyebut induknya secara eksplisit."""
    out = []
    judul = reg.get("judul") or ""
    if not re.search(r"\bPERUBAHAN\b", judul, re.I) and \
       not re.search(r"\bPENCABUTAN\b", judul, re.I):
        return out
    tipe = MENCABUT if re.search(r"\bPENCABUTAN\b", judul, re.I) else MENGUBAH
    for ref in extract_refs(judul, reg.get("tahun")):
        out.append(Cand(reg["id"], ref["raw"], tipe, judul[:400],
                        dst_key_hint=(ref["regid"].key if ref["regid"] else None),
                        confidence=0.97, method="rule",
                        meta={"urutan": urutan_perubahan(judul), "asal": "judul"}))
        break     # judul perubahan hanya menyebut satu induk
    return out


TRIG_KETENTUAN_PENUTUP = re.compile(
    r"(pada\s+saat\s+.{0,80}?\s+ini\s+mulai\s+berlaku|dengan\s+berlakunya|"
    r"dengan\s+ditetapkannya|terhitung\s+sejak\s+berlakunya)", re.I)


def from_penutup(reg: dict, units: list[dict]) -> list[Cand]:
    """Klausul pencabutan.

    Klausul ini TIDAK selalu berada di pasal yang sama dengan 'mulai berlaku'.
    Pada PER-31/PJ/2009 misalnya, pencabutan ada di Pasal 27 sedangkan
    'mulai berlaku' di Pasal 28. Karena itu kita memindai seluruh batang tubuh
    dan mengandalkan syarat gabungan: ada frasa pemicu pencabutan DAN ada
    rujukan peraturan lain di kalimat yang sama.
    """
    out: list[Cand] = []
    n = len(units) or 1
    pos = {u["id"]: i for i, u in enumerate(units)}
    kandidat = [u for u in units
                if u["bagian_dok"] in ("penutup", "batang_tubuh")
                and (TRIG_CABUT.search(u["text"]) or TRIG_CABUT_SEBAGIAN.search(u["text"]))]
    for u in kandidat:
        text = u["text"]
        for sent in _sentences(text):
            if TRIG_TETAP_BERLAKU.search(sent) and not TRIG_CABUT.search(sent):
                continue                      # klausul "tetap berlaku" bukan pencabutan
            refs = extract_refs(sent, reg.get("tahun"))
            if not refs:
                continue
            # Abaikan rujukan ke dirinya sendiri.
            refs = [r for r in refs
                    if not (r["regid"] and r["regid"].key == reg["id"])]
            if not refs:
                continue

            m_seb = TRIG_CABUT_SEBAGIAN.search(sent)
            m_cab = TRIG_CABUT.search(sent)
            if not (m_seb or m_cab):
                continue

            # Rujukan sesudah frasa "sebagaimana telah diubah dengan" adalah
            # peraturan pengubah, bukan sasaran pencabutan yang berdiri sendiri.
            stdd_spans = [m.end() for m in TRIG_STDD.finditer(sent)]

            tipe = MENCABUT_SEBAGIAN if m_seb else MENCABUT
            scope = None
            if m_seb:
                sm = RE_SCOPE.search(sent)
                scope = sm.group(1) if sm else None
            multi = len(refs) > 1
            # Klausul penutup sejati punya frasa pembuka khas; bila tidak ada,
            # kalimat bisa saja membahas pencabutan hal lain (NPWP, izin, dsb).
            konteks_penutup = bool(TRIG_KETENTUAN_PENUTUP.search(sent))
            di_akhir = pos.get(u["id"], 0) >= n * 0.7
            for r in refs:
                is_amender = any(0 <= r["span"][0] - s < 120 for s in stdd_spans)
                conf = 0.95
                if multi:
                    conf = 0.85          # daftar panjang mudah salah atribusi
                if is_amender:
                    conf = 0.70          # posisi sintaksis ambigu -> verifikasi
                if tipe == MENCABUT_SEBAGIAN:
                    conf = min(conf, 0.75)
                if not konteks_penutup:
                    conf -= 0.15
                if not di_akhir:
                    conf -= 0.10
                out.append(Cand(reg["id"], r["raw"], tipe, sent[:600],
                                evidence_pasal_id=u["id"], scope=scope,
                                dst_key_hint=(r["regid"].key if r["regid"] else None),
                                confidence=round(max(conf, 0.05), 2), method="rule",
                                note="kandidat-pengubah" if is_amender else "",
                                meta={"asal": "penutup", "jumlah_rujukan": len(refs),
                                      "konteks_penutup": konteks_penutup}))
    return out


def from_stdd(reg: dict, units: list[dict]) -> list[Cand]:
    """'X sebagaimana telah diubah dengan Y' — observasi pihak ketiga.

    Sumber relasi adalah Y (pengubah), bukan dokumen yang sedang dibaca.
    Sinyal ini sangat berharga: ia mengisi rantai amandemen untuk peraturan
    lama yang badan teksnya sendiri tidak tersedia di situs DJP.
    """
    out: list[Cand] = []
    for u in units:
        for m in TRIG_STDD.finditer(u["text"]):
            after = u["text"][m.end():m.end() + 200]
            before = u["text"][max(0, m.start() - 260):m.start()]
            tgt = extract_refs(after, reg.get("tahun"))
            src = extract_refs(before, reg.get("tahun"))
            if not tgt or not src:
                continue
            pengubah, induk = tgt[0], src[-1]
            if not (pengubah["regid"] and induk["regid"]):
                continue
            if pengubah["regid"].key == induk["regid"].key:
                continue
            out.append(Cand(pengubah["regid"].key, induk["raw"], MENGUBAH,
                            (before[-120:] + " ⟦" + m.group(0) + "⟧ " + after[:120]),
                            evidence_pasal_id=u["id"], confidence=0.80,
                            method="rule", dst_key_hint=induk["regid"].key,
                            meta={"asal": "stdd", "dilaporkan_oleh": reg["id"]}))
    return out


# "Beberapa ketentuan dalam Undang-Undang Nomor 6 Tahun 1983 ... diubah
# sebagai berikut:" — pola undang-undang omnibus.
TRIG_OMNIBUS = re.compile(
    r"(?:Beberapa\s+ketentuan(?:\s+dan\s+menambah\s+ketentuan\s+baru)?\s+"
    r"(?:dalam|pada)|Ketentuan\s+(?:Pasal\s+[\w\s,()]{1,40}\s+)?dalam)\s+", re.I)
TRIG_OMNIBUS_TAIL = re.compile(r"diubah\s+(?:sebagai\s+berikut|sehingga)", re.I)


def from_omnibus(reg: dict, units: list[dict]) -> list[Cand]:
    """Undang-undang omnibus yang mengubah beberapa UU dari batang tubuh.

    Ditemukan lewat gold set: UU 7/2021 (HPP) mengubah enam undang-undang
    sekaligus, tetapi judulnya "HARMONISASI PERATURAN PERPAJAKAN" — bukan
    "PERUBAHAN ATAS ...". Aturan berbasis judul melewatkan seluruh relasinya.
    Pola yang benar ada di batang tubuh: "Beberapa ketentuan dalam <X> ...
    diubah sebagai berikut:". Hal yang sama berlaku untuk UU Cipta Kerja.

    Sasarannya adalah rujukan PERTAMA setelah frasa pemicu; rujukan sesudah
    "sebagaimana telah diubah dengan" adalah riwayat perubahan induk, bukan
    sasaran tambahan.
    """
    out: list[Cand] = []
    for u in units:
        if u["bagian_dok"] not in ("batang_tubuh", "penutup"):
            continue
        for m in TRIG_OMNIBUS.finditer(u["text"]):
            ekor = u["text"][m.end():m.end() + 1400]
            if not TRIG_OMNIBUS_TAIL.search(ekor):
                continue
            refs = extract_refs(ekor, reg.get("tahun"))
            if not refs:
                continue
            stdd = TRIG_STDD.search(ekor)
            induk = next((r for r in refs
                          if not stdd or r["span"][0] < stdd.start()), refs[0])
            if induk["regid"] and induk["regid"].key == reg["id"]:
                continue
            bukti = re.sub(r"\s+", " ", m.group(0) + ekor)[:600]
            out.append(Cand(reg["id"], induk["raw"], MENGUBAH, bukti,
                            evidence_pasal_id=u["id"], confidence=0.93,
                            dst_key_hint=(induk["regid"].key if induk["regid"] else None),
                            method="rule", meta={"asal": "omnibus", "peran": "induk"}))
            # Mengubah "UU 8/1983 s.t.d.t.d. UU 42/2009" menyentuh dua simpul:
            # undang-undang induk DAN perubahan terakhirnya (versi konsolidasi
            # yang sebenarnya berlaku). peraturan.go.id mencatat keduanya, dan
            # untuk penelusuran rantai perubahan keduanya memang diperlukan.
            if stdd:
                terakhir = next((r for r in refs if r["span"][0] > stdd.end()), None)
                if terakhir and terakhir["regid"] and \
                        terakhir["regid"].key != reg["id"]:
                    out.append(Cand(
                        reg["id"], terakhir["raw"], MENGUBAH, bukti,
                        evidence_pasal_id=u["id"], confidence=0.85,
                        dst_key_hint=terakhir["regid"].key, method="rule",
                        note="perubahan-terakhir-dari-induk",
                        meta={"asal": "omnibus", "peran": "perubahan_terakhir"}))
    return out


def from_mengingat(reg: dict, units: list[dict]) -> list[Cand]:
    out = []
    for u in units:
        if u["bagian_dok"] != "mengingat":
            continue
        stdd_spans = [m.end() for m in TRIG_STDD.finditer(u["text"])]
        for r in extract_refs(u["text"], reg.get("tahun")):
            # Rujukan tepat setelah "sebagaimana telah diubah dengan" adalah
            # peraturan pengubah dari dasar hukum, bukan dasar hukum mandiri.
            pengubah = any(0 <= r["span"][0] - s < 120 for s in stdd_spans)
            out.append(Cand(reg["id"], r["raw"], DASAR_HUKUM, u["text"][:300],
                            evidence_pasal_id=u["id"], confidence=0.99,
                            method="rule",
                            dst_key_hint=(r["regid"].key if r["regid"] else None),
                            meta={"asal": "mengingat",
                                  "peran": "pengubah" if pengubah else "induk"}))
    return out


def from_menimbang(reg: dict, units: list[dict]) -> list[Cand]:
    out = []
    for u in units:
        if u["bagian_dok"] != "menimbang":
            continue
        if not TRIG_PELAKSANAAN.search(u["text"]):
            continue
        for r in extract_refs(u["text"], reg.get("tahun")):
            sm = RE_SCOPE.search(u["text"])
            out.append(Cand(reg["id"], r["raw"], MELAKSANAKAN, u["text"][:400],
                            evidence_pasal_id=u["id"],
                            dst_key_hint=(r["regid"].key if r["regid"] else None),
                            scope=sm.group(1) if sm else None,
                            confidence=0.85, method="rule",
                            meta={"asal": "menimbang"}))
    return out


def extract_for(reg: dict, units: list[dict]) -> list[Cand]:
    cands = (from_judul(reg) + from_penutup(reg, units) + from_stdd(reg, units)
             + from_omnibus(reg, units) + from_mengingat(reg, units)
             + from_menimbang(reg, units))
    # Dedup: pertahankan kepercayaan tertinggi per (src, dst, type, scope).
    best: dict[tuple, Cand] = {}
    for c in cands:
        k = (c.src_id, c.dst_raw.upper(), c.type, c.scope or "")
        if k not in best or c.confidence > best[k].confidence:
            best[k] = c
    return list(best.values())


# --- Resolusi rujukan ke dokumen -------------------------------------------
def build_alias_index(conn) -> tuple[dict, dict]:
    """Peta kunci-ketat dan kunci-longgar untuk mencocokkan kutipan."""
    strict = {}
    loose: dict[str, list[str]] = {}
    for row in conn.execute(
            "SELECT id,nomor_raw,jenis,tahun FROM regulation").fetchall():
        strict[row["id"]] = row["id"]
        rid = normalize_nomor(row["nomor_raw"], row["jenis"], row["tahun"])
        ak = alias_key(rid)
        if ak:
            loose.setdefault(ak, []).append(row["id"])
    return strict, loose


def resolve(cands: list[Cand], strict: dict, loose: dict, tahun_hint=None) -> None:
    for c in cands:
        if c.dst_key_hint and c.dst_key_hint in strict:
            c.dst_id = c.dst_key_hint
            continue
        rid = normalize_nomor(c.dst_raw, None, tahun_hint)
        if rid and rid.key in strict:
            c.dst_id = rid.key
            continue
        ak = alias_key(rid)
        if ak and len(loose.get(ak, [])) == 1:
            # Alias longgar hanya dipercaya bila unik di seluruh korpus.
            c.dst_id = loose[ak][0]
            c.confidence = min(c.confidence, 0.88)
            c.note = (c.note + " alias-longgar").strip()
            continue
        if ak and len(loose.get(ak, [])) > 1:
            c.note = (c.note + " alias-ambigu").strip()
            c.confidence = min(c.confidence, 0.55)


# --- Lapis 1: verifikasi LLM murah -----------------------------------------
VERIFY_SYSTEM = """Anda adalah pemverifikasi relasi peraturan perundang-undangan Indonesia, khusus bidang perpajakan.

Tugas: memeriksa satu kandidat relasi yang diusulkan oleh parser berbasis aturan, lalu memutuskan apakah kandidat itu benar menurut KALIMAT BUKTI yang diberikan.

Jenis relasi:
- MENCABUT: peraturan sumber mencabut seluruh peraturan sasaran sehingga tidak berlaku lagi.
- MENCABUT_SEBAGIAN: hanya sebagian ketentuan (pasal/ayat tertentu) yang dicabut atau dinyatakan tidak berlaku.
- MENGUBAH: peraturan sumber mengubah sebagian rumusan peraturan sasaran, sasaran tetap berlaku dalam versi terubah.
- DASAR_HUKUM: sasaran dirujuk sebagai dasar hukum pada bagian Mengingat.
- MELAKSANAKAN: sumber diterbitkan untuk melaksanakan ketentuan pasal tertentu dalam sasaran.

Aturan penilaian:
1. Putuskan HANYA berdasarkan kalimat bukti. Jangan memakai pengetahuan luar tentang peraturan tersebut.
2. Frasa "sebagaimana telah diubah dengan Y" berarti Y mengubah peraturan yang disebut SEBELUMNYA — bukan berarti Y ikut dicabut.
3. Frasa "tetap berlaku", "masih berlaku", atau "sepanjang tidak bertentangan" BUKAN pencabutan.
4. Bila kalimat bukti tidak cukup untuk memastikan, jawab benar=false dengan alasan "bukti tidak memadai". Lebih baik menolak daripada menebak.
5. Bila jenis relasi salah tetapi ada relasi lain yang jelas benar, isi jenis_seharusnya.
6. Bila pencabutan hanya menyangkut pasal tertentu, isi lingkup (contoh: "Pasal 5 ayat (2)").

Jawab hanya dengan objek JSON sesuai skema."""

VERIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "benar": {"type": "boolean"},
        "jenis_seharusnya": {
            "type": "string",
            "enum": ["MENCABUT", "MENCABUT_SEBAGIAN", "MENGUBAH",
                     "DASAR_HUKUM", "MELAKSANAKAN", "TIDAK_ADA"],
        },
        "lingkup": {"type": "string"},
        "keyakinan": {"type": "number"},
        "alasan": {"type": "string"},
    },
    "required": ["benar", "jenis_seharusnya", "lingkup", "keyakinan", "alasan"],
    "additionalProperties": False,
}


def verify_prompt(c: Cand, src_label: str, dst_label: str) -> str:
    return json.dumps({
        "peraturan_sumber": src_label,
        "peraturan_sasaran": dst_label or c.dst_raw,
        "jenis_relasi_diusulkan": c.type,
        "lingkup_diusulkan": c.scope or "",
        "catatan_parser": c.note or "",
        "kalimat_bukti": c.evidence,
    }, ensure_ascii=False, indent=1)


def needs_verification(c: Cand) -> bool:
    if c.type == DASAR_HUKUM:
        return False                      # nilai rendah, presisi aturan sudah tinggi
    return c.confidence < RULE_CONFIDENCE_AUTO


def apply_verdict(c: Cand, v: dict) -> Cand:
    if v.get("_error"):
        c.note = (c.note + f" llm-gagal:{v['_error']}").strip()
        return c
    c.method = "rule+llm"
    c.verified = True
    if not v.get("benar"):
        alt = v.get("jenis_seharusnya", "TIDAK_ADA")
        if alt in (MENCABUT, MENCABUT_SEBAGIAN, MENGUBAH, MELAKSANAKAN):
            c.type = alt
            c.confidence = float(v.get("keyakinan", 0.7))
        else:
            c.confidence = 0.0            # ditolak
    else:
        if v.get("jenis_seharusnya") not in ("", "TIDAK_ADA", c.type):
            c.type = v["jenis_seharusnya"]
        c.confidence = max(c.confidence, float(v.get("keyakinan", 0.9)))
    if v.get("lingkup"):
        c.scope = v["lingkup"]
    c.note = (c.note + " | " + str(v.get("alasan", ""))[:200]).strip(" |")
    return c


# --- Penyimpanan ------------------------------------------------------------
def store(conn, cands: list[Cand]) -> int:
    n = 0
    for c in cands:
        if c.confidence <= 0:
            continue
        conn.execute(
            """INSERT INTO relation(src_id,dst_id,dst_raw,type,scope,evidence,
                    evidence_pasal_id,method,confidence,verified)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(src_id,dst_raw,type,IFNULL(scope,'')) DO UPDATE SET
                    dst_id=COALESCE(excluded.dst_id,relation.dst_id),
                    confidence=MAX(excluded.confidence,relation.confidence),
                    method=excluded.method, verified=excluded.verified,
                    evidence=excluded.evidence""",
            (c.src_id, c.dst_id, c.dst_raw, c.type, c.scope, c.evidence,
             c.evidence_pasal_id, c.method, c.confidence,
             1 if getattr(c, "verified", False) else 0))
        n += 1
    return n


def run_rules(conn, limit=None, progress=print) -> tuple[int, int]:
    q = ("SELECT id,judul,tahun,nomor_raw,jenis FROM regulation "
         "WHERE has_body=1")
    if limit:
        q += f" LIMIT {int(limit)}"
    regs = [dict(r) for r in conn.execute(q).fetchall()]
    strict, loose = build_alias_index(conn)
    total = unresolved = 0
    for i, reg in enumerate(regs, 1):
        units = [dict(u) for u in conn.execute(
            "SELECT id,text,bagian_dok FROM pasal WHERE reg_id=? ORDER BY seq",
            (reg["id"],)).fetchall()]
        if not units:
            continue
        cands = extract_for(reg, units)
        resolve(cands, strict, loose, reg.get("tahun"))
        unresolved += sum(1 for c in cands if c.dst_id is None)
        total += store(conn, cands)
        if i % 200 == 0:
            conn.commit(); progress(f"  {i}/{len(regs)} dokumen — {total} relasi")
    conn.commit()
    return total, unresolved
