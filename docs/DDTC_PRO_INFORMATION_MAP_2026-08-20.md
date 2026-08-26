# Pemetaan DDTC Perpajakan — Paket Pro

**Tanggal observasi:** 20 Agustus 2026
**Halaman awal:** [Pencarian Panduan Pajak](https://perpajakan.ddtc.co.id/id/panduan-pajak/pencarian)
**Metode:** penelusuran read-only menggunakan sesi Microsoft Edge pengguna yang telah login dan memiliki paket Pro aktif.

> Catatan: laporan ini memetakan struktur informasi, fitur, cakupan, dan pola kerja platform. Laporan tidak menyalin isi berbayar secara massal. Angka koleksi bersifat dinamis dan beberapa kelompok data saling tumpang tindih, sehingga tidak boleh dijumlahkan sebagai jumlah dokumen unik.

## 1. Ringkasan eksekutif

DDTC Perpajakan Pro berfungsi sebagai **portal riset perpajakan terpadu**, bukan sekadar mesin pencarian peraturan. Produk menyatukan lima lapisan utama:

1. **Sumber hukum primer:** peraturan pusat/daerah, undang-undang konsolidasi, P3B, dan putusan.
2. **Informasi temporal dan relasional:** status berlaku, tanggal efektif, versi dokumen, riwayat, peraturan terkait, dan dampak MLI.
3. **Konten editorial:** panduan profesi, panduan transaksi, Coretax, rekap peraturan, Tax Manual, ebooks, dan newsletter.
4. **Data operasional:** formulir pajak, kurs pajak, dan glosarium.
5. **Alat riset pengguna:** pencarian lanjutan, indeks, highlight, bookmark/tersimpan, terjemahan, unduh, dan notifikasi.

Nilai terbesar paket Pro adalah kemampuan berpindah dari pertanyaan praktis ke panduan, lalu ke peraturan/versi yang relevan dan dokumen sumber. Kekuatan ini didukung katalog besar, struktur artikel, status hukum, dan tautan silang. Namun, fitur analisis tidak selalu tersedia untuk setiap dokumen; pada contoh peraturan yang diperiksa, panel Analisis menampilkan bahwa data belum tersedia. Untuk putusan, metadata dan AI Summary tertentu tercantum sebagai fasilitas Enterprise, bukan Pro.

## 2. Inventaris informasi yang diamati

| Kelompok | Cakupan yang ditampilkan | Informasi penting |
|---|---:|---|
| UU konsolidasi | 7 rumpun UU | KUP, PPh, PPN/PPnBM, Cukai, PPSP, Bea Meterai, dan PDRD; tersedia beberapa versi perubahan dan sebagian versi Inggris |
| Peraturan pajak pusat | 15.760 hasil | Jenis/nomor/judul, bahasa, status, tanggal berlaku, topik, lampiran, riwayat, peraturan terkait, PDF/unduh bila tersedia |
| Peraturan pajak daerah | 32.191 | Kumpulan produk hukum daerah dengan pola metadata dan navigasi serupa |
| Peraturan bahasa Inggris | 3.264 | Terjemahan peraturan; merupakan lapisan bahasa, sehingga dapat tumpang tindih dengan koleksi pusat/daerah |
| P3B | 74 yurisdiksi | Negara, bahasa, status in force, tanggal berlaku, tanggal penandatanganan, wilayah, dampak MLI, protokol, dan pasal |
| Putusan Pengadilan Pajak/MA | 7.118 hasil | Nomor, tahun, jenis pajak, upaya hukum, hasil, masa pajak, pokok sengketa, argumen, bukti, pertimbangan, dan amar |
| Panduan Pajak | 235 | Pajak Profesi 63, Pajak Transaksi 153, Coretax 19 |
| Rekap Peraturan | 115 | Ringkasan editorial berdasarkan tema/perubahan regulasi |
| Ebooks | 11 | Buku tematik prosedur, PPh, PPN, transfer pricing, insentif, desain sistem perpajakan, dan bahasa profesi |
| Newsletter | 180 | Pembaruan regulasi dan isu perpajakan secara periodik |
| Glosarium | 5.780 istilah | Definisi istilah perpajakan dan hukum |
| Formulir Pajak | 325 formulir | Dasar peraturan, tanggal berlaku, kategori, serta format PDF/DOCX bila tersedia |
| Tax Manual | Edisi 2025 | Manual tematik dari KUP sampai pajak daerah; menyebut pembaruan regulasi sampai Agustus 2025 |

Angka putusan berubah dari 7.117 pada landing page menjadi 7.118 pada halaman pencarian saat observasi. Laporan menggunakan angka halaman pencarian yang lebih mutakhir.

## 3. Arsitektur informasi

### 3.1 Sumber Hukum

Bagian ini menjadi katalog hukum primer dan terbagi menjadi:

- UU Konsolidasi;
- Peraturan Pajak Pusat;
- Peraturan Pajak Daerah;
- Peraturan Bahasa Inggris;
- P3B;
- Putusan Pengadilan Pajak dan Mahkamah Agung.

### 3.2 Panduan Pajak

- **Pajak Profesi:** perlakuan pajak berdasarkan pekerjaan/profesi.
- **Pajak Transaksi:** perlakuan pajak atas skenario transaksi tertentu.
- **Coretax:** prosedur administrasi pada Coretax, misalnya pendaftaran, perubahan data, penghapusan NPWP, dan pelaporan.
- **Rekap Peraturan:** ringkasan perubahan/ketentuan berdasarkan tema.

### 3.3 Publikasi

- Ebooks;
- Newsletter;
- DDTC Indonesian Tax Manual.

### 3.4 Data Informasi

- Glosarium;
- Kurs pajak berdasarkan KMK dan kurs BI;
- Formulir pajak lintas jenis pajak.

### 3.5 Area pengguna

- Tersimpan/bookmark;
- Highlight;
- Notifikasi;
- Informasi langganan dan profil.

## 4. Hak akses dan fasilitas paket Pro

Harga publik yang terlihat saat observasi adalah **Rp250.000 per bulan** atau **Rp3.000.000 per tahun**, belum termasuk PPN 11%. Harga dan promosi dapat berubah. Paket Pro mencakup seluruh fasilitas Lite dan menambahkan analisis dokumen, permintaan terjemahan, serta sumber referensi/file/tautan resmi untuk kelompok dokumen tertentu.

### 4.1 Matriks fasilitas per kelompok

| Kelompok | Yang tersedia pada Pro | Batasan/catatan |
|---|---|---|
| Peraturan pusat | baca, sumber resmi/referensi, lampiran, indeks, riwayat, peraturan terkait, filter status, analisis, permintaan terjemahan, highlight, unduh, terjemahan | Analisis bergantung pada ketersediaan per dokumen |
| Peraturan daerah | sumber, lampiran, indeks, riwayat, peraturan terkait, analisis, terjemahan, highlight, unduh | Kelengkapan dokumen sumber dapat berbeda |
| Putusan Pajak/MA/risalah | baca, indeks/lampiran/relasi, analisis dan permintaan terjemahan, highlight, unduh | Sumber referensi putusan tidak tercantum sebagai hak Pro; metadata dan AI Summary tertentu berada di Enterprise |
| UU konsolidasi | sumber, indeks, versi/riwayat, keterangan, peraturan terkait, terjemahan, highlight, unduh | Tidak ada fasilitas analisis lanjutan yang ditampilkan dalam matriks paket |
| P3B | sumber, indeks, protokol, MLI, versi, tanggal berlaku, tanggal penandatanganan, keterangan, terjemahan, highlight, unduh | Tidak ada analisis lanjutan pada matriks paket |
| Panduan & Rekap | baca, indeks/lampiran/keterangan/relasi, permintaan terjemahan, highlight | Tidak ada unduh dan sumber referensi penuh seperti pada peraturan |
| Ebooks & Newsletter | baca, indeks/lampiran, highlight, terjemahan | Tidak ada unduh pada matriks Pro |
| Tax Manual | indeks, peraturan terkait, keterangan, riwayat, informasi tambahan, highlight, terjemahan | Tidak ada unduh atau analisis lanjutan pada matriks Pro |
| Formulir | sumber peraturan dan unduh format yang tersedia | Format bergantung pada formulir |
| Kurs Pajak | unduh PDF dan XLS | Dibagi antara kurs KMK dan kurs BI |

## 5. Cara kerja pencarian dan penelusuran

### 5.1 Pencarian lintas koleksi

Halaman pencarian menyediakan tab untuk Semua, UU Konsolidasi, Peraturan, P3B, Putusan, Panduan Pajak, Rekap Peraturan, Ebooks, dan Newsletter. Dengan demikian, satu istilah dapat ditelusuri sebagai hukum primer maupun penjelasan editorial.

### 5.2 Filter peraturan

Filter yang ditemukan meliputi:

- pencarian biasa dan pencarian lanjutan;
- urutan terbaru atau baru dirilis;
- bahasa Indonesia/Inggris;
- pusat/daerah;
- jenis instrumen, termasuk UU, PP, Perpres, PMK, KMK, PER/KEP/SE/Surat DJP, instrumen DJBC, instrumen daerah, BI/OJK, dan lainnya;
- topik pajak dan administrasi;
- status hukum, termasuk berlaku, diubah, beberapa kali diubah, dikoreksi, dicabut sebagian/seluruhnya, atau diganti;
- rentang tahun;
- konten publik atau eksklusif.

Filter status sangat penting untuk menghindari penggunaan aturan yang sudah tidak relevan. Pada paket Pro, fasilitas ini tersedia.

### 5.3 Filter putusan

Halaman putusan mendukung:

- kategori transfer pricing/non-transfer pricing;
- jenis pajak sampai subjenis PPh, PPN, bea/cukai, PBB, pajak daerah, dan gugatan;
- upaya hukum: gugatan, banding, PK atas gugatan, dan PK atas banding;
- hasil putusan, misalnya dikabulkan seluruhnya/sebagian, ditolak, tidak dapat diterima, dibatalkan, atau hasil PK;
- rentang tahun.

Pada saat observasi, komposisi upaya hukum yang tampil adalah 573 gugatan, 4.246 banding, 253 PK atas gugatan, dan 2.046 PK atas banding. Kategori ini dapat tumpang tindih dengan pengelompokan lain dan harus dipahami sebagai facet pencarian.

### 5.4 Filter P3B

P3B dapat difilter berdasarkan:

- bahasa Indonesia/Inggris;
- penerapan MLI;
- wilayah: Asia 30, Eropa 27, Afrika 8, Amerika 6, dan Oseania 3.

Kartu negara menampilkan status, tanggal berlaku, tanggal penandatanganan, bahasa dokumen, dan penanda MLI.

## 6. Informasi pada halaman detail

### 6.1 Detail peraturan

Halaman detail peraturan memuat:

- jenis, nomor, dan judul;
- status hukum dan tanggal mulai berlaku;
- PDF/unduh bila tersedia;
- indeks bab/pasal;
- lampiran;
- pilihan bahasa;
- riwayat;
- peraturan terkait;
- analisis bila tersedia;
- teks terstruktur (menimbang, mengingat, bab, pasal);
- tautan langsung dari sitasi peraturan ke halaman katalog terkait;
- highlight, glosarium, pengaturan ukuran huruf, dan pelaporan kesalahan ketik.

Tautan sitasi dan peraturan terkait secara fungsional membentuk graph navigasi hukum, walaupun antarmuka tidak menyebutnya sebagai knowledge graph.

### 6.2 Detail UU konsolidasi

UU konsolidasi menampilkan:

- versi berdasarkan undang-undang perubahan;
- versi Indonesia dan, pada sebagian versi, Inggris;
- indeks BAB/Pasal;
- penanda perubahan;
- penjelasan pasal;
- peraturan terkait;
- keterangan dan versi terbaru.

Ini berfungsi sebagai “time machine” terbatas: peneliti dapat memilih naskah setelah perubahan 2020, 2021, atau 2023 untuk rumpun UU tertentu.

### 6.3 Detail P3B

Halaman P3B menampilkan:

- negara/yurisdiksi dan bendera;
- status in force;
- tanggal penandatanganan dan tanggal berlaku;
- versi dokumen dan bahasa;
- indeks per pasal dan protokol;
- penanda/implikasi MLI;
- catatan editorial pada pasal tertentu;
- PDF/unduh dan highlight.

### 6.4 Detail putusan

Halaman putusan yang diuji menampilkan:

- nomor dan tahun putusan;
- hasil putusan;
- jenis pajak dan masa pajak;
- pokok sengketa;
- PDF/unduh;
- indeks dan highlight kasus;
- duduk perkara;
- posisi Pemohon Banding dan Terbanding;
- daftar dasar hukum;
- alat bukti para pihak;
- pertimbangan hukum;
- amar/mengadili.

Data tersebut sangat berguna untuk ekstraksi terstruktur menjadi matriks **isu–fakta–bukti–aturan–pertimbangan–hasil**. Informasi identitas pribadi pada putusan harus diperlakukan hati-hati jika akan diproses ulang.

### 6.5 Panduan, rekap, dan Tax Manual

Panduan memadukan pertanyaan praktis dengan uraian, versi bahasa, tanggal pembaruan, dan tautan. Tax Manual 2025 mengelompokkan pengetahuan ke dalam perkembangan terkini, KUP, PPh badan/orang pribadi/pemotongan, pajak internasional dan transfer pricing, PPN/PPnBM, kepabeanan/cukai, insentif, bea meterai, PBB, pajak daerah, dan pajak karbon.

## 7. Kekuatan, keterbatasan, dan risiko

### Kekuatan

- Cakupan hukum dan editorial dalam satu portal.
- Status dan dimensi waktu cukup kuat.
- UU konsolidasi mengurangi beban membaca banyak amendemen.
- P3B terstruktur sampai pasal, protokol, bahasa, dan MLI.
- Putusan memiliki facet pencarian yang berguna untuk analisis sengketa.
- Tautan silang antarperaturan mendukung eksplorasi relasi.
- Alat riset pengguna—save, highlight, notifikasi, indeks—mendukung penggunaan berulang.

### Keterbatasan

- Fitur analisis tidak berarti semua dokumen sudah dianalisis.
- AI Summary putusan tertentu berada di Enterprise.
- Hak “sumber referensi” tidak seragam untuk semua kategori pada Pro.
- Angka landing page dan search page dapat berbeda karena pembaruan indeks.
- Status hukum tetap perlu diverifikasi terhadap sumber pemerintah sebelum dipakai untuk opini berisiko tinggi.
- Portal kuat sebagai knowledge/research system, tetapi belum tampak sebagai chatbot RAG percakapan penuh pada halaman yang diuji.

### Risiko implementasi serupa

- Salah memilih versi aturan berdasarkan masa pajak.
- Menganggap dokumen terjemahan sebagai sumber hukum otoritatif.
- Menjumlahkan koleksi yang sebenarnya tumpang tindih.
- Menampilkan putusan tanpa pengamanan data pribadi.
- Menghasilkan ringkasan AI tanpa locator pasal/halaman dan tanpa status review.

## 8. Implikasi untuk Alpha AI Jurist

### 8.1 Fitur yang perlu diprioritaskan

**Prioritas 0 — fondasi kepercayaan**

1. Canonical ID untuk setiap instrumen dan setiap versi.
2. Status hukum, tanggal berlaku, tanggal berakhir, dan masa pajak yang relevan.
3. PDF/file asli, URL pemerintah, hash sumber, serta locator halaman/pasal.
4. Graph terverifikasi: mengubah, mencabut, mengganti, melaksanakan, terkait, menyitir, ditafsirkan oleh, dan diterapkan pada putusan.
5. Pencarian hybrid dengan filter waktu, status, jenis pajak, instrumen, dan yurisdiksi.
6. Citation validator dan abstention apabila bukti/versi tidak memadai.

**Prioritas 1 — pengalaman riset**

1. Katalog detail dengan indeks pasal dan tautan internal.
2. Save, highlight, folder, history, dan alert perubahan.
3. Tampilan versi konsolidasi dan perbandingan perubahan.
4. P3B navigator dengan protokol/MLI.
5. Putusan sebagai matriks isu–fakta–bukti–aturan–pertimbangan–hasil.
6. Bahasa Indonesia sebagai default, terjemahan sebagai lapisan sekunder.

**Prioritas 2 — diferensiasi**

1. Chat RAG dengan jawaban langsung, rumus, contoh, dan sitasi yang dapat diklik.
2. Precedent navigator berbasis kemiripan fakta dan alasan pembeda.
3. Regulation time machine berdasarkan tanggal transaksi/masa pajak.
4. Evidence matrix dan generator memo/keberatan/banding/PK dengan reviewer sign-off.
5. Workspace per tenant/client/matter dan private knowledge base.

### 8.2 Model graph yang disarankan

Node utama:

- `RegulationInstrument`;
- `RegulationVersion`;
- `Article`/`Provision`;
- `Treaty`/`Protocol`/`MLIPosition`;
- `Decision`;
- `TaxIssue`;
- `Evidence`;
- `Guide`/`ManualChapter`;
- `Form`;
- `OfficialSource`.

Edge utama:

- `AMENDS`, `REVOKES`, `REPLACES`, `IMPLEMENTS`;
- `CITES`, `RELATED_TO`, `INTERPRETS`, `APPLIES`;
- `EFFECTIVE_DURING`, `SUPERSEDED_BY`;
- `DECIDES_ISSUE`, `SUPPORTED_BY_EVIDENCE`;
- `EXPLAINS`, `HAS_OFFICIAL_SOURCE`;
- `MODIFIED_BY_MLI`.

Graph tidak boleh dibangun hanya dari pola regex. Edge berisiko tinggi—terutama mencabut, mengganti, atau membalik arah pelaksanaan—harus melalui verifikasi otomatis plus review manusia.

## 9. Benchmark yang disarankan

| Dimensi | Metrik minimum | Target awal produksi |
|---|---|---:|
| Exact regulation lookup | Exact Top-1 | ≥98% |
| Retrieval umum | Required Recall@5 | ≥90% |
| Multi-document | All-required@5 | ≥85% |
| Temporal | ketepatan versi/status pada tanggal kasus | ≥95% |
| Graph | precision edge terverifikasi | ≥95% |
| Citation | klaim substantif dengan locator valid | ≥95% |
| Source readiness | PDF/URL/hash/locator lengkap | ≥90% corpus aktif |
| Abstention | recall pada pertanyaan tidak didukung | ≥90% |
| Answer completeness | cakupan poin ground truth | ≥90% |
| Latency | P95 jawaban warm | ≤5 detik untuk retrieval; generation dapat dipisahkan |

Set uji sebaiknya mencakup PPh, PPN/PPnBM, KUP, kepabeanan/cukai, PBB, pajak daerah, transfer pricing, P3B/MLI, prosedur keberatan/banding/PK, formulir, dan pertanyaan berbasis tanggal. Setiap kasus perlu memiliki dokumen wajib, versi wajib, pasal wajib, jawaban minimum, dan alasan abstention jika bukti tidak cukup.

## 10. Kesimpulan

DDTC Pro unggul sebagai sistem riset perpajakan karena menghubungkan sumber hukum, dimensi waktu, konten editorial, dan alat kerja pengguna. Pola terbaik yang layak diadopsi adalah **navigasi dari jawaban praktis ke sumber primer, versi yang tepat, dan hubungan antaraturan**. Alpha AI Jurist dapat melampaui pola tersebut apabila menggabungkannya dengan RAG bersitasi, graph terverifikasi, pencarian temporal, putusan terstruktur, workspace perkara, serta abstention yang kuat.

Tautan utama yang digunakan dalam observasi:

- [Pencarian Panduan Pajak](https://perpajakan.ddtc.co.id/id/panduan-pajak/pencarian)
- [Sumber Hukum](https://perpajakan.ddtc.co.id/id/sumber-hukum)
- [Pencarian Peraturan](https://perpajakan.ddtc.co.id/id/sumber-hukum/peraturan/pencarian?kategori=pusat)
- [Pencarian Putusan](https://perpajakan.ddtc.co.id/id/sumber-hukum/putusan/pencarian)
- [Pencarian P3B](https://perpajakan.ddtc.co.id/id/sumber-hukum/p3b/pencarian)
- [UU Konsolidasi](https://perpajakan.ddtc.co.id/id/sumber-hukum/konsolidasi/pencarian)
- [Harga Paket](https://perpajakan.ddtc.co.id/id/pricing)
