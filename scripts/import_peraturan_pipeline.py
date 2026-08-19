#!/usr/bin/env python3
"""Import the audited ``peraturan-pipeline`` SQLite corpus into AA Jurist.

The importer is deliberately independent from the Next.js runtime.  It reads
the pipeline database in read-only mode, normalises records into the schema
used by the local Python prototype, writes deterministic JSONL artifacts, and
optionally upserts those artifacts into ``tax_dispute_prototype.sqlite``.

Important properties:

* Stable IDs are derived from ``source + pipeline id``; a second run updates
  the same rows instead of duplicating them.
* Chunk and graph-link IDs are SHA-256 based and therefore idempotent too.
* Invalid records are quarantined with an explicit reason.  They are never
  silently dropped or guessed.
* Non-government source URLs are not exposed as citation URLs.  The text is
  retained for local discovery but remains ``review_required`` in the trust
  layer.  Government URLs are preserved only when they are HTTPS ``.go.id``.
* Source and graph provenance is retained in ``raw_json`` and in the manifest.

This script does not change the web UI or the source pipeline database.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import hashlib
import json
import re
import sqlite3
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse


SCHEMA_VERSION = "aa-jurist-peraturan-import-v1"
DEFAULT_SOURCE = Path("/Users/sintzu/Anahdraw/peraturan-pipeline/data/peraturan.db")
DEFAULT_TARGET = Path("data/tax_dispute_prototype.sqlite")
DEFAULT_OUTPUT = Path("data/regulation-pipeline-import")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_id(*parts: object) -> str:
    return hashlib.sha256("\x1f".join(str(part or "") for part in parts).encode("utf-8")).hexdigest()[:32]


def norm_text(value: object) -> str:
    value = unicodedata.normalize("NFKC", str(value or ""))
    value = value.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n[ \t]+", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def redact_external_mentions(value: object) -> str:
    """Remove product/source boilerplate that should not reach the UI.

    This intentionally does not touch legal terms such as "pajak".  Source
    URLs are handled separately by ``safe_official_url``.
    """

    text = norm_text(value)
    # Use linear substitutions here.  A preceding-context pattern looks neat
    # but becomes catastrophically slow on multi-megabyte legal bodies.
    text = re.sub(r"(?im)^[^\n]*(?:ortax(?:\.org)?|taxbasex|hukumonline|ddtc)[^\n]*$", "", text)
    text = re.sub(r"\b(?:ortax(?:\.org)?|taxbasex|hukumonline|ddtc)\b", "", text, flags=re.IGNORECASE)
    # Remove product names even when embedded in a URL or a compound name
    # such as Coretaxpedia; a word-boundary-only replacement misses both.
    text = re.sub(r"https?://[^\s)\]>]*coretax[^\s)\]>]*", "[tautan resmi DJP]", text, flags=re.IGNORECASE)
    text = re.sub(r"\bcore\s+tax\s+administration\s+system\b", "sistem administrasi perpajakan DJP", text, flags=re.IGNORECASE)
    text = re.sub(r"\bcoretax[a-z0-9_-]*\b", "sistem administrasi perpajakan DJP", text, flags=re.IGNORECASE)
    text = re.sub(r"\bcoretax\b", "sistem administrasi perpajakan DJP", text, flags=re.IGNORECASE)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def safe_official_url(value: object) -> str:
    url = norm_text(value)
    if not url:
        return ""
    try:
        parsed = urlparse(url)
    except ValueError:
        return ""
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme.lower() != "https" or not host:
        return ""
    if host == "go.id" or host.endswith(".go.id"):
        return url
    return ""


def safe_official_pdf_url(value: object) -> str:
    """Keep only an HTTPS government PDF attachment as a public PDF link.

    The crawl database also contains local paths and occasional non-PDF
    attachments.  Local paths must never leak into the JSON snapshot; only a
    government-hosted PDF URL is suitable for a user-facing citation.
    """

    url = safe_official_url(value)
    if not url:
        return ""
    try:
        path = (urlparse(url).path or "").lower()
    except ValueError:
        return ""
    return url if path.endswith(".pdf") else ""


def local_reference_url(pipeline_id: str) -> str:
    """Return a non-network URI for records whose source is not official.

    The prototype schema requires a unique, non-null URL.  A local opaque URI
    satisfies that legacy constraint without exposing a secondary publisher
    or creating a misleading clickable citation.
    """

    return f"aa-jurist-local://regulation/{stable_id('local-reference', pipeline_id)}"


def parse_year(value: object, fallback: object = "") -> int | None:
    try:
        number = int(value) if str(value or "").strip() else None
        if number and 1800 <= number <= 2200:
            return number
    except (TypeError, ValueError):
        pass
    match = re.search(r"\b((?:19|20)\d{2})\b", f"{value or ''} {fallback or ''}")
    return int(match.group(1)) if match else None


def topic_for(row: sqlite3.Row, content: str) -> str:
    source = " ".join(str(row[key] or "") for key in ("kategori", "judul", "jenis"))
    text = f"{source} {content[:30000]}".lower()
    if re.search(r"\bppn\b|pajak pertambahan nilai|pajak masukan|faktur pajak|ppnbm", text):
        return "PPN"
    if re.search(r"\bpph\b|pajak penghasilan", text):
        return "PPh"
    if re.search(r"kup|ketentuan umum dan tata cara perpajakan", text):
        return "KUP"
    category = norm_text(row["kategori"])
    return category.split(",")[0].strip() if category else "general"


def derived_status(row: sqlite3.Row) -> str:
    site = norm_text(row["status_site"])
    if site:
        return site
    return "Status belum terverifikasi"


def relation_type(value: object) -> str:
    mapping = {
        "MENGUBAH": "amends",
        "MENCABUT": "revokes",
        "MENCABUT_SEBAGIAN": "partially_revokes",
        "DASAR_HUKUM": "legal_basis",
        "MELAKSANAKAN": "implements",
        "MENGGANTI": "replaces",
    }
    return mapping.get(norm_text(value).upper(), "related")


RELATION_HIERARCHY = {
    "UU": 1,
    "PERPU": 1,
    "PP": 2,
    "PERPRES": 3,
    "KEPPRES": 3,
    "PMK": 5,
    "KMK": 5,
    "PER": 6,
    "KEP": 6,
    "SE": 7,
    "INS": 7,
    "PENG": 7,
}


def serving_relation(row: sqlite3.Row, source_row: sqlite3.Row | None, target_row: dict[str, Any] | None) -> bool:
    """Allow only externally verified, auditable edges into answer context.

    The complete graph remains available in ``links.jsonl`` and the quality
    snapshot.  The serving projection is intentionally stricter: an unresolved
    or heuristic edge must never influence an answer merely because it exists
    in the source database.
    """

    if source_row is None or target_row is None:
        return False
    if not bool(row["verified"]):
        return False
    confidence = row["confidence"]
    if confidence is None or float(confidence) < 0.92:
        return False
    if norm_text(row["conflict"]):
        return False
    if not norm_text(row["evidence"]):
        return False
    if norm_text(row["src_id"]) == norm_text(row["dst_id"]):
        return False
    relation = norm_text(row["type"]).upper()
    if relation in {"MENGUBAH", "MENCABUT", "MENCABUT_SEBAGIAN"}:
        src_type = norm_text(source_row["jenis_code"]).upper()
        dst_type = norm_text(target_row.get("regulation_type_code")).upper()
        if src_type in RELATION_HIERARCHY and dst_type in RELATION_HIERARCHY and RELATION_HIERARCHY[src_type] > RELATION_HIERARCHY[dst_type]:
            return False
        src_year = parse_year(source_row["tahun"], source_row["canonical"])
        dst_year = parse_year(target_row.get("year"), target_row.get("number"))
        if src_year and dst_year and src_year < dst_year:
            return False
    return True


def approx_tokens(text: str) -> int:
    # Deterministic and good enough for the existing prototype UI.
    return max(1, len(re.findall(r"\S+", text))) if text else 0


def split_fallback(text: str, max_chars: int = 9000) -> list[tuple[str, str]]:
    """Create deterministic chunks when a body has no parsed pasal rows."""

    paragraphs = [part.strip() for part in re.split(r"\n{2,}", text) if part.strip()]
    if not paragraphs:
        paragraphs = [line.strip() for line in text.splitlines() if line.strip()]
    chunks: list[tuple[str, str]] = []
    buf: list[str] = []
    size = 0
    for paragraph in paragraphs:
        if buf and size + len(paragraph) + 1 > max_chars:
            chunks.append(("body", "\n\n".join(buf)))
            buf, size = [], 0
        buf.append(paragraph)
        size += len(paragraph) + 1
    if buf:
        chunks.append(("body", "\n\n".join(buf)))
    return chunks


def read_rows(conn: sqlite3.Connection, query: str, params: tuple = ()) -> Iterable[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    yield from conn.execute(query, params)


def ensure_target_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys=ON;
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


def valid_row(row: sqlite3.Row) -> str | None:
    required = {
        "id": norm_text(row["id"]),
        "judul": norm_text(row["judul"]),
        "canonical": norm_text(row["canonical"]),
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        return f"missing_required:{','.join(missing)}"
    if not norm_text(row["url"]) and norm_text(row["source"]) != "sdsn-djp-2023":
        return "missing_source_url"
    return None


def normalize_regulation(
    row: sqlite3.Row,
    source_rows: dict[str, sqlite3.Row],
    attachments_by_reg: dict[str, list[sqlite3.Row]] | None = None,
) -> dict[str, Any]:
    body = redact_external_mentions(row["body_text"])
    official_url = safe_official_url(row["url"])
    pipeline_id = norm_text(row["id"])
    attachments = (attachments_by_reg or {}).get(pipeline_id, [])
    official_pdf_urls = list(dict.fromkeys(safe_official_pdf_url(attachment["url"]) for attachment in attachments if safe_official_pdf_url(attachment["url"])))
    pdf_attachment = next((attachment for attachment in attachments if safe_official_pdf_url(attachment["url"])), None)
    official_pdf_url = official_pdf_urls[0] if official_pdf_urls else ""
    source = "peraturan-pipeline"
    # The original source is useful for audit, but never becomes a user-facing
    # citation label.  It remains in raw_json for data stewardship review.
    title = redact_external_mentions(row["judul"])
    canonical = redact_external_mentions(row["canonical"] or row["nomor_raw"])
    category = redact_external_mentions(row["kategori"])
    jenis = redact_external_mentions(row["jenis"])
    summary_parts = [canonical, title]
    if category:
        summary_parts.append(f"Kategori: {category}")
    if row["status_site"]:
        summary_parts.append(f"Status katalog: {derived_status(row)}")
    if body:
        summary_parts.append(body[:1800])
    raw = {
        "schema": SCHEMA_VERSION,
        "pipelineId": pipeline_id,
        "pipelineSourceClass": "official-government" if official_url else "secondary-or-local",
        "pipelineCanonical": norm_text(row["canonical"]),
        "pipelineStatus": norm_text(row["status_site"]),
        "identity": {
            "idBody": norm_text(row["id_body"]),
            "canonicalBody": norm_text(row["canonical_body"]),
            "identityOk": row["identity_ok"],
        },
        "validity": dict(source_rows.get(pipeline_id, {})) if pipeline_id in source_rows else {},
        "provenance": {
            "sourceUrlPresent": bool(norm_text(row["url"])),
            "officialUrlRetained": bool(official_url),
            "officialPdfUrlPresent": bool(official_pdf_url),
            "officialPdfCount": len(official_pdf_urls),
            "localPdfAvailable": bool(pdf_attachment and norm_text(pdf_attachment["local_path"])),
            "sourceHash": norm_text(row["sha256"]),
        },
    }
    return {
        "regulation_id": f"pipeline:{pipeline_id}",
        "source": source,
        "source_id": pipeline_id,
        "url": official_url or local_reference_url(pipeline_id),
        "title": title,
        "regulation_type": jenis,
        "regulation_type_code": norm_text(row["jenis_code"]),
        "number": canonical,
        "year": parse_year(row["tahun"], canonical),
        "topic": topic_for(row, body),
        "category": category,
        "published_date": norm_text(row["tanggal"]),
        "status": derived_status(row),
        "summary": redact_external_mentions("\n".join(summary_parts)),
        "content": body,
        "raw_json": json.dumps(raw, ensure_ascii=False, sort_keys=True),
        # Deterministic fallback for curated/local rows that predate crawl
        # timestamps; using utc_now() here would break idempotent artifact
        # hashes even when the source database is unchanged.
        "fetched_at": norm_text(row["fetched_at"]) or norm_text(row["tanggal"]) or "1970-01-01T00:00:00Z",
        "pipeline_id": pipeline_id,
        "pipeline_sha256": norm_text(row["sha256"]),
        "official_pdf_url": official_pdf_url,
        "official_pdf_urls": official_pdf_urls,
        "has_body": bool(body),
    }


def stable_source_fingerprint(conn: sqlite3.Connection) -> str:
    digest = hashlib.sha256()
    query = "SELECT id,canonical,judul,source,url,sha256,body_text FROM regulation ORDER BY id"
    for row in conn.execute(query):
        for value in row:
            digest.update(str(value or "").encode("utf-8"))
            digest.update(b"\0")
    attachment_table = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='attachment'").fetchone()
    if attachment_table:
        for row in conn.execute("SELECT reg_id,url,local_path,pages,text_ratio,route,ocr_conf FROM attachment ORDER BY reg_id,id"):
            for value in row:
                digest.update(str(value or "").encode("utf-8"))
                digest.update(b"\0")
    return digest.hexdigest()


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    count = 0
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            handle.write("\n")
            count += 1
    return count


def write_jsonl_gz(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    count = 0
    # Level 6 keeps the snapshot compact while avoiding a multi-minute level-9
    # CPU pass over hundreds of megabytes of provisions.
    # Use an explicit zero mtime: gzip.open's default timestamp would make the
    # artifact hash change on every otherwise-identical import.
    with path.open("wb") as raw:
        with gzip.GzipFile(filename=path.name, mode="wb", fileobj=raw, mtime=0, compresslevel=6) as compressed:
            with io.TextIOWrapper(compressed, encoding="utf-8", newline="\n") as handle:
                for row in rows:
                    handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
                    handle.write("\n")
                    count += 1
    return count


def import_corpus(source_db: Path, output_dir: Path, target_db: Path | None, dry_run: bool = False) -> dict[str, Any]:
    if not source_db.exists():
        raise FileNotFoundError(f"Source pipeline DB not found: {source_db}")
    output_dir.mkdir(parents=True, exist_ok=True)
    now = utc_now()
    source = sqlite3.connect(f"file:{source_db.resolve()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    try:
        source_fingerprint = stable_source_fingerprint(source)
        validity = {
            row["reg_id"]: dict(row)
            for row in source.execute("SELECT * FROM validity")
        }
        regulation_rows = list(source.execute("SELECT * FROM regulation ORDER BY id"))
        source_by_id = {norm_text(row["id"]): row for row in regulation_rows}
        source_rows = {str(row["reg_id"]): row for row in source.execute("SELECT * FROM validity")}
        table_names = {str(row["name"]) for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        attachments_by_reg: dict[str, list[sqlite3.Row]] = defaultdict(list)
        if "attachment" in table_names:
            for row in source.execute("SELECT * FROM attachment ORDER BY reg_id, id"):
                attachments_by_reg[norm_text(row["reg_id"])].append(row)
        pasal_rows = list(source.execute("SELECT * FROM pasal ORDER BY reg_id, seq, id"))
        relation_rows = list(source.execute("SELECT * FROM relation ORDER BY id"))
        tags = defaultdict(list)
        if "reg_tag" in {str(row["name"]) for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
            for row in source.execute("SELECT reg_id,tag_code,tag_name,term_id FROM reg_tag ORDER BY reg_id,tag_name"):
                tags[str(row["reg_id"])].append(dict(row))
    finally:
        source.close()

    by_id: dict[str, dict[str, Any]] = {}
    quarantine: list[dict[str, Any]] = []
    for row in regulation_rows:
        reason = valid_row(row)
        pipeline_id = norm_text(row["id"])
        if reason:
            quarantine.append({"kind": "regulation", "pipeline_id": pipeline_id, "reason": reason, "record": dict(row)})
            continue
        normalized = normalize_regulation(row, source_rows, attachments_by_reg)
        existing = by_id.get(normalized["regulation_id"])
        if existing and existing["raw_json"] != normalized["raw_json"]:
            quarantine.append({"kind": "regulation", "pipeline_id": pipeline_id, "reason": "duplicate_stable_id_conflict", "record": dict(row)})
            continue
        by_id[normalized["regulation_id"]] = normalized

    # URL is unique in the local prototype.  Preserve the first deterministic
    # record and quarantine later collisions instead of changing identities.
    url_owner: dict[str, str] = {}
    for regulation_id in sorted(list(by_id)):
        item = by_id[regulation_id]
        url = item["url"]
        if not url:
            continue
        owner = url_owner.get(url)
        if owner and owner != regulation_id:
            quarantine.append({"kind": "regulation", "pipeline_id": item["pipeline_id"], "reason": "duplicate_official_url", "record": item})
            del by_id[regulation_id]
        else:
            url_owner[url] = regulation_id

    valid_pipeline_ids = {item["pipeline_id"] for item in by_id.values()}
    chunks: list[dict[str, Any]] = []
    pasal_by_reg = defaultdict(list)
    for row in pasal_rows:
        pipeline_id = norm_text(row["reg_id"])
        if pipeline_id in valid_pipeline_ids:
            text = redact_external_mentions(row["text"])
            if text:
                pasal_by_reg[pipeline_id].append(row)
                chunks.append({
                    "chunk_id": f"pipeline:{stable_id('chunk', pipeline_id, row['id'])}",
                    "regulation_id": f"pipeline:{pipeline_id}",
                    "chunk_order": int(row["seq"] or len(pasal_by_reg[pipeline_id])),
                    "section_label": redact_external_mentions(row["path"] or row["bagian_dok"] or "body"),
                    "text": text,
                    "token_count": approx_tokens(text),
                    "created_at": now,
                    "pipeline_pasal_id": norm_text(row["id"]),
                })
    # A body can legitimately exist without a parsed pasal.  Add fallback
    # chunks so it remains searchable, while retaining the absence for QA.
    for item in by_id.values():
        if not item["content"] or pasal_by_reg.get(item["pipeline_id"]):
            continue
        for order, (label, text) in enumerate(split_fallback(item["content"]), start=1):
            chunks.append({
                "chunk_id": f"pipeline:{stable_id('fallback', item['pipeline_id'], order, text)}",
                "regulation_id": item["regulation_id"],
                "chunk_order": order,
                "section_label": label,
                "text": text,
                "token_count": approx_tokens(text),
                "created_at": now,
                "pipeline_pasal_id": "",
            })

    normalized_rows = [by_id[key] for key in sorted(by_id)]
    by_pipeline = {item["pipeline_id"]: item for item in normalized_rows}

    links: list[dict[str, Any]] = []
    for row in relation_rows:
        src = norm_text(row["src_id"])
        if src not in valid_pipeline_ids:
            continue
        dst = norm_text(row["dst_id"])
        dst_row = by_pipeline.get(dst)
        raw = redact_external_mentions(row["dst_raw"])
        related_source_id = f"pipeline:{dst}" if dst and dst in valid_pipeline_ids else raw
        related_url = dst_row["url"] if dst_row else ""
        link = {
            "link_id": f"pipeline:{stable_id('relation', row['id'], src, dst, raw, row['type'], row['scope'])}",
            "regulation_id": f"pipeline:{src}",
            "related_source_id": related_source_id,
            "relation_type": relation_type(row["type"]),
            "title": redact_external_mentions(dst_row["title"] if dst_row else raw),
            "url": related_url,
            "created_at": now,
            "verified": bool(row["verified"]),
            "confidence": row["confidence"],
            "scope": redact_external_mentions(row["scope"]),
            "evidence": redact_external_mentions(row["evidence"]),
            "method": norm_text(row["method"]),
            "pipeline_relation_id": row["id"],
        }
        links.append(link)

    # Regulation-compatible snapshot for the Next.js search/trust layer.  It
    # intentionally carries article/path locators and deterministic relations
    # rather than flattening the pipeline into title-only cards.
    relation_payloads = defaultdict(list)
    for row in relation_rows:
        src = norm_text(row["src_id"])
        if src not in valid_pipeline_ids:
            continue
        dst = by_pipeline.get(norm_text(row["dst_id"]))
        source_row = source_by_id.get(src)
        if not serving_relation(row, source_row, dst):
            continue
        raw_citation = redact_external_mentions(row["dst_raw"])
        relation_payloads[src].append({
            "type": relation_type(row["type"]),
            "citation": dst["number"] if dst else raw_citation,
            "title": dst["title"] if dst else raw_citation,
            "note": redact_external_mentions(row["evidence"]),
            "source": "official_page" if row["verified"] else "seed",
        })

    provision_payloads = defaultdict(list)
    for row in pasal_rows:
        src = norm_text(row["reg_id"])
        if src not in valid_pipeline_ids:
            continue
        text = redact_external_mentions(row["text"])
        if not text:
            continue
        provision_payloads[src].append({
            "article": redact_external_mentions(row["path"] or row["bagian_dok"] or "body"),
            "text": text,
        })

    next_snapshot: list[dict[str, Any]] = []
    for item in normalized_rows:
        pipeline_id = item["pipeline_id"]
        source_row = source_by_id.get(pipeline_id)
        if source_row is None:
            continue
        official_url = safe_official_url(source_row["url"])
        official_pdf_url = norm_text(item.get("official_pdf_url"))
        official_pdf_urls = [safe_official_pdf_url(value) for value in (item.get("official_pdf_urls") or [])]
        official_pdf_urls = list(dict.fromkeys(value for value in official_pdf_urls if value))
        validity_row = validity.get(pipeline_id, {})
        raw_status = norm_text(validity_row.get("status_derived") or source_row["status_site"])
        status_map = {
            "berlaku": "active",
            "diubah": "amended",
            "dicabut_sebagian": "partially_revoked",
            "dicabut": "revoked",
        }
        legal_status = status_map.get(raw_status, "unknown")
        provisions = provision_payloads.get(pipeline_id, [])
        if not provisions and item["content"]:
            provisions = [{"article": "body", "text": text} for _, text in split_fallback(item["content"])]
        identity_ok = source_row["identity_ok"] == 1
        hash_ok = bool(re.fullmatch(r"(?:sha256:)?[a-f0-9]{64}", item["pipeline_sha256"], flags=re.IGNORECASE))
        ready = bool((official_url or official_pdf_url) and item["content"] and provisions and hash_ok and identity_ok)
        source_language = "id"
        snapshot = {
            "id": item["regulation_id"],
            "topic": "vat" if item["topic"] == "PPN" else "income_tax" if item["topic"] == "PPh" else "general",
            "title": item["title"],
            "citation": item["number"],
            "focus": item["summary"],
            "relevance": 90 if (official_url or official_pdf_url) else 70,
            "source": "official" if (official_url or official_pdf_url) else "manual",
            "sourceUrl": official_url,
            "pdfUrl": official_pdf_url,
            "officialPdfUrl": official_pdf_url,
            "pdfUrls": official_pdf_urls,
            "storedPdfUrl": "",
            "sourceAuthority": "Pemerintah Republik Indonesia" if (official_url or official_pdf_url) else "",
            # Keep the source id as the canonical identity.  The `id` remains
            # namespaced for provenance, while AA-Jurist's merge layer can
            # coalesce this record with an existing seed card for the same
            # regulation instead of showing duplicate rules.
            "canonicalKey": pipeline_id,
            "sourceLanguage": source_language,
            "content": item["content"],
            "ingestionStatus": "ready" if ready else "review_required",
            "ingestionMessage": "Deterministic import from audited regulation pipeline; graph and provision locators retained.",
            "fileHash": item["pipeline_sha256"] if hash_ok else "",
            "extraction": {
                "schemaVersion": "regulation-extraction-v1",
                "summary": item["summary"],
                "scope": [part.strip() for part in item["category"].split(",") if part.strip()],
                "keyProvisions": provisions,
                "effectiveDate": validity_row.get("valid_from") or source_row["tanggal"] or None,
                "legalStatus": legal_status,
                "statusNote": redact_external_mentions(validity_row.get("reason")),
                "relations": relation_payloads.get(pipeline_id, []),
                "keywords": [item["topic"], item["regulation_type"]],
                "verificationNotes": [
                    "Sumber resmi pemerintah dipertahankan." if official_url else "Sumber non-resmi tidak dipakai sebagai URL sitasi publik.",
                    "Identitas kop cocok dengan metadata pipeline." if identity_ok else "Identitas kop belum tervalidasi penuh; perlu tinjauan manusia.",
                ],
                "extractedAt": item["fetched_at"] or now,
                "model": "pipeline-deterministic-v1",
                "sourcePdfUrl": official_pdf_url or official_url,
            },
            "relations": relation_payloads.get(pipeline_id, []),
            "extractedAt": item["fetched_at"] or now,
            "updatedAt": item["fetched_at"] or now,
        }
        next_snapshot.append(snapshot)

    next_snapshot.sort(key=lambda item: item["id"])
    next_count = write_jsonl_gz(output_dir / "next-regulations.jsonl.gz", next_snapshot)
    next_snapshot_hash = sha256_file(output_dir / "next-regulations.jsonl.gz")
    manifest_core = {
        "schema_version": SCHEMA_VERSION,
        "source_db": str(source_db.resolve()),
        "source_fingerprint_sha256": source_fingerprint,
        "normalization": {
            "external_url_policy": "https-go.id-only",
            "chunk_fallback_max_chars": 9000,
            "redaction": ["coretax", "ortax", "taxbasex", "hukumonline", "ddtc"],
        },
        "counts": {
            "source_regulations": len(regulation_rows),
            "normalized_regulations": len(normalized_rows),
            "normalized_chunks": len(chunks),
            "normalized_links": len(links),
            "next_snapshot_regulations": next_count,
            "quarantined": len(quarantine),
            "quarantine_by_reason": dict(sorted(Counter(item["reason"] for item in quarantine).items())),
        },
        "artifacts": {
            "next-regulations.jsonl.gz": next_snapshot_hash,
        },
    }
    manifest_hash = sha256_bytes(json.dumps(manifest_core, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    manifest = {**manifest_core, "manifest_sha256": manifest_hash, "generated_at": now}

    write_jsonl(output_dir / "regulations.jsonl", normalized_rows)
    write_jsonl(output_dir / "chunks.jsonl", chunks)
    write_jsonl(output_dir / "links.jsonl", links)
    write_jsonl(output_dir / "quarantine.jsonl", quarantine)
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if target_db and not dry_run:
        target_db.parent.mkdir(parents=True, exist_ok=True)
        target = sqlite3.connect(str(target_db))
        target.row_factory = sqlite3.Row
        try:
            ensure_target_schema(target)
            timestamp = now
            # Preserve created_at for rows imported previously.
            for item in normalized_rows:
                existing = target.execute("SELECT created_at FROM tax_regulations WHERE regulation_id = ?", (item["regulation_id"],)).fetchone()
                created_at = existing["created_at"] if existing else timestamp
                target.execute(
                    """INSERT INTO tax_regulations
                      (regulation_id,source,source_id,url,title,regulation_type,number,year,topic,category,published_date,status,summary,content,raw_json,fetched_at,created_at,updated_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                      ON CONFLICT(regulation_id) DO UPDATE SET
                        source=excluded.source,source_id=excluded.source_id,url=excluded.url,title=excluded.title,
                        regulation_type=excluded.regulation_type,number=excluded.number,year=excluded.year,topic=excluded.topic,
                        category=excluded.category,published_date=excluded.published_date,status=excluded.status,summary=excluded.summary,
                        content=excluded.content,raw_json=excluded.raw_json,fetched_at=excluded.fetched_at,updated_at=excluded.updated_at""",
                    (item["regulation_id"], item["source"], item["source_id"], item["url"], item["title"], item["regulation_type"], item["number"], item["year"], item["topic"], item["category"], item["published_date"], item["status"], item["summary"], item["content"], item["raw_json"], item["fetched_at"], created_at, timestamp),
                )
            target.execute("DELETE FROM tax_regulation_chunks WHERE regulation_id LIKE 'pipeline:%'")
            target.executemany(
                "INSERT INTO tax_regulation_chunks (chunk_id,regulation_id,chunk_order,section_label,text,token_count,created_at) VALUES (?,?,?,?,?,?,?)",
                [(item["chunk_id"], item["regulation_id"], item["chunk_order"], item["section_label"], item["text"], item["token_count"], item["created_at"]) for item in chunks],
            )
            target.execute("DELETE FROM tax_regulation_links WHERE regulation_id LIKE 'pipeline:%'")
            target.executemany(
                "INSERT INTO tax_regulation_links (link_id,regulation_id,related_source_id,relation_type,title,url,created_at) VALUES (?,?,?,?,?,?,?)",
                [(item["link_id"], item["regulation_id"], item["related_source_id"], item["relation_type"], item["title"], item["url"], item["created_at"]) for item in links],
            )
            target.commit()
        finally:
            target.close()

    return {**manifest, "output_dir": str(output_dir.resolve()), "target_db": str(target_db.resolve()) if target_db else None, "dry_run": dry_run}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-db", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--target-db", type=Path, default=DEFAULT_TARGET)
    parser.add_argument("--no-db", action="store_true", help="Only write JSONL artifacts; do not modify the local prototype DB.")
    parser.add_argument("--dry-run", action="store_true", help="Write artifacts and manifest but skip target DB writes.")
    args = parser.parse_args(argv)
    try:
        result = import_corpus(args.source_db, args.output_dir, None if args.no_db else args.target_db, args.dry_run)
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"import failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({
        "manifest_sha256": result["manifest_sha256"],
        "counts": result["counts"],
        "output_dir": result["output_dir"],
        "target_db": result["target_db"],
        "dry_run": result["dry_run"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
