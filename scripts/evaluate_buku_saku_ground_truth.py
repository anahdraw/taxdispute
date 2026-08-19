#!/usr/bin/env python3
"""Validate the supplied book ground-truth projection without an LLM."""

from __future__ import annotations

import argparse
import gzip
import json
import re
from collections import Counter
from pathlib import Path


def norm(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--qa", type=Path, default=Path("data/reference-knowledge/buku-praktis-pajak-qa.jsonl.gz"))
    parser.add_argument("--output", type=Path, default=Path("tests/evaluation/results/buku-saku-ground-truth.json"))
    args = parser.parse_args()
    with gzip.open(args.qa, "rt", encoding="utf-8") as handle:
        pairs = [json.loads(line) for line in handle if line.strip()]
    rows = []
    for pair in pairs:
        minimum = norm(pair.get("ground_truth_minimum"))
        answer = norm(pair.get("answer"))
        pages = pair.get("source", {}).get("pages") or []
        rows.append({
            "id": pair.get("id"),
            "topic": pair.get("topic", "unknown"),
            "minimum_present": bool(minimum and minimum in answer),
            "has_pdf_link": pair.get("source", {}).get("pdf_url") == "/api/reference-pdfs/buku-praktis-pajak-2025",
            "has_page_locator": bool(pages and all(isinstance(page, int) and page > 0 for page in pages)),
        })
    topic_counts = Counter(row["topic"] for row in rows)
    summary = {
        "schemaVersion": "buku-praktis-pajak-ground-truth-eval-v1",
        "cases": len(rows),
        "minimum_answer_coverage": sum(row["minimum_present"] for row in rows) / len(rows) if rows else 0,
        "pdf_link_coverage": sum(row["has_pdf_link"] for row in rows) / len(rows) if rows else 0,
        "page_locator_coverage": sum(row["has_page_locator"] for row in rows) / len(rows) if rows else 0,
        "by_topic": dict(sorted(topic_counts.items())),
        "failed_cases": [row["id"] for row in rows if not all(row[key] for key in ("minimum_present", "has_pdf_link", "has_page_locator"))],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not summary["failed_cases"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
