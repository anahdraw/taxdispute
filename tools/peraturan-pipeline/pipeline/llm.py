"""Lapisan LLM berbiaya rendah — provider-agnostik, baku ke OpenAI.

Tiga pengungkit biaya dipakai sekaligus:
  1. **Model murah** untuk 99% pekerjaan. Tugasnya verifikasi keputusan biner
     dengan bukti yang sudah disodorkan, bukan penalaran terbuka.
  2. **Batch API** — diskon 50% untuk semua pekerjaan non-interaktif.
  3. **Prompt caching** — instruksi verifikasi identik di setiap permintaan dan
     ditaruh paling depan sebagai pesan `system`; OpenAI meng-cache prefiks
     stabil secara otomatis (tanpa penanda khusus) untuk prompt ≥1024 token,
     dengan tarif ~10% harga input. Karena itu bagian yang berubah per item
     WAJIB diletakkan sesudahnya — kalau tertukar, cache tidak pernah kena.

Provider Anthropic tetap tersedia (`PROVIDER=anthropic`) supaya perpindahan
dapat dibalik tanpa menulis ulang pipeline.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

from .config import (BATCH_DISCOUNT, DATA, MODEL_CHEAP, MODEL_STRONG, PRICING,
                     PROVIDER)


def estimate_usd(model: str, in_tok: int, out_tok: int, *, batch=False,
                 cached_in_tok: int = 0) -> float:
    p = PRICING.get(model)
    if p is None:
        p = PRICING[MODEL_CHEAP]
    fresh = max(in_tok - cached_in_tok, 0)
    cached_rate = p.get("cached", p["in"] * 0.10)
    usd = (fresh * p["in"] + cached_in_tok * cached_rate + out_tok * p["out"]) / 1_000_000
    return usd * (BATCH_DISCOUNT if batch else 1.0)


@dataclass
class Job:
    custom_id: str
    system_stable: str      # blok stabil — diletakkan paling depan agar ter-cache
    user: str | list        # bagian yang berubah per item (teks atau blok konten)
    schema: dict | None = None
    max_tokens: int = 1024


def image_block(b64_png: str, provider: str = PROVIDER) -> dict:
    """Blok gambar dalam format masing-masing provider."""
    if provider == "openai":
        return {"type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{b64_png}"}}
    return {"type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": b64_png}}


# ---------------------------------------------------------------------------
class OpenAIBackend:
    """Chat Completions + Batch API.

    Sengaja memakai `/v1/chat/completions` (bukan Responses API) karena bentuk
    permintaannya paling stabil lintas versi SDK dan didukung penuh oleh Batch
    API — pipeline ini berumur panjang dan tidak boleh rusak karena perubahan
    permukaan API.
    """

    name = "openai"

    def __init__(self, model: str, client=None):
        self.model = model
        self._client = client

    @property
    def client(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI()
        return self._client

    def _body(self, job: Job) -> dict:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": job.system_stable},
                {"role": "user", "content": job.user},
            ],
            "max_completion_tokens": job.max_tokens,
        }
        if job.schema:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "keluaran", "strict": True,
                                "schema": job.schema},
            }
        return body

    def one(self, job: Job):
        resp = self.client.chat.completions.create(**self._body(job))
        text = resp.choices[0].message.content or ""
        u = resp.usage
        cached = 0
        if getattr(u, "prompt_tokens_details", None):
            cached = getattr(u.prompt_tokens_details, "cached_tokens", 0) or 0
        usage = {"in": u.prompt_tokens, "out": u.completion_tokens, "cache_read": cached}
        return (json.loads(text) if job.schema else text), usage

    def submit_batch(self, jobs: list[Job], tag="batch") -> str:
        path = Path(DATA) / f"{tag}-{len(jobs)}.jsonl"
        with open(path, "w", encoding="utf-8") as fh:
            for j in jobs:
                fh.write(json.dumps({
                    "custom_id": j.custom_id, "method": "POST",
                    "url": "/v1/chat/completions", "body": self._body(j),
                }, ensure_ascii=False) + "\n")
        up = self.client.files.create(file=open(path, "rb"), purpose="batch")
        batch = self.client.batches.create(
            input_file_id=up.id, endpoint="/v1/chat/completions",
            completion_window="24h")
        return batch.id

    def wait_batch(self, batch_id: str, poll=30, progress=print) -> None:
        while True:
            b = self.client.batches.retrieve(batch_id)
            if b.status in ("completed", "failed", "expired", "cancelled"):
                progress(f"  batch {batch_id}: {b.status}")
                return
            progress(f"  batch {batch_id}: {b.status}")
            time.sleep(poll)

    def collect_batch(self, batch_id: str, parse_json=True) -> dict:
        b = self.client.batches.retrieve(batch_id)
        if not b.output_file_id:
            return {}
        out: dict = {}
        for line in self.client.files.content(b.output_file_id).text.splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            cid = rec.get("custom_id")
            resp = (rec.get("response") or {}).get("body") or {}
            if rec.get("error") or not resp.get("choices"):
                out[cid] = {"_error": str(rec.get("error"))[:200] or "kosong"}
                continue
            text = resp["choices"][0]["message"]["content"] or ""
            try:
                out[cid] = json.loads(text) if parse_json else {"text": text}
            except json.JSONDecodeError:
                out[cid] = {"_error": "json_decode", "_raw": text[:400]}
            u = resp.get("usage") or {}
            out[cid]["_usage"] = {
                "in": u.get("prompt_tokens", 0), "out": u.get("completion_tokens", 0),
                "cache_read": (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0),
            }
        return out


class AnthropicBackend:
    """Jalur Claude — dipertahankan agar perpindahan provider dapat dibalik."""

    name = "anthropic"

    def __init__(self, model: str, client=None):
        self.model = model
        self._client = client

    @property
    def client(self):
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic()
        return self._client

    def _params(self, job: Job) -> dict:
        params = dict(
            model=self.model, max_tokens=job.max_tokens,
            system=[{"type": "text", "text": job.system_stable,
                     "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": job.user}],
        )
        if job.schema:
            params["output_config"] = {"format": {"type": "json_schema",
                                                  "schema": job.schema}}
        return params

    def one(self, job: Job):
        resp = self.client.messages.create(**self._params(job))
        text = next((b.text for b in resp.content if b.type == "text"), "")
        usage = {"in": resp.usage.input_tokens, "out": resp.usage.output_tokens,
                 "cache_read": getattr(resp.usage, "cache_read_input_tokens", 0) or 0}
        return (json.loads(text) if job.schema else text), usage

    def submit_batch(self, jobs: list[Job], tag="batch") -> str:
        from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
        from anthropic.types.messages.batch_create_params import Request
        reqs = [Request(custom_id=j.custom_id,
                        params=MessageCreateParamsNonStreaming(**self._params(j)))
                for j in jobs]
        return self.client.messages.batches.create(requests=reqs).id

    def wait_batch(self, batch_id: str, poll=30, progress=print) -> None:
        while True:
            b = self.client.messages.batches.retrieve(batch_id)
            if b.processing_status == "ended":
                progress(f"  batch {batch_id}: selesai")
                return
            progress(f"  batch {batch_id}: {b.processing_status}")
            time.sleep(poll)

    def collect_batch(self, batch_id: str, parse_json=True) -> dict:
        out = {}
        for res in self.client.messages.batches.results(batch_id):
            if res.result.type != "succeeded":
                out[res.custom_id] = {"_error": res.result.type}
                continue
            msg = res.result.message
            text = next((b.text for b in msg.content if b.type == "text"), "")
            try:
                out[res.custom_id] = json.loads(text) if parse_json else {"text": text}
            except json.JSONDecodeError:
                out[res.custom_id] = {"_error": "json_decode", "_raw": text[:400]}
            out[res.custom_id]["_usage"] = {
                "in": msg.usage.input_tokens, "out": msg.usage.output_tokens,
                "cache_read": getattr(msg.usage, "cache_read_input_tokens", 0) or 0}
        return out


def LLM(model: str | None = None, provider: str | None = None):
    provider = provider or PROVIDER
    model = model or MODEL_CHEAP
    if provider == "anthropic":
        return AnthropicBackend(model)
    return OpenAIBackend(model)


def strong():
    return LLM(MODEL_STRONG)
