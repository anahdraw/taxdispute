import html
import json
import math
import re
import sqlite3
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen


ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "tax_dispute_prototype.sqlite"
ORTAX_BASE_URL = "https://datacenter.ortax.org/ortax/aturan/show"

PPN_SEED_RULES = [
    {
        "source_id": "13964",
        "note": "UU PPN 42/2009, salah satu rujukan utama sebelum perubahan HPP.",
    },
    {
        "source_id": "17575",
        "note": "UU HPP 7/2021, perubahan penting atas ketentuan PPN.",
    },
    {
        "source_id": "17321",
        "note": "PP 9/2021, perlakuan perpajakan untuk kemudahan berusaha termasuk PPN.",
    },
    {
        "source_id": "14198",
        "note": "PMK 72/PMK.03/2010, tata cara pengembalian kelebihan pembayaran PPN/PPnBM.",
    },
    {
        "source_id": "13286",
        "note": "PER-29/PJ/2008, SPT Masa PPN hard copy.",
    },
    {
        "source_id": "15278",
        "note": "PER-21/PJ/2013, perubahan tata cara penerimaan dan pengolahan SPT Masa PPN.",
    },
    {
        "source_id": "15020",
        "note": "Contoh PMK fasilitas/perlakuan PPN dan PPnBM.",
    },
    {
        "source_id": "26272",
        "note": "PER-6/PJ/2025, aturan baru yang memuat istilah PPN/PKP/BKP/JKP.",
    },
]

STOPWORDS = {
    "yang",
    "dan",
    "di",
    "ke",
    "dari",
    "dalam",
    "untuk",
    "dengan",
    "atas",
    "atau",
    "ini",
    "itu",
    "pada",
    "para",
    "bahwa",
    "adalah",
    "telah",
    "tidak",
    "oleh",
    "sebagai",
    "maka",
    "akan",
    "dapat",
    "karena",
    "berdasarkan",
    "peraturan",
    "undang",
    "nomor",
    "tahun",
    "pasal",
    "ayat",
}


@dataclass
class RegulationRecord:
    regulation_id: str
    source: str
    source_id: str
    url: str
    title: str
    regulation_type: str
    number: str
    year: Optional[int]
    topic: str
    category: str
    published_date: str
    status: str
    summary: str
    content: str
    fetched_at: str
    raw_json: str = ""


def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def connect(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    DATA_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def init_regulation_db(db_path: Path = DEFAULT_DB_PATH) -> None:
    with connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tax_regulations (
                regulation_id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                source_id TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                title TEXT,
                regulation_type TEXT,
                number TEXT,
                year INTEGER,
                topic TEXT,
                category TEXT,
                published_date TEXT,
                status TEXT,
                summary TEXT,
                content TEXT,
                raw_json TEXT,
                fetched_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(source, source_id)
            );

            CREATE TABLE IF NOT EXISTS tax_regulation_chunks (
                chunk_id TEXT PRIMARY KEY,
                regulation_id TEXT NOT NULL,
                chunk_order INTEGER NOT NULL,
                section_label TEXT,
                text TEXT NOT NULL,
                token_count INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY(regulation_id) REFERENCES tax_regulations(regulation_id)
            );

            CREATE TABLE IF NOT EXISTS tax_regulation_links (
                link_id TEXT PRIMARY KEY,
                regulation_id TEXT NOT NULL,
                related_source_id TEXT,
                relation_type TEXT,
                title TEXT,
                url TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(regulation_id) REFERENCES tax_regulations(regulation_id)
            );

            CREATE INDEX IF NOT EXISTS idx_tax_regulations_topic ON tax_regulations(topic);
            CREATE INDEX IF NOT EXISTS idx_tax_regulations_type ON tax_regulations(regulation_type);
            CREATE INDEX IF NOT EXISTS idx_tax_regulation_chunks_regulation ON tax_regulation_chunks(regulation_id);
            """
        )


def normalize_ortax_source_id(source: str) -> str:
    source = str(source or "").strip()
    if not source:
        return ""
    if source.startswith("http"):
        parsed = urlparse(source)
        query = parse_qs(parsed.query)
        if query.get("id"):
            return query["id"][0]
        match = re.search(r"/show/(\d+)", parsed.path)
        if match:
            return match.group(1)
    match = re.search(r"\d+", source)
    return match.group(0) if match else source


def ortax_url(source_id: str) -> str:
    return f"{ORTAX_BASE_URL}/{normalize_ortax_source_id(source_id)}"


def fetch_ortax_html(source: str, timeout: int = 25) -> Tuple[str, str, str]:
    source_id = normalize_ortax_source_id(source)
    if not source_id:
        raise ValueError("ID atau URL Ortax kosong.")
    url = ortax_url(source_id)
    request = Request(
        url,
        headers={
            "User-Agent": "TaxDisputePrototype/0.1 (+local research connector)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return source_id, url, response.read().decode(charset, errors="ignore")


def fetch_ortax_regulation(source: str) -> Tuple[RegulationRecord, List[Dict[str, str]]]:
    source_id, url, raw_html = fetch_ortax_html(source)
    return parse_ortax_regulation_html(raw_html, source_id, url)


def parse_ortax_regulation_html(raw_html: str, source_id: str, url: str) -> Tuple[RegulationRecord, List[Dict[str, str]]]:
    jsonld = extract_jsonld_fields(raw_html)
    raw_list = extract_raw_list_fields(raw_html, source_id)
    related = extract_related_regulations(raw_html, source_id)
    title = jsonld.get("headline") or raw_list.get("title") or extract_title(raw_html)
    number = jsonld.get("identifier") or raw_list.get("nomor") or raw_list.get("docNumber")
    summary = jsonld.get("description") or raw_list.get("perihal") or raw_list.get("description")
    content = clean_regulation_text(jsonld.get("articleBody") or extract_isiaturan_text(raw_html))
    category = raw_list.get("kategori_list") or raw_list.get("kategori") or infer_category(content, title, summary)
    regulation_type = raw_list.get("jenis") or infer_regulation_type(title, content)
    published = jsonld.get("datePublished") or raw_list.get("published_at") or raw_list.get("tanggal")
    year = extract_year(number) or extract_year(published) or extract_year(title) or extract_year(content[:1000])
    topic = "PPN" if is_ppn_text(" ".join([category, title, summary, content[:20000]])) else category.strip() or "UNKNOWN"
    status = raw_list.get("info_status") or raw_list.get("status") or ""

    if not title and content:
        title = content[:120]
    if not summary and content:
        summary = content[:500]

    record = RegulationRecord(
        regulation_id=stable_regulation_id("ortax", source_id),
        source="ortax",
        source_id=source_id,
        url=url,
        title=normalize_spaces(title),
        regulation_type=normalize_spaces(regulation_type),
        number=normalize_spaces(number),
        year=year,
        topic=normalize_spaces(topic),
        category=normalize_spaces(category),
        published_date=normalize_spaces(published),
        status=normalize_spaces(status),
        summary=normalize_spaces(summary),
        content=content,
        raw_json=json.dumps({"jsonld": jsonld, "raw_list": raw_list}, ensure_ascii=False),
        fetched_at=now_iso(),
    )
    return record, related


def extract_jsonld_fields(raw_html: str) -> Dict[str, str]:
    fields: Dict[str, str] = {}
    start = raw_html.find(r'{\"@context\":\"https://schema.org\",\"@type\":\"Article\"')
    block = raw_html[start : raw_html.find('"])</script>', start)] if start >= 0 else raw_html
    for key in ["headline", "description", "articleBody", "identifier", "datePublished", "dateModified"]:
        match = find_escaped_field(block, key)
        if match:
            fields[key] = decode_js_string(match.group(1))
    return fields


def extract_raw_list_fields(raw_html: str, source_id: str) -> Dict[str, str]:
    fields: Dict[str, str] = {}
    anchor = raw_html.find(rf'\"id\":{source_id},\"nomor\"')
    if anchor < 0:
        anchor = raw_html.find(rf'\"source_id\":{source_id},\"nomor\"')
    block = raw_html[anchor : anchor + 14000] if anchor >= 0 else raw_html
    patterns = {
        "nomor": r'\\"nomor\\":\\"(.*?)\\",',
        "perihal": r'\\"perihal\\":\\"(.*?)\\",\\"isi\\"',
        "jenis": r'\\"jenis\\":\\"(.*?)\\",\\"jenis_status\\"',
        "kategori_list": r'\\"kategori_list\\":\\"(.*?)\\"',
        "kategori": r'\\"kategori\\":\\"(.*?)\\"',
        "tanggal": r'\\"tanggal\\":\\"(.*?)\\"',
        "published_at": r'\\"published_at\\":\\"(.*?)\\"',
        "info_status": r'\\"info_status\\":\\"(.*?)\\"',
        "status": r'\\"status\\":\\"(.*?)\\"',
        "title": r'\\"title\\":\\"(.*?)\\",\\"docNumber\\"',
        "docNumber": r'\\"docNumber\\":\\"(.*?)\\"',
        "description": r'\\"docNumber\\":\\".*?\\",\\"description\\":\\"(.*?)\\"',
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, block, flags=re.S)
        if match:
            fields[key] = decode_js_string(match.group(1))
    return fields


def find_escaped_field(text: str, key: str) -> Optional[re.Match]:
    return re.search(rf'\\"{re.escape(key)}\\":\\"((?:\\\\.|[^"\\\\])*)\\"', text, flags=re.S)


def extract_related_regulations(raw_html: str, current_source_id: str) -> List[Dict[str, str]]:
    related: List[Dict[str, str]] = []
    seen = {str(current_source_id)}
    pattern = re.compile(
        r'\{\\"id\\":(\d+),\\"jenis\\":\\"(.*?)\\",\\"perihal\\":\\"(.*?)\\",\\"nomor\\":\\"(.*?)\\"',
        flags=re.S,
    )
    for match in pattern.finditer(raw_html):
        source_id = match.group(1)
        if source_id in seen:
            continue
        seen.add(source_id)
        jenis = decode_js_string(match.group(2))
        perihal = decode_js_string(match.group(3))
        nomor = decode_js_string(match.group(4))
        related.append(
            {
                "source_id": source_id,
                "title": normalize_spaces(f"{jenis} Nomor: {nomor}"),
                "type": normalize_spaces(jenis),
                "number": normalize_spaces(nomor),
                "description": normalize_spaces(perihal),
                "url": ortax_url(source_id),
            }
        )
    return related


def decode_js_string(value: str) -> str:
    if value is None:
        return ""
    try:
        decoded = json.loads(f'"{value}"')
    except Exception:
        decoded = value
        replacements = {
            r"\u003c": "<",
            r"\u003e": ">",
            r"\u0026": "&",
            r"\u002F": "/",
            r"\/": "/",
            r"\"": '"',
            r"\n": "\n",
            r"\r": "\r",
            r"\t": "\t",
        }
        for old, new in replacements.items():
            decoded = decoded.replace(old, new)
    decoded = html.unescape(decoded)
    return decoded.replace("\xa0", " ")


def extract_title(raw_html: str) -> str:
    match = re.search(r"<title>(.*?)</title>", raw_html, flags=re.S | re.I)
    if not match:
        return ""
    return normalize_spaces(html.unescape(re.sub(r"<[^>]+>", " ", match.group(1))))


def extract_isiaturan_text(raw_html: str) -> str:
    match = re.search(r'\\u003cdiv id=\\"isiaturan\\"\\u003e(.*?)\\u003c/div\\u003e"\]\)', raw_html, flags=re.S)
    if not match:
        return ""
    decoded = decode_js_string(match.group(0))
    decoded = re.sub(r"<br\s*/?>", "\n", decoded, flags=re.I)
    decoded = re.sub(r"</p>|</li>|</div>|</tr>", "\n", decoded, flags=re.I)
    decoded = re.sub(r"<[^>]+>", " ", decoded)
    return normalize_spaces(decoded)


def clean_regulation_text(text: str) -> str:
    text = decode_js_string(text or "")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p>|</li>|</div>|</tr>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text).replace("\xa0", " ")
    text = text.replace(" | ", " ")
    notices = [
        "Dokumen ini diketik ulang dan diperuntukan secara ekslusif untuk www.ortax.org dan TaxBaseX. Pengambilan dokumen ini yang dilakukan tanpa ijin adalah tindakan ilegal.",
        "Dokumen ini diketik ulang dan diperuntukan secara eksklusif untuk www.ortax.org dan TaxBaseX. Pengambilan dokumen ini yang dilakukan tanpa ijin adalah tindakan ilegal.",
    ]
    for notice in notices:
        text = text.replace(notice, " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def infer_category(*parts: str) -> str:
    joined = " ".join(part or "" for part in parts)
    return "PPN" if is_ppn_text(joined) else "UNKNOWN"


def is_ppn_text(text: str) -> bool:
    lower = f" {text.lower()} "
    return any(
        keyword in lower
        for keyword in [
            " ppn ",
            "ppn/",
            "pajak pertambahan nilai",
            "pajak masukan",
            "pajak keluaran",
            "faktur pajak",
            "pengusaha kena pajak",
            "barang kena pajak",
            "jasa kena pajak",
            "ppnbm",
        ]
    )


def infer_regulation_type(title: str, content: str) -> str:
    text = f"{title} {content[:1000]}".upper()
    if "UNDANG-UNDANG" in text:
        return "Undang-Undang"
    if "PERATURAN PEMERINTAH" in text:
        return "Peraturan Pemerintah"
    if "PERATURAN MENTERI KEUANGAN" in text:
        return "Peraturan Menteri Keuangan"
    if "PERATURAN DIREKTUR JENDERAL" in text:
        return "Peraturan Dirjen Pajak"
    if "KEPUTUSAN MENTERI KEUANGAN" in text:
        return "Keputusan Menteri Keuangan"
    if "SURAT EDARAN" in text:
        return "Surat Edaran"
    return "Peraturan"


def extract_year(text: str) -> Optional[int]:
    matches = re.findall(r"\b((?:19|20)\d{2})\b", text or "")
    return max(int(match) for match in matches) if matches else None


def stable_regulation_id(source: str, source_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{source}:{source_id}"))


def save_regulation(
    record: RegulationRecord,
    related: Optional[List[Dict[str, str]]] = None,
    db_path: Path = DEFAULT_DB_PATH,
) -> RegulationRecord:
    init_regulation_db(db_path)
    timestamp = now_iso()
    with connect(db_path) as conn:
        existing = conn.execute(
            "SELECT regulation_id, created_at FROM tax_regulations WHERE source = ? AND source_id = ?",
            (record.source, record.source_id),
        ).fetchone()
        regulation_id = existing["regulation_id"] if existing else record.regulation_id
        created_at = existing["created_at"] if existing else timestamp
        conn.execute(
            """
            INSERT INTO tax_regulations (
                regulation_id, source, source_id, url, title, regulation_type, number, year,
                topic, category, published_date, status, summary, content, raw_json,
                fetched_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source, source_id) DO UPDATE SET
                url = excluded.url,
                title = excluded.title,
                regulation_type = excluded.regulation_type,
                number = excluded.number,
                year = excluded.year,
                topic = excluded.topic,
                category = excluded.category,
                published_date = excluded.published_date,
                status = excluded.status,
                summary = excluded.summary,
                content = excluded.content,
                raw_json = excluded.raw_json,
                fetched_at = excluded.fetched_at,
                updated_at = excluded.updated_at
            """,
            (
                regulation_id,
                record.source,
                record.source_id,
                record.url,
                record.title,
                record.regulation_type,
                record.number,
                record.year,
                record.topic,
                record.category,
                record.published_date,
                record.status,
                record.summary,
                record.content,
                record.raw_json,
                record.fetched_at,
                created_at,
                timestamp,
            ),
        )
        conn.execute("DELETE FROM tax_regulation_chunks WHERE regulation_id = ?", (regulation_id,))
        for idx, (section_label, chunk) in enumerate(chunk_regulation_text(record.content), start=1):
            conn.execute(
                """
                INSERT INTO tax_regulation_chunks (chunk_id, regulation_id, chunk_order, section_label, text, token_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    regulation_id,
                    idx,
                    section_label,
                    chunk,
                    len(tokenize(chunk)),
                    timestamp,
                ),
            )
        conn.execute("DELETE FROM tax_regulation_links WHERE regulation_id = ?", (regulation_id,))
        for item in related or []:
            conn.execute(
                """
                INSERT INTO tax_regulation_links (link_id, regulation_id, related_source_id, relation_type, title, url, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    regulation_id,
                    item.get("source_id"),
                    "related",
                    item.get("title") or item.get("description") or item.get("number") or "",
                    item.get("url") or ortax_url(item.get("source_id", "")),
                    timestamp,
                ),
            )
    record.regulation_id = regulation_id
    return record


def fetch_and_store_ortax_regulation(source: str, db_path: Path = DEFAULT_DB_PATH) -> Dict[str, Any]:
    try:
        record, related = fetch_ortax_regulation(source)
        save_regulation(record, related, db_path=db_path)
        return {
            "ok": True,
            "error": None,
            "record": regulation_to_dict(record),
            "related_count": len(related),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc), "record": None, "related_count": 0}


def download_ppn_seed_regulations(
    db_path: Path = DEFAULT_DB_PATH,
    seed_rules: Optional[List[Dict[str, str]]] = None,
    follow_related: bool = True,
    max_related: int = 6,
) -> Dict[str, Any]:
    seed_rules = seed_rules or PPN_SEED_RULES
    queue = [(item["source_id"], item.get("note", "seed")) for item in seed_rules]
    seen = set()
    stored: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    related_added = 0

    while queue:
        source_id, reason = queue.pop(0)
        source_id = normalize_ortax_source_id(source_id)
        if not source_id or source_id in seen:
            continue
        seen.add(source_id)
        try:
            record, related = fetch_ortax_regulation(source_id)
            if is_ppn_text(" ".join([record.topic, record.category, record.title, record.summary, record.content[:20000]])):
                save_regulation(record, related, db_path=db_path)
                item = regulation_to_dict(record)
                item["reason"] = reason
                item["related_count"] = len(related)
                stored.append(item)
                if follow_related:
                    for rel in related:
                        if related_added >= max_related:
                            break
                        rel_text = " ".join([rel.get("title", ""), rel.get("description", ""), rel.get("number", "")])
                        if is_ppn_text(rel_text) and rel.get("source_id") not in seen:
                            queue.append((rel["source_id"], f"terkait dengan {record.number or record.source_id}"))
                            related_added += 1
            else:
                errors.append({"source_id": source_id, "error": "Tidak terdeteksi sebagai aturan PPN."})
        except Exception as exc:
            errors.append({"source_id": source_id, "error": str(exc)})

    return {"stored": stored, "errors": errors, "stored_count": len(stored), "error_count": len(errors)}


def refresh_ortax_regulations(
    db_path: Path = DEFAULT_DB_PATH,
    topic: str = "PPN",
    include_seed: bool = True,
    follow_related: bool = True,
    max_related: int = 6,
) -> Dict[str, Any]:
    init_regulation_db(db_path)
    seed_ids = [item["source_id"] for item in PPN_SEED_RULES] if include_seed else []
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT source_id
            FROM tax_regulations
            WHERE source = 'ortax' AND (? = 'ANY' OR COALESCE(topic, '') LIKE ? OR COALESCE(category, '') LIKE ?)
            ORDER BY COALESCE(year, 0) DESC, source_id
            """,
            (topic, f"%{topic}%", f"%{topic}%"),
        ).fetchall()
    existing_ids = [row["source_id"] for row in rows]
    seed_rules = [{"source_id": source_id, "note": "refresh berkala"} for source_id in dedupe(seed_ids + existing_ids)]
    return download_ppn_seed_regulations(
        db_path=db_path,
        seed_rules=seed_rules,
        follow_related=follow_related,
        max_related=max_related,
    )


def chunk_regulation_text(text: str, max_chars: int = 2200, overlap: int = 160) -> List[Tuple[str, str]]:
    text = normalize_spaces(text)
    if not text:
        return []
    matches = list(re.finditer(r"\b(Pasal\s+\d+[A-Z]?)\b", text, flags=re.I))
    segments: List[Tuple[str, str]] = []
    if matches:
        first_start = matches[0].start()
        if first_start > 80:
            segments.extend(split_long_segment("Pembukaan", text[:first_start], max_chars, overlap))
        for idx, match in enumerate(matches):
            start = match.start()
            end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
            label = normalize_spaces(match.group(1))
            segments.extend(split_long_segment(label, text[start:end], max_chars, overlap))
    else:
        segments.extend(split_long_segment("Isi", text, max_chars, overlap))
    return segments[:240]


def split_long_segment(label: str, text: str, max_chars: int, overlap: int) -> List[Tuple[str, str]]:
    text = normalize_spaces(text)
    if len(text) <= max_chars:
        return [(label, text)] if text else []
    chunks = []
    start = 0
    part = 1
    step = max(500, max_chars - overlap)
    while start < len(text):
        chunk = text[start : start + max_chars].strip()
        if chunk:
            chunks.append((f"{label} ({part})", chunk))
        part += 1
        start += step
    return chunks


def list_regulations(limit: int = 100, db_path: Path = DEFAULT_DB_PATH) -> List[Dict[str, Any]]:
    init_regulation_db(db_path)
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT r.*, COUNT(c.chunk_id) AS chunk_count
            FROM tax_regulations r
            LEFT JOIN tax_regulation_chunks c ON c.regulation_id = r.regulation_id
            GROUP BY r.regulation_id
            ORDER BY COALESCE(r.year, 0) DESC, r.title
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_regulation_stats(db_path: Path = DEFAULT_DB_PATH) -> Dict[str, Any]:
    init_regulation_db(db_path)
    with connect(db_path) as conn:
        total = conn.execute("SELECT COUNT(*) FROM tax_regulations").fetchone()[0]
        chunks = conn.execute("SELECT COUNT(*) FROM tax_regulation_chunks").fetchone()[0]
        by_type = {
            row["regulation_type"] or "UNKNOWN": row["count"]
            for row in conn.execute("SELECT regulation_type, COUNT(*) AS count FROM tax_regulations GROUP BY regulation_type")
        }
        by_topic = {
            row["topic"] or "UNKNOWN": row["count"]
            for row in conn.execute("SELECT topic, COUNT(*) AS count FROM tax_regulations GROUP BY topic")
        }
    return {"regulations": total, "regulation_chunks": chunks, "by_type": by_type, "by_topic": by_topic}


def search_regulations(
    query: str,
    topic: str = "PPN",
    limit: int = 8,
    db_path: Path = DEFAULT_DB_PATH,
) -> List[Dict[str, Any]]:
    init_regulation_db(db_path)
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT r.*, c.chunk_id, c.section_label, c.text AS chunk_text
            FROM tax_regulations r
            LEFT JOIN tax_regulation_chunks c ON c.regulation_id = r.regulation_id
            WHERE (? = 'ANY' OR COALESCE(r.topic, '') LIKE ? OR COALESCE(r.category, '') LIKE ?)
            """,
            (topic, f"%{topic}%", f"%{topic}%"),
        ).fetchall()

    query_tokens = Counter(tokenize(query))
    grouped: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        reg_id = row["regulation_id"]
        if reg_id not in grouped:
            grouped[reg_id] = {
                **{key: row[key] for key in row.keys() if key not in {"chunk_id", "section_label", "chunk_text"}},
                "score": 0.0,
                "reasons": [],
                "matched_chunks": [],
            }
        base_text = " ".join(
            [
                row["title"] or "",
                row["number"] or "",
                row["summary"] or "",
                row["regulation_type"] or "",
                row["section_label"] or "",
                row["chunk_text"] or "",
            ]
        )
        score, reasons = score_text(query_tokens, query, base_text, row["title"] or "", row["summary"] or "")
        if score > grouped[reg_id]["score"]:
            grouped[reg_id]["score"] = score
            grouped[reg_id]["reasons"] = reasons
        if score > 0 and row["chunk_text"]:
            grouped[reg_id]["matched_chunks"].append(
                {
                    "section_label": row["section_label"] or "",
                    "text": trim_snippet(row["chunk_text"], query_tokens),
                    "score": round(score, 1),
                }
            )

    results = []
    for item in grouped.values():
        if item["score"] > 0 or not query_tokens:
            item["matched_chunks"] = sorted(item["matched_chunks"], key=lambda c: c["score"], reverse=True)[:3]
            item["score"] = round(item["score"], 1)
            results.append(item)
    results.sort(key=lambda item: item["score"], reverse=True)
    return results[:limit]


def find_relevant_regulations_for_intake(
    intake: Dict[str, Any],
    limit: int = 6,
    db_path: Path = DEFAULT_DB_PATH,
) -> List[Dict[str, Any]]:
    query = " ".join(
        str(intake.get(key, ""))
        for key in [
            "tax_type",
            "issue_type",
            "djp_reason",
            "wp_reason",
            "available_evidence",
            "case_notes",
            "correction_amount",
        ]
    )
    topic = "PPN" if "ppn" in query.lower() or intake.get("tax_type") == "PPN" else "ANY"
    return search_regulations(query=query, topic=topic, limit=limit, db_path=db_path)


def score_text(query_tokens: Counter, query: str, text: str, title: str, summary: str) -> Tuple[float, List[str]]:
    text_tokens = Counter(tokenize(text))
    reasons = []
    score = 0.0
    if query_tokens:
        overlap = set(query_tokens) & set(text_tokens)
        weighted_overlap = sum(query_tokens[t] * (1 + math.log1p(text_tokens[t])) for t in overlap)
        norm = math.sqrt(sum(v * v for v in query_tokens.values())) * math.sqrt(sum(v * v for v in text_tokens.values()))
        score += (weighted_overlap / norm * 100) if norm else 0
        if overlap:
            reasons.append("Keyword sama: " + ", ".join(sorted(overlap)[:8]))
    lower_query = f" {query.lower()} "
    lower_text = f" {title.lower()} {summary.lower()} "
    for keyword, bonus in [
        ("pajak masukan", 12),
        ("faktur pajak", 12),
        ("spt masa ppn", 10),
        ("pengusaha kena pajak", 8),
        ("barang kena pajak", 7),
        ("jasa kena pajak", 7),
        ("pengembalian kelebihan", 8),
        ("restitusi", 8),
    ]:
        if keyword in lower_query and keyword in lower_text:
            score += bonus
            reasons.append(f"Topik cocok: {keyword}")
    if "restitusi" in lower_query and "pengembalian kelebihan" in lower_text:
        score += 18
        reasons.append("Topik cocok: restitusi / pengembalian kelebihan")
    if ("dikreditkan" in lower_query or "pengkreditan" in lower_query) and "pajak masukan" in lower_text:
        score += 10
        reasons.append("Topik cocok: pengkreditan pajak masukan")
    return score, reasons


def trim_snippet(text: str, query_tokens: Counter, width: int = 520) -> str:
    text = normalize_spaces(text)
    if len(text) <= width:
        return text
    lower = text.lower()
    positions = [lower.find(token) for token in query_tokens if len(token) > 3 and lower.find(token) >= 0]
    center = min(positions) if positions else 0
    start = max(0, center - width // 3)
    snippet = text[start : start + width].strip()
    if start > 0:
        snippet = "... " + snippet
    if start + width < len(text):
        snippet += " ..."
    return snippet


def regulation_to_dict(record: RegulationRecord) -> Dict[str, Any]:
    return {
        "regulation_id": record.regulation_id,
        "source": record.source,
        "source_id": record.source_id,
        "url": record.url,
        "title": record.title,
        "regulation_type": record.regulation_type,
        "number": record.number,
        "year": record.year,
        "topic": record.topic,
        "category": record.category,
        "published_date": record.published_date,
        "status": record.status,
        "summary": record.summary,
        "content_length": len(record.content or ""),
        "fetched_at": record.fetched_at,
    }


def dedupe(items: Iterable[str]) -> List[str]:
    seen = set()
    result = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def tokenize(text: str) -> List[str]:
    tokens = re.findall(r"[a-zA-Z0-9_./-]{3,}", (text or "").lower())
    normalized = []
    for token in tokens:
        token = token.strip("._/-")
        if len(token) >= 3 and token not in STOPWORDS:
            normalized.append(token)
    return normalized


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()
