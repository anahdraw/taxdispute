# Baseline benchmark snapshot

Snapshot ini dibuat pada 5 Agustus 2026 setelah perbaikan canonical-key, citation regex, dan perlindungan singkatan `No.` pada sentence splitter.

## Provenance

- Corpus: 58 kartu seed AA-Jurist.
- Gold: 35 query; 32 positif dan 3 negative/abstention.
- Gold SHA-256: `635cd20628b61bb8df492a4a84b528e1070e85cd69616290529be8359db1bede`.
- Corpus SHA-256: `532743bd9ee93fb1c9768682498a8ba7d33a43d247ec1fc7313ef5ed66c3198a`.
- Top-k evaluasi: 5.
- Hasil mentah tidak berisi credential, prompt rahasia, atau isi `.env`.

## Hasil

| Metrik @5 | Smart Chat baseline | Regulation Bot baseline |
|---|---:|---:|
| Hit@5 | 93,75% | 75,00% |
| Required Recall@5 | 90,63% | 71,35% |
| All-required@5 | 84,38% | 65,63% |
| MRR | 0,7526 | 0,6500 |
| nDCG@5 | 0,7579 | 0,6250 |
| Exact lookup top-1 | 83,33% | 50,00% |
| Multi-hop all-required@5 | 60,00% | 60,00% |
| English all-required@5 | 75,00% | 50,00% |
| Negative false-positive@5 | 100,00% | 100,00% |

Latency pada JSON hanya microbenchmark ranking 58 kartu di mesin lokal. Nilai tersebut tidak sebanding langsung dengan latency LightRAG end-to-end.

## Catatan interpretasi

- Gold memprioritaskan PMK 172/2023 untuk pertanyaan transfer-pricing yang meminta aturan saat ini. Kartu legacy yang menurut registry sudah dicabut hanya ditandai sebagai konteks historis dan tidak memperoleh relevance gain.
- Sebanyak 21 relasi heuristik ditemukan setelah regex, sentence splitter, self-edge, dan trailing punctuation diperbaiki. Semuanya dikeluarkan dari graph candidate karena arah, deduplikasi, dan validitas hukumnya belum dikurasi.
- Benchmark ini merupakan development set kecil. Kemenangan candidate pada set ini belum membuktikan akurasi jawaban hukum produksi.
- Gate utama LightRAG: pertahankan exact top-1 minimal 83,33%, lampaui required recall 90,63%, tingkatkan multi-hop all-required di atas 60%, dan turunkan false-positive melalui abstention gate.

## Hasil pilot LightRAG 1.5.5

Indeks lokal selesai untuk seluruh 58 kartu: 58 `PROCESSED`, 0 `FAILED`. Kedua candidate menjalankan 35 query melalui `/query/data`; seluruh request sukses dan tidak ada referensi sumber yang gagal dipetakan kembali ke `record.id` AA-Jurist.

| Metrik @5 | Baseline Smart Chat | LightRAG naive | LightRAG mix |
|---|---:|---:|---:|
| Hit@5 | 93,75% | 93,75% | 93,75% |
| Required Recall@5 | 90,63% | 92,19% | 92,19% |
| All-required@5 | 84,38% | 90,63% | 90,63% |
| MRR | 0,7526 | 0,7795 | 0,7795 |
| nDCG@5 | 0,7579 | 0,7784 | 0,7788 |
| Exact lookup top-1 | 83,33% | 100,00% | 100,00% |
| Multi-hop all-required@5 | 60,00% | 80,00% | 80,00% |
| English required recall@5 | 75,00% | 87,50% | 87,50% |
| Negative false-positive@5 | 100,00% | 100,00% | 100,00% |

Delta LightRAG `mix` terhadap baseline adalah +1,56 poin persentase required recall, +6,25 poin all-required, +2,69 poin MRR, +2,09 poin nDCG, +16,67 poin exact lookup top-1, dan +20 poin multi-hop all-required. Pada corpus ringkasan kecil ini, `mix` belum memberikan kenaikan berarti dibanding `naive` pada top-5; manfaat graph perlu diuji lagi setelah corpus berisi naskah utuh, relasi hukum terkurasi, dan putusan sengketa.

Latency candidate diukur end-to-end melalui HTTP lokal dan tidak sebanding dengan microbenchmark baseline yang hanya menjalankan ranking in-process. `Naive` mencatat mean 492,87 ms dan p95 996,17 ms. Run final `mix` memakai cache hangat dengan mean 723,27 ms dan p95 1.188,66 ms; observasi run dingin sebelumnya adalah mean 2.251,15 ms dan p95 3.242,71 ms.

Tiga query positif yang belum memenuhi semua required document pada LightRAG adalah `concept_tp_documentation`, `relation_kup_stack`, dan `english_employee_withholding`. Ketiga query negatif masih mengembalikan dokumen, sehingga pilot belum boleh dipromosikan sebagai sistem yang mampu menolak pertanyaan di luar domain tanpa abstention/routing gate tambahan.

Artefak mentah: [`lightrag-naive.json`](./lightrag-naive.json), [`lightrag-mix.json`](./lightrag-mix.json), dan [`lightrag-index-manifest.json`](./lightrag-index-manifest.json).

## Benchmark corpus peraturan pipeline

Rerun terakhir memakai SQLite pipeline lokal secara read-only, 10.535 aturan,
174.905 pasal, 44.495 baris relasi, dan 30 kasus positif pada top-k 5. Candidate
memakai FTS5 + title-only fallback + ekspansi graph berbasis relasi + reranking
hierarki instrumen/status. Tidak ada LLM yang dipanggil.

| Metrik @5 | Seed/curated | Pipeline awal | Pipeline reranker |
|---|---:|---:|---:|
| Hit@5 | 93,33% | 80,00% | **100,00%** |
| Required Recall@5 | 90,00% | 68,06% | **98,33%** |
| All-required@5 | 83,33% | 56,67% | **96,67%** |
| MRR | 0,7528 | 0,5778 | **0,8111** |
| nDCG@5 | 0,7293 | 0,5445 | **0,8034** |
| Trust-ready top-k | — | — | 61,54% |

Satu kasus strict yang tersisa (`relation_local_tax_stack`) meminta `UU
1/2022`, tetapi ID tersebut memang tidak ada di corpus pipeline saat import.
Coverage gold unik dicatat di artefak sebagai audit, bukan dihapus dari skor.
Negative false-positive masih 100% pada benchmark retrieval; abstention/routing
gate tetap wajib sebelum produksi.

Artefak: [`pipeline-imported.json`](./pipeline-imported.json). Runner yang dapat
diulang: [`scripts/evaluate_regulation_pipeline.py`](../../scripts/evaluate_regulation_pipeline.py).
