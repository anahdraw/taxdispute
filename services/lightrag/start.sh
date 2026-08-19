#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SERVICE_DIR"

if [[ ! -x .venv/bin/lightrag-server ]]; then
  echo "Missing .venv. Run ./bootstrap.sh first." >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "Missing services/lightrag/.env. Copy .env.example and fill secrets." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

for name in LIGHTRAG_API_KEY LLM_BINDING_API_KEY EMBEDDING_BINDING_API_KEY; do
  value="${!name:-}"
  if [[ -z "$value" || "$value" == replace-with-* ]]; then
    echo "$name is missing or still uses the placeholder value." >&2
    exit 1
  fi
done

mkdir -p \
  "${INPUT_DIR:-./inputs}" \
  "${WORKING_DIR:-./rag_storage}" \
  "${LOG_DIR:-./logs}" \
  "${TIKTOKEN_CACHE_DIR:-./tiktoken_cache}"

exec .venv/bin/lightrag-server \
  --host "${HOST:-127.0.0.1}" \
  --port "${PORT:-9621}" \
  --working-dir "${WORKING_DIR:-./rag_storage}" \
  --input-dir "${INPUT_DIR:-./inputs}" \
  --workspace "${WORKSPACE:-aa_jurist_regulations_v1}"
