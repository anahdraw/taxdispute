# Audit corpus dan baseline retrieval peraturan

Audit ini dilakukan terhadap workspace lokal pada 5 Agustus 2026. Angka di bawah adalah kondisi corpus yang benar-benar dapat dibaca dari repository; koneksi PostgreSQL tidak terisi di `.env.local`, sehingga data deployment tidak dihitung.

## Corpus aktif Next.js

Smart Dispute Bot dan Regulation Bot sama-sama membentuk corpus melalui `mergeRegulationRecords`. Tanpa PostgreSQL, corpus akhirnya adalah 58 kartu seed:

| Ukuran | Nilai |
|---|---:|
| Kartu peraturan | 58 |
| General | 37 |
| Transfer pricing | 12 |
| PPN/VAT | 9 |
| Memiliki URL pemerintah | 53 |
| Memiliki content ringkas | 53 |
| Memiliki hasil ekstraksi PDF | 0 |
| Status ingestion `seed` | 58 |
| Total teks yang dapat diindeks (title, citation, focus, content) | 36.912 karakter |

Lima kartu tanpa URL dan tanpa `content` adalah kartu legacy berbahasa Inggris: dokumentasi TP, pedoman pemeriksaan TP, PER-32/PJ/2011, APA, dan aturan faktur pajak generik. Semua hanya memiliki title/citation/focus. Karena corpus aktif sebagian besar berupa metadata ringkas, eksperimen LightRAG tahap pertama mengukur kemampuan menemukan dan menghubungkan kartu, belum kemampuan menjawab pasal secara lengkap.

## Corpus SQLite legacy

File `data/tax_dispute_prototype.sqlite` memiliki corpus PPN lama yang berbeda:

| Ukuran | Nilai |
|---|---:|
| Peraturan | 24 |
| Chunk | 1.535 |
| Link antardokumen | 229 |
| Total full text | 1.180.860 karakter |
| Rata-rata chunk per aturan | 64,0 |
| Rentang chunk | 6–240 |
| Status diubah/disempurnakan | 13 |
| Status dicabut/tidak berlaku | 7 |
| Status tidak jelas (`-`) | 4 |

Corpus ini berasal dari connector legacy, hanya bertopik PPN, dan tidak dipakai oleh route Next.js saat ini. Jangan mencampurnya ke benchmark seed tanpa provenance, normalisasi status, deduplikasi, dan pemetaan ke sumber resmi.

## Temuan kualitas data

1. **False-positive, pemisahan `No.`, self-edge exact-key, dan tanda baca penutup sudah diperbaiki, tetapi edge tetap belum layak menjadi fakta graph.** Citation regex yang mewajibkan digit menghilangkan fragmen biasa seperti `perubahan`, `perpajakan`, atau `sejak`. Perlindungan singkatan `No.` sebelum sentence splitting memulihkan relasi eksplisit seperti PP 44/2022 ke PP 1/2012. Hasil terbaru adalah 21 relasi heuristik: 1 `amends`, 3 `related`, 8 `revokes`, 7 `implements`, dan 2 `amended_by`. Recall masih tidak mencakup alias tanpa nomor seperti `UU KUP`, `UU HPP`, dan `UU PPN`. Arah serta deduplikasi juga belum dapat dipercaya: record gabungan UU 19 tetap menghasilkan edge `amends` dari sumber gabungan ke UU 19/2000; record PP 55/2022–PP 20/2026 masih menyimpan target singkat `PP 55` karena target tanpa tahun tidak dapat dikenali sebagai self-edge; dan teks `PP 86/2021` yang menyebut pelaksanaan lebih lanjut melalui `PMK 78/2024` diberi arah `PP 86/2021 implements PMK 78/2024`.
2. **Canonical key format lama sudah diperbaiki.** Enam format yang diaudit sekarang memetakan nomor pertama dan tahun pertama dengan benar: PMK 141/2015, 169/2015, 177/2022, 35/2019, 192/2018, dan 107/2017. Contoh `PMK No. 141/PMK.03/2015` sekarang menjadi `pmk-141-2015`.
3. **Corpus seed bukan naskah hukum.** Tidak ada `RegulationExtraction` atau key provisions hasil PDF pada 58 kartu. Evaluasi jawaban pasal, tarif, tenggat, dan status per pasal memerlukan naskah resmi yang sudah diekstraksi serta gold oleh ahli pajak.
4. **Ada dua baseline retrieval berbeda.** Smart Dispute Bot memakai token-frequency cosine ditambah boost topik, judul, nomor, hierarki, dan relevance. Regulation Bot memakai keyword coverage, topic filter, dan boost metadata. Keduanya selalu mengembalikan top result tanpa ambang kecukupan.
5. **Bahasa Inggris tertinggal.** Pada gold set, baseline Smart Chat mencapai all-required@5 75% untuk query Inggris dibanding 85,71% untuk Indonesia. Regulation Bot hanya 50% untuk Inggris dibanding 67,86% untuk Indonesia.

## Audit fairness gold set

- Semua ID wajib, pendukung, dan konteks historis ada di corpus 58 kartu; tidak ada ID kasus duplikat.
- Pertanyaan dibagi menjadi exact citation, single-hop, multi-hop, dua bahasa, dan abstention agar tidak hanya menguntungkan graph retrieval.
- Pertanyaan aturan yang berlaku saat ini memprioritaskan `PMK 172 Tahun 2023`, sesuai status pada registry internal. Kartu legacy `PMK 213/2016`, `PER-22/PJ/2013`, dan `PMK 22/2020` tidak lagi diberi relevance gain; ketiganya hanya ditandai sebagai konteks historis.
- Query single-hop menggunakan istilah yang tersedia pada corpus, tetapi tidak seluruhnya exact-copy. Kedua engine diuji dengan teks gold yang sama dan corpus fingerprint yang sama.
- Tiga negative query memang di luar cakupan 58 kartu: ketenagakerjaan/UMP, klasifikasi kepabeanan HS, dan perceraian.
- Gold ini adalah **development benchmark kecil**, bukan holdout independen dan bukan sertifikasi hukum. Hasil belum cukup untuk klaim akurasi produksi atau signifikansi statistik.

## Baseline pada gold set v1

Gold set terdiri dari 35 pertanyaan: 6 exact lookup, 16 single-hop, 10 multi-hop, dan 3 pertanyaan di luar corpus. Ada 32 pertanyaan positif dan 4 di antaranya berbahasa Inggris.

### Smart Dispute Bot — `rankRegulations`

| Metrik @5 | Nilai |
|---|---:|
| Hit@5 | 93,75% |
| Required Recall@5 | 90,63% |
| All-required@5 | 84,38% |
| MRR | 0,7526 |
| nDCG@5 | 0,7579 |
| Exact lookup top-1 | 83,33% |
| Multi-hop all-required@5 | 60,00% |
| Negative false-positive@5 | 100,00% |
| p95 retrieval lokal (run tersimpan) | 5,43 ms |

### Regulation Bot — `chooseRegulationContext`

| Metrik @5 | Nilai |
|---|---:|
| Hit@5 | 75,00% |
| Required Recall@5 | 71,35% |
| All-required@5 | 65,63% |
| MRR | 0,6500 |
| nDCG@5 | 0,6250 |
| Exact lookup top-1 | 50,00% |
| Multi-hop all-required@5 | 60,00% |
| Negative false-positive@5 | 100,00% |
| p95 retrieval lokal (run tersimpan) | 1,92 ms |

Latency di atas hanya CPU lokal untuk ranking 58 kartu. Latency itu tidak mencakup jaringan, embedding, graph traversal, reranking, atau generasi jawaban, sehingga tidak boleh dibandingkan langsung dengan latency end-to-end LightRAG.

## Acceptance gate untuk eksperimen LightRAG seed

Candidate layak diteruskan ke corpus full text bila, pada input dan top-k yang sama:

- exact lookup top-1 tidak turun dari 83,33%;
- required recall@5 melebihi 90,63%;
- multi-hop all-required@5 meningkat dari 60%;
- nDCG@5 meningkat dari 0,7579;
- negative false-positive turun melalui relevance/abstention gate;
- graph tidak memakai 21 relasi heuristik sebagai fakta hukum sebelum arah, deduplikasi, dan substansinya divalidasi;
- setiap hasil mempertahankan `document_id` seed agar perbandingan dan citation audit deterministik.

Setelah gate seed, buat gold set tahap kedua dari naskah resmi hasil ekstraksi. Tahap kedua harus menilai citation precision per pasal/halaman, temporal validity, answer faithfulness, dan unsupported-claim rate dengan review ahli pajak.
