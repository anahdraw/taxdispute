"""Konfigurasi global pipeline peraturan perpajakan."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.getenv("PERATURAN_DATA", ROOT / "data"))
RAW_HTML = DATA / "raw_html"
PDF_DIR = DATA / "pdf"
OCR_DIR = DATA / "ocr"
DB_PATH = DATA / "peraturan.db"

for _d in (DATA, RAW_HTML, PDF_DIR, OCR_DIR):
    _d.mkdir(parents=True, exist_ok=True)

BASE = "https://www.pajak.go.id"
INDEX_PATH = "/index-peraturan"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# Sopan: robots.txt tidak melarang /index-peraturan maupun /id/peraturan/*,
# dan tidak mencantumkan Crawl-delay. 1 req/detik + 2 worker adalah batas aman.
REQUEST_DELAY = float(os.getenv("PERATURAN_DELAY", "1.0"))
MAX_WORKERS = int(os.getenv("PERATURAN_WORKERS", "2"))
TIMEOUT = 60
RETRIES = 4

# --- LLM ---------------------------------------------------------------
# Provider: "openai" (baku) atau "anthropic". Jalur Anthropic dipertahankan
# agar perpindahan dapat dibalik tanpa menulis ulang pipeline.
PROVIDER = os.getenv("PERATURAN_PROVIDER", "openai")

if PROVIDER == "openai":
    # Tier 1 — verifikasi relasi, OCR VLM, normalisasi ambigu.
    MODEL_CHEAP = os.getenv("PERATURAN_MODEL_CHEAP", "gpt-5.6-luna")
    # Tier 2 — adjudikasi konflik & pembuatan gold set (<1% volume).
    MODEL_STRONG = os.getenv("PERATURAN_MODEL_STRONG", "gpt-5.6-terra")
else:
    MODEL_CHEAP = os.getenv("PERATURAN_MODEL_CHEAP", "claude-haiku-4-5")
    MODEL_STRONG = os.getenv("PERATURAN_MODEL_STRONG", "claude-opus-5")

# Harga USD per 1 juta token. Diverifikasi dari halaman harga resmi masing-
# masing penyedia pada 2026-08-09; perbarui bila berubah.
PRICING = {
    # OpenAI — seluruh model 5.6 menerima input gambar (1,05 juta token konteks).
    "gpt-5.6-luna":  {"in": 0.20, "cached": 0.02, "out": 1.20},
    "gpt-5.6-terra": {"in": 2.00, "cached": 0.20, "out": 12.00},
    "gpt-5.6-sol":   {"in": 5.00, "cached": 0.50, "out": 30.00},
    # Anthropic
    "claude-haiku-4-5": {"in": 1.00, "cached": 0.10, "out": 5.00},
    "claude-sonnet-5":  {"in": 3.00, "cached": 0.30, "out": 15.00},
    "claude-opus-5":    {"in": 5.00, "cached": 0.50, "out": 25.00},
}
BATCH_DISCOUNT = 0.50      # Batch API: 50% dari harga standar (kedua penyedia)
CACHE_READ_MULT = 0.10     # cache hit ~0,1x harga input

# Ambang kepercayaan: di bawah ini relasi wajib diverifikasi LLM.
RULE_CONFIDENCE_AUTO = 0.92
