# Regulation retrieval evaluation

Untuk membandingkan seed dengan SQLite hasil `peraturan-pipeline` (termasuk
10k+ dokumen, pasal, status, dan graph), gunakan benchmark terpisah:

```bash
npm run eval:regulations:pipeline
```

Spesifikasi, definisi citation/trust, fingerprint input, dan batasan benchmark
ada di [`PIPELINE_BENCHMARK.md`](./PIPELINE_BENCHMARK.md). Snapshot hasil yang
terakhir dijalankan ada di [`results/pipeline-imported.json`](./results/pipeline-imported.json).

Gold set ini membandingkan retrieval peraturan AA-Jurist lama dengan candidate engine seperti LightRAG pada corpus seed yang sama.

## Menjalankan baseline

```bash
node scripts/run_regulation_baseline_eval.mjs /private/tmp/baseline-regulations.json
node scripts/evaluate_regulation_retrieval.mjs \
  --results /private/tmp/baseline-regulations.json \
  --k 5
```

Gunakan `--strategy regulation-bot` untuk mengukur retriever pada endpoint Regulation Bot. Default `smart-chat` mengukur retriever Smart Dispute Bot:

```bash
node scripts/run_regulation_baseline_eval.mjs \
  /private/tmp/baseline-regulation-bot.json \
  --strategy regulation-bot
```

## Membandingkan dengan LightRAG

Adapter LightRAG harus menghasilkan JSON berikut:

```json
{
  "schema_version": "regulation-retrieval-results-v1",
  "engine": "lightrag-mix",
  "corpus": "aa-jurist-next-seed-regulations-2026-07-20",
  "cases": [
    {
      "id": "lookup_uu_kup",
      "latency_ms": 123.4,
      "retrieved": [
        {
          "document_id": "essential-01-uu-no-6-tahun-1983-tentang-kup",
          "score": 0.91
        }
      ]
    }
  ]
}
```

Lalu jalankan:

```bash
node scripts/evaluate_regulation_retrieval.mjs \
  --results /private/tmp/baseline-regulations.json \
  --compare /private/tmp/lightrag-regulations.json \
  --k 5
```

## Definisi metrik

- `hit_at_k`: sedikitnya satu dokumen wajib ditemukan dalam top-k.
- `recall_required_at_k`: proporsi semua dokumen wajib yang ditemukan dalam top-k.
- `all_required_at_k`: seluruh dokumen wajib ditemukan dalam top-k; penting untuk pertanyaan lintas aturan.
- `mrr`: reciprocal rank dari dokumen wajib pertama.
- `ndcg_at_k`: kualitas urutan dengan bobot 2 untuk dokumen wajib dan 1 untuk dokumen pendukung.
- `exact_lookup_top_1_accuracy`: akurasi posisi pertama untuk pertanyaan nomor aturan eksplisit.
- `negative_false_positive_rate_at_k`: proporsi pertanyaan di luar corpus yang tetap diberi hasil. Lebih rendah lebih baik.

Gold dibuat dari metadata kartu seed yang benar-benar tersedia. Gold ini tidak menggantikan validasi ahli pajak atas isi, status berlaku per pasal, atau kelengkapan peraturan.

Field `historical_context_document_ids` hanya mencatat aturan lama yang berguna
untuk audit historis. Dokumen tersebut tidak memperoleh relevance gain dan
tidak dihitung sebagai jawaban benar untuk pertanyaan yang meminta aturan saat
ini.

Snapshot baseline yang telah diaudit tersedia di `tests/evaluation/results/`. Kedua JSON snapshot membawa SHA-256 gold dan corpus, sehingga hasil LightRAG hanya boleh dibandingkan bila fingerprint inputnya sama.
