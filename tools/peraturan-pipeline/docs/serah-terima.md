# Serah-terima korpus peraturan perpajakan

Dokumen ini untuk pengembang berikutnya. Isinya bukan daftar fitur, melainkan
**hal-hal yang akan merusak korpus bila tidak diketahui** — masing-masing lahir
dari kesalahan yang sudah terjadi dan sudah diperbaiki.

## Checkpoint terverifikasi 26 Agustus 2026

- 29.592 dokumen; 28.935 memiliki badan teks.
- 1.117.374 unit dan 186.007 relasi.
- 132.088 relasi benar-benar terpaut (`JOIN regulation`).
- 165 relasi `external` menunjuk aturan sah yang belum ada di korpus; ini bukan
  kerusakan referensial dan tidak dihitung sebagai terpaut.
- Relasi internal dengan target tidak ada: 0.
- Pelanggaran hierarki aktif: 0.
- Pemeriksaan parsing langsung: 1.557 dari 28.935. Antrean lama sempat masih
  menampilkan 7.247; setelah `cli.py tinjau --bangun`, 5.690 kasus palsu
  ditutup sebagai `tidak_berlaku_lagi` tanpa dihapus.
- 21 endpoint GET, halaman utama, viewer, dan unduhan statistik menjawab 200.

Checkpoint ini adalah angka operasional yang harus dipakai saat memverifikasi
hasil restore di mesin baru.

---

## 1. Alamat lokal

| Apa | Alamat |
|---|---|
| Aplikasi | `http://127.0.0.1:8765` |
| Viewer satu peraturan | `http://127.0.0.1:8765/baca.html?reg_id=<id>&pasal=<n>&sorot=<istilah>` |
| Unduh statistik | `http://127.0.0.1:8765/unduh/statistik.xlsx` (`?segar=0` untuk berkas tersimpan) |
| Basis data | `data/peraturan.db` — SQLite, mode WAL, ±1,8 GB |
| Naskah HTML sumber | `data/raw_html/` |
| PDF resmi | `data/pdf/` — tertaut lewat tabel `attachment` |

Menjalankan:

```bash
cd peraturan-pipeline
./.venv/bin/python server.py --port 8765          # aplikasi
./.venv/bin/python cli.py --help                  # seluruh perintah
```

**Basis datanya bacalah dengan koneksi read-only** bila aplikasi Anda hanya
membaca:

```python
sqlite3.connect("file:data/peraturan.db?mode=ro", uri=True)
```

Server ini memakai `koneksi(tulis=False)` untuk seluruh rute GET, sehingga
aplikasi lain dapat menulis tanpa saling mengunci.

---

## 2. API

Seluruhnya GET, mengembalikan JSON, tanpa autentikasi (hanya mendengar di
localhost).

| Rute | Untuk |
|---|---|
| `/api/ringkas` | angka pokok korpus |
| `/api/cari?q=&jenis=&kategori=&as_of=&dicabut=&limit=` | penelusuran per pasal, berperingkat cakupan istilah |
| `/api/tanya?q=&jenis=&daerah=&tahun=&dicabut=` | penelusuran percakapan; membaca penyaring dari kalimat dan **melaporkan tafsirnya** |
| `/api/naskah?reg_id=` | seluruh naskah satu peraturan, tiap unit dengan kutipannya |
| `/api/pasal?reg_id=&pasal=&as_of=` | satu pasal beserta provenansinya |
| `/api/daftar-pasal?reg_id=` | daftar judul pasal |
| `/api/konteks?reg_id=` | riwayat (pencabutan/perubahan) dan peraturan terkait |
| `/api/peraturan?q=&jenis=&tahun=&daerah=&teks=&berkala=` | daftar peraturan |
| `/api/jenis`, `/api/daerah` | isi penyaring |
| `/api/hierarki`, `/api/hierarki/tangga`, `/api/hierarki/rincian` | kedudukan hukum tiap bentuk |
| `/api/graf?reg_id=` | ego-graf relasi |
| `/api/berkala*` | kurs dan tarif bunga per tanggal |
| `/api/qc`, `/api/tinjau`, `/api/tinjau/ringkas`, `/api/verifikasi/ringkas` | pemeriksaan mutu dan antrean tinjauan |

POST: `/api/tinjau/putuskan`, `/api/tinjau/batalkan`, `/api/tinjau/bangun`,
`/api/verifikasi/satu`.

---

## 3. Tabel yang penting

- **`regulation`** — satu baris per dokumen. `id` kunci kanonik, `canonical`
  **sebutan yang dapat dikutip** (bukan slug), `body_text` naskah, `source`
  asal, `sha256` sidik jari, `url` alamat sumber, `kategori` **daerah** untuk
  peraturan daerah, `berkala` menandai terbitan kurs/tarif.
- **`pasal`** — satu baris per unit terkecil (pasal, ayat, huruf, angka,
  diktum). `path` jalur baca, `bagian_dok` bagian dokumen, `seq` urutan.
- **`relation`** — relasi antar-peraturan. `dst_id` terisi **hanya** bila
  sasarannya ada di korpus, kecuali `method='external'`.
- **`validity`** — status keberlakuan hasil hitungan, beserta `reason`.
- **`attachment`** — berkas PDF, tertaut ke `reg_id`.
- **`temuan` / `perbaikan`** — antrean tinjauan dan jejak perbaikan yang dapat
  dibatalkan.
- **`katalog_luar`** — katalog sumber luar untuk analisis celah.

---

## 4. Yang akan merusak bila tidak diketahui

### 4.1 Identitas peraturan daerah WAJIB memuat daerahnya

"Perda 1 Tahun 2024" bukan identitas — setiap kabupaten punya satu. Pakai
`normalize.kunci_daerah()`, jangan `normalize_nomor()`, untuk bentuk daerah.
Daerah masuk ke medan `unit`: `perda-1-provinsi-bali-2024`.

Pada percobaan pertama tanpa ini: 28 identitas bertabrakan pada 532 dokumen,
56 naskah saling menimpa, tanpa satu pun galat.

### 4.2 `canonical` adalah sebutan, bukan kunci

12.145 dokumen pernah menyimpan slug di sana. Tidak ada angka yang turun; yang
rusak justru satu-satunya medan yang gunanya dipakai di luar sistem — orang
menempelkannya ke dokumen sebagai rujukan.

### 4.3 Membangun ulang relasi menghidupkan kembali pelanggaran hierarki

`relations.run_rules()` membangun ulang seluruh tabel, dan setiap relasi yang
mustahil menurut UU 12/2011 Pasal 7 kembali dengan keyakinan penuh. Antrean
tinjauan **tidak** menolongnya: temuannya sudah bertanda `auto_selesai`, jadi
dilewati.

`cli.py integrasi` menurunkan keyakinannya langsung sesudah `run_rules`,
idempoten. **Jangan panggil `run_rules` sendirian** — pakai `integrasi`.

### 4.4 Kunci unit harus menyertakan bagian dokumen dan urutan kemunculan

Dua tabrakan berbeda, keduanya diam:

- **Penjelasan menimpa batang tubuh.** Penjelasan Pasal 1 berkunci sama dengan
  batang tubuh Pasal 1 bila `bagian_dok` tidak ikut. 212 dari 400 dokumen
  sampel terkena.
- **Nomor pasal berulang di dalam satu dokumen.** PMK 72/2023 memuat "Pasal 3"
  dua kali. Tanpa pembeda urutan (`~2`, `~3`), 5.544 dokumen kehilangan 47.258
  unit.

Pembedanya urutan kemunculan, **bukan `seq`** — `seq` bergeser tiap kali
penguraian berubah, dan kunci yang bergeser memutus setiap rujukan lama.

### 4.5 Bentuk yang belum dipetakan tidak boleh dinilai

`profil.BAKU` dulu profil peraturan menteri, yang menuntut adanya pasal.
Akibatnya surat, instruksi, dan pengumuman — yang memang tidak berpasal —
dituduh gagal diurai: 5.077 temuan palsu, 25% korpus tampak rusak. Bakunya
sekarang `_TAK_DIKENAL`, yang tidak menyatakan apa pun. Bila menambah bentuk
baru, daftarkan di `profil.PROFIL`.

### 4.6 "Terpaut" berarti sasarannya ada di korpus

Bukan sekadar `dst_id IS NOT NULL`. 165 relasi bersumber repositori resmi
membawa kunci sasaran yang sah menurut hukum tetapi dokumennya tidak ada di
sini. Hitung dengan `JOIN regulation`.

### 4.7 Kelengkapan dihitung terhadap potongan, bukan seluruh himpunan

Dua kali kesalahan yang sama: penambalan nomor katalog berhenti karena
membandingkan jumlah global dengan total satu tahun; pencarian di dalam naskah
menggantung karena menggambar ulang seluruh dokumen padahal yang berubah
sebagian kecil. Bila menulis pemeriksaan kelengkapan, pastikan pembanding dan
yang dibandingkan berada pada lingkup yang sama.

### 4.8 Angka yang terpotong tidak boleh terbaca sebagai angka yang lengkap

Setiap penelusuran melaporkan `total` dari sumbernya dan membandingkannya
dengan yang benar-benar terambil. Itu satu-satunya hal yang membuat kehilangan
314 PMK terlihat. Pertahankan pola ini pada pengambilan apa pun yang Anda
tambahkan.

---

## 5. Sifat data yang perlu disampaikan ke pengguna akhir

- **Korpus ini transkripsi, bukan pindaian.** 338 dari 29.592 dokumen punya PDF
  resmi tersimpan. Untuk riset dan penelusuran relasi transkripsi lebih
  berguna; untuk pembuktian naskah ia bukan pengganti. Tiap baris menyimpan
  `url` dan `sha256` sehingga selalu dapat ditelusuri balik.
- **81% naskah berasal dari perantara** (Ortax, DDTC), 19% dari penerbitnya
  sendiri atau repositori resmi. Untuk bentuk terbitan DJP, HTML memang bentuk
  resminya — tidak ada pindaian yang "lebih asli".
- **Status keberlakuan adalah hitungan, bukan kutipan.** Dokumen yang
  pencabutnya belum ada di korpus akan terhitung berlaku. 322 dokumen
  dinyatakan dicabut oleh sumber lain sementara kita menghitungnya berlaku —
  arah kekeliruan yang paling berbahaya, dan sudah masuk antrean tinjauan.
- **Belum ada LLM yang dipakai sama sekali.** `tanya.susun_naratif()`
  menyiapkan sambungannya tetapi mati secara baku. Bila dinyalakan, dua penjaga
  wajib dipasang: rangkuman tidak boleh menyebut pasal yang tidak ada di
  temuan, dan bunyi pasalnya tetap ditampilkan di bawahnya.

---

## 6. Perintah yang sering dipakai

```bash
./.venv/bin/python cli.py integrasi        # urai, indeks, relasi, keberlakuan, tinjauan
./.venv/bin/python cli.py statistik        # tulis Excel statistik
./.venv/bin/python cli.py kurang           # apa yang masih kurang
./.venv/bin/python cli.py unduh-pdf        # antrean PDF resmi (--jalankan untuk mengunduh)
./.venv/bin/python cli.py ddtc --sisi daerah   # katalog & naskah DDTC
./.venv/bin/python cli.py ulang-ortax      # ambil ulang naskah Ortax yang menggumpal
```

**Sesudah menambah dokumen apa pun, jalankan `integrasi`.** Ia satu-satunya
jalan yang menjalankan kelima langkah dalam urutan yang benar.
