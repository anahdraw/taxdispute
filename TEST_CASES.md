# Test Cases: PDF Ingest from TestData

Tujuan test ini adalah memastikan aplikasi dapat mengambil file PDF dari folder `TestData`, membaca teksnya, mengekstrak metadata awal, menyimpan hasil ke SQLite test, dan menolak duplikat nomor putusan.

## TC-TD-001: Deteksi PDF di Folder TestData

**Precondition**
- Folder `TestData` tersedia.
- Folder berisi minimal satu file `.pdf`.

**Steps**
1. Jalankan `find_pdfs(TestData)`.
2. Pastikan hanya file berekstensi `.pdf` yang diambil.
3. Pastikan urutan file stabil berdasarkan nama file.

**Expected Result**
- Semua PDF di `TestData` ditemukan.
- File non-PDF tidak ikut diproses.

## TC-TD-002: Ingest PDF dari TestData ke SQLite Test

**Precondition**
- Folder `TestData` berisi PDF dengan text layer.
- Database test kosong.

**Steps**
1. Jalankan `upsert_document()` untuk setiap PDF dari `TestData`.
2. Gunakan `db_path` temporary agar database lokal production tidak berubah.
3. Cek tabel `documents`.
4. Cek tabel `document_extractions`.
5. Cek tabel `chunks`.

**Expected Result**
- Setiap PDF valid tersimpan sebagai satu record `documents`.
- `extraction_status` bernilai `completed`.
- `document_extractions` berisi payload ekstraksi untuk setiap dokumen.
- `chunks` terisi untuk search pembanding.

## TC-TD-003: Ekstraksi Metadata Dasar

**Precondition**
- PDF fixture memuat nomor putusan, tahun, PPN, pokok sengketa, posisi WP/DJP, dan amar.

**Steps**
1. Ingest PDF dari `TestData`.
2. Baca kembali record dengan `list_documents()`.
3. Validasi field utama.

**Expected Result**
- `putusan_number` terisi.
- `putusan_year` terisi.
- `tax_type` terdeteksi sebagai `PPN`.
- `issue_type` tidak kosong.
- `outcome` terdeteksi dari amar putusan jika teks memuat frasa putusan.

## TC-TD-004: Penolakan Duplikat Nomor Putusan

**Precondition**
- Ada dua PDF berbeda yang memuat nomor putusan yang sama.

**Steps**
1. Ingest PDF pertama.
2. Ingest PDF kedua dengan nomor putusan sama.

**Expected Result**
- PDF pertama berhasil tersimpan.
- PDF kedua ditolak dengan `DuplicateDocumentError`.
- Detail duplikat menampilkan dokumen yang sudah pernah diekstraksi.

## Cara Menjalankan

Membuat sample PDF dummy di `TestData`, lalu menjalankan ingest test:

```bash
python3 scripts/run_testdata_ingest.py --generate-samples
```

Menjalankan validasi strict bahwa semua PDF yang diproses harus selesai diekstrak:

```bash
python3 scripts/run_testdata_ingest.py --testdata TestData --require-completed
```

Jika folder `TestData` berisi PDF scan tanpa text layer, mode strict akan gagal. Itu berarti aplikasi berhasil mengambil file, tetapi ekstraksi teks perlu OCR/vision LLM.

Menjalankan unit test otomatis:

```bash
python3 -m unittest tests/test_testdata_ingest.py
```
