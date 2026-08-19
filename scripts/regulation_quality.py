#!/usr/bin/env python3
"""Build an auditable regulation graph and quality report.

This module deliberately reads the Anahdraw/peraturan-pipeline SQLite database
in read-only mode.  It does not migrate or mutate the source database.  The
output is a deterministic snapshot that can be imported into AAJurist later:

    python scripts/regulation_quality.py \
      --db /Users/sintzu/Anahdraw/peraturan-pipeline/data/peraturan.db

The graph keeps questionable edges instead of silently dropping them.  Edges
with unresolved targets, identity conflicts, hierarchy violations, temporal
inconsistency, missing evidence, or low confidence are marked
``eligibleForAnswer=false`` and are counted in the quality report.  This is
important for a legal RAG system: an incomplete graph is safer than a graph
that looks complete while carrying false amendments.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ALGORITHM_VERSION = "regulation-quality-v1"

# Same broad hierarchy used by the source pipeline.  Unknown document types
# are not rejected; they are marked as not checked instead.
HIERARCHY = {
    "UUD": 0,
    "UU": 1,
    "PERPU": 1,
    "PP": 2,
    "PERPRES": 3,
    "KEPPRES": 3,
    "INPRES": 3,
    "PERDA": 4,
    "PMK": 5,
    "KMK": 5,
    "IMK": 5,
    "PERMENDAG": 5,
    "PERMENPERIN": 5,
    "PERMENDAGRI": 5,
    "PERMENKUMHAM": 5,
    "PER": 6,
    "KEP": 6,
    "SE": 7,
    "INS": 7,
    "PENG": 7,
    "ND": 7,
}

TYPE_ALIASES = {
    "UNDANG-UNDANG": "UU",
    "UNDANG UNDANG": "UU",
    "UNDANG-UNDANG DASAR": "UUD",
    "PERATURAN PEMERINTAH PENGGANTI UNDANG-UNDANG": "PERPU",
    "PERATURAN PEMERINTAH": "PP",
    "PERATURAN PRESIDEN": "PERPRES",
    "KEPUTUSAN PRESIDEN": "KEPPRES",
    "INSTRUKSI PRESIDEN": "INPRES",
    "PERATURAN MENTERI KEUANGAN": "PMK",
    "KEPUTUSAN MENTERI KEUANGAN": "KMK",
    "PERATURAN DIREKTUR JENDERAL PAJAK": "PER",
    "PERATURAN DIRJEN PAJAK": "PER",
    "KEPUTUSAN DIREKTUR JENDERAL PAJAK": "KEP",
    "KEPUTUSAN DIRJEN PAJAK": "KEP",
    "SURAT EDARAN DIREKTUR JENDERAL PAJAK": "SE",
    "SURAT EDARAN DIRJEN PAJAK": "SE",
    "SURAT EDARAN": "SE",
}

PREFIX_CODES = {
    "PER": "PER",
    "KEP": "KEP",
    "SE": "SE",
    "S": "S",
    "PENG": "PENG",
    "ND": "ND",
    "INS": "INS",
    "PMK": "PMK",
    "KMK": "KMK",
    "UU": "UU",
    "PP": "PP",
    "PERPRES": "PERPRES",
    "KEPPRES": "KEPPRES",
    "PERPU": "PERPU",
}

UNIT_TO_TYPE = {
    "PMK": "PMK",
    "KMK": "KMK",
    "MK": "KMK",
    "PJ": "PER",
    "PB": "PB",
}

TYPE_NAME_RE = (
    r"Undang-Undang(?:\s+Dasar)?|"
    r"Peraturan\s+Pemerintah\s+Pengganti\s+Undang-Undang|"
    r"Peraturan\s+Pemerintah|Peraturan\s+Presiden|Keputusan\s+Presiden|"
    r"Peraturan\s+Menteri\s+Keuangan|Keputusan\s+Menteri\s+Keuangan|"
    r"Peraturan\s+Direktur\s+Jenderal\s+Pajak|Peraturan\s+Dirjen\s+Pajak|"
    r"Keputusan\s+Direktur\s+Jenderal\s+Pajak|Keputusan\s+Dirjen\s+Pajak|"
    r"Surat\s+Edaran\s+Direktur\s+Jenderal\s+Pajak|Surat\s+Edaran\s+Dirjen\s+Pajak"
)

# The order is intentional: named references consume their type words first;
# coded/bare patterns then cover PER-31/PJ/2009 and 212/PMK.07/2009.
RE_NAMED_REFERENCE = re.compile(
    rf"(?P<jenis>{TYPE_NAME_RE})\s+(?:Republik\s+Indonesia\s+)?"
    rf"(?:Nomor\s+)?(?P<nomor>"
    rf"[0-9]+[A-Z]?\s+Tahun\s+\d{{4}}|"
    rf"[0-9]+[A-Z]?\s*/\s*[A-Za-z0-9.\-]+\s+Tahun\s+\d{{4}}|"
    rf"[A-Z]{{2,7}}\s*-\s*\d+[A-Z]?\s*/\s*[A-Za-z0-9.\-/]+\s*/\s*\d{{4}}|"
    rf"[0-9]+[A-Z]?(?:\s*/\s*[A-Za-z0-9.\-]+)+"
    rf")",
    re.IGNORECASE,
)
RE_CODED_REFERENCE = re.compile(
    r"\b(?P<nomor>(?:PER|KEP|SE|S|PENG|ND|INS)\s*-\s*"
    r"\d+[A-Z]?\s*/\s*[A-Za-z0-9.\-]+\s*/\s*\d{4})\b",
    re.IGNORECASE,
)
RE_BARE_REFERENCE = re.compile(
    r"(?<![\w/])(?P<nomor>\d{1,4}[A-Z]?/[A-Z]{2,8}"
    r"(?:\.[0-9]{1,4})?(?:/[A-Za-z0-9.\-]+)?/(?:19|20)\d{2})"
    r"(?![\w/])",
    re.IGNORECASE,
)
RE_SHORT_REFERENCE = re.compile(
    r"\b(?P<jenis>UU|PP|PMK|KMK|PERPRES|PERPU)\s*(?:NO\.?|NOMOR)?\s*"
    r"(?P<nomor>\d+[A-Z]?\s+TAHUN\s+\d{4})\b",
    re.IGNORECASE,
)


def clean(value: Any) -> str:
    text = str(value or "")
    return re.sub(r"\s+", " ", text.replace("–", "-").replace("—", "-")).strip()


def type_code(value: Any) -> str | None:
    text = clean(value).upper().rstrip(".")
    if not text:
        return None
    if text in TYPE_ALIASES:
        return TYPE_ALIASES[text]
    if text in HIERARCHY or text in PREFIX_CODES:
        return text
    for label, code in TYPE_ALIASES.items():
        if text.startswith(label):
            return code
    # Preserve a known short code even where the source has a new label.
    match = re.match(r"^(UU|PP|PMK|KMK|PERPRES|PERPU|PER|KEP|SE|INS)\b", text)
    return match.group(1) if match else None


def norm_number(number: str) -> str:
    match = re.match(r"^0*(\d+[A-Z]?)$", clean(number).upper())
    return (match.group(1) if match else clean(number).upper()).replace(".", "")


def canonical_key(raw: Any, jenis: Any = None, tahun: Any = None) -> str | None:
    """Return a stable key such as ``uu-8-1983`` or ``per-31-pj-2009``.

    A key is only produced when a legal type, number, and year can be
    identified.  Unknown references remain unresolved in the graph instead of
    being guessed from a bare number.
    """
    text = clean(raw).upper().replace("NOMOR", " ").strip(" .,:;")
    if not text:
        return None
    hinted = type_code(jenis)
    year_hint = str(tahun or "")
    short_type = re.match(r"^(UU|PP|PMK|KMK|PERPRES|PERPU)\s*(?:NO\.?\s*)?", text)
    if short_type:
        hinted = short_type.group(1)
        text = text[short_type.end():].strip()
    # Accept the full citation form as input too (the relation table stores
    # ``dst_raw`` in this form).  Strip the descriptive legal type while
    # retaining it as the type hint for ``8 Tahun 1983``.
    for label in sorted(TYPE_ALIASES, key=len, reverse=True):
        if text.startswith(label + " "):
            hinted = TYPE_ALIASES[label]
            text = text[len(label):].strip()
            text = re.sub(r"^(?:REPUBLIK\s+INDONESIA\s+)?NOMOR\s+", "", text)
            break

    match = re.match(
        r"^([A-Z]{1,9})\s*-\s*(\d+[A-Z]?)\s*/\s*([A-Z0-9.\-/]+?)\s*/\s*(\d{4})$",
        text,
    )
    if match:
        prefix, number, unit, year = match.groups()
        code = PREFIX_CODES.get(prefix, hinted or prefix)
        unit = unit.strip(".")
        parts = [code, norm_number(number), *[p for p in unit.split("/") if p], year]
        return "-".join(re.sub(r"[^A-Z0-9]+", "-", p).strip("-") for p in parts).lower()

    match = re.match(
        r"^(\d+[A-Z]?)\s*/\s*([A-Z0-9.\-]+(?:\s*/\s*[A-Z0-9.\-]+)*)\s*/\s*(\d{4})$",
        text,
    )
    if match:
        number, unit, year = match.groups()
        unit = re.sub(r"\s*/\s*", "/", unit).strip(".")
        head = unit.split("/")[0].split(".")[0]
        code = UNIT_TO_TYPE.get(head) or hinted or head
        parts = [code, norm_number(number), *[p for p in unit.split("/") if p], year]
        return "-".join(re.sub(r"[^A-Z0-9]+", "-", p).strip("-") for p in parts).lower()

    match = re.match(r"^(?:([A-Z.\s]{2,30})\s+)?(\d+[A-Z]?)\s+TAHUN\s+(\d{4})$", text)
    if match:
        prefix, number, year = match.groups()
        code = type_code(prefix) if prefix else hinted
        if code:
            return f"{code.lower()}-{norm_number(number)}-{year}"

    # Presidential decisions and a few historical instruments use
    # ``20/P Tahun 2005`` rather than ``20/P/2005``.
    match = re.match(r"^(\d+[A-Z]?)\s*/\s*([A-Z0-9.\-]+)\s+TAHUN\s+(\d{4})$", text)
    if match and hinted:
        number, unit, year = match.groups()
        parts = [hinted, norm_number(number), unit.strip("."), year]
        return "-".join(re.sub(r"[^A-Z0-9]+", "-", p).strip("-") for p in parts).lower()

    match = re.match(r"^([A-Z]{1,9})\s*-\s*(\d+[A-Z]?)\s*/\s*(\d{4})$", text)
    if match:
        prefix, number, year = match.groups()
        code = PREFIX_CODES.get(prefix, hinted or prefix)
        return f"{code.lower()}-{norm_number(number)}-{year}"

    match = re.match(r"^(\d+[A-Z]?)$", text)
    if match and hinted and year_hint:
        return f"{hinted.lower()}-{norm_number(match.group(1))}-{year_hint}"
    return None


def canonical_display(raw: Any, key: str | None) -> str:
    return clean(raw) if clean(raw) else (key or "")


def law_id(key: str | None) -> str | None:
    return f"law:{key}" if key else None


def source_hash(path: Path) -> str:
    digest = hashlib.sha256()
    # SQLite WAL may contain the newest committed pages while the main file is
    # unchanged. Include sidecars in the provenance fingerprint when present.
    for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        if not candidate.exists():
            continue
        digest.update(candidate.name.encode("utf-8"))
        with candidate.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
    return digest.hexdigest()


def read_only_connection(path: Path) -> sqlite3.Connection:
    # URI mode=ro prevents accidental writes even if an exception occurs.
    return sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)


def row_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def normalize_site_status(status: Any) -> str:
    text = clean(status).lower()
    if "dicabut sebagian" in text:
        return "partially_revoked"
    if "dicabut" in text:
        return "revoked"
    if "diubah" in text or "disempurnakan" in text:
        return "amended"
    if "aktif" in text or "berlaku" in text:
        return "active"
    return "unknown"


def _record_key(record: dict[str, Any]) -> tuple[str | None, str]:
    """Use body identity when present, but expose metadata mismatch."""
    body_key = canonical_key(record.get("canonical_body"), record.get("jenis_code"), record.get("tahun"))
    metadata_key = canonical_key(
        record.get("canonical") or record.get("nomor_raw"),
        record.get("jenis_code") or record.get("jenis"),
        record.get("tahun"),
    )
    # id_body is already a pipeline canonical key and is useful for forms such
    # as ``34/MK/EF.2/2026`` where a terse body canonical may be hard to parse.
    body_key = body_key or clean(record.get("id_body")) or None
    return body_key or metadata_key, "body" if body_key else "metadata"


def build_node_index(rows: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, list[str]], dict[str, str]]:
    """Deduplicate source rows into nodes and maps used by graph/citations."""
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in rows:
        key, identity_source = _record_key(record)
        # Fall back to the DB ID only as a quarantine node.  It is never used
        # to resolve a legal citation unless a legal key exists too.
        key = key or f"unparsed-{clean(record.get('id'))}"
        record = dict(record)
        record["_key"] = key
        record["_identity_source"] = identity_source
        grouped[key].append(record)

    nodes: list[dict[str, Any]] = []
    legal_key_to_ids: dict[str, list[str]] = defaultdict(list)
    db_id_to_node: dict[str, str] = {}
    for key in sorted(grouped):
        members = sorted(grouped[key], key=lambda item: clean(item.get("id")))
        canonical = next((clean(item.get("canonical_body")) for item in members if clean(item.get("canonical_body"))), "")
        canonical = canonical or next((clean(item.get("canonical")) for item in members if clean(item.get("canonical"))), key)
        node_id = law_id(key) or f"law:{key}"
        mismatches = [item for item in members if item.get("identity_ok") == 0]
        node = {
            "id": node_id,
            "canonicalKey": key if not key.startswith("unparsed-") else None,
            "canonical": canonical,
            "title": clean(next((item.get("judul") for item in members if item.get("judul")), "")),
            "typeCode": clean(next((item.get("jenis_code") for item in members if item.get("jenis_code")), "")) or None,
            "year": next((item.get("tahun") for item in members if item.get("tahun") is not None), None),
            "date": clean(next((item.get("tanggal") for item in members if item.get("tanggal")), "")) or None,
            "statusSite": normalize_site_status(next((item.get("status_site") for item in members if item.get("status_site")), "")),
            "statusSiteRaw": clean(next((item.get("status_site") for item in members if item.get("status_site")), "")) or None,
            "source": clean(next((item.get("source") for item in members if item.get("source")), "")) or None,
            "sourceUrl": clean(next((item.get("url") for item in members if item.get("url")), "")) or None,
            "sourceHash": clean(next((item.get("sha256") for item in members if item.get("sha256")), "")) or None,
            "hasBody": bool(any(item.get("body_text") or item.get("has_body") for item in members)),
            "sourceIds": [clean(item.get("id")) for item in members if clean(item.get("id"))],
            "metadataCanonicals": sorted({clean(item.get("canonical")) for item in members if clean(item.get("canonical"))}),
            "bodyCanonicals": sorted({clean(item.get("canonical_body")) for item in members if clean(item.get("canonical_body"))}),
            "identityMismatch": bool(mismatches),
            "duplicateSourceRows": len(members),
            "validity": {},
            "qualityFlags": [],
        }
        if len(members) > 1:
            node["qualityFlags"].append("duplicate_canonical_identity")
        if mismatches:
            node["qualityFlags"].append("metadata_body_identity_mismatch")
        if not node["canonicalKey"]:
            node["qualityFlags"].append("unparsed_canonical_identity")
        nodes.append(node)
        if node["canonicalKey"]:
            legal_key_to_ids[key].append(node_id)
        for item in members:
            if clean(item.get("id")):
                db_id_to_node[clean(item["id"])] = node_id
    return nodes, legal_key_to_ids, db_id_to_node


def resolve_key(
    raw: Any,
    *,
    dst_id: Any,
    source_map: dict[str, str],
    key_to_ids: dict[str, list[str]],
    jenis: Any = None,
    year: Any = None,
) -> tuple[str | None, list[str]]:
    """Resolve a relation/citation without guessing ambiguous references."""
    db_id = clean(dst_id)
    if db_id and db_id in source_map:
        return source_map[db_id], []
    key = canonical_key(raw, jenis, year)
    candidates = key_to_ids.get(key or "", [])
    if len(candidates) == 1:
        return candidates[0], []
    if len(candidates) > 1:
        return None, ["ambiguous_target"]
    return None, []


def extract_references(text: str, default_year: Any = None) -> list[dict[str, Any]]:
    """Extract normalized legal citations with character spans.

    The regexes intentionally require a document type or a structured
    publisher/unit and a four-digit year.  A bare ``No. 8`` is not a legal
    citation; accepting it would create a large number of false graph edges.
    """
    if not text:
        return []
    found: list[dict[str, Any]] = []
    occupied: list[tuple[int, int]] = []

    def add(match: re.Match[str], raw: str, jenis: str | None = None) -> None:
        start, end = match.span("nomor") if "nomor" in match.groupdict() else match.span()
        if any(not (end <= left or start >= right) for left, right in occupied):
            return
        raw_clean = clean(raw)
        key = canonical_key(raw_clean, jenis, default_year)
        occupied.append((start, end))
        found.append({
            "raw": raw_clean,
            "span": [start, end],
            "canonicalKey": key,
            "kind": "named" if jenis else "coded_or_bare",
            "context": clean(text[max(0, start - 100): min(len(text), end + 160)])[:400],
        })

    for match in RE_NAMED_REFERENCE.finditer(text):
        add(match, match.group("nomor"), match.group("jenis"))
    for match in RE_SHORT_REFERENCE.finditer(text):
        add(match, match.group("nomor"), match.group("jenis"))
    for match in RE_CODED_REFERENCE.finditer(text):
        add(match, match.group("nomor"))
    for match in RE_BARE_REFERENCE.finditer(text):
        add(match, match.group("nomor"))
    found.sort(key=lambda item: (item["span"][0], item["span"][1], item["raw"]))
    return found


def load_rows(conn: sqlite3.Connection, table: str, columns: str) -> list[dict[str, Any]]:
    try:
        cursor = conn.execute(f"SELECT {columns} FROM {table}")
    except sqlite3.OperationalError:
        return []
    return [row_dict(row) for row in cursor.fetchall()]


def load_validity(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    rows = load_rows(conn, "validity", "reg_id,valid_from,valid_to,status_derived,superseded_by,agrees_with_site,reason")
    return {clean(row.get("reg_id")): row for row in rows if clean(row.get("reg_id"))}


def apply_validity(nodes: list[dict[str, Any]], validity: dict[str, dict[str, Any]], db_id_to_node: dict[str, str]) -> None:
    by_id = {node["id"]: node for node in nodes}
    variants: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for source_id, value in sorted(validity.items()):
        node_id = db_id_to_node.get(source_id)
        if not node_id or node_id not in by_id:
            continue
        node = by_id[node_id]
        variant = {
            "validFrom": clean(value.get("valid_from")) or node.get("date"),
            "validTo": clean(value.get("valid_to")) or None,
            "statusDerived": clean(value.get("status_derived")) or "unknown",
            "supersededBySourceId": clean(value.get("superseded_by")) or None,
            "agreesWithSite": value.get("agrees_with_site"),
            "reason": clean(value.get("reason")) or None,
        }
        variants[node_id].append({"sourceId": source_id, **variant})
        # The first source ID is deterministic.  Conflicting duplicate rows
        # are retained below and surfaced as a quality flag.
        if not node["validity"]:
            node["validity"] = variant
        if value.get("agrees_with_site") == 0:
            node["qualityFlags"].append("status_site_conflict")
    for node in nodes:
        node_variants = variants.get(node["id"], [])
        semantic_variants = {
            json.dumps({key: item.get(key) for key in ("validFrom", "validTo", "statusDerived", "agreesWithSite")}, sort_keys=True)
            for item in node_variants
        }
        if len(semantic_variants) > 1:
            node["qualityFlags"].append("duplicate_validity_conflict")
        if node_variants:
            node["validityVariants"] = node_variants
        if not node["validity"]:
            node["validity"] = {
                "validFrom": node.get("date"),
                "validTo": None,
                "statusDerived": node.get("statusSite") or "unknown",
                "supersededBySourceId": None,
                "agreesWithSite": None,
                "reason": "validity row unavailable",
            }


def date_or_year(node: dict[str, Any]) -> str:
    return clean(node.get("validity", {}).get("validFrom")) or clean(node.get("date")) or (str(node.get("year")) if node.get("year") else "")


def hierarchy_violation(source: dict[str, Any] | None, target: dict[str, Any] | None, relation_type: str) -> bool:
    if relation_type not in {"MENCABUT", "MENCABUT_SEBAGIAN", "MENGUBAH"} or not source or not target:
        return False
    left = HIERARCHY.get(clean(source.get("typeCode")).upper())
    right = HIERARCHY.get(clean(target.get("typeCode")).upper())
    return left is not None and right is not None and left > right


def relation_edge_key(source: str | None, target: str | None, raw: str, relation_type: str, scope: str) -> str:
    payload = "|".join([source or "?", target or "?", clean(raw).lower(), clean(relation_type).upper(), clean(scope).lower()])
    return "edge:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def build_relation_edges(
    rows: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    source_map: dict[str, str],
    key_to_ids: dict[str, list[str]],
) -> tuple[list[dict[str, Any]], Counter]:
    by_id = {node["id"]: node for node in nodes}
    aggregates: dict[str, dict[str, Any]] = {}
    pair_types: dict[tuple[str, str], set[str]] = defaultdict(set)
    unresolved_reasons: Counter = Counter()

    for row in sorted(rows, key=lambda item: (clean(item.get("src_id")), clean(item.get("dst_id")), clean(item.get("dst_raw")), clean(item.get("type")), clean(item.get("scope")), int(item.get("id") or 0))):
        source = source_map.get(clean(row.get("src_id")))
        target, target_reasons = resolve_key(
            row.get("dst_raw"),
            dst_id=row.get("dst_id"),
            source_map=source_map,
            key_to_ids=key_to_ids,
        )
        relation_type = clean(row.get("type")).upper() or "UNKNOWN"
        raw = clean(row.get("dst_raw"))
        scope = clean(row.get("scope"))
        edge_id = relation_edge_key(source, target, raw, relation_type, scope)
        edge = aggregates.get(edge_id)
        if edge is None:
            edge = {
                "id": edge_id,
                "source": source,
                "target": target,
                "targetRaw": raw or None,
                "type": relation_type,
                "scope": scope or None,
                "evidence": clean(row.get("evidence"))[:1000] or None,
                "evidencePasalId": clean(row.get("evidence_pasal_id")) or None,
                "method": clean(row.get("method")) or None,
                "confidence": float(row.get("confidence")) if row.get("confidence") is not None else None,
                "verified": bool(row.get("verified")),
                "conflict": clean(row.get("conflict")) or None,
                "sourceRowIds": [],
                "duplicateRows": 0,
                "flags": [],
                "eligibleForAnswer": True,
            }
            aggregates[edge_id] = edge
        edge["sourceRowIds"].append(row.get("id"))
        edge["duplicateRows"] += 1
        # Keep the strongest evidence/confidence for a duplicate aggregate.
        if len(clean(row.get("evidence"))) > len(edge["evidence"] or ""):
            edge["evidence"] = clean(row.get("evidence"))[:1000]
        if edge["confidence"] is None or (row.get("confidence") is not None and float(row["confidence"]) > edge["confidence"]):
            edge["confidence"] = float(row["confidence"]) if row.get("confidence") is not None else edge["confidence"]
        if source and target:
            pair_types[(source, target)].add(relation_type)

        reasons = list(target_reasons)
        if not source:
            reasons.append("missing_source")
        if not target and "ambiguous_target" not in reasons:
            reasons.append("unresolved_target")
        if source and target and source == target:
            reasons.append("self_relation")
        if hierarchy_violation(by_id.get(source or ""), by_id.get(target or ""), relation_type):
            reasons.append("hierarchy_violation")
        confidence = edge["confidence"]
        if confidence is None or not 0 <= confidence <= 1:
            reasons.append("invalid_confidence")
        elif confidence < 0.75:
            reasons.append("low_confidence")
        elif confidence < 0.92:
            # The source pipeline's automatic-accept threshold is 0.92.  A
            # rule-derived edge may be useful to a reviewer at 0.80, but it
            # must never be served as an asserted legal relationship.
            reasons.append("below_auto_review_threshold")
        if not edge["verified"] and relation_type not in {"DASAR_HUKUM"}:
            reasons.append("unverified")
        if edge["conflict"]:
            reasons.append("source_conflict")
        if not edge["evidence"]:
            reasons.append("missing_evidence")

        source_node, target_node = by_id.get(source or ""), by_id.get(target or "")
        if source_node and target_node and relation_type in {"MENGUBAH", "MENCABUT", "MENCABUT_SEBAGIAN"}:
            src_date, dst_date = date_or_year(source_node), date_or_year(target_node)
            if src_date and dst_date and src_date < dst_date:
                reasons.append("temporal_inconsistency")
        edge["flags"] = sorted(set(edge["flags"]).union(reasons))
        for reason in set(reasons):
            unresolved_reasons[reason] += 1
        hard_flags = {
            "missing_source", "unresolved_target", "ambiguous_target", "self_relation",
            "hierarchy_violation", "invalid_confidence", "low_confidence",
            "source_conflict", "missing_evidence", "temporal_inconsistency",
            "contradictory_relation_types", "below_auto_review_threshold", "unverified",
        }
        # Keep every edge for audit/graph exploration, but only a verified,
        # high-confidence edge with a resolved target may feed an answer.
        edge["eligibleForAnswer"] = bool(
            edge["verified"]
            and edge["confidence"] is not None
            and edge["confidence"] >= 0.92
            and edge["target"]
            and not (set(edge["flags"]) & hard_flags)
        )
        edge["servingEligibility"] = {
            "eligible": edge["eligibleForAnswer"],
            "policy": "verified_and_confidence_at_least_0.92",
            "reason": "ok" if edge["eligibleForAnswer"] else "review_required",
        }

    # A pair carrying multiple mutually exclusive structural actions needs
    # review.  This does not declare it wrong: an amendment chain can be
    # legitimately represented by two rows, so we quarantine instead of drop.
    exclusive = {"MENCABUT", "MENCABUT_SEBAGIAN", "MENGUBAH"}
    for edge in aggregates.values():
        pair = (edge["source"], edge["target"])
        types = pair_types.get(pair, set())
        if len(types & exclusive) > 1:
            edge["flags"] = sorted(set(edge["flags"]) | {"contradictory_relation_types"})
            edge["eligibleForAnswer"] = False
            edge["servingEligibility"] = {
                "eligible": False,
                "policy": "verified_and_confidence_at_least_0.92",
                "reason": "review_required",
            }
            unresolved_reasons["contradictory_relation_types"] += 1

    edges = sorted(aggregates.values(), key=lambda item: item["id"])
    for edge in edges:
        edge["sourceRowIds"] = sorted(item for item in edge["sourceRowIds"] if item is not None)
    return edges, unresolved_reasons


def build_citations(
    pasal_rows: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    source_map: dict[str, str],
    key_to_ids: dict[str, list[str]],
) -> tuple[list[dict[str, Any]], Counter]:
    by_id = {node["id"]: node for node in nodes}
    citations: list[dict[str, Any]] = []
    stats: Counter = Counter()
    for row in sorted(pasal_rows, key=lambda item: (clean(item.get("reg_id")), int(item.get("seq") or 0), clean(item.get("id")))):
        source = source_map.get(clean(row.get("reg_id")))
        text = clean(row.get("text"))
        if not text:
            continue
        for ordinal, ref in enumerate(extract_references(text), start=1):
            key = ref.get("canonicalKey")
            target_candidates = key_to_ids.get(key or "", [])
            target = target_candidates[0] if len(target_candidates) == 1 else None
            flags: list[str] = []
            if not source:
                flags.append("missing_source")
            if not key:
                flags.append("unparsed_reference")
            elif not target:
                flags.append("ambiguous_target" if len(target_candidates) > 1 else "unresolved_target")
            if source and target and source == target:
                flags.append("self_reference")
            citations.append({
                "id": "cite:" + hashlib.sha256(
                    f"{source or '?'}|{row.get('id')}|{ref['span'][0]}|{ref['raw']}".encode("utf-8")
                ).hexdigest()[:24],
                "source": source,
                "target": target,
                "raw": ref["raw"],
                "canonicalKey": key,
                "locator": {
                    "unitId": clean(row.get("id")) or None,
                    "path": clean(row.get("path")) or None,
                    "section": clean(row.get("bagian_dok")) or None,
                    "paragraph": ref["span"][0],
                    "charOffset": ref["span"][0],
                },
                "context": ref["context"],
                "flags": sorted(set(flags)),
                "resolved": bool(target and not flags),
            })
            stats["total"] += 1
            stats["resolved"] += int(bool(target and not flags))
            stats["unresolved"] += int("unresolved_target" in flags)
            stats["ambiguous"] += int("ambiguous_target" in flags)
            stats["self"] += int("self_reference" in flags)
    citations.sort(key=lambda item: item["id"])
    return citations, stats


def quality_findings(nodes: list[dict[str, Any]], edges: list[dict[str, Any]], citations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for node in nodes:
        for flag in sorted(set(node.get("qualityFlags", []))):
            severity = "high" if flag in {"metadata_body_identity_mismatch", "status_site_conflict", "unparsed_canonical_identity"} else "medium"
            findings.append({"kind": "node", "severity": severity, "code": flag, "id": node["id"], "canonical": node.get("canonical")})
    for edge in edges:
        for flag in edge.get("flags", []):
            severity = "high" if flag in {"hierarchy_violation", "temporal_inconsistency", "contradictory_relation_types", "source_conflict"} else "medium"
            findings.append({"kind": "relation", "severity": severity, "code": flag, "id": edge["id"], "source": edge.get("source"), "target": edge.get("target"), "type": edge.get("type")})
    for citation in citations:
        for flag in citation.get("flags", []):
            findings.append({"kind": "citation", "severity": "medium", "code": flag, "id": citation["id"], "source": citation.get("source"), "raw": citation.get("raw")})
    return sorted(findings, key=lambda item: (item["severity"], item["kind"], item["code"], item["id"]))


def build_snapshot(db_path: Path, *, max_citations: int | None = None) -> dict[str, Any]:
    conn = read_only_connection(db_path)
    conn.row_factory = sqlite3.Row
    try:
        regulation_rows = load_rows(conn, "regulation", "id,canonical,nomor_raw,jenis,jenis_code,tahun,tanggal,judul,url,status_site,has_body,body_text,source,sha256,id_body,canonical_body,identity_ok")
        relation_rows = load_rows(conn, "relation", "id,src_id,dst_id,dst_raw,type,scope,evidence,evidence_pasal_id,method,confidence,verified,conflict")
        validity = load_validity(conn)
        pasal_rows = load_rows(conn, "pasal", "id,reg_id,seq,path,bagian_dok,text")
    finally:
        conn.close()

    nodes, key_to_ids, source_map = build_node_index(regulation_rows)
    apply_validity(nodes, validity, source_map)
    edges, relation_stats = build_relation_edges(relation_rows, nodes, source_map, key_to_ids)
    citations, citation_stats = build_citations(pasal_rows, nodes, source_map, key_to_ids)
    if max_citations is not None:
        citations = citations[: max(0, max_citations)]

    findings = quality_findings(nodes, edges, citations)
    conflicted_node_ids = {
        node["id"] for node in nodes if "status_site_conflict" in node.get("qualityFlags", [])
    }
    conflicted_edge_ids = {
        edge["id"] for edge in edges if set(edge.get("flags", [])) & {
            "source_conflict", "hierarchy_violation", "temporal_inconsistency", "contradictory_relation_types"
        }
    }
    summary = {
        "nodes": len(nodes),
        "sourceRegulationRows": len(regulation_rows),
        "duplicateSourceRows": sum(max(0, int(node["duplicateSourceRows"]) - 1) for node in nodes),
        "edges": len(edges),
        "relationRows": len(relation_rows),
        "eligibleEdges": sum(int(edge["eligibleForAnswer"]) for edge in edges),
        "quarantinedEdges": sum(int(not edge["eligibleForAnswer"]) for edge in edges),
        "conflicts": {
            "nodes": len(conflicted_node_ids),
            "edges": len(conflicted_edge_ids),
            "total": len(conflicted_node_ids) + len(conflicted_edge_ids),
        },
        "orphans": sum(int("unresolved_target" in edge.get("flags", []) or "ambiguous_target" in edge.get("flags", [])) for edge in edges),
        "duplicates": {
            "sourceRowsCollapsed": sum(max(0, int(node["duplicateSourceRows"]) - 1) for node in nodes),
            "canonicalNodesWithMultipleRows": sum(int(node["duplicateSourceRows"] > 1) for node in nodes),
            "relationRowsCollapsed": sum(max(0, int(edge["duplicateRows"]) - 1) for edge in edges),
        },
        "citations": len(citations),
        "resolvedCitations": sum(int(item.get("resolved")) for item in citations),
        "quarantinedCitations": sum(int(not item.get("resolved")) for item in citations),
        "nodeFlags": dict(sorted(Counter(flag for node in nodes for flag in node.get("qualityFlags", [])).items())),
        "relationFlags": dict(sorted(relation_stats.items())),
        "citationFlags": dict(sorted(Counter(flag for item in citations for flag in item.get("flags", [])).items())),
        "status": dict(sorted(Counter(node.get("validity", {}).get("statusDerived", "unknown") for node in nodes).items())),
        "qualityGate": "review_required" if any(item["severity"] == "high" for item in findings) else "pass_with_warnings" if findings else "pass",
    }
    source_stat = db_path.stat()
    return {
        "schemaVersion": ALGORITHM_VERSION,
        "source": {
            "databasePath": str(db_path.resolve()),
            "databaseSha256": source_hash(db_path),
            "databaseMtime": datetime.fromtimestamp(source_stat.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
            "readOnly": True,
        },
        "summary": summary,
        "nodes": sorted(nodes, key=lambda item: item["id"]),
        "edges": edges,
        "citations": citations,
        "findingsSample": findings[:200],
    }


def write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def write_artifacts(snapshot: dict[str, Any], output_dir: Path) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    graph = {key: snapshot[key] for key in ("schemaVersion", "source", "summary", "nodes", "edges")}
    report = {
        "schemaVersion": snapshot["schemaVersion"],
        "source": snapshot["source"],
        "summary": snapshot["summary"],
        "findingsSample": snapshot["findingsSample"],
    }
    graph_path = output_dir / "regulation-graph.json"
    report_path = output_dir / "regulation-quality-report.json"
    citations_path = output_dir / "regulation-citations.jsonl"
    write_atomic(graph_path, json.dumps(graph, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    write_atomic(report_path, json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    write_atomic(citations_path, "".join(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n" for item in snapshot["citations"]))

    # A compact CSV makes the review queue usable without loading the graph.
    queue_path = output_dir / "regulation-review-queue.csv"
    rows = []
    for finding in snapshot["findingsSample"]:
        rows.append({
            "severity": finding.get("severity", ""),
            "kind": finding.get("kind", ""),
            "code": finding.get("code", ""),
            "id": finding.get("id", ""),
            "source": finding.get("source", ""),
            "target": finding.get("target", ""),
            "type": finding.get("type", ""),
            "raw": finding.get("raw", ""),
            "canonical": finding.get("canonical", ""),
        })
    write_atomic(queue_path, "")
    with queue_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["severity", "kind", "code", "id", "source", "target", "type", "raw", "canonical"])
        writer.writeheader()
        writer.writerows(rows)
    return {"graph": str(graph_path), "report": str(report_path), "citations": str(citations_path), "queue": str(queue_path)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True, help="Read-only source SQLite database")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/regulation-quality"))
    parser.add_argument("--max-citations", type=int, default=None, help="Only for smoke tests; omit for full snapshot")
    args = parser.parse_args(argv)
    if not args.db.exists():
        parser.error(f"source database does not exist: {args.db}")
    snapshot = build_snapshot(args.db, max_citations=args.max_citations)
    paths = write_artifacts(snapshot, args.output_dir)
    print(json.dumps({"summary": snapshot["summary"], "artifacts": paths}, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
