# Komparasi AAJurist dan DDTC Pro serta Roadmap Parity

**Tanggal:** 21 Agustus 2026
**Status:** product gap assessment berbasis fitur AAJurist yang ada di repository dan observasi read-only DDTC Pro pada 20 Agustus 2026

## 1. Kesimpulan eksekutif

AAJurist belum setara DDTC sebagai **portal riset pajak yang luas**, tetapi sudah memiliki fondasi yang lebih kuat untuk menjadi **trusted tax research and dispute operating system**.

Perbedaan posisinya:

- **DDTC Pro** unggul pada keluasan katalog, konsolidasi dan riwayat aturan, P3B, konten editorial, glosarium/formulir, serta pengalaman riset yang sudah matang.
- **AAJurist** unggul pada jawaban percakapan bersumber, analisis sengketa, workflow tenant/client/matter, private storage, review berbantu AI, trust/abstention, graph experimentation, dan ekspor pekerjaan advisor.

AAJurist tidak perlu mengejar seluruh volume DDTC terlebih dahulu. Target yang lebih masuk akal adalah mencapai parity pada alur inti:

> **Cari → pahami status dan versi → baca sumber resmi → tanya AI → simpan/highlight → gunakan dalam matter → ekspor hasil.**

Setelah alur ini kuat, diferensiasi AAJurist harus dibangun di atas:

> **isu–fakta–bukti–aturan–putusan pembanding–draft argumentasi–review manusia.**

## 2. Basis pembanding

### DDTC Pro yang diamati

- 15.760 peraturan pusat;
- 32.191 peraturan daerah;
- 3.264 peraturan bahasa Inggris;
- 7 rumpun UU konsolidasi;
- 74 P3B;
- 7.118 putusan;
- 235 panduan pajak;
- 115 rekap peraturan;
- 11 ebook;
- 180 newsletter;
- 5.780 istilah glosarium;
- 325 formulir;
- Tax Manual 2025;
- pencarian lintas koleksi, filter detail, versi/riwayat, dokumen terkait, PDF, highlight, bookmark, terjemahan, dan notifikasi.

Detail observasi tersedia di [DDTC_PRO_INFORMATION_MAP_2026-08-20.md](./DDTC_PRO_INFORMATION_MAP_2026-08-20.md).

### AAJurist saat ini

Corpus pipeline yang sudah diuji memuat:

- 10.535 peraturan;
- 8.728 peraturan memiliki body;
- 174.905 pasal;
- 166.928 pasal terpetakan ke FTS;
- 44.495 relation rows;
- 1.497 relasi berlabel verified pada data sumber;
- 6.118 record memiliki URL resmi;
- 10.528 record memiliki SHA-256.

Benchmark retrieval pipeline saat ini menghasilkan:

- Hit@5: **100%**;
- required recall@5: **98,33%**;
- all-required@5: **96,67%**;
- exact lookup top-1: **100%**;
- multi-hop all-required: **90%**;
- latency p95 offline: **464,67 ms**;
- negative false-positive rate: **100%**.

Angka positifnya kuat, tetapi negative false-positive 100% berarti sistem masih selalu mengembalikan dokumen pajak untuk pertanyaan yang seharusnya ditolak atau dinyatakan di luar cakupan.

Graph yang sudah dibangun memuat 10.425 node dan 43.713 edge, tetapi quality gate masih `review_required`. Hanya **791 edge** yang saat ini lolos sebagai evidence jawaban; 42.922 edge masih dikarantina. Jadi graph sudah dipakai secara selektif untuk reranking/evidence, tetapi belum dapat dianggap sebagai graph hukum produksi yang matang.

LightRAG pernah diuji pada 58 kartu seed dan menunjukkan peningkatan retrieval tertentu, tetapi belum menjadi indeks penuh untuk corpus 10.535 peraturan. Route produksi saat ini sengaja tidak memakai indeks LightRAG pilot ketika snapshot peraturan yang lebih baru tersedia.

## 3. Matriks komparasi fitur

Keterangan status AAJurist:

- **Kuat:** sudah tersedia dan memberi nilai lebih.
- **Parsial:** fondasi ada, tetapi coverage, integrasi, atau kualitas belum cukup.
- **Gap:** belum menjadi fitur produk yang siap dipakai.

| Area | DDTC Pro | AAJurist sekarang | Status | Yang harus dikejar |
|---|---|---|---|---|
| Katalog peraturan | Pusat, daerah, Inggris, status, topik, jenis, tahun | 10.535 peraturan pipeline; katalog dan import tersedia | Parsial | Lengkapi coverage prioritas, facet, metadata konsisten, dan quality gate |
| UU konsolidasi | 7 rumpun, versi perubahan, indeks pasal | Canonical/version/graph data mulai ada, belum ada naskah konsolidasi dan time-machine yang matang | Gap kritis | Consolidated view, compare version, effective-at-date, dan perubahan per pasal |
| Status dan masa berlaku | Status, mulai berlaku, riwayat, peraturan terkait | Status/validity ada, tetapi terdapat 1.597 `status_site_conflict` | Parsial berisiko | Verifikasi temporal dan konflik sumber sebelum current-law answer |
| PDF dan sumber resmi | PDF/unduh/lampiran/sumber pada banyak kategori | Viewer, source link, PDF enrichment, hash dan ekstraksi tersedia; coverage belum merata | Parsial | Registry PDF resmi, immutable hash, locator halaman/pasal, dan missing-PDF queue |
| Search dan filter | Universal search dan facet matang | BM25/FTS, optional vector/RRF, reranker dan graph boost tersedia | Parsial | Persistent hybrid index, facet lengkap, threshold relevansi, dan abstention negatif |
| Detail peraturan | Indeks, teks, lampiran, riwayat, relasi, bahasa | Ringkasan, ketentuan, relasi, dokumen/PDF, dan tanya satu referensi tersedia | Mendekati | Tambah indeks pasal penuh, histori versi, compare, lampiran, dan citation deep-link |
| Knowledge graph | Relasi tampil sebagai related/history/citation navigation | Graph eksplisit dan graph-path reranking sudah ada | Parsial berisiko | Review edge, provenance per edge, temporal direction, dan graph-path explanation |
| P3B/MLI | 74 yurisdiksi, protokol, bahasa, MLI, status, tanggal | Belum ada navigator khusus | Gap kritis | Treaty/protocol/MLI data model, article navigator, effective-date logic |
| Putusan | 7.118, filter pajak/upaya/hasil/tahun, detail terstruktur | Database, extraction, analisis, comparable decision, detail dan PDF tersedia | Kuat secara fitur | Validasi coverage corpus, tambah facet, PII policy, dan citation-to-page |
| Panduan praktis | 235 panduan profesi/transaksi/Coretax | Ground truth buku pajak dan answer layer tersedia, belum menjadi library editorial | Gap konten | FAQ/playbook asli, reviewed, versioned, dan selalu terhubung ke aturan resmi |
| Rekap dan impact note | 115 rekap | Graph dapat menjadi dasar, tetapi produk rekap belum tersedia | Gap | Auto-draft perubahan + reviewer sign-off + impact by taxpayer/matter |
| Manual, ebook, newsletter | Tax Manual, 11 ebook, 180 newsletter | Buku ground truth internal dan report generation ada | Parsial | Manual internal modular, update bulletin, dan subscription alert |
| Glosarium | 5.780 istilah | Belum menjadi modul katalog | Gap | Glosarium bersitasi, alias/sinonim, tooltip, dan bilingual mapping |
| Formulir dan kurs | 325 formulir, kurs KMK/BI | Belum menjadi modul operasional | Gap | Registry formulir resmi, versi, kalkulator kurs, dan dependency ke prosedur |
| Chat peraturan | Bukan kekuatan utama yang tampak pada observasi | Jawaban natural, rumus, contoh, sumber klik, reranker dan graph context | Kuat | Satukan citation validator dan trust response pada semua jalur chat |
| Analisis sengketa | Detail putusan dan analisis terbatas menurut paket | Extraction, dispute analysis, smart chat, comparables, evidence gap, report | Lebih kuat | Evidence matrix dan precedent navigator yang lebih eksplisit |
| Save/highlight/history | Tersimpan, highlight, notifikasi | Folder, saved item, highlight, history; scope tenant/client/matter | Kuat secara fondasi | Tempel kontrol ini ke semua hasil chat/detail/search dan tambah annotation anchors |
| Workspace privat | Area pengguna, bukan matter workspace mendalam | Tenant/client/matter, private file, user scope | Lebih kuat | Collaboration, assignment, approval, versioning, retention, legal hold |
| Review kualitas | Editorial internal tidak tampak pada sisi pengguna | Review app admin, AI assist, resolve, fail-closed | Lebih kuat | SLA, sampling, dual control, reviewer analytics, dan audit export |
| Trust dan abstention | Status/sumber kuat, mekanisme AI tidak terlihat penuh | Citation Trust Layer dan abstention sudah ada pada trusted search | Parsial | Terapkan gate yang sama ke regulation-chat, smart-chat, report, dan drafting |
| Terjemahan/bilingual | 3.264 aturan Inggris, translation request | Jawaban/UI ID–EN; coverage corpus Inggris dan validasi terjemahan terbatas | Parsial | Translation memory, official-vs-machine label, article alignment, reviewer workflow |
| Export | Unduh sumber sesuai kategori/paket | Word/PDF report dan TP Local File Word | Lebih kuat | Export citation register, audit trail, evidence matrix, dan version stamp |
| Alert/update | Notifikasi dan konten update | Import/update tersedia, alert pengguna belum utuh | Gap | Watchlist, delta ingestion, impact notification, daily/weekly digest |
| Admin dan tiering | Subscription/account | Role, tier, feature entitlement, user/log/settings | Kuat secara fondasi | Usage metering, billing integration, audit policy, SSO/MFA |
| Skala produksi | Platform production dengan koleksi besar | Corpus lokal 10,5k; sebagian pencarian masih local/in-memory; pilot LightRAG stale | Gap infrastruktur | Postgres/OpenSearch/pgvector, queue, object storage, blue-green index, observability |

## 4. Fitur inti minimum yang wajib sama

Parity minimum bukan berarti menyamai seluruh jumlah artikel dan dokumen. AAJurist dapat disebut minimal setara pada fitur inti bila enam kapabilitas berikut tersedia secara konsisten.

### 4.1 Universal tax research

Satu kolom pencarian untuk:

- peraturan;
- pasal;
- putusan;
- P3B;
- panduan/FAQ internal;
- formulir;
- glosarium.

Filter minimum:

- jenis pajak;
- jenis instrumen;
- status hukum;
- tanggal transaksi atau masa pajak;
- tahun terbit;
- pusat/daerah;
- bahasa;
- sumber resmi;
- putusan berdasarkan upaya hukum dan outcome.

### 4.2 Regulation time machine

Pengguna harus dapat memasukkan tanggal atau masa pajak dan memperoleh:

- aturan yang berlaku pada tanggal tersebut;
- aturan sebelumnya dan sesudahnya;
- pasal yang berubah;
- instrumen yang mengubah/mencabut/melaksanakan;
- warning apabila ada konflik status;
- tautan ke PDF dan locator yang menjadi bukti.

Ini lebih penting daripada sekadar menambah jumlah dokumen.

### 4.3 Detail sumber yang dapat diaudit

Setiap peraturan utama harus memiliki:

- canonical ID;
- status dan rentang berlaku;
- PDF/HTML resmi;
- checksum;
- indeks pasal;
- lampiran;
- versi;
- relasi terverifikasi;
- deep link ke halaman/pasal;
- label apakah teks merupakan sumber resmi, hasil ekstraksi, atau terjemahan.

### 4.4 Research workspace menyatu

Save, highlight, folder, history, dan private file tidak boleh menjadi pulau terpisah. Kontrolnya harus tersedia langsung pada:

- kartu hasil pencarian;
- sumber jawaban chatbot;
- detail putusan/peraturan;
- PDF viewer;
- hasil analisis sengketa;
- draft laporan.

### 4.5 Update dan notification

Pengguna dapat mengikuti topik, peraturan, pasal, client, atau matter. Ketika aturan berubah, sistem mengirim:

- perubahan apa;
- mulai berlaku kapan;
- matter mana yang mungkin terdampak;
- jawaban/draft mana yang perlu ditinjau ulang;
- sumber resmi perubahan.

### 4.6 Trust layer pada seluruh output AI

Semua jawaban, analisis, dan draft harus melalui gate yang sama:

- current-law validator;
- citation coverage;
- source eligibility;
- locator validation;
- calculation validation;
- abstention bila bukti tidak cukup;
- audit record model/prompt/retrieval/source/reviewer.

## 5. Prioritas pengembangan

### P0 — kepercayaan dan data, sebelum menambah fitur baru

1. Turunkan negative false-positive rate dari 100% menjadi maksimum 5%.
2. Integrasikan Citation & Trust Layer ke `regulation-chat`, `smart-chat`, report, dan drafting—bukan hanya trusted search.
3. Selesaikan konflik identity/status pada aturan prioritas tinggi.
4. Hubungkan PDF resmi, SHA-256, dan locator halaman/pasal untuk aturan yang paling sering dipakai.
5. Review graph berdasarkan dampak: perubahan, pencabutan, pelaksanaan, dan masa berlaku terlebih dahulu.
6. Jangan aktifkan full LightRAG sampai manifest indeks identik dengan snapshot corpus aktif.

### P1 — parity pengalaman riset

1. Universal search dengan facet lengkap.
2. Detail regulation workspace: summary, pasal, versi, relasi, PDF, lampiran, dan tanya dokumen.
3. Regulation time machine dan compare version.
4. Integrasikan save/highlight/folder/history ke seluruh aplikasi.
5. Watchlist dan notification.
6. Faceted decision navigator dan internal citation links.

### P2 — parity pengetahuan

1. P3B/MLI navigator.
2. Panduan transaksi dan profesi yang ditulis sendiri berdasarkan sumber resmi.
3. Coretax playbook.
4. Rekap perubahan/impact note.
5. Tax manual modular.
6. Glosarium bersitasi.
7. Formulir dan kurs resmi.

Konten editorial DDTC tidak boleh disalin. Produk pengetahuan AAJurist harus ditulis independen dari sumber pemerintah dan direview ahli, kecuali tersedia lisensi tertulis.

### P3 — skala dan operasi produksi

1. Pindahkan serving search ke persistent FTS + vector index.
2. Gunakan queue untuk extraction, OCR, enrichment, graph, dan embeddings.
3. Versioned/blue-green LightRAG workspace agar indeks baru dapat diuji sebelum aktif.
4. Object storage privat untuk PDF, immutable raw zone, dan manifest.
5. Telemetry retrieval, citation, answer quality, latency, cost, dan drift.
6. Backup, disaster recovery, SSO/MFA, retention, legal hold, dan audit export.

## 6. Fitur tambahan untuk membuat AAJurist lebih unggul

### 6.1 Issue–fact–evidence–rule matrix

Sistem membentuk matriks per perkara:

| Isu | Fakta | Bukti | Aturan pada masa pajak | Putusan pembanding | Gap | Reviewer |
|---|---|---|---|---|---|---|

Setiap sel harus memiliki locator dan status verifikasi. Ini adalah diferensiasi utama yang tidak tampak sebagai workflow terpadu di DDTC.

### 6.2 Precedent navigator

Bukan “prediksi menang”, tetapi:

- kemiripan fakta;
- kesamaan isu dan masa pajak;
- dasar hukum yang dipakai;
- pola pertimbangan majelis;
- outcome distribution;
- faktor pembeda;
- kekuatan dan kelemahan bukti.

### 6.3 Drafting studio

Dari evidence matrix, pengguna membuat:

- memo riset;
- tanggapan pemeriksaan;
- keberatan;
- banding;
- gugatan;
- kontra memori/PK;
- executive summary untuk manajemen.

Draft harus memakai approved facts, approved citations, clause locking, versioning, dan reviewer sign-off.

### 6.4 Explainable tax calculation engine

Untuk pertanyaan perhitungan, sistem tidak hanya menghasilkan teks, tetapi:

- meminta input yang belum lengkap;
- memilih formula menurut masa pajak;
- menunjukkan langkah angka per angka;
- membandingkan skenario;
- menyimpan asumsi;
- menyertakan pasal dan aturan pelaksana;
- menjalankan deterministic recomputation sebelum jawaban dipublikasikan.

### 6.5 Regulatory impact monitor

Graph dipakai untuk menjawab:

- aturan baru mengubah pasal mana;
- panduan, kalkulator, template, dan jawaban mana yang menjadi stale;
- client/matter mana yang terdampak;
- reviewer siapa yang harus melakukan approval ulang.

### 6.6 Private enterprise knowledge

Per tenant dapat ditambahkan:

- SOP perusahaan;
- tax position paper;
- kontrak;
- korespondensi DJP;
- bukti transaksi;
- hasil review sebelumnya.

Retrieval harus menjaga pemisahan tenant dan membedakan tegas sumber hukum publik, pengetahuan internal, dan fakta perkara.

### 6.7 Quality cockpit

Dashboard internal menampilkan:

- pertanyaan gagal/abstain;
- unsupported claim;
- aturan tanpa PDF/locator;
- konflik status;
- edge graph karantina;
- query tanpa jawaban;
- perubahan benchmark;
- reviewer throughput dan disagreement.

## 7. Target mutu sebelum klaim parity

| Ukuran | Kondisi sekarang yang diketahui | Target minimum |
|---|---:|---:|
| Required recall@5 | 98,33% | ≥95% dipertahankan pada benchmark lebih luas |
| All-required@5 | 96,67% | ≥90% dipertahankan |
| Exact lookup top-1 | 100% | ≥98% |
| Negative false-positive | 100% | ≤5% |
| Graph verified precision | 52,57% pada audit sebelumnya | ≥95% |
| Graph recall | 100% pada audit sebelumnya | ≥90% dengan gold set diperluas |
| Current-law temporal accuracy | Belum ada benchmark produksi yang cukup | ≥98% |
| Citation eligibility/locator coverage pada jawaban | Belum menyeluruh | ≥95% |
| Unsupported substantive claims | Belum diukur end-to-end | ≤2% |
| Kelengkapan minimum jawaban vs ground truth | Book QA sudah tersedia, belum menjadi release gate global | ≥95% |
| Search latency p95 | 464,67 ms offline | ≤1 detik pada beban target |
| Full answer latency p95 | Belum menjadi release gate | ≤10 detik |
| Cross-tenant leakage | Tests dasar tersedia | 0 pada security/UAT suite |
| Freshness aturan prioritas | Manual/import | ≤24 jam dari deteksi perubahan |

Benchmark harus diperluas dari puluhan query menjadi set yang mencakup setidaknya:

- PPh OP dan badan;
- PPN/PPnBM;
- pemotongan/pemungutan;
- KUP dan prosedur;
- transfer pricing;
- pajak internasional/P3B;
- kepabeanan/cukai;
- pajak daerah;
- perhitungan;
- pertanyaan temporal;
- pertanyaan multi-hop;
- pertanyaan ambigu;
- pertanyaan di luar cakupan;
- pertanyaan adversarial dan sumber yang saling bertentangan.

## 8. Urutan rilis yang disarankan

### Release 1 — Trusted core

- negative-query gate;
- trust layer pada semua chatbot;
- aturan prioritas memiliki source, PDF/hash/locator, status, dan version;
- graph edge prioritas direview;
- benchmark end-to-end menjadi release gate.

### Release 2 — Research parity

- universal search dan facet;
- detail regulation/decision yang konsisten;
- time machine dan compare version;
- save/highlight/folder terintegrasi;
- watchlist dan alert.

### Release 3 — Knowledge parity

- P3B/MLI;
- panduan dan FAQ internal;
- impact note;
- manual, glosarium, formulir, dan kurs.

### Release 4 — Tax Dispute OS

- evidence matrix;
- precedent navigator;
- drafting studio;
- case deadline/workflow;
- reviewer approval dan audit trail;
- portfolio analytics.

### Release 5 — Scale and enterprise

- persistent hybrid retrieval;
- full-corpus LightRAG/graph index dengan blue-green deployment;
- private enterprise knowledge;
- SSO/MFA, retention/legal hold, observability, backup, dan DR.

Dengan tim internal kecil yang fokus, Release 1–2 realistis dikerjakan sebagai program sekitar **8–12 minggu**. Parity pengetahuan dan kesiapan enterprise adalah program lanjutan, bukan sekadar penambahan UI; total yang masuk akal adalah **5–7 bulan**, tergantung kecepatan review ahli dan kelengkapan sumber resmi.

## 9. Keputusan produk yang disarankan

1. Jangan menjual AAJurist sebagai katalog terbesar sebelum coverage dan update SLA terukur.
2. Klaim yang aman dalam tahap sekarang: **retrieval peraturan kuat pada benchmark terbatas, jawaban bersumber, serta workflow sengketa dan review yang lebih mendalam**.
3. Jadikan status/temporal correctness, citation, dan abstention sebagai fitur produk yang terlihat—bukan mekanisme backend tersembunyi.
4. Kejar parity DDTC pada discovery, source navigation, versioning, dan research workspace.
5. Gunakan keunggulan AAJurist untuk menang pada pekerjaan setelah riset: evidence, argumentation, drafting, collaboration, dan auditability.
6. Semua konten editorial baru harus merupakan karya internal berbasis sumber resmi atau berlisensi; jangan menyalin koleksi berbayar platform lain.

## 10. Rekomendasi fokus langsung

Jika hanya tiga pekerjaan yang boleh dimulai sekarang, urutannya:

1. **Trusted current-law answer:** negative gate + temporal validator + citation gate pada seluruh jawaban.
2. **Regulation time machine:** source/PDF/version/history/related graph yang telah direview.
3. **Unified research workspace:** search, chat, detail, PDF, save/highlight, alert, dan matter dalam satu alur.

Tiga hal ini akan menaikkan AAJurist dari aplikasi AI dengan database menjadi produk riset pajak yang dapat dipakai berulang dan dipertanggungjawabkan.
