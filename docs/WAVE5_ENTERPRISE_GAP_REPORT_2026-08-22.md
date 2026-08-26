# Gelombang 5 — Enterprise Scale dan Gap Report

Tanggal pemeriksaan: 22 Agustus 2026 (Asia/Jakarta)

## Ringkasan eksekutif

Gelombang 5 sudah menghasilkan fondasi enterprise yang dapat dipakai dan diuji secara lokal, tetapi belum memaksakan komponen cloud yang belum memiliki provider, credential, persetujuan keamanan, atau anggaran. Tidak ada klaim bahwa sistem saat ini sudah HA, multi-region, atau memenuhi DR production.

| Kapabilitas | Status sekarang | Bukti aktual | Gap produksi utama |
|---|---|---|---|
| Persistent hybrid search | **Siap lokal / parsial secara hybrid** | 10.829 proyeksi persisten mengarahkan pencarian ke 157.924 chunk penuh; indeks 73.338.594 byte | Belum ada embeddings aktif, distributed FTS/vector, replication, dan blue/green reindex |
| Full-corpus LightRAG | **Parsial** | Manifest 10.822 aturan, SHA-256 `4e10b9085bff708b63f55d1691633271a6cadbc2644720a85816c62728860fe7` | Full ingestion belum dijalankan; pilot 58 dokumen tidak boleh diaktifkan; storage LightRAG masih lokal/non-HA |
| Queue | **Siap lokal** | Durable JSON queue dengan idempotency, lease, retry, delayed retry, dan dead-letter; payload menolak secret | Belum multi-worker/multi-node, belum ada broker/DB HA dan autoscaling worker |
| Object storage | **Siap lokal / parsial cloud** | Private filesystem deny-by-default dan jalur Vercel Blob telah ada | S3 adapter, KMS, versioning, lifecycle, replication, dan restore evidence belum tersedia |
| Observability & cost control | **Siap lokal** | Smart Chat dan Regulation Chat mencatat metadata, latency, estimasi token/biaya tanpa prompt; configurable warning/hard budget | Belum ada OTEL/APM terpusat, alert routing, immutable audit sink, dan rekonsiliasi invoice provider |
| SSO/MFA | **Gap** | Session lokal signed cookie; `TDP_MFA_REQUIRED` fail-closed terhadap claim `amr` | Belum ada OIDC callback/token validation, PKCE/state/nonce, SCIM/JIT, enrollment/recovery, dan break-glass |
| Retention | **Parsial, default nonaktif** | Jadwal per kategori, legal-hold override, dan disposition dry-run tersedia | Belum ada registry legal hold, approval deletion, purge worker, serta bukti penghapusan seluruh replica |
| Backup | **Siap lokal** | 6 file / 77.578.501 byte dibackup dan seluruh hash diverifikasi | Belum terenkripsi offsite, belum database PITR, belum cross-account/cross-region |
| Disaster recovery | **Parsial** | Restore rehearsal berhasil ke direktori sementara tanpa menimpa data aktif | Belum ada RPO/RTO formal, alternate region/account, DNS/failover, dan full production exercise |

## Hasil benchmark

Artefak: `tests/evaluation/results/wave5-enterprise.json`.

- Kasus exact lookup: **120**.
- Exact lookup top-1: **100%**.
- Hit@5: **100%**.
- Latency pencarian setelah corpus dimuat: **p50 9,19 ms**, **p95 26,17 ms** pada mesin lokal pengujian.
- Candidate hydration maksimum: **265 chunk**, dibanding corpus penuh **157.924 chunk**.
- Full-corpus manifest: **10.822 aturan**; **9.861 citation-ready**; **2.086 relasi graph**.
- Pilot LightRAG 58 dokumen sengaja gagal activation gate karena count/hash tidak cocok.
- Production build lulus. Masih ada satu warning nonfatal Turbopack/NFT pada dynamic quality-file path di route bantuan review peraturan; NFT route enterprise telah diperiksa dan tidak memuat private storage, backup, PDF, atau storage LightRAG.

Angka latency di atas adalah benchmark lokal, bukan SLA production. Waktu pemuatan corpus awal pada run benchmark sekitar 5,64 detik dan harus diganti oleh service/index persisten production yang selalu hangat.

## Yang sudah diimplementasikan

### Persistent search

- Indeks ditulis atomik dengan permission lokal terbatas.
- Satu proyeksi ringkas per instrumen dipakai untuk candidate generation.
- Candidate kemudian di-hydrate dari chunk/pasal sumber penuh dan diranking ulang; locator/trust tidak diambil dari proyeksi ringkas.
- Hash corpus mencegah indeks stale dipakai pada mode `required`.
- Mode `prefer` fallback aman ke search lama; mode `required` mengembalikan 503 bila indeks hilang/stale.
- Parser sitasi lama seperti `132/KMK.014/2000` dan subkode `SE-1/PJ.8/2000` telah diperbaiki.

### LightRAG

- Export contract canonical, text hash, source hash, status hukum, locator count, dan relation count tersedia.
- Manifest dibangun dari corpus lokal penuh, bukan 58 seed cards.
- Activation hanya lolos bila dokumen terproses dan corpus hash identik.
- JSONL penuh dapat dibuat eksplisit dengan `npm run build:lightrag-manifest -- --with-jsonl`, tetapi ingestion berbiaya besar tidak dijalankan tanpa storage production, provider budget, dan approval.

### Queue, observability, governance

- Generic enterprise job types: search reindex, LightRAG export/ingest, retention scan, backup, alert sync.
- Job payload membatasi ukuran dan menolak key yang menyerupai secret/token/password.
- Cost price tidak di-hard-code; operator memasukkan harga kontrak per satu juta token dan monthly ceiling.
- Hard budget bersifat opt-in dan menghentikan panggilan AI sebelum generation.
- Retention destructive sweep default `false`; legal hold selalu menang.
- MFA config default `false`; bila diaktifkan tanpa verified MFA claim, akses ditolak.

### Backup dan DR lokal

- Sumber backup dibatasi pada workspace metadata, private storage, persistent search index, dan LightRAG manifest.
- Symlink ditolak; setiap file memiliki SHA-256.
- Verifier membaca ulang seluruh file.
- Rehearsal restore hanya menuju temporary directory dan tidak pernah overwrite live data.

## Gap yang harus dikejar berikutnya

### P0 — sebelum data klien production

1. Implement OIDC SSO dengan library/provider yang diaudit, MFA enrollment/recovery, SCIM/JIT mapping, dan break-glass account.
2. Pilih private object storage production dengan KMS, versioning, lifecycle, malware scanning, signed short-lived URL, dan tenant prefix policy.
3. Terapkan tenant isolation di database dengan composite keys/RLS dan tes bypass lintas tenant.
4. Pindahkan persistent search ke PostgreSQL FTS + pgvector atau OpenSearch/vector engine; siapkan blue/green rebuild dan alias swap.
5. Gunakan secret manager dan workload identity; jangan menaruh static cloud credential di env aplikasi.

### P1 — sebelum skala worker dan full LightRAG

1. Ganti queue lokal dengan durable database/broker yang mendukung HA, visibility timeout, DLQ, idempotency, dan autoscaling worker.
2. Pilih storage LightRAG production untuk KV/document status, graph, dan vector; lakukan full ingestion 10.822 dokumen pada workspace versioned.
3. Jalankan benchmark retrieval dan answer end-to-end setelah full index, termasuk negative query, temporal/status, citation validator, PPh/PPN/TP, dan query bahasa Inggris.
4. Aktifkan OTEL/APM, structured logs, trace correlation, alert/error budget, dan billing reconciliation.
5. Tambahkan legal-hold registry, dual approval purge, dan deletion certificate.
6. Hilangkan warning dynamic file tracing pada route bantuan review peraturan dan tambahkan pemeriksaan NFT artifact sebagai CI gate.

### P2 — sebelum klaim DR dan enterprise SLA

1. Tetapkan RPO/RTO per layanan dan data class.
2. Aktifkan database PITR, object replication cross-region/cross-account, dan backup terenkripsi immutable.
3. Sediakan infrastructure-as-code untuk primary dan recovery environment.
4. Jalankan restore database, object, index, dan graph secara terjadwal; ukur durasi terhadap RTO.
5. Jalankan game day/failover penuh termasuk DNS, secret rotation, queue replay, dan komunikasi insiden.

## Keputusan activation saat ini

- Persistent search lokal: **boleh dipakai (`prefer`)**.
- Persistent search production serverless/multi-node: **belum**.
- Full-corpus LightRAG serving: **belum**; manifest siap, indeks aktif belum cocok.
- Queue lokal untuk development/admin job: **boleh**.
- Queue production terdistribusi: **belum**.
- Local private storage: **boleh untuk development pada disk yang dijaga operator**.
- Penyimpanan dokumen rahasia production: **belum sampai KMS/versioning/retention/restore dibuktikan**.
- SSO/MFA enterprise: **belum**.
- Backup lokal: **lulus verifikasi**.
- DR production: **belum**.
