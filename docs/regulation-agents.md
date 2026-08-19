# AA-Jurist regulation agents

The regulation pipeline is split into deterministic agents. They run locally
first and communicate through versioned JSONL/JSON artifacts rather than
mutating the source SQLite database.

| Agent | Responsibility | Publish gate |
| --- | --- | --- |
| `source-ingest` | Read the Anahdraw SQLite in read-only mode; normalize identity, text, pasal/diktum chunks, official URLs, hashes, and status. | Every record has a stable id; invalid rows are quarantined. |
| `citation-review` | Resolve citations to canonical keys, retain article/path locators, detect duplicates, orphan targets, conflicting status, and missing provenance. | A citation is trusted only with official `*.go.id` provenance, immutable hash, body, locator, and known status. |
| `graph-review` | Build the complete relation graph and a strict serving projection. Unverified/ambiguous edges remain in the review queue. | Only verified, high-confidence, evidenced, temporally consistent edges are answer-eligible. |
| `retrieval-rerank` | Serve local hybrid BM25/vector-compatible search, exact citation boosts, current-law filters, and one result per canonical regulation. | Retrieval never bypasses tenant scope or trust metadata. |
| `answer-trust` | Validate machine citations and substantive claims; abstain on unsupported or ineligible evidence. | No unsupported claim is silently presented as legal advice. |
| `benchmark-eval` | Compare seed and imported corpus on fixed gold queries, retrieval metrics, citation readiness, graph precision/recall, latency, and negative false positives. | A corpus is not promoted until the benchmark and human UAT gates pass. |

The current implementation is deterministic and local. An LLM reviewer can be
added later as a **review-queue agent**, but it must propose changes with
evidence and confidence; it must not publish graph edges or legal-status
changes directly. Human sign-off remains required for disputed identity,
currentness, and contradictory relations.

## Repeatable run

```bash
npm run import:regulations
npm run quality:regulations
npm run eval:regulations:pipeline
```

The importer writes a local snapshot under `data/regulation-pipeline-import/`.
The quality agent writes the graph, citation ledger, report, and CSV review
queue under `outputs/regulation-quality/`. The benchmark writes its immutable
result and input hashes under `tests/evaluation/results/`.

The snapshot is intentionally opt-in through
`TDP_LOCAL_REGULATION_SNAPSHOT`; this prevents a noisy historical corpus from
silently replacing the curated seed in another environment. The local AA-Jurist
workspace currently points to this snapshot, while the strict serving gates
remain active.
