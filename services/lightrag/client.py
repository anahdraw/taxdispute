#!/usr/bin/env python3
"""Minimal, dependency-free client for the pinned LightRAG 1.5.5 API."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


SERVICE_DIR = Path(__file__).resolve().parent
DEFAULT_CORPUS = SERVICE_DIR / "generated" / "essential-regulations.jsonl"
TERMINAL_STATUSES = {"PROCESSED", "FAILED"}


class LightRAGClient:
    def __init__(self, base_url: str, api_key: str = "", timeout: int = 300):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        body = None
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(
            f"{self.base_url}{path}", data=body, headers=headers, method=method
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"LightRAG returned HTTP {exc.code} for {path}: {detail[:1000]}"
            ) from exc
        except URLError as exc:
            raise RuntimeError(f"Cannot reach LightRAG at {self.base_url}: {exc}") from exc
        return json.loads(raw) if raw else {}

    def health(self) -> dict[str, Any]:
        return self.request("GET", "/health")

    def ingest(self, records: list[dict[str, Any]]) -> dict[str, Any]:
        return self.request(
            "POST",
            "/documents/texts",
            {
                "texts": [record["text"] for record in records],
                "file_sources": [record["file_source"] for record in records],
                "chunking": {
                    "strategy": "fixed_token",
                    "params": {
                        "chunk_token_size": 1000,
                        "chunk_overlap_token_size": 100,
                        "split_by_character": "\n\n",
                        "split_by_character_only": False,
                    },
                },
            },
        )

    def track_status(self, track_id: str) -> dict[str, Any]:
        return self.request(
            "GET", f"/documents/track_status/{quote(track_id, safe='')}"
        )

    def wait_for_track(
        self, track_id: str, timeout_seconds: int, poll_seconds: float
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        last_summary: dict[str, int] | None = None
        while True:
            status = self.track_status(track_id)
            summary = status.get("status_summary") or {}
            if summary != last_summary:
                print(json.dumps({"track_id": track_id, "status": summary}))
                last_summary = summary
            total = int(status.get("total_count") or 0)
            normalized_summary: dict[str, int] = {}
            for raw_name, count in summary.items():
                name = str(raw_name).split(".")[-1].upper()
                normalized_summary[name] = normalized_summary.get(name, 0) + int(count)
            terminal = sum(
                int(normalized_summary.get(name, 0)) for name in TERMINAL_STATUSES
            )
            if total > 0 and terminal >= total:
                return status
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"Track {track_id} did not finish within {timeout_seconds}s"
                )
            time.sleep(poll_seconds)

    def query(
        self,
        question: str,
        mode: str,
        *,
        structured_data: bool,
        include_chunk_content: bool,
        only_need_context: bool = False,
    ) -> dict[str, Any]:
        path = "/query/data" if structured_data else "/query"
        return self.request(
            "POST",
            path,
            {
                "query": question,
                "mode": mode,
                "response_type": "Bullet Points",
                "top_k": 20,
                "chunk_top_k": 12,
                "enable_rerank": False,
                "include_references": True,
                "include_chunk_content": include_chunk_content,
                "only_need_context": only_need_context,
                "user_prompt": (
                    "Jawab dalam bahasa Indonesia dengan bullet points yang rapi. "
                    "Gunakan hanya konteks yang diberikan. Bedakan fakta eksplisit dari "
                    "inferensi dan nyatakan bila informasi tidak cukup."
                ),
            },
        )


def read_jsonl(path: Path, limit: int | None = None) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            if not item.get("text") or not item.get("file_source"):
                raise ValueError(f"Invalid corpus record on line {line_number}")
            records.append(item)
            if limit is not None and len(records) >= limit:
                break
    if not records:
        raise ValueError(f"Corpus is empty: {path}")
    return records


def build_client(args: argparse.Namespace) -> LightRAGClient:
    return LightRAGClient(
        base_url=args.base_url,
        api_key=args.api_key,
        timeout=args.http_timeout,
    )


def parse_args() -> argparse.Namespace:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--base-url",
        default=os.getenv("LIGHTRAG_BASE_URL", "http://127.0.0.1:9621"),
    )
    common.add_argument("--api-key", default=os.getenv("LIGHTRAG_API_KEY", ""))
    common.add_argument("--http-timeout", type=int, default=300)

    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("health", parents=[common])

    ingest = subparsers.add_parser("ingest", parents=[common])
    ingest.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    ingest.add_argument("--limit", type=int, default=None)
    ingest.add_argument("--batch-size", type=int, default=10)
    ingest.add_argument("--wait", action="store_true")
    ingest.add_argument("--wait-timeout", type=int, default=3600)
    ingest.add_argument("--poll-seconds", type=float, default=3.0)

    wait = subparsers.add_parser("wait", parents=[common])
    wait.add_argument("track_id")
    wait.add_argument("--wait-timeout", type=int, default=3600)
    wait.add_argument("--poll-seconds", type=float, default=3.0)

    query = subparsers.add_parser("query", parents=[common])
    query.add_argument("question")
    query.add_argument(
        "--mode",
        choices=["naive", "local", "global", "hybrid", "mix"],
        default="mix",
    )
    query.add_argument("--data", action="store_true")
    query.add_argument("--include-chunks", action="store_true")
    query.add_argument(
        "--only-context",
        action="store_true",
        help="Return retrieved context without running final-answer generation.",
    )
    query.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    client = build_client(args)

    if args.command == "health":
        print(json.dumps(client.health(), ensure_ascii=False, indent=2))
        return 0

    if args.command == "ingest":
        records = read_jsonl(args.corpus.resolve(), args.limit)
        if args.batch_size < 1:
            raise ValueError("--batch-size must be at least 1")
        responses: list[dict[str, Any]] = []
        for offset in range(0, len(records), args.batch_size):
            batch = records[offset : offset + args.batch_size]
            response = client.ingest(batch)
            responses.append(response)
            print(json.dumps(response, ensure_ascii=False))
            if args.wait:
                client.wait_for_track(
                    response["track_id"], args.wait_timeout, args.poll_seconds
                )
        failed = [response for response in responses if response.get("status") == "failure"]
        return 1 if failed else 0

    if args.command == "wait":
        result = client.wait_for_track(
            args.track_id, args.wait_timeout, args.poll_seconds
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    if args.command == "query":
        started = time.monotonic()
        result = client.query(
            args.question,
            args.mode,
            structured_data=args.data,
            include_chunk_content=args.include_chunks,
            only_need_context=args.only_context,
        )
        result["client_elapsed_seconds"] = round(time.monotonic() - started, 3)
        rendered = json.dumps(result, ensure_ascii=False, indent=2)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered + "\n", encoding="utf-8")
        print(rendered)
        return 0

    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, TimeoutError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
