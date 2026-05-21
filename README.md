# RSM Tax Dispute Agentic Advisor Prototype

Prototype lokal untuk membaca PDF putusan Pengadilan Pajak, mencari putusan pembanding,
memberi indikasi peluang sederhana, membuat review risiko, dan menyusun draft rekomendasi
awal untuk Wajib Pajak.

Sekarang prototype juga punya konektor lokal ke Datacenter Ortax untuk mengunduh,
menyimpan, dan mencari peraturan PPN sebagai konteks dasar hukum analisis.

## GitHub / Vercel

Repo ini sudah disiapkan agar aman dipush ke GitHub:

- `.env`, database SQLite, folder upload, PDF putusan, dan generated binary files di-ignore.
- `requirements.txt` berisi dependency Python utama.
- Aplikasi Streamlit lokal tetap disimpan sebagai prototype utama.
- Folder `app/`, `lib/`, `package.json`, dan konfigurasi Next.js baru disiapkan untuk deployment Vercel.

Catatan penting: versi Vercel sekarang adalah aplikasi Next.js terpisah yang meniru alur utama prototype tanpa mengubah data lokal Streamlit. File upload dan analisis di versi Vercel masih bersifat demo/browser-side dengan API mock sederhana; untuk production, storage dokumen, database, OCR, dan LLM perlu dipindah ke service/API managed.

Detail deployment ada di [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Cara Menjalankan Next.js untuk Vercel

```bash
npm install
npm run dev
```

Lalu buka:

```text
http://localhost:3000
```

Build production lokal:

```bash
npm run build
```

Fitur Next.js/Vercel yang tersedia:

- Upload PDF dan ekstraksi field kasus via LLM (`/api/extract`).
- PDF besar dipecah di browser menjadi chunk halaman kecil sebelum ekstraksi, agar tidak terkena limit payload Vercel.
- Analisis risiko dan rekomendasi mendalam via LLM (`/api/analyze`).
- Chatbot aturan PPN (`/api/regulation-chat`).
- Export hasil analisis ke Word dan PDF (`/api/export`).

## Test PDF dari Folder TestData

Test case lengkap ada di [`TEST_CASES.md`](TEST_CASES.md).

Jalankan smoke test ingest dari folder `TestData` tanpa mengubah database prototype lokal:

```bash
python3 scripts/run_testdata_ingest.py --testdata TestData
```

Buat sample PDF dummy jika folder `TestData` kosong:

```bash
python3 scripts/run_testdata_ingest.py --testdata TestData --generate-samples
```

Jalankan unit test otomatis:

```bash
python3 -m unittest tests/test_testdata_ingest.py
```

## Cara Menjalankan

```bash
streamlit run prototype_app.py --server.address 127.0.0.1 --server.port 8501
```

Lalu buka:

```text
http://127.0.0.1:8501
```

## Alur Demo

1. Buka menu `Alur Terpandu`.
2. Upload PDF baru atau pilih dokumen yang sudah diingest.
3. Pilih jenis dokumen: putusan, surat banding, keberatan, SPHP, uraian banding, bantahan, atau dokumen pendukung.
4. Ekstraksi menyimpan field minimum: metadata putusan, objek sengketa, pihak, pokok sengketa, argumen, pertimbangan, dan outcome.
5. Jika nomor putusan sudah ada, ekstraksi ditolak dan aplikasi menampilkan dokumen yang sama. Nama WP tidak dipakai sebagai kunci duplikat karena satu WP bisa punya banyak sengketa.
6. Ekstraksi detail memakai LLM jika `OPENAI_API_KEY` tersedia; heuristik lokal hanya menjadi fallback awal.
7. Review parameter kasus yang sudah auto-fill.
8. Klik `Cari Pembanding + Buat Analisis`.
9. Baca putusan pembanding, indikasi peluang, review risiko, dan draft rekomendasi WP.

Untuk menambahkan dan menanyakan dasar hukum PPN:

1. Buka menu `Peraturan`.
2. Klik `Unduh/Refresh Berkala dari Ortax` untuk mengambil dan memperbarui aturan awal dari Ortax.
3. Tambahkan ID/URL Ortax tertentu jika ada aturan yang ingin dipakai sebagai rujukan khusus.
4. Gunakan tab `Chatbot Aturan` untuk bertanya aturan dan lokasi pasal/bagiannya.
5. Jalankan analisis ulang agar tab `Peraturan Terkait` dan draft rekomendasi ikut memakai konteks aturan lokal.

Menu tambahan:

- `Ingest Putusan`: ekstraksi batch PDF dari folder lokal.
- `LLM Labeling`: label satu dokumen atau batch dokumen dengan LLM.
- `Search Putusan`: pencarian pembanding manual.
- `Peraturan`: chatbot aturan, unduh/refresh berkala, dan cari aturan PPN dari Datacenter Ortax.
- `Analisis Kasus WP`: analisis manual dengan opsi auto-fill dari dokumen.
- `Reports`: melihat dan download hasil analisis.

## Kebutuhan Saat Ini

- Python 3.9+
- `streamlit`
- `pypdf`
- `pdftotext` sebagai fallback extraction
- `openai` opsional untuk LLM eksternal
- Akses internet saat mengunduh peraturan dari Ortax

Semua dependency di atas sudah terdeteksi di environment lokal saat prototype dibuat.
Jika pindah mesin, install paket Python dengan:

```bash
python3 -m pip install -r requirements.txt
```

## LLM Opsional

Prototype tetap bisa berjalan tanpa API key. Jika ingin memakai OpenAI LLM untuk catatan
review tambahan, isi file `.env`:

```bash
OPENAI_API_KEY=sk-...
TDP_LLM_MODEL=gpt-5.4-mini
TDP_REASONING_EFFORT=low
TDP_TEXT_VERBOSITY=low
```

Untuk Vercel, isi environment variables yang sama di Project Settings. Jangan memasukkan API key ke repository.

Jika API key tidak ada, aplikasi memakai scoring lokal berbasis:

- distribusi outcome putusan pembanding,
- similarity score,
- kelengkapan bukti,
- keyword positif/negatif,
- risiko formal.

## File Penting

- `prototype_app.py`: UI Streamlit lokal.
- `tax_dispute_core.py`: ingestion, extraction, search, scoring, dan draft rekomendasi.
- `tax_regulation_connector.py`: konektor Ortax, database, dan search peraturan PPN.
- `data/tax_dispute_prototype.sqlite`: database lokal yang dibuat otomatis.
- `uploads/`: folder dokumen yang di-upload melalui UI.

## Status Saat Ini

- 100 PDF sudah diingest.
- 30 PDF sudah dilabeli dengan LLM `gpt-5.5`.
- Label LLM disimpan di tabel `llm_labels`.
- Metadata dokumen diperbarui dari label LLM untuk search dan auto-fill.
- Dashboard memakai tabel `dashboard_metrics` untuk visualisasi ringkas.
- Detail ekstraksi tersimpan di tabel `document_extractions`.
- Tabel peraturan PPN dibuat otomatis: `tax_regulations`, `tax_regulation_chunks`, dan `tax_regulation_links`.

## Batasan Prototype

- Belum memakai PostgreSQL/pgvector.
- Belum melakukan OCR gambar penuh untuk PDF scan.
- Extraction metadata masih heuristik.
- Prediction bersifat indikatif, bukan kepastian hukum.
- Draft rekomendasi wajib direview ahli pajak/kuasa hukum sebelum dipakai.
- Untuk production, gunakan izin/API/sumber resmi yang sesuai untuk pengambilan peraturan secara berkala.
