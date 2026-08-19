# Benchmark corpus peraturan hasil pipeline

Benchmark ini membandingkan query yang sama terhadap dua kondisi:

1. **Seed AA-Jurist** — 58 kartu ringkas yang dipakai baseline Smart Chat.
2. **Imported pipeline** — SQLite read-only dari `/Users/sintzu/Anahdraw/peraturan-pipeline/data/peraturan.db`, yang saat ini berisi lebih dari 10 ribu peraturan, pasal/chunk, masa berlaku, dan relasi graph.

Query, pemetaan gold, dan kategori disimpan di [`pipeline_regulation_benchmark.json`](./pipeline_regulation_benchmark.json). ID baseline dan ID pipeline dipisahkan supaya perbandingan tidak menganggap kedua corpus memakai primary key yang sama.

## Menjalankan

Dari root AA-Jurist:

```bash
python3 scripts/evaluate_regulation_pipeline.py
```

Runner membaca SQLite dengan `mode=ro`, tidak menjalankan migrasi, tidak memanggil LLM, dan menulis snapshot ke [`results/pipeline-imported.json`](./results/pipeline-imported.json). Untuk database atau output lain:

```bash
python3 scripts/evaluate_regulation_pipeline.py \
  --db /path/to/peraturan.db \
  --out /tmp/pipeline-imported.json \
  --k 5
```

Setiap snapshot menyimpan SHA-256 database, spec, dan baseline; jumlah corpus; hit/recall/MRR/nDCG; latency; coverage sitasi/trust; serta precision/recall graph terhadap label `goldset` yang tersedia. Snapshot tidak menyimpan token, API key, atau kredensial.

## Definisi pengukuran

- `hit_at_k`: sedikitnya satu dokumen wajib ditemukan.
- `recall_required_at_k`: proporsi semua dokumen wajib yang ditemukan.
- `all_required_at_k`: semua dokumen wajib ditemukan; paling penting untuk pertanyaan rantai UU–PP–PMK.
- `mrr`: posisi dokumen wajib pertama.
- `ndcg_at_k`: urutan dokumen wajib (bobot 2) dan pendukung (bobot 1).
- `negative_false_positive_rate_at_k`: proporsi pertanyaan di luar gold yang tetap mengembalikan hasil; untuk benchmark ini dianggap sebagai sinyal kebutuhan abstention.
- `citation_trust.trust_eligible_coverage`: top-k hit yang memiliki URL resmi `*.go.id`, SHA-256, body, locator pasal, dan status sumber. Ini hanya readiness gate sitasi, bukan bukti kebenaran materiil.
- `graph.verified_indexed_edges.precision/recall`: relasi graph yang sudah `verified=1` dibanding `goldset.label=1` dengan target ter-resolve. Edge rule yang belum diverifikasi boleh membantu eksplorasi retrieval, tetapi tidak dihitung sebagai trusted evidence.

## Interpretasi yang benar

Corpus imported jauh lebih lengkap daripada seed, tetapi juga jauh lebih noisy: satu query dapat menemukan banyak aturan historis dan aturan teknis yang sama-sama relevan. Karena itu benchmark ini sengaja mengukur baseline dan imported pada top-5 yang sama, dan menampilkan perbedaan per kategori/bahasa. Penurunan retrieval top-5 pada snapshot awal bukan alasan untuk menghapus corpus imported; itu adalah acceptance gate untuk tahap berikutnya: canonical citation reranker, temporal filter, graph path ranking, dan abstention.

Benchmark ini adalah development benchmark kecil, bukan holdout independen dan bukan sertifikasi hukum. Sebelum produksi, gold harus diperluas oleh ahli pajak sampai level pasal/ayat, termasuk label status berlaku pada tanggal tertentu, citation precision, unsupported-claim rate, dan answer faithfulness.
