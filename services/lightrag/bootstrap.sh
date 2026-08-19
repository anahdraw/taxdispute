#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SERVICE_DIR"

if [[ -n "${PYTHON_BIN:-}" ]]; then
  PYTHON="$PYTHON_BIN"
elif command -v python3.12 >/dev/null 2>&1; then
  PYTHON="$(command -v python3.12)"
else
  PYTHON="$(command -v python3)"
fi

"$PYTHON" - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit(
        f"LightRAG 1.5.5 requires Python >=3.10; found {sys.version.split()[0]}"
    )
print(f"Using Python {sys.version.split()[0]}")
PY

"$PYTHON" -m venv .venv
.venv/bin/python -m pip install --requirement requirements.lock.txt
mkdir -p inputs logs rag_storage tiktoken_cache generated
.venv/bin/lightrag-download-cache \
  --cache-dir "$SERVICE_DIR/tiktoken_cache" \
  --models gpt-4o-mini

echo "Bootstrap complete. Copy .env.example to .env, fill secrets, then run ./start.sh"
