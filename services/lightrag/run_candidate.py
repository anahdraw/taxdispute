#!/usr/bin/env python3
"""Run the gold retrieval set against LightRAG `/query/data`.

The runner deliberately evaluates retrieval only. It does not ask LightRAG to
generate a legal answer, so the comparison measures document discovery rather
than prose quality or model style.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

from client import LightRAGClient, read_jsonl


SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parents[1]
DEFAULT_CORPUS = SERVICE_DIR / "generated" / "essential-regulations.jsonl"
DEFAULT_GOLD = REPO_ROOT / "tests" / "evaluation" / "regulation_retrieval_gold.json"
DEFAULT_OUTPUT = SERVICE_DIR / "generated" / "lightrag-mix-results.json"


def build_source_map(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    mapping: dict[str, dict[str, Any]] = {}
    for record in records:
        mapping[record["file_source"]] = record
        mapping[record["id"]] = record
        canonical_key = str(record.get("canonical_key") or "").strip()
        if canonical_key:
            mapping[canonical_key] = record
            mapping[f"aaj-regulation--{canonical_key}.md"] = record
    return mapping


def record_from_reference(
    reference: dict[str, Any], source_map: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    path = str(reference.get("file_path") or "").strip()
    if path in source_map:
        return source_map[path]
    prefix = "aa-jurist://regulation/"
    if path.startswith(prefix):
        return source_map.get(path[len(prefix) :])
    canonical_prefix = "aaj-regulation--"
    if path.startswith(canonical_prefix) and path.endswith(".md"):
        return source_map.get(path)
    return None


def records_from_reference(
    reference: dict[str, Any], source_map: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Resolve one LightRAG reference, including graph multi-source paths.

    LightRAG joins the source paths of merged entities and relationships with
    ``<SEP>``. Chunks and the public reference list normally contain one path,
    while graph rows can therefore map to several canonical AA-Jurist cards.
    """

    raw_path = str(reference.get("file_path") or "").strip()
    if not raw_path:
        return [], []
    records: list[dict[str, Any]] = []
    unmapped: list[str] = []
    for path in (part.strip() for part in raw_path.split("<SEP>")):
        if not path:
            continue
        record = record_from_reference({"file_path": path}, source_map)
        if record:
            records.append(record)
        else:
            unmapped.append(path)
    return records, unmapped


def rank_retrieved_documents(
    response: dict[str, Any], source_map: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str]]:
    data = response.get("data") or {}
    ordered_references: list[dict[str, Any]] = []
    ordered_references.extend(data.get("chunks") or [])
    ordered_references.extend(data.get("references") or [])
    ordered_references.extend(data.get("entities") or [])
    ordered_references.extend(data.get("relationships") or [])

    retrieved: list[dict[str, Any]] = []
    unmapped: list[str] = []
    seen: set[str] = set()
    for reference in ordered_references:
        records, missing_paths = records_from_reference(reference, source_map)
        for path in missing_paths:
            if path not in unmapped:
                unmapped.append(path)
        for record in records:
            document_id = record["id"]
            if document_id in seen:
                continue
            seen.add(document_id)
            retrieved.append(
                {
                    "rank": len(retrieved) + 1,
                    "document_id": document_id,
                    "score": None,
                    "citation": record.get("citation", ""),
                    "title": record.get("title", ""),
                }
            )
    return retrieved, unmapped


def run_candidate(
    client: LightRAGClient,
    gold: dict[str, Any],
    corpus: list[dict[str, Any]],
    *,
    mode: str,
    case_limit: int | None = None,
) -> dict[str, Any]:
    source_map = build_source_map(corpus)
    cases: list[dict[str, Any]] = []
    selected_cases = gold["cases"][:case_limit] if case_limit else gold["cases"]
    for index, test_case in enumerate(selected_cases, start=1):
        started = time.monotonic()
        response = client.query(
            test_case["query"],
            mode,
            structured_data=True,
            include_chunk_content=True,
        )
        latency_ms = round((time.monotonic() - started) * 1000, 3)
        retrieved, unmapped = rank_retrieved_documents(response, source_map)
        cases.append(
            {
                "id": test_case["id"],
                "latency_ms": latency_ms,
                "retrieved": retrieved,
                "unmapped_references": unmapped,
                "query_status": response.get("status", "unknown"),
            }
        )
        print(
            json.dumps(
                {
                    "progress": f"{index}/{len(selected_cases)}",
                    "id": test_case["id"],
                    "retrieved": len(retrieved),
                    "latency_ms": latency_ms,
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
    return {
        "schema_version": "regulation-retrieval-results-v1",
        "engine": f"lightrag-1.5.5-{mode}-query-data",
        "corpus": gold["corpus"],
        "corpus_document_count": len(corpus),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cases": cases,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gold", type=Path, default=DEFAULT_GOLD)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--base-url", default=os.getenv("LIGHTRAG_BASE_URL", "http://127.0.0.1:9621")
    )
    parser.add_argument("--api-key", default=os.getenv("LIGHTRAG_API_KEY", ""))
    parser.add_argument(
        "--mode",
        choices=["naive", "local", "global", "hybrid", "mix"],
        default="mix",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--http-timeout", type=int, default=300)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    gold = json.loads(args.gold.read_text(encoding="utf-8"))
    corpus = read_jsonl(args.corpus)
    client = LightRAGClient(args.base_url, args.api_key, args.http_timeout)
    result = run_candidate(client, gold, corpus, mode=args.mode, case_limit=args.limit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(str(args.output.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
