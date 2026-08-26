# Serah-terima AA-Jurist ke Windows

Tanggal verifikasi: **26 Agustus 2026**.

## Isi yang dipindahkan

Source AA-Jurist dan source pipeline peraturan berada dalam satu Git repository.
Data besar sengaja tidak masuk Git:

- SQLite pipeline: `peraturan.db` sekitar 1,8 GB.
- Seluruh data pipeline: sekitar 2,2 GB.
- Runtime data AA-Jurist: sekitar 1,5 GB.
- Output evaluasi/graph: sekitar 505 MB.

`node_modules`, `.next`, `.venv`, cache, temporary render, dan secret **tidak
dipindahkan**. Semuanya dipasang atau dimasukkan ulang di Windows.

Masuk dengan akun Codex yang sama tidak memindahkan filesystem lokal. Git bundle
dan paket data inilah salinan yang dapat dipulihkan; GitHub menjadi salinan source
jarak jauh setelah commit didorong.

## Keadaan pipeline yang telah diverifikasi

- 29.592 dokumen; 28.935 memiliki naskah.
- 1.117.374 unit dapat ditelusuri.
- 186.007 relasi; 132.088 benar-benar terpaut ke dokumen dalam korpus.
- 165 target eksternal sah tidak ada di korpus; tidak dihitung sebagai terpaut.
- Relasi internal yang menunjuk target tidak ada: 0.
- Pelanggaran hierarki aktif: 0.
- Parsing aktif: 1.557 dari 28.935. Sebanyak 5.690 temuan lama yang timbul dari
  profil bentuk yang salah telah ditutup sebagai `tidak_berlaku_lagi`.
- 338 dokumen terhubung ke PDF resmi. Korpus tetap harus dilabeli sebagai
  transkripsi, bukan koleksi pindaian lengkap.

Seluruh 21 endpoint GET, halaman utama, viewer, dan unduhan statistik diuji dan
menjawab HTTP 200. Empat endpoint POST sengaja tidak dipanggil dalam smoke test
karena mengubah data; kontraknya diverifikasi dari routing server.

## Membuat paket dari Mac

Pasang drive eksternal dengan ruang kosong minimal **8 GB**, lalu dari repository:

```bash
chmod +x scripts/migration/export_to_windows.sh
./scripts/migration/export_to_windows.sh /Volumes/NAMA_DRIVE/AAJurist-Handoff
```

Script menggunakan SQLite Online Backup API sehingga salinan database konsisten,
menyalin data langsung ke drive tujuan, membuat Git bundle, dan menghitung SHA-256.
Nilai secret tidak disalin; hanya nama variabel yang perlu diisi ulang.

Jangan hapus data Mac sebelum proses restore Windows dan verifikasi checksum
selesai.

## Memulihkan di Windows

Prasyarat:

- Git.
- Node.js 20 atau lebih baru.
- Python 3.11 atau lebih baru dengan `py` launcher.
- PowerShell 7 direkomendasikan.

Jalankan PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& "E:\AAJurist-Handoff\handoff\restore_on_windows.ps1" `
  -TransferRoot "E:\AAJurist-Handoff" `
  -InstallRoot "C:\AAJurist" `
  -DataRoot "D:\AAJuristData"
```

Jika laptop hanya memiliki drive C, gunakan folder di C sebagai `DataRoot`.
Script membuat junction sehingga data besar tidak perlu berada di dalam working
tree Git.

## Environment yang harus dimasukkan ulang

Minimal untuk pengembangan chatbot:

- `OPENAI_API_KEY`
- `TDP_AUTH_SECRET`
- `TDP_REGULATION_PIPELINE_DB`
- `TDP_LOCAL_REGULATION_SNAPSHOT`

Sesuai modul yang diuji:

- `DATABASE_URL`/`POSTGRES_URL`
- `BLOB_READ_WRITE_TOKEN`
- `TAVILY_API_KEY`
- `CRON_SECRET`
- credential LightRAG bila diaktifkan

Jangan memindahkan `.env.local` tanpa enkripsi. Buat secret baru bila ada
kemungkinan drive transfer dapat diakses pihak lain.

## Menjalankan

Pipeline peraturan:

```powershell
$env:PERATURAN_DATA = "D:\AAJuristData\peraturan-pipeline"
.\tools\peraturan-pipeline\run-server.ps1 -Port 8765
```

AA-Jurist:

```powershell
$env:TDP_REGULATION_PIPELINE_DB = "D:\AAJuristData\peraturan-pipeline\peraturan.db"
npm run import:regulations
npm run quality:regulations
npm run eval:regulations:pipeline
npm run lint
npm run dev
```

Alamat pipeline: `http://127.0.0.1:8765`. Viewer:
`/baca.html?reg_id=<id>&pasal=<n>&sorot=<istilah>`.

## Penjaga data yang tidak boleh dihilangkan

1. Identitas peraturan daerah wajib memuat daerah.
2. `canonical` adalah sebutan, bukan slug/kunci.
3. Jangan memanggil `relations.run_rules()` sendiri; jalankan `cli.py integrasi`.
4. Kunci unit memuat bagian dokumen dan urutan kemunculan.
5. Bentuk tak dikenal tidak boleh dinilai dengan profil PMK.
6. Relasi terpaut berarti target ada melalui `JOIN regulation`.
7. Kelengkapan dihitung pada potongan yang sama.
8. Angka sumber yang terpotong tidak boleh dinyatakan lengkap.
9. Status keberlakuan adalah hasil hitungan dan harus membawa batasan sumber.
10. Ground truth buku tidak masuk primary legal RAG.

## Gate sebelum Mac dibersihkan

- SHA-256 Git bundle dan `peraturan.db` cocok dengan manifest.
- `npm ci`, `npm run lint`, dan production build berhasil di Windows.
- `/api/ringkas` mengembalikan 29.592 dokumen dan 132.088 relasi terpaut.
- `/api/qc?hanya=parsing_ganjil` mengembalikan 1.557.
- Import snapshot selesai tanpa memutasi database pipeline.
- Secret baru telah disimpan pada password manager.
- GitHub dan Vercel masih menunjuk commit yang sama.
