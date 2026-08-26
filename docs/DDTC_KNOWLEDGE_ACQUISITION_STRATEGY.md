# Strategi Akuisisi Dokumen Pengetahuan DDTC untuk Alpha AI Jurist

**Tanggal:** 21 Agustus 2026
**Status:** Rancangan implementasi - membutuhkan persetujuan lisensi sebelum pengunduhan massal

## 1. Keputusan utama

Akun DDTC Pro **tidak otomatis memberikan hak untuk mengunduh massal atau memasukkan konten DDTC ke RAG, knowledge graph, dataset ground truth, maupun produk bersama**.

Syarat penggunaan DDTC yang diperbarui 2 Juni 2026 membatasi penggunaan untuk kepentingan pribadi dan mensyaratkan izin tertulis untuk penggunaan lain. Ketentuannya juga melarang reproduksi, penyalinan, penyimpanan, modifikasi, penerjemahan, penerbitan, transfer, dan distribusi konten tanpa izin tertulis.

Karena itu, strategi yang disarankan memiliki dua jalur:

1. **Jalur A - lisensi resmi DDTC:** untuk panduan, rekap, Tax Manual, ebooks, newsletter, glosarium, dan konten editorial DDTC lainnya.
2. **Jalur B - sumber primer pemerintah:** membangun pengetahuan setara secara independen dari PDF, HTML, formulir, putusan, kurs, dan publikasi resmi pemerintah.

DDTC dapat dipakai sebagai katalog riset dan pembanding kelengkapan, tetapi teks editorialnya tidak boleh disalin ke Alpha AI Jurist sebelum hak pemanfaatannya jelas.

## 2. Pemetaan kelompok dokumen

| Kelompok | Nilai untuk Alpha Jurist | Strategi akuisisi |
|---|---|---|
| Panduan Pajak Profesi | FAQ praktis berdasarkan profesi | Minta lisensi DDTC atau tulis ulang secara independen dari sumber resmi |
| Panduan Pajak Transaksi | Perlakuan pajak per skenario transaksi | Minta lisensi; alternatifnya buat playbook internal berbasis aturan resmi |
| Panduan Coretax | Prosedur operasional aplikasi | Gunakan panduan/manual DJP resmi dan pengujian internal; DDTC hanya sebagai checklist |
| Rekap Peraturan | Ringkasan perubahan dan dampak | Minta lisensi atau hasilkan impact note sendiri dari graph amendemen |
| Tax Manual | Penjelasan sistematis lintas jenis pajak | Minta lisensi khusus; alternatifnya bangun manual internal dari aturan dan buku resmi |
| Ebooks | Pengetahuan konseptual dan praktik | Jangan diunduh massal; negosiasikan hak penggunaan per judul |
| Newsletter | Pembaruan periodik | Jangan diarsipkan/diindeks tanpa izin; buat alert sendiri dari JDIH dan sumber pemerintah |
| Glosarium | Definisi istilah | Minta dataset berlisensi atau buat definisi internal dengan sitasi primer |
| Formulir Pajak | Dokumen operasional | Ambil versi resmi dari instansi penerbit; tombol unduh DDTC hanya untuk penggunaan pribadi kecuali ada izin lain |
| Kurs Pajak | Data periodik | Ambil langsung dari sumber resmi Kemenkeu/BI beserta tanggal dan checksum |
| Putusan | Fakta, isu, bukti, pertimbangan, amar | Ambil dari sumber resmi pengadilan/MA; terapkan redaksi data pribadi dan provenance |
| P3B/MLI | Aturan pajak internasional | Ambil dari sumber resmi pemerintah/otoritas treaty; DDTC sebagai pembanding struktur |
| UU konsolidasi | Naskah hasil penggabungan amendemen | Bangun konsolidasi sendiri secara terverifikasi atau lisensikan naskah konsolidasi DDTC |

## 3. Jalur A - lisensi dan export resmi DDTC

### 3.1 Permintaan hak yang harus eksplisit

Permintaan ke DDTC sebaiknya mencakup:

- penggunaan internal atau komersial;
- jumlah pengguna dan organisasi/tenant;
- izin mengunduh dan menyimpan salinan;
- izin membuat embeddings dan index pencarian;
- izin membangun knowledge graph dan hubungan turunan;
- izin membuat ringkasan dan jawaban generatif;
- izin menggunakan konten sebagai ground truth/evaluation set;
- izin terjemahan;
- apakah konten boleh dipakai untuk pelatihan/fine-tuning model;
- batas kutipan yang boleh ditampilkan kepada pengguna;
- masa retensi dan kewajiban penghapusan setelah langganan berakhir;
- lingkungan penggunaan: development, UAT, production, dan disaster recovery;
- hak untuk tenant/client eksternal;
- mekanisme pembaruan dan delta feed;
- watermark, atribusi, audit log, serta larangan redistribusi.

### 3.2 Bentuk delivery yang diminta

Urutan pilihan terbaik:

1. API resmi;
2. bulk export berkala;
3. object storage/drop folder;
4. paket JSONL/CSV + file PDF/HTML;
5. automation browser hanya jika secara tertulis diperbolehkan.

Kontrak data minimal:

```text
document_id
document_type
title
language
category
published_at
updated_at
effective_from
effective_to
status
source_url
official_source_url
file_url
license_code
content_hash
version
related_document_ids
```

### 3.3 Kontrol teknis pengunduhan berlisensi

- Gunakan akun service/API khusus, bukan kredensial pegawai.
- Simpan token di secret manager; jangan menyimpan cookie browser.
- Ikuti rate limit yang disepakati.
- Gunakan incremental sync berdasarkan `updated_at`, ETag, atau manifest delta.
- Jangan melewati CAPTCHA, anti-bot, pembatasan paket, atau endpoint privat.
- Setiap file harus memiliki checksum, waktu pengambilan, URL sumber, dan kode lisensi.
- Terapkan idempotency agar file identik tidak diunduh ulang.
- Hentikan pipeline otomatis bila lisensi kedaluwarsa atau manifest tidak valid.
- Sediakan proses takedown dan penghapusan menyeluruh.

## 4. Jalur B - membangun knowledge base independen

Jika DDTC tidak memberikan lisensi, Alpha AI Jurist tetap dapat membangun kemampuan setara tanpa menyalin konten DDTC.

### 4.1 Prinsip

- Gunakan DDTC hanya untuk menemukan topik, klasifikasi, dan gap.
- Cari dokumen yang sama pada JDIH/portal resmi pemerintah.
- Simpan hanya sumber yang izin dan provenance-nya jelas.
- Buat penjelasan, contoh, FAQ, dan glosarium dengan penulisan internal.
- Wajib menyertakan sitasi pasal/halaman ke sumber primer.
- Lakukan review ahli sebelum konten editorial menjadi ground truth.

### 4.2 Produk pengetahuan yang dibuat sendiri

- kartu profesi;
- kartu transaksi;
- prosedur Coretax;
- impact note perubahan regulasi;
- tax manual internal;
- glosarium bersitasi;
- kalkulator dan contoh perhitungan;
- FAQ;
- checklist kepatuhan;
- matriks isu-fakta-bukti-aturan untuk putusan;
- regulation time machine;
- alert perubahan peraturan.

## 5. Pipeline teknis setelah hak sumber dinyatakan aman

### Tahap 1 - source registry

Setiap sumber didaftarkan dengan:

- pemilik hak;
- jenis lisensi;
- tujuan penggunaan yang diperbolehkan;
- tanggal mulai/berakhir;
- aturan atribusi;
- hak membuat turunan/embedding;
- status `allowed`, `metadata_only`, `personal_only`, `quarantined`, atau `prohibited`.

Pipeline harus **fail-closed**: dokumen tanpa status lisensi tidak boleh masuk index produksi.

### Tahap 2 - acquisition

- Ambil manifest lebih dahulu.
- Download hanya objek baru/berubah.
- Verifikasi MIME type, ukuran, checksum, dan malware.
- Simpan file mentah secara immutable.
- Pisahkan raw, processed, reviewed, dan published zones.

### Tahap 3 - extraction

- PDF teks: ekstraksi native.
- PDF scan: OCR hanya bila lisensi mengizinkan.
- HTML: simpan struktur heading, tabel, catatan kaki, dan tautan.
- XLS/DOCX: pertahankan struktur tabel dan metadata.
- Rekam locator halaman, pasal, bab, tabel, atau paragraf.

### Tahap 4 - normalisasi

- canonical ID;
- deduplikasi versi;
- bahasa;
- jenis pajak dan topik;
- tanggal berlaku dan status;
- sumber resmi;
- data pribadi/PII;
- hak penggunaan.

### Tahap 5 - graph

Node:

- `KnowledgeDocument`;
- `GuideTopic`;
- `Profession`;
- `TransactionType`;
- `CoretaxProcedure`;
- `TaxConcept`;
- `Form`;
- `ExchangeRatePeriod`;
- `DecisionIssue`;
- `RegulationVersion`;
- `OfficialSource`.

Edge:

- `EXPLAINS`;
- `REQUIRES_FORM`;
- `USES_RATE`;
- `GOVERNED_BY`;
- `CITES_PROVISION`;
- `APPLIES_TO_PROFESSION`;
- `APPLIES_TO_TRANSACTION`;
- `UPDATED_BY`;
- `SUPERSEDES`;
- `SUPPORTED_BY_DECISION`;
- `HAS_OFFICIAL_SOURCE`.

Setiap edge wajib menyimpan provenance, locator, extraction method, confidence, dan reviewer status.

### Tahap 6 - review dan publication

- Citation validator;
- current-law/temporal validator;
- perhitungan ulang contoh numerik;
- pemeriksaan hak cipta;
- pemeriksaan PII;
- reviewer pajak;
- versioning dan approval;
- publish hanya dokumen berstatus `reviewed`.

## 6. Penyimpanan dan keamanan

Struktur yang disarankan:

```text
private-knowledge/
  raw/
  extracted/
  normalized/
  reviewed/
  published/
  manifests/
  licenses/
  takedown/
```

Kontrol minimum:

- private object storage;
- encryption at rest dan in transit;
- akses berbasis role;
- tenant isolation;
- audit log download dan query;
- retention policy;
- backup terenkripsi;
- takedown by document ID dan by license ID;
- output guard agar kutipan tidak melebihi hak lisensi.

## 7. Urutan implementasi

### Fase 0 - 1 minggu

- Bekukan rencana scraping massal.
- Susun daftar konten yang diinginkan.
- Kirim permintaan lisensi/API ke DDTC.
- Tambahkan `license_status` pada source registry Alpha Jurist.

### Fase 1 - 2 sampai 4 minggu

- Bangun acquisition pipeline untuk sumber resmi pemerintah.
- Prioritaskan formulir, kurs, P3B, putusan, dan dokumen resmi.
- Buat manifest, checksum, dedupe, dan provenance.

### Fase 2 - 4 sampai 8 minggu

- Buat panduan profesi/transaksi/Coretax secara internal.
- Hubungkan setiap klaim ke pasal atau dokumen resmi.
- Bangun graph dan review queue.

### Fase 3 - setelah lisensi DDTC disetujui

- Implementasikan connector DDTC sesuai mekanisme resmi.
- Lakukan pilot 50-100 dokumen.
- Audit hak, kualitas extraction, graph, dan answer generation.
- Baru lanjut incremental bulk sync.

## 8. Kriteria go/no-go

Pengunduhan atau ingestion DDTC hanya boleh berjalan jika seluruh syarat berikut terpenuhi:

- ada izin tertulis yang mencakup jenis konten;
- tujuan RAG/graph/ground truth disebutkan;
- hak penyimpanan dan pembuatan turunan jelas;
- mekanisme akses disetujui;
- rate limit dan volume disetujui;
- retensi dan penghapusan jelas;
- atribusi dan batas tampilan jelas;
- pemakaian oleh client/tenant eksternal jelas.

Jika salah satu belum jelas, statusnya `NO-GO` untuk ingestion dan hanya boleh digunakan sebagai referensi personal melalui antarmuka DDTC.

## 9. Tindakan yang tidak boleh dilakukan

- scraping massal dengan akun Pro biasa;
- mengekspor cookie/session Edge;
- melewati CAPTCHA atau rate limit;
- menggunakan endpoint internal yang tidak didokumentasikan;
- menghapus watermark;
- menyimpan ebooks, Tax Manual, panduan, atau newsletter ke RAG tanpa lisensi;
- menerjemahkan dan menerbitkan ulang konten DDTC tanpa izin;
- memasukkan teks DDTC ke fine-tuning atau evaluation set tanpa hak yang eksplisit;
- membagikan akun atau hasil unduhan ke pengguna/tenant lain.

## 10. Kontak dan langkah berikutnya

Ketentuan DDTC mengarahkan pertanyaan dan permintaan ke **info.perpajakan@ddtc.co.id**.

Permintaan sebaiknya diposisikan sebagai pembicaraan lisensi data/enterprise integration, bukan sekadar permintaan akses Pro. Target hasilnya adalah salah satu dari:

1. lisensi dataset + export berkala;
2. API resmi;
3. hak ingestion internal terbatas;
4. hak menampilkan kutipan dan sitasi;
5. konfirmasi tertulis bahwa kategori tertentu tidak dapat dilisensikan.

Sumber ketentuan: [Syarat & Ketentuan Perpajakan DDTC](https://perpajakan.ddtc.co.id/id/terms-conditions).
