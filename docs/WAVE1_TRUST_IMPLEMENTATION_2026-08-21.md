# Gelombang 1 — Trust, Temporal, Dokumen, Graph, dan Benchmark

**Tanggal:** 21 Agustus 2026
**Status:** implementasi lokal; belum dipromosikan sebagai sertifikasi hukum atau benchmark produksi

## Hasil implementasi

### 1. Negative-query abstention

- Domain gate baru mengenali sinyal perpajakan Indonesia/Inggris.
- Pertanyaan nonpajak dan corpus khusus yang belum tersedia dihentikan sebelum retrieval dan sebelum panggilan LLM.
- Gate dipasang pada Trusted Search, Regulation Bot, Smart Chat, dan Reference Chat.
- Contoh yang ditolak: ketenagakerjaan, perceraian, kesehatan, cuaca, resep, dan klasifikasi HS operasional tanpa framing sengketa pajak.
- Pertanyaan HS tetap dapat diterima bila jelas dibingkai sebagai sengketa pajak/Pengadilan Pajak.

### 2. Trust Layer pada chatbot

- Regulation Bot menjalankan preflight trust terhadap sumber hasil reranking.
- Smart Chat menjalankan preflight trust untuk mode peraturan/gabungan.
- Mode putusan-only diberi trust status `insufficient` sampai putusan memiliki immutable hash dan locator halaman.
- Reference Chat diberi source-bound preflight dan menolak current-law answer bila metadata temporal tidak cukup.
- Response API sekarang membawa `trust`, alasan abstention, evidence count, domain decision, temporal decision, dan `validationStage`.
- Jawaban ditahan bila sumber resmi, hash, locator, status, atau rentang waktunya tidak memenuhi gate.

Catatan: tahap ini adalah **pre-generation/preflight trust**. Claim-by-claim post-generation validation masih memerlukan machine citation marker konsisten dari seluruh generator jawaban. Trusted Search sudah memiliki validator claim/citation; perluasan post-generation ke setiap generator menjadi iterasi lanjutan.

### 3. Temporal/status validator

- Search result sekarang membawa `effectiveFrom` dan `effectiveTo`.
- Validator membedakan tahun pada nomor aturan dari masa/tahun pajak.
- Pertanyaan perhitungan praktis diperlakukan sebagai current-law question.
- Aturan yang mulai berlaku setelah masa pajak dikeluarkan.
- Aturan dicabut hanya boleh dipakai secara historis bila tanggal akhir berlakunya diketahui.
- Status `unknown` atau rentang yang tidak lengkap menghasilkan abstention/uncertainty.

### 4. PDF, source hash, locator, dan document readiness

Review app memiliki tab baru **Dokumen**. Setiap peraturan diperiksa untuk:

- URL pemerintah;
- PDF lokal/resmi;
- SHA-256;
- locator halaman/pasal;
- status hukum;
- tanggal efektif;
- teks hasil ekstraksi.

Snapshot saat ini:

| Ukuran | Hasil |
|---|---:|
| Record diperiksa | 10.822 |
| Lengkap seluruh checklist | 41 |
| Answer-eligible minimum | 5.451 |
| Masih perlu review dokumen | 10.781 |
| Skor kesiapan rata-rata | 73% |
| Tidak memiliki PDF | 10.520 |
| Tidak memiliki URL resmi | 4.690 |
| Tidak memiliki tanggal efektif | 4.447 |
| Tidak memiliki locator | 685 |
| Status hukum unknown | 287 |
| Tidak memiliki SHA-256 valid | 23 |
| Tidak memiliki teks ekstraksi | 5 |

Angka 10.822 mencakup snapshot peraturan aktif serta projection ground-truth yang dikonfigurasi lokal. Queue perlu dapat difilter berdasarkan jenis sumber agar buku referensi tidak disamakan dengan sumber hukum primer.

### 5. Review graph relasi penting

- Graph answer expansion sekarang **hanya** mengikuti edge yang sekaligus:
  - `eligibleForAnswer=true`;
  - `verified=true`;
  - tidak memiliki flag.
- Edge karantina tidak lagi dapat menambah sumber ke answer context.
- Review queue memprioritaskan pencabutan/penggantian, perubahan, pelaksanaan, lalu masa berlaku.

Snapshot relasi berisiko tinggi:

| Ukuran | Hasil |
|---|---:|
| Relasi hukum penting | 9.108 |
| Answer-eligible | 350 |
| Masih perlu review | 8.758 |

### 6. Benchmark end-to-end lebih besar

Benchmark baru memiliki 60 kasus dan menjalankan domain routing, abstention, temporal intent, retrieval/reranking, source trust, dan graph policy tanpa memanggil LLM.

Hasil snapshot:

| Gate | Hasil |
|---|---:|
| Domain accuracy | 100% |
| Negative abstention | 100% |
| Temporal intent accuracy | 100% |
| Retrieval hit@8 aturan wajib | 100% |
| Trusted positive answer rate | 100% |

Benchmark ini adalah regression set pengembangan yang dikurasi, bukan holdout independen. Langkah berikutnya adalah memperluasnya menjadi minimal 500 kasus yang direview ahli dan menambah post-generation citation/faithfulness scoring.

## File dan perintah penting

- Spesifikasi benchmark: `tests/evaluation/wave1_end_to_end_benchmark.json`
- Hasil benchmark: `tests/evaluation/results/wave1-end-to-end.json`
- Jalankan benchmark: `npm run eval:wave1`
- Jalankan trust tests: `npm run test:trust`
- Jalankan graph/RAG tests: `npm run test:rag`
- Review UI: `/review`, lalu pilih tab **Dokumen** atau **Edge**.

## Gate yang masih belum selesai

1. Claim-by-claim validation otomatis pada jawaban Regulation Bot dan Smart Chat.
2. Immutable page chunks untuk putusan sehingga mode putusan-only dapat menjadi verified.
3. PDF acquisition pipeline untuk 10.520 record yang belum memiliki file.
4. Penyelesaian 8.758 relasi hukum penting melalui reviewer manusia.
5. Holdout benchmark independen dan blind expert review.
6. Temporal end-date yang lengkap untuk aturan dicabut/diganti.

## Urutan operasional berikutnya

1. Kerjakan dokumen yang sering muncul pada query terlebih dahulu.
2. Lengkapi URL resmi → PDF → SHA-256 → extraction → locator → status → effective date.
3. Review edge pencabutan/perubahan untuk aturan tersebut.
4. Jalankan `npm run eval:wave1` setelah setiap batch.
5. Aktifkan dokumen sebagai evidence hanya bila document readiness dan graph gate sama-sama lolos.
