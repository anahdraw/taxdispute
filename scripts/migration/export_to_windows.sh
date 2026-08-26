#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Pemakaian: ./scripts/migration/export_to_windows.sh /Volumes/NAMA_DRIVE/AAJurist-Handoff"
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEST_INPUT="$1"
mkdir -p "$DEST_INPUT"
DEST="$(cd "$DEST_INPUT" && pwd)"

PIPELINE_ROOT="${PERATURAN_PIPELINE_ROOT:-/Users/sintzu/Anahdraw/peraturan-pipeline}"
PIPELINE_DATA="${PERATURAN_DATA:-$PIPELINE_ROOT/data}"

case "$DEST" in
  "$REPO_ROOT"|"$REPO_ROOT"/*|"$PIPELINE_ROOT"|"$PIPELINE_ROOT"/*)
    echo "Tujuan harus berada di drive/folder terpisah dari source project."
    exit 2
    ;;
esac

if [ ! -f "$PIPELINE_DATA/peraturan.db" ]; then
  echo "peraturan.db tidak ditemukan: $PIPELINE_DATA/peraturan.db"
  exit 2
fi

if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  echo "Repository masih memiliki perubahan yang belum di-commit. Commit dahulu agar Git bundle lengkap."
  exit 2
fi

mkdir -p "$DEST/source" "$DEST/data/peraturan-pipeline" \
  "$DEST/data/TaxDisputeC" "$DEST/handoff"

echo "[1/7] Membuat Git bundle source AA-Jurist…"
git -C "$REPO_ROOT" bundle create "$DEST/source/AAJurist-source.bundle" --all
cp "$REPO_ROOT/.env.example" "$DEST/handoff/env.example"
cp "$REPO_ROOT/docs/WINDOWS_MIGRATION_HANDOFF_2026-08-26.md" "$DEST/handoff/README-WINDOWS.md"
cp "$REPO_ROOT/scripts/migration/restore_on_windows.ps1" "$DEST/handoff/restore_on_windows.ps1"

echo "[2/7] Membuat backup SQLite konsisten langsung ke media tujuan…"
SOURCE_DB="$PIPELINE_DATA/peraturan.db" \
TARGET_DB="$DEST/data/peraturan-pipeline/peraturan.db" \
python3 - <<'PY'
import os
import sqlite3
from pathlib import Path

source = Path(os.environ["SOURCE_DB"]).resolve()
target = Path(os.environ["TARGET_DB"]).resolve()
target.parent.mkdir(parents=True, exist_ok=True)
src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
dst = sqlite3.connect(target)
try:
    src.backup(dst, pages=8192)
finally:
    dst.close()
    src.close()
PY

echo "[3/7] Menyalin data pendamping pipeline tanpa menggandakan database…"
rsync -a --human-readable --info=progress2 \
  --exclude 'peraturan.db' --exclude 'peraturan.db-wal' \
  --exclude 'peraturan.db-shm' --exclude '*.tmp' \
  "$PIPELINE_DATA/" "$DEST/data/peraturan-pipeline/"

echo "[4/7] Menyalin runtime data AA-Jurist…"
if [ -d "$REPO_ROOT/data" ]; then
  rsync -a --human-readable --info=progress2 --exclude '*.tmp' \
    "$REPO_ROOT/data/" "$DEST/data/TaxDisputeC/data/"
fi
if [ -d "$REPO_ROOT/outputs" ]; then
  rsync -a --human-readable --info=progress2 --exclude '*.tmp' \
    "$REPO_ROOT/outputs/" "$DEST/data/TaxDisputeC/outputs/"
fi

echo "[5/7] Mencatat nama variabel secret tanpa menyalin nilainya…"
if [ -f "$REPO_ROOT/.env.local" ]; then
  sed -nE 's/^([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "$REPO_ROOT/.env.local" \
    | sort -u > "$DEST/handoff/secret-variable-names.txt"
else
  : > "$DEST/handoff/secret-variable-names.txt"
fi

echo "[6/7] Menulis manifest dan checksum…"
REPO_ROOT="$REPO_ROOT" DEST="$DEST" python3 - <<'PY'
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

root = Path(os.environ["REPO_ROOT"])
dest = Path(os.environ["DEST"])

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

critical = [
    dest / "source" / "AAJurist-source.bundle",
    dest / "data" / "peraturan-pipeline" / "peraturan.db",
]
manifest = {
    "schemaVersion": "aa-jurist-windows-handoff-v1",
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "gitCommit": subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
    ).strip(),
    "secretsCopied": False,
    "criticalFiles": [
        {
            "path": str(path.relative_to(dest)).replace("\\", "/"),
            "bytes": path.stat().st_size,
            "sha256": digest(path),
        }
        for path in critical
    ],
}
(dest / "handoff" / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
PY

echo "[7/7] Selesai. Jangan hapus data Mac sebelum restore dan checksum di Windows lulus."
echo "Paket: $DEST"
