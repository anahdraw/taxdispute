# Gelombang 3 — Knowledge Parity

Tanggal audit: 21 Agustus 2026

## Hasil implementasi

Gelombang 3 menambahkan `Tax Knowledge Hub` pada `/knowledge` dengan tujuh domain:

1. P3B dan Multilateral Instrument (MLI).
2. Panduan transaksi, profesi, dan Coretax.
3. Tax manual.
4. Rekap perubahan berbasis graph.
5. Glosarium perpajakan.
6. Formulir.
7. Kurs pajak.

Knowledge Hub memakai endpoint lokal berotorisasi `/api/knowledge`. Setiap item membawa klasifikasi sumber, status bukti, status hukum, tanggal berlaku, locator, hash, tautan katalog internal, PDF (bila ada), dan tautan resmi. Manual edukatif selalu berstatus `reference_only`; manual tidak pernah dinaikkan menjadi sumber hukum primer. Rekap perubahan hanya menerima edge graph yang `verified`, `eligibleForAnswer`, dan tidak memiliki quality flag yang memblokir serving.

## Sinkronisasi sumber resmi yang sudah dijalankan

Pipeline `npm run sync:wave3` sekarang mengambil halaman sumber, memvalidasi signature file, membuat SHA-256, mengekstrak halaman PDF Coretax, dan menghasilkan snapshot ringkas untuk aplikasi. Hasil sinkronisasi 21 Agustus 2026:

- 72 mitra P3B/MLI dari matriks DJP, termasuk tanggal signing, entry into force, dan entry into effect.
- 21 PDF Buku Panduan Coretax DJP; 1.346 halaman teks dapat dicari dengan locator halaman.
- 85 file formulir PDF/XLS/XLSX/ZIP/RAR dari katalog DJP; 100% file memiliki checksum lokal.
- 25 baris kurs dari KMK 38/MK/EF.2/2026 untuk 19–25 Agustus 2026; PDF KMK, hash, nilai, unit, dan rentang berlaku terhubung.
- 107 file sumber resmi tersimpan di area audit lokal `outputs/knowledge-acquisition` (diabaikan Git); snapshot deployable berada di `content/official-knowledge`.

Katalog menyediakan detail internal `/knowledge/[id]` berisi provenance, checksum, metadata terstruktur, tautan resmi, file resmi, serta indeks halaman untuk manual Coretax. Formulir yang berhasil diunduh tidak otomatis dinyatakan aktif: field `activeStatus=not_asserted` dan `temporalReviewRequired=true` tetap memaksa review periode/aturan dasar.

## Benchmark aktual

Artefak: `tests/evaluation/results/wave3-knowledge-parity.json`

| Metrik | Hasil |
| --- | ---: |
| Kasus katalog | 140 |
| Hit@10 katalog | 100% |
| Skenario pencarian realistis | 17 |
| Hit@10 skenario realistis | 100% |
| Rekaman sumber | 10.805 |
| Aturan primer | 10.545 |
| Entri manual | 260 |
| Item knowledge | 7.040 |
| P3B/MLI | 277; 72 baris country matrix terstruktur |
| Manual Coretax resmi | 21 PDF / 1.346 halaman searchable |
| Panduan transaksi | 3.078 termasuk 11 workflow editorial baru |
| Panduan profesi | 210 termasuk 5 workflow editorial baru |
| Relasi perubahan eligible | 785 |
| Istilah glosarium | 50 |
| Formulir | 85 file resmi ter-hash + 668 referensi aturan |
| Kurs | 25 baris minggu berjalan + 1.539 instrumen historis |

Semua gate implementasi lulus: ukuran benchmark, retrieval, katalog treaty, tax manual, glosarium, pemisahan manual dari hukum, graph fail-closed, dan keterbukaan gap data.

## Apakah dokumen dan data sudah cukup?

Belum cukup untuk parity produksi. Cukup untuk pilot riset dengan guardrail.

| Domain | Status | Bukti audit | Kekurangan utama |
| --- | --- | --- | --- |
| P3B/MLI | Parsial | 72 mitra resmi terstruktur + 205 naskah/aturan terkait | Matching pasal, reservasi, dan notifikasi OECD belum diekspor; synthesized text bilingual belum lengkap. |
| Panduan/Coretax | Parsial | 21 manual resmi / 1.346 halaman + 16 workflow transaksi/profesi | Workflow editorial perlu review ahli dan perlu tambahan panduan untuk proses/industri yang belum tercakup. |
| Tax manual | Parsial | 260 Q&A; PDF/hash/locator 100% | Seluruh pasangan berasal dari satu buku. Perlu manual tambahan per industri/jenis pajak, versioning masa berlaku, dan review hukum. |
| Rekap perubahan | Parsial | 785 edge verified dan answer-eligible | Verifikasi saat ini terutama quality gate mesin/eksternal; sign-off ahli dan locator bukti relasi/transisi belum lengkap. |
| Glosarium | Parsial | 50 istilah dengan tautan sumber primer | Definisi editorial masih memerlukan sign-off ahli dan versioning. |
| Formulir | Parsial | 85/85 file resmi memiliki URL dan checksum | Tahun pajak/status aktif/aturan dasar belum tervalidasi ahli untuk seluruh file lama. |
| Kurs | Siap untuk minggu berjalan | 25/25 mata uang; KMK, PDF, checksum, locator, validFrom/validTo | Scheduled job produksi dan deteksi missing-week/revisi masih perlu infrastruktur persisten. |

Karena semua domain masih `partial`, `dataEnoughForProductionParity` sengaja bernilai `false`. Sistem tidak menampilkan KMK historis sebagai kurs “minggu ini” tanpa sinkronisasi resmi.

## Sumber resmi yang sudah dipetakan sebagai acquisition queue

- DJP — Tax Treaty and Multilateral Instrument: `https://www.pajak.go.id/id/taxtreaty-mli`
- OECD — BEPS MLI Matching Database: `https://www.oecd.org/en/data/tools/beps-mli-matching-database.html`
- DJP — Buku Panduan Coretax: `https://www.pajak.go.id/coretaxpedia/buku-panduan-coretax-djp`
- DJP — Formulir Perpajakan: `https://www.pajak.go.id/id/formulir-page`
- DJSEF Kementerian Keuangan — Kurs Pajak: `https://fiskal.kemenkeu.go.id/informasi-publik/kurs-pajak`

Empat connector pemerintah kini berstatus `catalogued`: matriks DJP P3B/MLI, manual Coretax, formulir DJP, dan kurs DJSEF. OECD MLI Matching Database tetap `not_ingested`, sehingga aplikasi tidak mengklaim bahwa pasangan pilihan/reservasi MLI sudah lengkap.

## Urutan pengadaan data yang disarankan

1. **MLI matching:** ekspor posisi, reservasi, notifikasi, dan matching outcome OECD; hubungkan ke 72 mitra DJP.
2. **Form review:** validasi status aktif, tahun pajak, aturan dasar, dan penggantian untuk 85 file; file yang belum ditandatangani reviewer tetap tidak disebut aktif.
3. **Scheduled kurs:** jalankan sinkronisasi mingguan pada storage persisten dan beri alert jika periode kosong, berubah, atau PDF berganti hash.
4. **Manual tambahan:** tambah tax manual resmi/berlisensi per jenis pajak, profesi, transaksi, dan industri agar ground truth tidak bergantung pada satu buku.
5. **Graph dan glosarium:** reviewer sign-off untuk relasi/definisi prioritas serta audit trail reviewer.

## Perintah verifikasi

```bash
npm run test:wave3
npm run eval:wave3
npm run lint
npm run build
```
