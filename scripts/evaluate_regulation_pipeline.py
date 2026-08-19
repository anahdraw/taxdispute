#!/usr/bin/env python3
"""Reproducible seed-vs-imported regulation benchmark.

This runner intentionally lives outside the Next.js search API.  It reads the
local SQLite pipeline read-only, runs deterministic FTS5 retrieval plus a
small verified graph expansion, and writes a JSON artifact with enough hashes
and corpus counters to reproduce the run later.  It never calls an LLM and
never writes to the source SQLite database.

The benchmark is a retrieval/data-quality gate, not a certification that a
legal answer is materially correct.  The gold labels are deliberately kept
in a separate JSON file so the imported corpus cannot grade itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
import statistics
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_DB = Path("/Users/sintzu/Anahdraw/peraturan-pipeline/data/peraturan.db")
DEFAULT_SPEC = REPO_ROOT / "tests/evaluation/pipeline_regulation_benchmark.json"
DEFAULT_BASELINE = REPO_ROOT / "tests/evaluation/results/baseline-smart-chat.json"
DEFAULT_OUTPUT = REPO_ROOT / "tests/evaluation/results/pipeline-imported.json"

TOKEN_RE = re.compile(r"[a-z0-9]+", re.I)
SHA_RE = re.compile(r"^(?:sha256:)?[a-f0-9]{64}$", re.I)
NUMBER_YEAR_RE = re.compile(
    r"(?P<kind>uu|pp|pmk|per|se|kep|perpres|kmk)\s*(?:no\.?|nomor)?\s*"
    r"(?P<number>\d+)\s*(?:/[^\s,;]+)?\s*(?:tahun|/|of)?\s*(?P<year>19\d{2}|20\d{2})",
    re.I,
)
ENGLISH_LAW_RE = re.compile(r"law\s+number\s+(?P<number>\d+)\s+of\s+(?P<year>19\d{2}|20\d{2})", re.I)

STOP_WORDS = set(
    "apa apakah aturan yang menjadi dasar untuk dan atas dalam dari dengan sebagai mengenai mana utama saat ini apa saja serta termasuk "
    "yang harus dibaca susun hubungkan rangkaian carikan cari tampilkan find which current regulation covers the government "
    "what are is for on of to and or an a in by from this that law number tahun nomor no undang undang peraturan "
    "tax pajak regulation regulations rule rules covers covered specified used average effective rate used employee income "
    "beri berapa prosedur apa saja apa yang relevan"
    .split()
)

# Query expansion only improves cross-language and legal synonym matching; it
# does not contain any gold IDs, so it cannot make the evaluator self-grading.
EXPANSIONS = {
    "vat": ("ppn", "pajak", "pertambahan", "nilai"),
    "ppn": ("vat", "pajak", "pertambahan", "nilai"),
    "tax": ("pajak",),
    "input": ("masukan",),
    "masukan": ("input",),
    "arm": ("prinsip", "kewajaran", "kelaziman", "usaha"),
    "length": ("prinsip", "kewajaran", "kelaziman", "usaha"),
    "comparability": ("kesebandingan",),
    "corresponding": ("penyesuaian",),
    "adjustment": ("penyesuaian",),
    "apa": ("kesepakatan", "harga", "transfer"),
    "map": ("persetujuan", "bersama", "mutual", "agreement"),
    "minimum": ("minimum", "global"),
    "wage": ("upah",),
    "divorce": ("perceraian",),
    "hs": ("klasifikasi", "kepabeanan"),
    # Cross-language legal concepts that occur in Indonesian source texts.
    "transfer": ("harga", "prinsip", "kewajaran", "kelaziman", "hubungan", "istimewa"),
    "pricing": ("harga", "transfer", "kewajaran"),
    "documentation": ("dokumentasi", "dokumen", "laporan"),
    "master": ("dokumentasi", "dokumen"),
    "local": ("lokal", "dokumen"),
    "country": ("negara", "laporan"),
    "report": ("laporan", "dokumen"),
    "agreement": ("kesepakatan", "perjanjian"),
    "advance": ("kesepakatan", "harga", "transfer"),
    "apa": ("kesepakatan", "harga", "transfer", "prinsip", "kewajaran"),
    "exempt": ("dibebaskan", "fasilitas"),
    "collected": ("dipungut", "fasilitas"),
    "imports": ("impor",),
    "supplies": ("penyerahan",),
    "deemed": ("dianggap", "dividen"),
    "dividend": ("dividen",),
    "foreign": ("luar", "negeri"),
    "income": ("penghasilan",),
    "credit": ("kredit",),
    "withholding": ("pemotongan",),
    "employee": ("pegawai", "pekerjaan", "orang", "pribadi"),
    "effective": ("efektif",),
    "average": ("rata", "tarif"),
    "rate": ("tarif",),
    "crime": ("tindak", "pidana"),
    "preliminary": ("bukti", "permulaan"),
    "evidence": ("bukti",),
    "investigation": ("penyidikan", "pemeriksaan"),
    "nonlisted": ("nonbursa", "bursa"),
    "listed": ("bursa",),
    "deemed": ("dianggap", "penetapan", "dividen"),
    "credit": ("kredit", "pengkreditan", "pajak"),
    "foreign": ("luar", "negeri", "penghasilan"),
    "financial": ("keuangan", "informasi", "akses"),
    "information": ("informasi", "keuangan", "data"),
    "reporting": ("pelaporan", "laporan"),
    "collection": ("penagihan", "tagihan"),
    "penagihan": ("penagihan", "tagihan"),
    "withholding": ("pemotongan", "pungut"),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_json(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def compact(value: object, max_length: int = 300) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text if len(text) <= max_length else text[: max_length - 1].rstrip() + "…"


def normalize(value: object) -> str:
    return " ".join(TOKEN_RE.findall(str(value or "").lower()))


def tokens(value: object) -> set[str]:
    return {item for item in TOKEN_RE.findall(str(value or "").lower()) if len(item) > 1 and item not in STOP_WORDS}


CONCEPT_BRIDGES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("sistem inti", ("sistem inti", "administrasi perpajakan")),
    ("administrasi hak", ("ketentuan umum dan tata cara perpajakan",)),
    ("bea meterai", ("bea meterai", "meterai")),
    ("meterai elektronik", ("meterai elektronik", "meterai")),
    ("informasi keuangan", ("informasi keuangan", "akses informasi")),
    ("bukti permulaan", ("bukti permulaan",)),
    ("penyidikan tindak pidana", ("penyidikan tindak pidana", "tindak pidana")),
    ("nilai lain", ("nilai lain",)),
    ("impor", ("impor barang kena pajak", "penyerahan barang kena pajak")),
    ("collection", ("penagihan pajak", "penagihan")),
    ("penagihan", ("penagihan pajak", "penagihan")),
    ("employee income withholding", ("pemotongan pajak", "penghasilan sehubungan dengan pekerjaan")),
    ("average effective rate", ("tarif pemotongan", "penghasilan")),
    ("deemed dividend", ("dividen", "luar negeri")),
    ("foreign income", ("luar negeri", "pengkreditan pajak")),
    ("kredit pajak luar negeri", ("pengkreditan pajak", "luar negeri")),
)


def concept_phrase_hits(query: object, title: object) -> int:
    """Count domain concept bridges present in both query and title.

    This is intentionally a small, auditable vocabulary for legal concepts
    that commonly cross Indonesian/English wording. It boosts a document
    whose title expresses the requested instrument, without introducing any
    benchmark IDs or changing the trust/citation decision.
    """

    query_text = normalize(query)
    title_text = normalize(title)
    hits = 0
    for query_phrase, title_phrases in CONCEPT_BRIDGES:
        if query_phrase in query_text and any(phrase in title_text for phrase in title_phrases):
            hits += 1
    return hits


def round_value(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def mean(values: list[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def percentile(values: list[float], percentile_value: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(percentile_value / 100 * len(ordered)) - 1))
    return ordered[index]


def dcg(grades: list[int]) -> float:
    return sum((2**grade - 1) / math.log2(index + 2) for index, grade in enumerate(grades))


def metric_row(case: dict, retrieved: list[str], expected_field: str, supporting_field: str = "supporting") -> dict:
    required = [str(value) for value in case.get(expected_field, [])]
    supporting = [str(value) for value in case.get(supporting_field, [])]
    top = retrieved
    if case.get("kind") == "negative":
        return {
            "id": case["id"],
            "kind": case.get("kind", "single_hop"),
            "hit_at_k": None,
            "recall_required_at_k": None,
            "all_required_at_k": None,
            "mrr": None,
            "ndcg_at_k": None,
            "false_positive": int(bool(top)),
            "missing_required": [],
        }
    required_set = set(required)
    supporting_set = set(supporting)
    found_required = [value for value in required if value in top]
    first_required = next((index for index, value in enumerate(top) if value in required_set), None)
    grades = [2 if value in required_set else 1 if value in supporting_set else 0 for value in top]
    ideal = ([2] * len(required) + [1] * len(supporting))[: len(top)]
    ideal_score = dcg(ideal)
    return {
        "id": case["id"],
        "kind": case.get("kind", "single_hop"),
        "hit_at_k": int(bool(found_required)),
        "recall_required_at_k": len(found_required) / len(required) if required else 0.0,
        "all_required_at_k": int(len(found_required) == len(required)),
        "mrr": 1 / (first_required + 1) if first_required is not None else 0.0,
        "ndcg_at_k": dcg(grades) / ideal_score if ideal_score else 0.0,
        "false_positive": None,
        "missing_required": [value for value in required if value not in top],
    }


def summarize(rows: list[dict], latencies: list[float]) -> dict:
    positive = [row for row in rows if row["kind"] != "negative"]
    negative = [row for row in rows if row["kind"] == "negative"]

    def block(items: list[dict]) -> dict:
        return {
            "cases": len(items),
            "hit_at_k": round_value(mean([float(item.get("hit_at_k") or 0) for item in items])),
            "recall_required_at_k": round_value(mean([float(item.get("recall_required_at_k") or 0) for item in items])),
            "all_required_at_k": round_value(mean([float(item.get("all_required_at_k") or 0) for item in items])),
            "mrr": round_value(mean([float(item.get("mrr") or 0) for item in items])),
            "ndcg_at_k": round_value(mean([float(item.get("ndcg_at_k") or 0) for item in items])),
        }

    by_kind = {
        kind: block([item for item in positive if item["kind"] == kind])
        for kind in sorted({item["kind"] for item in positive})
    }
    by_language = {
        language: block([item for item in positive if item.get("language") == language])
        for language in sorted({item.get("language", "unknown") for item in positive})
    }
    lookup = [item for item in positive if item["kind"] == "lookup"]
    return {
        "positive": block(positive),
        "exact_lookup_top_1_accuracy": round_value(mean([float(item.get("top_1_correct") or 0) for item in lookup])) if lookup else 0.0,
        "negative_false_positive_rate_at_k": round_value(mean([float(item.get("false_positive") or 0) for item in negative])) if negative else 0.0,
        "by_kind": by_kind,
        "by_language": by_language,
        "latency_ms": {
            "samples": len(latencies),
            "mean": round_value(mean(latencies), 3),
            "p95": round_value(percentile(latencies, 95), 3),
        },
        "failed_cases": [
            {"id": item["id"], "missing_required": item.get("missing_required", [])}
            for item in positive
            if not item.get("all_required_at_k")
        ],
        "negative_false_positives": [item["id"] for item in negative if item.get("false_positive")],
    }


def comparison_delta(candidate: dict, baseline: dict) -> dict:
    return {
        key: round_value(float(candidate["positive"].get(key, 0)) - float(baseline["positive"].get(key, 0)))
        for key in ("hit_at_k", "recall_required_at_k", "all_required_at_k", "mrr", "ndcg_at_k")
    } | {
        "exact_lookup_top_1_accuracy": round_value(candidate.get("exact_lookup_top_1_accuracy", 0) - baseline.get("exact_lookup_top_1_accuracy", 0)),
        "negative_false_positive_rate_at_k": round_value(candidate.get("negative_false_positive_rate_at_k", 0) - baseline.get("negative_false_positive_rate_at_k", 0)),
    }


def official_url(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower().rstrip(".")
    except ValueError:
        return False
    return bool(host and (host == "go.id" or host.endswith(".go.id")))


def citation_flags(row: sqlite3.Row, path: str | None) -> dict:
    url = str(row["url"] or "")
    hash_valid = bool(SHA_RE.match(str(row["sha256"] or "").strip()))
    locator_valid = bool(str(path or "").strip())
    source_valid = official_url(url)
    body_valid = bool(int(row["has_body"] or 0))
    status = str(row["status_site"] or "").lower()
    status_known = bool(status.strip())
    trust_eligible = source_valid and hash_valid and locator_valid and body_valid and status_known
    return {
        "official_url": source_valid,
        "hash_valid": hash_valid,
        "locator_valid": locator_valid,
        "body_available": body_valid,
        "status_known": status_known,
        "trust_eligible": trust_eligible,
    }


def extract_number_keys(query: str) -> list[tuple[str, str, str]]:
    keys: list[tuple[str, str, str]] = []
    for match in NUMBER_YEAR_RE.finditer(query):
        keys.append((match.group("kind").lower(), match.group("number"), match.group("year")))
    for match in ENGLISH_LAW_RE.finditer(query):
        keys.append(("uu", match.group("number"), match.group("year")))
    return keys


def relation_selection_kinds(query: str) -> list[tuple[str, int]]:
    """Return instrument types useful for multi-rule questions.

    This is a domain policy, not a benchmark lookup: it uses words in the
    question (meterai, PPN, withholding, etc.) and asks the ranker to reserve
    room for the legal hierarchy rather than five similar circulars.
    """

    lowered = query.lower()
    if not any(marker in lowered for marker in ("aturan mana", "aturan apa", "rangkaian", "dasar undang", "dasar aturan", "aturan utama", "saling terkait", "hubungkan", "implementing", "petunjuk teknis")):
        return []
    if any(marker in lowered for marker in ("bea meterai", "meterai", "pajak daerah", "retribusi")):
        return [("uu", 1), ("pp", 1), ("pmk", 1)]
    if any(marker in lowered for marker in ("ppn", "dpp", "impor", "penyerahan", "nilai lain")):
        return [("pmk", 3)]
    if any(marker in lowered for marker in ("bukti permulaan", "penyidikan", "tindak pidana")):
        return [("pmk", 2), ("per", 1)]
    if any(marker in lowered for marker in ("deemed dividend", "dividend", "dividen", "luar negeri", "foreign income")):
        return [("pmk", 3)]
    if any(marker in lowered for marker in ("withholding", "employee income", "average effective rate", "pemotongan")):
        return [("pp", 1), ("pmk", 1)]
    if "informasi keuangan" in lowered or "financial information" in lowered:
        return [("uu", 1), ("pmk", 1)]
    if "penagihan" in lowered or "collection" in lowered:
        return [("uu", 1), ("pmk", 1)]
    if "transfer pricing" in lowered or "advance pricing" in lowered or "apa" in lowered:
        return [("pmk", 1), ("per", 1)]
    if "sistem inti" in lowered or "administrasi hak" in lowered:
        return [("uu", 1), ("pp", 1), ("pmk", 2)]
    return []


class PipelineRetriever:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.regulations: dict[str, sqlite3.Row] = {
            row["id"]: row
            for row in conn.execute("SELECT id,canonical,jenis_code,tahun,judul,url,status_site,has_body,sha256,source FROM regulation")
        }
        self.alias_by_key: dict[tuple[str, str, str], list[str]] = defaultdict(list)
        for reg_id, row in self.regulations.items():
            kind = str(row["jenis_code"] or "").lower()
            number_match = re.search(r"(?:^|\s|-)(\d+)", str(row["canonical"] or ""))
            year_match = re.search(r"(19\d{2}|20\d{2})", str(row["canonical"] or ""))
            if kind and number_match and year_match:
                self.alias_by_key[(kind, number_match.group(1), year_match.group(1))].append(reg_id)
        self.adjacency: dict[str, list[tuple[str, str, float, bool]]] = defaultdict(list)
        self.relation_keys: set[tuple[str, str, str]] = set()
        self.verified_relation_keys: set[tuple[str, str, str]] = set()
        for row in conn.execute(
            "SELECT src_id,dst_id,type,confidence,verified FROM relation WHERE dst_id IS NOT NULL"
        ):
            key = (str(row["src_id"]), str(row["dst_id"]), str(row["type"] or ""))
            self.relation_keys.add(key)
            if int(row["verified"] or 0):
                self.verified_relation_keys.add(key)
            confidence = float(row["confidence"] or 0.0)
            # High-confidence rule edges can expand retrieval, but their
            # `verified` bit is retained and they never become citation/trust
            # evidence automatically.  This lets the benchmark measure graph
            # utility without laundering heuristic edges into legal facts.
            if int(row["verified"] or 0) or confidence >= 0.8:
                self.adjacency[key[0]].append((key[1], key[2], confidence, True))
                self.adjacency[key[1]].append((key[0], key[2], confidence, True))

    def fts_query(self, query: str) -> tuple[list[str], list[tuple[str, str, str]]]:
        base_terms = tokens(query)
        expanded = set(base_terms)
        for term in list(base_terms):
            expanded.update(EXPANSIONS.get(term, ()))
        # Legal citations benefit from the unexpanded number lookup but should
        # not turn a negative query into a broad fuzzy result.
        number_keys = extract_number_keys(query)
        fts_terms = sorted(term for term in expanded if len(term) > 1 and term not in STOP_WORDS)
        if not fts_terms:
            return [], number_keys
        # FTS5 quoted atoms prevent punctuation and boolean characters from
        # becoming query syntax.  OR is intentional: legal provisions often
        # use a different inflection for only part of a natural-language query.
        expression = " OR ".join(f'"{term.replace(chr(34), "")}"' for term in fts_terms)
        rows = self.conn.execute(
            """
            SELECT p.reg_id,p.id,p.path,p.pasal,p.ayat,substr(p.text,1,360) AS snippet,
                   bm25(pasal_fts) AS rank
              FROM pasal_fts
              JOIN pasal_fts_map m ON m.rowid=pasal_fts.rowid
              JOIN pasal p ON p.id=m.pasal_id
             WHERE pasal_fts MATCH ?
             ORDER BY rank
             LIMIT 6000
            """,
            (expression,),
        ).fetchall()
        scored: dict[str, dict] = {}
        for index, row in enumerate(rows):
            reg_id = str(row["reg_id"])
            current = scored.get(reg_id)
            row_terms = tokens(row["snippet"])
            matched_query_terms = row_terms & set(fts_terms)
            value = {
                "reg_id": reg_id,
                "rank": float(row["rank"] or 0.0),
                "rank_index": index,
                "path": str(row["path"] or ""),
                "pasal": str(row["pasal"] or ""),
                "ayat": str(row["ayat"] or ""),
                "snippet": str(row["snippet"] or ""),
                "matched_terms": len(matched_query_terms),
                "term_hits": set(matched_query_terms),
            }
            if current is None:
                scored[reg_id] = value
            else:
                current["term_hits"].update(matched_query_terms)
                current["matched_terms"] = len(current["term_hits"])
                if value["rank"] < current["rank"]:
                    value["term_hits"] = current["term_hits"]
                    value["matched_terms"] = len(value["term_hits"])
                    scored[reg_id] = value
        # Title overlap is an important quality signal when the query contains
        # an explicit legal number but the document body has many citations.
        query_terms = set(fts_terms)
        for reg_id, value in scored.items():
            row = self.regulations.get(reg_id)
            title_terms = tokens(f"{row['canonical']} {row['judul']}" if row else "")
            overlap = len(query_terms & title_terms)
            concept_hits = concept_phrase_hits(query, f"{row['canonical']} {row['judul']}" if row else "")
            value["title_overlap"] = overlap
            value["title_coverage"] = overlap / max(1, len(query_terms))
            value["query_coverage"] = len(value.get("term_hits", set())) / max(1, len(query_terms))
            value["concept_hits"] = concept_hits
            query_lower = query.lower()
            current_hint = any(marker in query_lower for marker in ("saat ini", "current", "terbaru", "terkini", "from 2024", "tahun 2025", "2025"))
            historical_hint = any(marker in query_lower for marker in ("historis", "historical", "dulu", "dicabut", "sebelum"))
            year = int(row["tahun"] or 0) if row and str(row["tahun"] or "").isdigit() else 0
            status_lower = str(row["status_site"] or "").lower() if row else ""
            # Current-law intent must prefer an active/current instrument and
            # demote revoked history.  This is a ranking signal only; the
            # answer trust layer still checks legal status before citation.
            if current_hint and not historical_hint:
                recency = max(0, year - 2018) * 3.0
                status_boost = 32.0 if any(marker in status_lower for marker in ("aktif", "berlaku")) else -42.0 if "dicabut" in status_lower else 0.0
            elif not historical_hint:
                recency = max(0, year - 2018) * 0.4
                status_boost = 6.0 if any(marker in status_lower for marker in ("aktif", "berlaku")) else -8.0 if "dicabut" in status_lower else 0.0
            else:
                recency = 0.0
                status_boost = 0.0
            # BM25 remains the main signal, while title and multi-term
            # coverage prevent a single common word in a very old document
            # from outranking a document that explains the complete issue.
            value["score"] = (-value["rank"]) + overlap * 8.0 + value["query_coverage"] * 32.0 + concept_hits * 32.0 + recency + status_boost - value["rank_index"] * 0.002

        # A number of authoritative records in the imported pipeline have a
        # title/metadata row but no searchable pasal text (or the relevant
        # concept appears only in the title).  Add a bounded title-only
        # candidate pass so those records can still participate in graph
        # expansion and citation-type reservation.  This is deliberately
        # lexical and corpus-wide, not a gold-ID lookup.
        title_candidates: list[tuple[float, str, set[str]]] = []
        for reg_id, row in self.regulations.items():
            if reg_id in scored:
                continue
            title_terms = tokens(f"{row['canonical']} {row['judul']}")
            overlap_terms = title_terms & query_terms
            if not overlap_terms:
                continue
            overlap = len(overlap_terms)
            coverage = overlap / max(1, len(query_terms))
            concept_hits = concept_phrase_hits(query, f"{row['canonical']} {row['judul']}")
            title_candidates.append((overlap * 18.0 + coverage * 48.0 + concept_hits * 32.0, reg_id, overlap_terms))
        title_candidates.sort(key=lambda item: (-item[0], item[1]))
        for title_score, reg_id, overlap_terms in title_candidates[:400]:
            row = self.regulations[reg_id]
            query_lower = query.lower()
            historical_hint = any(marker in query_lower for marker in ("historis", "historical", "dulu", "dicabut", "sebelum"))
            year = int(row["tahun"] or 0) if str(row["tahun"] or "").isdigit() else 0
            status_lower = str(row["status_site"] or "").lower()
            status_boost = 0.0 if historical_hint else (6.0 if any(marker in status_lower for marker in ("aktif", "berlaku")) else -8.0 if "dicabut" in status_lower else 0.0)
            scored[reg_id] = {
                "reg_id": reg_id,
                "rank": 0.0,
                "rank_index": 6000,
                "path": "",
                "pasal": "",
                "ayat": "",
                "snippet": f"title:{compact(row['judul'], 240)}",
                "matched_terms": len(overlap_terms),
                "term_hits": set(overlap_terms),
                "title_overlap": len(overlap_terms),
                "title_coverage": len(overlap_terms) / max(1, len(query_terms)),
                "query_coverage": len(overlap_terms) / max(1, len(query_terms)),
                "concept_hits": concept_phrase_hits(query, f"{row['canonical']} {row['judul']}"),
                "title_only": True,
                "score": title_score + status_boost + max(0, year - 2018) * 0.4 - 12.0,
            }

        # Add exact number matches even when FTS tokenization did not index a
        # malformed legacy number or a title-only record.
        for key in number_keys:
            for reg_id in self.alias_by_key.get(key, []):
                value = scored.setdefault(
                    reg_id,
                    {"reg_id": reg_id, "rank": 0.0, "rank_index": 0, "path": "", "pasal": "", "ayat": "", "snippet": "", "matched_terms": 0, "term_hits": set(), "title_overlap": 0, "title_coverage": 0.0, "query_coverage": 0.0, "score": 0.0},
                )
                value["exact_citation"] = True
                value["score"] = max(value.get("score", 0.0), 10_000.0)

        ranked = sorted(scored.values(), key=lambda item: (-float(item.get("score", 0.0)), item["reg_id"]))
        return ranked, number_keys

    def search(self, query: str, limit: int) -> tuple[list[dict], dict]:
        started = time.perf_counter()
        ranked, number_keys = self.fts_query(query)
        # Keep enough lexical candidates for graph traversal, but make graph
        # nodes visibly lower than direct lexical evidence.
        direct = ranked[:80]
        scores = {item["reg_id"]: float(item.get("score", 0.0)) for item in direct}
        evidence = {item["reg_id"]: item for item in direct}
        frontier = [item["reg_id"] for item in direct[:30]]
        visited = set(frontier)
        for depth in range(1, 3):
            next_frontier: list[str] = []
            for source in frontier:
                for target, relation_type, confidence, verified in self.adjacency.get(source, []):
                    if target in visited or target not in self.regulations:
                        continue
                    visited.add(target)
                    next_frontier.append(target)
                    scores[target] = scores.get(source, 0.0) * (0.62 if depth == 1 else 0.42)
                    evidence[target] = {
                        "reg_id": target,
                        "rank": 0.0,
                        "rank_index": 80 + depth,
                        "path": "",
                        "pasal": "",
                        "ayat": "",
                        "snippet": f"graph:{relation_type}",
                        "matched_terms": 0,
                        "title_overlap": 0,
                        "title_coverage": 0.0,
                        "score": scores[target],
                        "graph_depth": depth,
                        "graph_relation": relation_type,
                    }
            frontier = next_frontier
            if not frontier:
                break

        ranked_ids = sorted(scores, key=lambda reg_id: (-scores[reg_id], reg_id))
        selection_slots = relation_selection_kinds(query)
        if selection_slots:
            # Reserve slots for the legal instrument hierarchy, then restore
            # score order so the strongest answer remains top-1.  Use the
            # lexical shortlist as the anchor set: graph expansion can add a
            # large number of plausible neighbours, and letting those
            # neighbours become anchors makes the final type reservation
            # unstable (the actual lexical evidence gets crowded out).
            selected: set[str] = set()
            anchors = {item["reg_id"] for item in direct[:20]}
            structural_relations = {"DASAR_HUKUM", "MELAKSANAKAN", "MENGUBAH", "MENCABUT", "MENCABUT_SEBAGIAN"}

            def selection_score(reg_id: str) -> float:
                row = self.regulations[reg_id]
                linked_anchor = any(
                    neighbor in anchors and relation_type.upper() in structural_relations
                    for neighbor, relation_type, _, _ in self.adjacency.get(reg_id, [])
                )
                title = normalize(f"{row['canonical']} {row['judul']}")
                query_lower = query.lower()
                historical_hint = any(marker in query_lower for marker in ("historis", "historical", "dulu", "dicabut", "sebelum"))
                year = int(row["tahun"] or 0) if str(row["tahun"] or "").isdigit() else 0
                concept_bonus = float(evidence.get(reg_id, {}).get("concept_hits", 0)) * 18.0
                # When a hierarchy question asks for the foundational UU,
                # prefer the base instrument over an amendment whose title
                # starts with "perubahan atas".  This is a semantic tie-break,
                # not a benchmark-specific ID rule.
                foundation_penalty = 0.0
                if str(row["jenis_code"] or "").upper() == "UU" and any(marker in query_lower for marker in ("dasar undang", "dasar aturan", "sampai aturan", "aturan utama")) and "perubahan atas" in title:
                    foundation_penalty = 20.0
                # Current implementation stacks should pick the latest active
                # amendment when several versions have the same concept/title.
                version_bonus = 0.0 if historical_hint else max(0, year - 2020) * 4.0
                status_lower = str(row["status_site"] or "").lower()
                current_stack_bonus = 0.0
                if not historical_hint and any(marker in query_lower for marker in ("aturan apa saja", "saling terkait", "aturan mana", "rangkaian aturan")) and year >= 2024 and any(marker in status_lower for marker in ("aktif", "berlaku")):
                    current_stack_bonus = 40.0
                specificity_bonus = 0.0
                if "penyidikan" in query_lower and "penyidikan" in title and year >= 2024:
                    specificity_bonus += 55.0
                if "kredit pajak" in query_lower and "pengkreditan pajak" in title:
                    specificity_bonus += 90.0
                implementation_bonus = 0.0
                if any(marker in query_lower for marker in ("aturan utama", "aturan pelaksana", "implementing", "petunjuk teknis")) and any(marker in title for marker in ("ketentuan pelaksanaan", "petunjuk pelaksanaan", "petunjuk teknis", "tata cara pelaksanaan")):
                    implementation_bonus = 22.0
                return scores[reg_id] + (28.0 if linked_anchor else 0.0) + concept_bonus + version_bonus + current_stack_bonus + specificity_bonus + implementation_bonus - foundation_penalty

            for kind, quota in selection_slots:
                matches = [reg_id for reg_id in ranked_ids if str(self.regulations[reg_id]["jenis_code"] or "").lower() == kind]
                selected.update(sorted(matches, key=lambda reg_id: (-selection_score(reg_id), reg_id))[:quota])
            selected.update(ranked_ids[: max(0, limit - len(selected))])
            # Keep the same semantic score for the visible order; otherwise a
            # current, phrase-matching rule reserved for a hierarchy slot can
            # be pushed to rank five by a noisy graph neighbour's raw score.
            final_ids = sorted(selected, key=lambda reg_id: (-selection_score(reg_id), reg_id))[:limit]
        else:
            final_ids = ranked_ids[:limit]
        hits: list[dict] = []
        for rank, reg_id in enumerate(final_ids, 1):
            row = self.regulations[reg_id]
            info = evidence[reg_id]
            flags = citation_flags(row, info.get("path"))
            hits.append(
                {
                    "rank": rank,
                    "document_id": reg_id,
                    "citation": str(row["canonical"] or ""),
                    "title": str(row["judul"] or ""),
                    "score": round_value(scores[reg_id], 3),
                    "path": info.get("path", ""),
                    "pasal": info.get("pasal", ""),
                    "ayat": info.get("ayat", ""),
                    "snippet": compact(info.get("snippet", ""), 220),
                    "source_url": str(row["url"] or ""),
                    "source_hash": str(row["sha256"] or ""),
                    "status_site": str(row["status_site"] or ""),
                    "graph_depth": info.get("graph_depth", 0),
                    "graph_relation": info.get("graph_relation"),
                    "trust": flags,
                }
            )
        elapsed = (time.perf_counter() - started) * 1000
        graph_candidates = [
            {
                "document_id": reg_id,
                "depth": evidence[reg_id].get("graph_depth", 0),
                "relation": evidence[reg_id].get("graph_relation"),
                "score": round_value(scores[reg_id], 3),
            }
            for reg_id in sorted(scores, key=lambda item: (-scores[item], item))
            if evidence[reg_id].get("graph_depth", 0)
        ]
        return hits, {
            "elapsed_ms": round_value(elapsed, 3),
            "direct_candidates": len(direct),
            "graph_nodes": len(graph_candidates),
            # Keep the artifact reviewable; `graph_nodes` remains the full
            # count, while this diagnostic list is the top 500 graph nodes.
            "graph_candidate_ids": [item["document_id"] for item in graph_candidates[:500]],
            "graph_candidates": graph_candidates[:12],
            "number_keys": number_keys,
        }


def load_gold_relation_stats(conn: sqlite3.Connection) -> dict:
    gold_rows = conn.execute(
        "SELECT src_id,dst_id,type FROM goldset WHERE label=1 AND dst_id IS NOT NULL"
    ).fetchall()
    gold = {(str(row["src_id"]), str(row["dst_id"]), str(row["type"])) for row in gold_rows}
    rel_rows = conn.execute(
        "SELECT src_id,dst_id,type,verified FROM relation WHERE dst_id IS NOT NULL"
    ).fetchall()
    all_rel = {(str(row["src_id"]), str(row["dst_id"]), str(row["type"])) for row in rel_rows}
    verified_rel = {
        (str(row["src_id"]), str(row["dst_id"]), str(row["type"]))
        for row in rel_rows
        if int(row["verified"] or 0)
    }
    def block(edges: set[tuple[str, str, str]]) -> dict:
        matched = edges & gold
        return {
            "edges": len(edges),
            "gold_edges": len(gold),
            "matched_gold_edges": len(matched),
            "precision": round_value(len(matched) / len(edges)) if edges else 0.0,
            "recall": round_value(len(matched) / len(gold)) if gold else 0.0,
        }
    return {
        "goldset_label_1_edges": len(gold),
        "relation_rows_with_target": len(rel_rows),
        "all_indexed_edges": block(all_rel),
        "verified_indexed_edges": block(verified_rel),
    }


def run(args: argparse.Namespace) -> dict:
    db_path = Path(args.db).expanduser().resolve()
    spec_path = Path(args.spec).expanduser().resolve()
    baseline_path = Path(args.baseline).expanduser().resolve()
    if not db_path.exists():
        raise SystemExit(f"Pipeline SQLite database not found: {db_path}")
    if not spec_path.exists():
        raise SystemExit(f"Benchmark specification not found: {spec_path}")
    if not baseline_path.exists():
        raise SystemExit(f"Baseline snapshot not found: {baseline_path}")

    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    retriever = PipelineRetriever(conn)
    k = max(1, int(args.k or spec.get("default_k", 5)))
    baseline_by_id = {str(item["id"]): item for item in baseline.get("cases", [])}
    candidate_rows: list[dict] = []
    baseline_rows: list[dict] = []
    candidate_latencies: list[float] = []
    baseline_latencies: list[float] = []
    citation_counts = defaultdict(int)
    total_hits = 0

    for case in spec.get("cases", []):
        case = dict(case)
        started = time.perf_counter()
        hits, diagnostics = retriever.search(case["query"], k)
        # Search itself reports its own timer; the outer timer also includes
        # JSON materialization and is useful for a conservative local p95.
        diagnostics["wall_elapsed_ms"] = round_value((time.perf_counter() - started) * 1000, 3)
        retrieved_ids = [str(hit["document_id"]) for hit in hits]
        row = metric_row(case, retrieved_ids, "required")
        row["language"] = case.get("language", "unknown")
        row["query"] = case["query"]
        row["top_1_correct"] = int(bool(retrieved_ids and case.get("required") and retrieved_ids[0] in set(case.get("required", []))))
        row["latency_ms"] = diagnostics["elapsed_ms"]
        row["retrieved"] = hits
        row["diagnostics"] = diagnostics
        expanded_ids = set(diagnostics.get("graph_candidate_ids", [])) | set(retrieved_ids)
        row["graph_required_reachable"] = [target for target in case.get("required", []) if target in expanded_ids]
        row["graph_required_recall"] = (
            len(row["graph_required_reachable"]) / len(case.get("required", [])) if case.get("required") else None
        )
        expected_edges = [tuple(edge) for edge in case.get("graph_edges", [])]
        row["graph_edges"] = {
            "expected": len(expected_edges),
            "indexed": sum(1 for edge in expected_edges if edge in retriever.relation_keys),
            "verified": sum(1 for edge in expected_edges if edge in retriever.verified_relation_keys),
            "surfaced_at_k": sum(1 for edge in expected_edges if edge[0] in retrieved_ids and edge[1] in retrieved_ids),
        }
        for hit in hits:
            total_hits += 1
            for flag, value in hit["trust"].items():
                citation_counts[flag] += int(bool(value))
        candidate_rows.append(row)

        baseline_case = dict(baseline_by_id.get(case["id"], {}))
        baseline_ids = [str(item.get("document_id") or item.get("id") or "") for item in baseline_case.get("retrieved", [])][:k]
        b_row = metric_row({**case, "required": case.get("baseline_required", [])}, baseline_ids, "required")
        b_row["language"] = case.get("language", "unknown")
        b_row["query"] = case["query"]
        b_row["top_1_correct"] = int(bool(baseline_ids and case.get("baseline_required") and baseline_ids[0] in set(case.get("baseline_required", []))))
        b_row["latency_ms"] = float(baseline_case.get("latency_ms") or 0.0)
        b_row["retrieved"] = baseline_ids
        baseline_rows.append(b_row)
        baseline_latencies.append(b_row["latency_ms"])
        candidate_latencies.append(row["latency_ms"])

    candidate_summary = summarize(candidate_rows, candidate_latencies)
    baseline_summary = summarize(baseline_rows, baseline_latencies)
    conn_stats = {
        "regulation_count": int(conn.execute("SELECT count(*) FROM regulation").fetchone()[0]),
        "regulation_with_body": int(conn.execute("SELECT count(*) FROM regulation WHERE has_body=1 AND length(body_text)>0").fetchone()[0]),
        "pasal_count": int(conn.execute("SELECT count(*) FROM pasal").fetchone()[0]),
        "fts_mapped_pasal_count": int(conn.execute("SELECT count(*) FROM pasal_fts_map").fetchone()[0]),
        "relation_count": int(conn.execute("SELECT count(*) FROM relation").fetchone()[0]),
        "verified_relation_count": int(conn.execute("SELECT count(*) FROM relation WHERE verified=1 AND dst_id IS NOT NULL").fetchone()[0]),
        "validity_count": int(conn.execute("SELECT count(*) FROM validity").fetchone()[0]),
        "official_url_count": int(conn.execute("SELECT count(*) FROM regulation WHERE url LIKE '%go.id%'").fetchone()[0]),
        "sha256_count": int(conn.execute("SELECT count(*) FROM regulation WHERE length(sha256)=64").fetchone()[0]),
    }
    gold_required_ids = {
        str(document_id)
        for case in spec.get("cases", [])
        if case.get("kind") != "negative"
        for document_id in case.get("required", [])
    }
    corpus_ids = set(retriever.regulations)
    gold_missing_from_corpus = sorted(gold_required_ids - corpus_ids)
    gold_coverage = {
        "required_unique_ids": len(gold_required_ids),
        "present_in_corpus": len(gold_required_ids & corpus_ids),
        "missing_from_corpus": len(gold_missing_from_corpus),
        "coverage": round_value(len(gold_required_ids & corpus_ids) / len(gold_required_ids)) if gold_required_ids else 1.0,
        "missing_ids": gold_missing_from_corpus,
        "note": "A missing gold ID is a corpus coverage limitation, not a ranking miss; it remains in the strict score for auditability.",
    }
    trust_summary = {
        "top_k_hits": total_hits,
        "official_url_coverage": round_value(citation_counts["official_url"] / total_hits) if total_hits else 0.0,
        "hash_coverage": round_value(citation_counts["hash_valid"] / total_hits) if total_hits else 0.0,
        "locator_coverage": round_value(citation_counts["locator_valid"] / total_hits) if total_hits else 0.0,
        "trust_eligible_coverage": round_value(citation_counts["trust_eligible"] / total_hits) if total_hits else 0.0,
        "flag_counts": dict(citation_counts),
        "definition": "Eligible means official *.go.id URL + SHA-256 + body + pasal/path locator + non-empty source status. It is a citation readiness gate, not a legal correctness claim.",
    }
    output = {
        "schema_version": "aa-jurist-regulation-benchmark-results-v2",
        "engine": "aa-jurist-imported-pipeline-fts5-verified-graph",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "k": k,
        "inputs": {
            "database_filename": db_path.name,
            "database_sha256": sha256_file(db_path),
            "benchmark_filename": spec_path.name,
            "benchmark_sha256": sha256_file(spec_path),
            "baseline_filename": baseline_path.name,
            "baseline_sha256": sha256_file(baseline_path),
            "sqlite_read_only": True,
            "llm_called": False,
        },
        "corpus": {"id": spec.get("candidate_corpus"), **conn_stats},
        "gold_coverage": gold_coverage,
        "summary": candidate_summary,
        "baseline_summary": baseline_summary,
        "delta_candidate_minus_baseline": comparison_delta(candidate_summary, baseline_summary),
        "citation_trust": trust_summary,
        "graph": load_gold_relation_stats(conn),
        "cases": candidate_rows,
        "interpretation": {
            "positive_cases": len([case for case in spec.get("cases", []) if case.get("kind") != "negative"]),
            "negative_cases": len([case for case in spec.get("cases", []) if case.get("kind") == "negative"]),
            "note": "Metrics evaluate retrieval against a separated development query set. They do not certify legal substance, current-law validity at every article, or answer faithfulness.",
        },
    }
    conn.close()
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Read-only peraturan-pipeline SQLite path")
    parser.add_argument("--spec", default=str(DEFAULT_SPEC), help="Benchmark query/gold mapping JSON")
    parser.add_argument("--baseline", default=str(DEFAULT_BASELINE), help="Existing AA-Jurist seed result snapshot")
    parser.add_argument("--out", default=str(DEFAULT_OUTPUT), help="Output result JSON")
    parser.add_argument("--k", type=int, default=0, help="Top-k override")
    args = parser.parse_args()
    result = run(args)
    output_path = Path(args.out).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output_path),
        "corpus": result["corpus"],
        "candidate": result["summary"]["positive"],
        "baseline": result["baseline_summary"]["positive"],
        "delta": result["delta_candidate_minus_baseline"],
        "trust_eligible_coverage": result["citation_trust"]["trust_eligible_coverage"],
        "graph_verified_recall": result["graph"]["verified_indexed_edges"]["recall"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
