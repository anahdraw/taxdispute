#!/usr/bin/env python3
"""Run the local regulation agents in a fail-closed, reproducible sequence."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_agent(name: str, command: list[str]) -> dict[str, object]:
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if completed.returncode:
        raise RuntimeError(
            f"{name} failed ({completed.returncode})\n"
            f"stdout:\n{completed.stdout[-4000:]}\n"
            f"stderr:\n{completed.stderr[-4000:]}"
        )
    return {"agent": name, "command": command, "stdout": completed.stdout[-4000:]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-db", type=Path, default=Path("/Users/sintzu/Anahdraw/peraturan-pipeline/data/peraturan.db"))
    parser.add_argument("--skip-import", action="store_true", help="Reuse the existing normalized snapshot.")
    args = parser.parse_args(argv)
    source_db = str(args.source_db)
    steps: list[dict[str, object]] = []
    try:
        if not args.skip_import:
            steps.append(run_agent("source-ingest", [sys.executable, "scripts/import_peraturan_pipeline.py", "--source-db", source_db, "--no-db"]))
        steps.append(run_agent("citation-and-graph-review", [sys.executable, "scripts/regulation_quality.py", "--db", source_db]))
        steps.append(run_agent("benchmark-eval", [sys.executable, "scripts/evaluate_regulation_pipeline.py", "--db", source_db]))
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps({"status": "completed", "source_db": source_db, "steps": steps}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
