# AAJurist Wave 2 — Research Parity

Tanggal implementasi: 21 Agustus 2026

## Outcome

Wave 2 menyatukan pencarian, katalog sumber, riwayat versi peraturan, koleksi riset, dan pemantauan perubahan dalam scope tenant/client/matter. Seluruh fitur tetap memakai guard autentikasi dan entitlement di server.

## Fitur

### Universal search dan facet

- Satu endpoint untuk putusan dan peraturan.
- Facet: korpus, topik, otoritas, kesiapan sumber, status hukum, dan tahun.
- Filter `asOf` tetap diterapkan sebelum ranking.
- Exact citation lookup mendukung format `UU 8 Tahun 1983`, `PMK 131/2024`, dan `PER-7/PJ/2025`.
- Setiap hasil peraturan mempunyai tautan internal ke katalog, selain URL provenance resmi.

### Regulation time machine

- Menampilkan versi yang terhubung dan indikasi versi yang berlaku per tanggal analisis.
- Hanya edge graph dengan `verified=true`, `eligibleForAnswer=true`, dan tanpa flag yang boleh membentuk timeline/consolidation.
- Edge yang belum lolos review tetap dikarantina dan ditampilkan sebagai jumlah pending, bukan evidence jawaban.

### Consolidated law dan compare version

- Konsolidasi riset mematerialisasi ketentuan terbaru per pasal dari versi/relasi yang telah lolos review.
- Compare mengklasifikasikan pasal sebagai `added`, `removed`, `changed`, atau `unchanged`.
- Hasil diberi label tegas sebagai konsolidasi riset, bukan naskah konsolidasi resmi.

### Detail sumber

- Identitas aturan, status hukum, tanggal berlaku, otoritas, topik, source hash, status ekstraksi.
- Halaman resmi dan seluruh PDF yang terhubung.
- Locator pasal/halaman, key provision, graph relation, dan timeline.

### Workspace riset terintegrasi

- Search result: save dan highlight.
- Source detail: save, highlight, dan view history otomatis.
- Regulation Chat dan Smart Chat: jawaban bisa langsung disimpan/highlight.
- Regulation Chat dan Smart Chat mencatat chat history ke scope workspace aktif.

### Watchlist dan alert

- Pantau aturan spesifik, sitasi, topik, atau sekumpulan kata kunci.
- Fingerprint mencakup hash sumber, status hukum, tanggal berlaku, timestamp pembaruan, dan jumlah relasi.
- Alert: source changed, status changed, relation changed, atau new match.
- Alert diisolasi berdasarkan tenant/user/client/matter dan dapat di-acknowledge.
- Sinkronisasi dijalankan saat halaman watchlist dibuka dan tersedia tombol pemeriksaan manual. Scheduler/email/push eksternal belum diaktifkan dalam mode lokal.

## Benchmark parity

Artifact: `tests/evaluation/results/wave2-research-parity.json`

- 170 alur uji terhadap 10.822 record dan 157.917 search document/chunk.
- Exact lookup top-1: 100% pada 60 sampel sitasi aktual, termasuk format kompak PER dan format lama PMK.
- Facet expected-hit: 100%.
- Facet precision: 100%.
- Time-machine connected rate: 100% pada sampel edge eligible.
- Graph fail-closed: 100%.
- Internal detail coverage: 100%.
- Watch change detection: 100%.

Coverage PDF/hash/locator adalah ukuran kesiapan data, bukan gate yang dipoles. Sampel benchmark terakhir sebelum batch PDF berikutnya menunjukkan PDF 6,67%, hash 83,33%, dan locator 83,33%. Kekurangan PDF harus tetap diprioritaskan melalui antrean review dokumen Wave 1.

## Commands

```bash
npm run test:wave2
npm run eval:wave2
npm run test:trust
npm run test:workspace
npm run test:rag
npm run lint
npm run build
```

## Batasan yang tetap jujur

1. Konsolidasi bukan pengganti naskah resmi dan belum memahami instruksi perubahan parsial yang tidak memiliki locator pasal stabil.
2. Alert lokal belum mengirim email, Teams, atau push notification; deployment dapat menambahkan cron terjadwal pada endpoint sinkronisasi yang diamankan.
3. Universal search lokal masih memakai kontrak in-memory. Kontrak facet dan result siap dipindahkan ke PostgreSQL FTS/pgvector atau OpenSearch untuk skala produksi.
4. PDF coverage masih rendah sehingga halaman detail dapat menampilkan status antrean review alih-alih PDF.
