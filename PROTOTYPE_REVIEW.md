# Review Fitur, Layout, dan Efisiensi Prototype

Dokumen ini merangkum evaluasi cepat atas prototype Tax Dispute Simple Advisor setelah fitur ekstraksi LLM, pencarian putusan, konektor peraturan PPN, analisis, dan export report tersedia.

## Kesimpulan Cepat

Prototype sudah memiliki alur end-to-end yang layak untuk demo lokal:

1. upload/ingest dokumen,
2. ekstraksi detail dengan LLM text/vision,
3. penyimpanan field ke database,
4. pencarian putusan pembanding,
5. pencarian aturan PPN,
6. analisis risiko dan rekomendasi,
7. export Word/PDF/Markdown.

Yang paling perlu dirapikan bukan penambahan fitur baru, melainkan penyederhanaan alur pengguna, pengurangan tampilan field kosong, dan pemisahan fitur utama vs fitur admin.

## Fitur yang Perlu Dipertahankan

| Fitur | Alasan |
|---|---|
| Alur Terpandu | Ini adalah jalur demo terbaik karena menggabungkan upload, ekstraksi, auto-fill, analisis, dan rekomendasi. |
| Analisis Kasus WP | Perlu tetap ada sebagai jalur manual jika kasus belum punya dokumen lengkap. |
| Peraturan | Penting untuk menghubungkan rekomendasi dengan aturan PPN dan menjawab “aturannya di mana?”. |
| Reports | Penting karena user butuh membuka ulang, mengedit, dan mengunduh hasil analisis. |
| Dashboard | Berguna untuk melihat kesiapan database, sebaran dokumen, dan status prototype. |
| LLM Extraction | Tetap perlu, tetapi lebih sebagai fitur admin untuk re-ekstraksi/quality control. |

## Fitur yang Sebaiknya Digabung atau Diturunkan Prioritasnya

| Fitur | Rekomendasi |
|---|---|
| Search Putusan | Tetap ada, tetapi bukan menu utama. Dalam demo, pencarian pembanding lebih natural lewat Alur Terpandu/Analisis. |
| Ingest & Ekstraksi | Perlu ada, tetapi sebagai menu admin/data preparation. User bisnis idealnya mulai dari Alur Terpandu. |
| Batch Labeling | Tetap admin-only. Berisiko memakan token dan waktu jika dipakai tanpa kontrol. |
| Kebutuhan Prototype | Lebih cocok menjadi dokumentasi, bukan layar yang sering digunakan. |

## Fitur yang Belum Perlu Dibesarkan Dulu

| Fitur | Alasan ditunda |
|---|---|
| Prediction statistik kompleks | Data label belum cukup. Lebih aman mempertahankan scoring indikatif berbasis pembanding + evidence. |
| Visualisasi distribusi terlalu detail | Bisa menimbulkan kesan akurasi statistik yang belum didukung data besar. |
| Full RAG/vector search production | Untuk prototype lokal, token similarity dan database SQLite masih cukup. |
| Workflow user/role/approval | Belum diperlukan sebelum alur analisis dan kualitas ekstraksi stabil. |
| Integrasi aturan pajak semua topik | Fokus PPN dulu lebih tajam dan mudah divalidasi. |

## Perbaikan Layout yang Sudah Dilakukan

| Area | Perbaikan |
|---|---|
| Sidebar | Menu utama diringkas untuk user/analis, dengan toggle untuk membuka menu admin/data. |
| Dashboard | Ditambah tombol aksi cepat agar user tidak harus mencari menu. |
| Ekstraksi dokumen | Field kosong/UNKNOWN disembunyikan secara default, dengan toggle jika ingin audit semua field. |
| Nama field | Field teknis seperti `taxpayer_name` ditampilkan menjadi label bisnis seperti “Nama WP”. |
| Export report | Word/PDF/Markdown tidak dibuat otomatis setiap rerender. User klik “Siapkan File Unduhan” dulu agar app lebih ringan. |
| LLM JSON | Raw JSON disembunyikan dalam expander agar UI utama tetap bersih. |

## Rekomendasi Layout Berikutnya

Idealnya aplikasi dibagi menjadi dua mode:

1. **Mode User/Analis**
   - Dashboard
   - Alur Terpandu
   - Analisis Kasus WP
   - Peraturan
   - Reports

2. **Mode Admin/Data**
   - Ingest & Ekstraksi
   - LLM Extraction
   - Search Putusan
   - Kebutuhan Prototype / dokumentasi

Jika nanti app makin besar, sidebar bisa memakai toggle “Tampilkan menu admin” agar user bisnis tidak terdistraksi.

## Status Eksekusi Rapih-Rapih

Per 12 Mei 2026, rekomendasi layout utama sudah diterapkan di `prototype_app.py`:

1. Sidebar sekarang memakai toggle **Tampilkan menu admin/data**.
2. Mode user/analis hanya menampilkan Dashboard, Alur Terpandu, Analisis Kasus WP, Peraturan, dan Reports.
3. Mode admin/data menampilkan tambahan Search Putusan, Ingest & Ekstraksi, LLM Extraction, dan Kebutuhan Prototype.
4. Hasil analisis di Alur Terpandu dan Analisis Kasus WP disimpan di session state, sehingga tombol export Word/PDF tidak menghilangkan hasil saat halaman rerun.
5. Cache dokumen, statistik, dan file report dibersihkan setelah proses ingest/labeling agar dashboard dan pilihan dokumen tetap sinkron.

## Rekomendasi Kode Berikutnya

| Area kode | Rekomendasi |
|---|---|
| `prototype_app.py` | Pecah menjadi modul `pages/`, `components/`, dan `state.py` jika sudah mulai production. Saat ini satu file masih bisa diterima untuk prototype. |
| `tax_dispute_core.py` | Pisahkan domain: extraction, analysis, reports, database. File ini sudah menjadi terlalu besar untuk pengembangan jangka panjang. |
| Export report | Simpan file hasil export di folder `exports/` agar tidak perlu generate ulang jika report sama dibuka lagi. |
| LLM prompts | Pindahkan prompt ke file `prompts/` agar mudah diaudit dan di-versioning. |
| Config | Buat `settings.py` untuk model, max pages vision, path DB, dan flags eksperimen. |
| Tests | Tambah smoke test untuk ekstraksi, duplicate guard, report export, dan regulation search. |

## Prioritas Setelah Data Tambahan Masuk

1. Validasi kualitas ekstraksi pada 10-20 dokumen baru.
2. Buat daftar field yang wajib selalu muncul untuk PPN.
3. Label outcome manual untuk sampel putusan agar scoring makin kredibel.
4. Rapikan template rekomendasi sesuai gaya memo yang diinginkan.
5. Evaluasi apakah search pembanding perlu naik ke vector search.
