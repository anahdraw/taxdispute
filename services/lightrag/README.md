# AA-Jurist LightRAG pilot

This sidecar runs pinned LightRAG `1.5.5` for regulation retrieval. It is
optional: AA-Jurist remains on its existing retriever unless
`AAJ_RAG_PROVIDER` is changed.

## Local setup

Requirements: Python 3.10+, Node dependencies installed in the repository,
and an OpenAI API key.

```bash
cd services/lightrag
./bootstrap.sh
cp .env.example .env
# Fill LIGHTRAG_API_KEY, LLM_BINDING_API_KEY, and
# EMBEDDING_BINDING_API_KEY without committing the file.
./start.sh
```

The example configuration deliberately uses JSON, NetworkX, and NanoVectorDB
for a single-process development pilot. Do not use those storage backends for
multi-worker production deployment.

## Export and index the current corpus

The exporter compiles the TypeScript sources and calls the same
`mergeRegulationRecords()` function used by AA-Jurist. A normal run must report
exactly 58 documents for the current seed corpus.

```bash
python export_regulations.py
python client.py health
python client.py ingest --wait --batch-size 10
```

Generated corpus, graph storage, logs, model cache, and secrets are ignored by
Git. The adjacent manifest fingerprints every document and the complete JSONL.
Only official `.go.id` URLs are accepted when a record contains a source URL.

The exporter also writes an adjacent `.manifest.json` containing the original
record ID, canonical key, LightRAG source name, source status, and text digest.
LightRAG 1.5.5 reduces a text `file_source` to its basename; the current pilot
therefore maps exact bare record IDs back through this manifest. A new production
workspace should instead use versioned canonical filenames such as
`aaj-regulation--<canonicalKey>.md`; do not rename files inside an existing
indexed workspace.

## Benchmark

Create the two deterministic baselines from the same 35-case gold set:

```bash
cd ../..
node scripts/run_regulation_baseline_eval.mjs \
  /private/tmp/baseline-smart-chat.json
node scripts/run_regulation_baseline_eval.mjs \
  /private/tmp/baseline-regulation-bot.json --strategy regulation-bot
```

Then query the indexed sidecar and compare top-5 retrieval:

```bash
cd services/lightrag
python run_candidate.py --mode mix \
  --output /private/tmp/lightrag-mix.json
cd ../..
node scripts/evaluate_regulation_retrieval.mjs \
  --results /private/tmp/baseline-smart-chat.json \
  --compare /private/tmp/lightrag-mix.json --k 5
```

This benchmark measures document retrieval, not substantive legal correctness.
The current cards are curated summaries and contain no official PDF extraction.
Legal-answer accuracy requires a second gold set reviewed by tax specialists,
with article/page citation and temporal-validity checks.

The reproducible pilot snapshot, including raw baseline, `naive`, `mix`, and
index provenance JSON, is stored in `tests/evaluation/results/README.md`.

## AA-Jurist rollout modes

Configure the Next.js application separately:

```dotenv
AAJ_RAG_PROVIDER=baseline
LIGHTRAG_BASE_URL=http://127.0.0.1:9621
LIGHTRAG_API_KEY=replace-with-the-sidecar-api-key
LIGHTRAG_QUERY_MODE=mix
LIGHTRAG_TOP_K=20
LIGHTRAG_CHUNK_TOP_K=12
LIGHTRAG_TIMEOUT_MS=30000
LIGHTRAG_ENABLE_RERANK=false
```

- `baseline`: never calls LightRAG.
- `shadow`: calls both providers, serves the baseline, and returns comparison
  telemetry.
- `lightrag`: serves LightRAG when it returns canonical references and falls
  back synchronously to the baseline on timeout, error, or unmapped context.

The current pilot intentionally falls back when database-backed regulation
records exist, because the v1 graph contains only the 58 repository cards. A
database corpus must not be activated until its canonical snapshot and manifest
have been indexed into a new versioned workspace.

Keep production on `baseline` until benchmark, security, latency, cost, and
expert-UAT gates pass. The LightRAG API must remain private and must not be
called directly from a browser.
