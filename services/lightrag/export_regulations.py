#!/usr/bin/env python3
"""Export AA-Jurist's curated regulation seeds for LightRAG ingestion.

This deliberately evaluates the same canonical TypeScript merge used by the
application instead of maintaining a second regulation list. Output is JSON
Lines so it remains inspectable and can be batch-posted to LightRAG's
`/documents/texts` endpoint.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parents[1]
DEFAULT_SOURCE = REPO_ROOT / "lib" / "essential-regulations.ts"
DEFAULT_OUTPUT = SERVICE_DIR / "generated" / "essential-regulations.jsonl"


def load_seed_records(source_path: Path) -> list[dict[str, Any]]:
    source = source_path.read_text(encoding="utf-8")
    marker = "export const essentialRegulationSeeds"
    marker_index = source.find(marker)
    if marker_index < 0:
        raise ValueError(f"Seed marker not found in {source_path}")
    array_start = source.find("= [", marker_index)
    array_end = source.find("\n];", array_start)
    if array_start < 0 or array_end < 0:
        raise ValueError(f"Seed array boundaries not found in {source_path}")
    records = json.loads(source[array_start + 2 : array_end + 2])
    if not isinstance(records, list) or not records:
        raise ValueError("Regulation seed array is empty or invalid")
    return records


def load_merged_records(repo_root: Path = REPO_ROOT) -> list[dict[str, Any]]:
    """Load the exact 58-card corpus exposed by mergeRegulationRecords()."""

    tsc = repo_root / "node_modules" / ".bin" / "tsc"
    if not tsc.exists():
        raise FileNotFoundError(
            f"TypeScript compiler not found at {tsc}; run npm install in the repo root"
        )
    with tempfile.TemporaryDirectory(prefix="aa-jurist-lightrag-export-") as tmp:
        compile_dir = Path(tmp)
        command = [
            str(tsc),
            "lib/mock-data.ts",
            "lib/essential-regulations.ts",
            "lib/regulation-knowledge.ts",
            "lib/regulation-sources.ts",
            "--outDir",
            str(compile_dir),
            "--module",
            "commonjs",
            "--target",
            "ES2020",
            "--esModuleInterop",
            "--skipLibCheck",
            "--moduleResolution",
            "node",
        ]
        compiled = subprocess.run(
            command,
            cwd=repo_root,
            text=True,
            capture_output=True,
            check=False,
        )
        if compiled.returncode:
            raise RuntimeError(
                "Failed to compile the canonical regulation corpus:\n"
                + (compiled.stderr or compiled.stdout)[-4000:]
            )
        node_script = """
const path = require('node:path');
const root = process.argv[1];
const { regulations } = require(path.join(root, 'mock-data.js'));
const { mergeRegulationRecords } = require(path.join(root, 'regulation-knowledge.js'));
process.stdout.write(JSON.stringify(mergeRegulationRecords(regulations)));
"""
        rendered = subprocess.run(
            ["node", "-e", node_script, str(compile_dir)],
            cwd=repo_root,
            text=True,
            capture_output=True,
            check=False,
        )
        if rendered.returncode:
            raise RuntimeError(
                "Failed to evaluate the canonical regulation corpus:\n"
                + (rendered.stderr or rendered.stdout)[-4000:]
            )
        records = json.loads(rendered.stdout)
        if not isinstance(records, list) or not records:
            raise ValueError("Merged regulation corpus is empty or invalid")
        return records


def normalize_text(value: Any) -> str:
    return (
        str(value or "")
        .replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .strip()
    )


def is_official_government_url(value: str) -> bool:
    try:
        host = (urlparse(value).hostname or "").lower()
    except ValueError:
        return False
    return host == "go.id" or host.endswith(".go.id")


def render_document(record: dict[str, Any]) -> str:
    content = normalize_text(record.get("content"))
    lines = [
        "DOKUMEN REFERENSI PERATURAN AA-JURIST",
        "Jenis dokumen: ringkasan registry peraturan terkurasi, bukan naskah lengkap peraturan.",
        f"ID dokumen: {normalize_text(record.get('id'))}",
        f"Judul: {normalize_text(record.get('title'))}",
        f"Sitasi: {normalize_text(record.get('citation'))}",
        f"Topik: {normalize_text(record.get('topic'))}",
        f"Fokus: {normalize_text(record.get('focus'))}",
        f"Relevansi: {record.get('relevance', '')}",
        f"URL sumber resmi: {normalize_text(record.get('sourceUrl'))}",
        "",
        "KETERANGAN TERKURASI",
        content,
    ]
    return "\n".join(lines).strip()


def export_records(
    records: list[dict[str, Any]],
    output_path: Path,
    *,
    limit: int | None = None,
    selected_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    exported: list[dict[str, Any]] = []
    invalid_sources: list[str] = []

    for record in records:
        record_id = normalize_text(record.get("id"))
        if selected_ids and record_id not in selected_ids:
            continue
        source_url = normalize_text(record.get("sourceUrl"))
        if source_url and not is_official_government_url(source_url):
            invalid_sources.append(f"{record_id}: {source_url or '<missing>'}")
            continue
        text = render_document(record)
        canonical_key = normalize_text(record.get("canonicalKey")) or record_id
        exported.append(
            {
                "id": record_id,
                "source_record_id": record_id,
                "canonical_key": canonical_key,
                "title": normalize_text(record.get("title")),
                "citation": normalize_text(record.get("citation")),
                "topic": normalize_text(record.get("topic")),
                "source_url": source_url,
                "source_status": "official" if source_url else "legacy_seed_missing_official_url",
                "file_source": f"aa-jurist://regulation/{record_id}",
                "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "text": text,
            }
        )
        if limit is not None and len(exported) >= limit:
            break

    if invalid_sources:
        details = "\n".join(invalid_sources)
        raise ValueError(
            "Only official .go.id regulation sources may enter the shared graph. "
            f"Invalid records:\n{details}"
        )
    if not exported:
        raise ValueError("No regulations matched the export selection")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = "\n".join(
        json.dumps(item, ensure_ascii=False, sort_keys=True) for item in exported
    )
    output_path.write_text(payload + "\n", encoding="utf-8")
    return exported


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Manifest path; defaults beside --output with .manifest.json suffix.",
    )
    parser.add_argument(
        "--essential-only",
        action="store_true",
        help="Export only the 53 essential registry entries (debug only).",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--id",
        action="append",
        dest="selected_ids",
        help="Export only this exact seed ID; repeat for multiple IDs.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    selected = set(args.selected_ids or []) or None
    source_records = (
        load_seed_records(args.source.resolve())
        if args.essential_only
        else load_merged_records(REPO_ROOT)
    )
    records = export_records(
        source_records,
        args.output.resolve(),
        limit=args.limit,
        selected_ids=selected,
    )
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    index_payload = "\n".join(
        json.dumps(
            {
                "file_source": record["file_source"],
                "text_sha256": record["text_sha256"],
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        for record in records
    )
    index_payload_digest = hashlib.sha256(index_payload.encode("utf-8")).hexdigest()
    manifest_path = (
        args.manifest.resolve()
        if args.manifest
        else args.output.resolve().with_suffix(".manifest.json")
    )
    manifest = {
        "schema_version": "aa-jurist-lightrag-regulation-manifest-v1",
        "corpus_document_count": len(records),
        "corpus_jsonl": str(args.output.resolve()),
        "corpus_jsonl_sha256": digest,
        "index_payload_sha256": index_payload_digest,
        "documents": [
            {
                key: record[key]
                for key in (
                    "id",
                    "source_record_id",
                    "canonical_key",
                    "file_source",
                    "title",
                    "citation",
                    "source_url",
                    "source_status",
                    "text_sha256",
                )
            }
            for record in records
        ],
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "status": "ok",
                "documents": len(records),
                "output": str(args.output.resolve()),
                "output_sha256": digest,
                "index_payload_sha256": index_payload_digest,
                "manifest": str(manifest_path),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
