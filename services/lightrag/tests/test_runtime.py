from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

from client import LightRAGClient, read_jsonl  # noqa: E402
from export_regulations import (  # noqa: E402
    DEFAULT_SOURCE,
    export_records,
    is_official_government_url,
    load_merged_records,
    load_seed_records,
)
from run_candidate import rank_retrieved_documents  # noqa: E402


class ExportRegulationsTests(unittest.TestCase):
    def test_current_seed_count_and_official_sources(self) -> None:
        records = load_seed_records(DEFAULT_SOURCE)
        self.assertEqual(len(records), 53)
        self.assertTrue(all(is_official_government_url(item["sourceUrl"]) for item in records))

    def test_merged_route_corpus_contains_58_cards(self) -> None:
        records = load_merged_records()
        self.assertEqual(len(records), 58)
        self.assertIn("pmk-213-tp-doc", {item["id"] for item in records})

    def test_export_preserves_citation_and_normalizes_newlines(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "regulations.jsonl"
            records = export_records(load_seed_records(DEFAULT_SOURCE), output, limit=2)
            self.assertEqual(len(records), 2)
            self.assertIn("Sitasi: UU No. 6 Tahun 1983 tentang KUP", records[0]["text"])
            self.assertIn("\nGroup: UU Induk.", records[0]["text"])
            parsed = read_jsonl(output)
            self.assertEqual(parsed[0]["id"], records[0]["id"])


class ClientContractTests(unittest.TestCase):
    def test_ingest_matches_lightrag_155_contract(self) -> None:
        client = LightRAGClient("http://127.0.0.1:9621", "test-key")
        with patch.object(client, "request", return_value={"status": "success"}) as request:
            client.ingest([{"text": "Dokumen", "file_source": "aa-jurist://regulation/test"}])
        method, path, payload = request.call_args.args
        self.assertEqual((method, path), ("POST", "/documents/texts"))
        self.assertEqual(payload["texts"], ["Dokumen"])
        self.assertEqual(payload["file_sources"], ["aa-jurist://regulation/test"])
        self.assertEqual(payload["chunking"]["strategy"], "fixed_token")

    def test_query_defaults_to_cited_bullets(self) -> None:
        client = LightRAGClient("http://127.0.0.1:9621", "test-key")
        with patch.object(client, "request", return_value={"response": "ok"}) as request:
            client.query("Apa aturan PPN?", "mix", structured_data=False, include_chunk_content=True)
        _, path, payload = request.call_args.args
        self.assertEqual(path, "/query")
        self.assertEqual(payload["mode"], "mix")
        self.assertEqual(payload["response_type"], "Bullet Points")
        self.assertTrue(payload["include_references"])
        self.assertTrue(payload["include_chunk_content"])
        self.assertFalse(payload["only_need_context"])

    def test_query_can_match_production_context_only_contract(self) -> None:
        client = LightRAGClient("http://127.0.0.1:9621", "test-key")
        with patch.object(client, "request", return_value={"response": "context"}) as request:
            client.query(
                "Apa aturan PPN?",
                "mix",
                structured_data=False,
                include_chunk_content=False,
                only_need_context=True,
            )
        _, _, payload = request.call_args.args
        self.assertTrue(payload["only_need_context"])
        self.assertFalse(payload["include_chunk_content"])

    def test_candidate_maps_canonical_file_source_to_document_id(self) -> None:
        source_map = {
            "aa-jurist://regulation/rule-1": {
                "id": "rule-1",
                "title": "Rule One",
                "citation": "R-1",
                "file_source": "aa-jurist://regulation/rule-1",
            },
            "rule-1": {
                "id": "rule-1",
                "title": "Rule One",
                "citation": "R-1",
                "file_source": "aa-jurist://regulation/rule-1",
            },
        }
        response = {
            "data": {
                "chunks": [
                    {"file_path": "aa-jurist://regulation/rule-1", "content": "x"}
                ],
                "references": [{"file_path": "aa-jurist://regulation/rule-1"}],
            }
        }
        retrieved, unmapped = rank_retrieved_documents(response, source_map)
        self.assertEqual([item["document_id"] for item in retrieved], ["rule-1"])
        self.assertEqual(unmapped, [])

    def test_candidate_expands_graph_multi_source_paths(self) -> None:
        source_map = {
            rule_id: {
                "id": rule_id,
                "title": rule_id,
                "citation": rule_id,
                "file_source": f"aa-jurist://regulation/{rule_id}",
            }
            for rule_id in ("rule-1", "rule-2")
        }
        response = {
            "data": {
                "relationships": [{"file_path": "rule-1<SEP>rule-2"}],
            }
        }
        retrieved, unmapped = rank_retrieved_documents(response, source_map)
        self.assertEqual(
            [item["document_id"] for item in retrieved], ["rule-1", "rule-2"]
        )
        self.assertEqual(unmapped, [])

    def test_wait_accepts_actual_namespaced_status_keys(self) -> None:
        client = LightRAGClient("http://127.0.0.1:9621", "test-key")
        response = {
            "track_id": "track-1",
            "total_count": 2,
            "status_summary": {"DocStatus.PROCESSED": 1, "DocStatus.FAILED": 1},
        }
        with patch.object(client, "track_status", return_value=response):
            result = client.wait_for_track("track-1", timeout_seconds=1, poll_seconds=0)
        self.assertEqual(result, response)


if __name__ == "__main__":
    unittest.main()
