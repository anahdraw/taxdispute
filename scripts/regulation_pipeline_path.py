"""Portable path resolution for the local regulation pipeline database."""

from __future__ import annotations

import os
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def default_regulation_pipeline_db() -> Path:
    """Resolve the source DB without embedding a developer-machine path.

    The environment variable is authoritative.  The two fallbacks support the
    bundled Windows handoff layout and the historical sibling-repository layout.
    Returning the first candidate when neither exists keeps argparse help and
    error messages deterministic.
    """

    configured = os.getenv("TDP_REGULATION_PIPELINE_DB", "").strip()
    if configured:
        return Path(configured).expanduser()

    candidates = (
        REPO_ROOT / "tools" / "peraturan-pipeline" / "data" / "peraturan.db",
        REPO_ROOT.parent / "peraturan-pipeline" / "data" / "peraturan.db",
        REPO_ROOT.parent / "Anahdraw" / "peraturan-pipeline" / "data" / "peraturan.db",
    )
    return next((candidate for candidate in candidates if candidate.exists()), candidates[0])
