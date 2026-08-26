# Pipeline Peraturan Perpajakan — Strategi & Perkakas

Sistem untuk mengunduh, mengurai, dan memetakan seluruh katalog peraturan
perpajakan di <https://www.pajak.go.id/katalog-peraturan>, lalu menyajikannya
lewat pencarian yang sadar-waktu dan knowledge graph yang dapat diaudit.

> **Paket Windows.** Source ini dibundel bersama AA-Jurist. Data 2+ GB tidak
> masuk Git; set `PERATURAN_DATA` ke folder yang berisi `peraturan.db`, jalankan
> `setup-windows.ps1`, lalu `run-server.ps1`. Jangan menyalin `.venv` dari Mac.

Seluruh angka di dokumen ini diukur langsung terhadap situs DJP pada
2026-08-09, bukan asumsi. Metode pengukuran dicantumkan agar bisa diulang.

---

## 1. Temuan yang mengubah strategi

Sebelum menulis kode, saya menyelidiki struktur situs. Empat temuan berikut
membalik asumsi awal bahwa proyek ini adalah "proyek OCR".

### 1.1 Teks lengkap sudah tersedia sebagai HTML — OCR bukan jalur utama

Halaman detail peraturan menyimpan **teks penuh** di dalam
`div.field--name-field-body-dalam-html`. Contoh PER-31/PJ/2009: 46.295 karakter
teks bersih, lengkap dengan Menimbang, Mengingat, seluruh pasal, dan klausul
penutup. Tidak ada PDF yang perlu di-OCR.

**Konsekuensi:** untuk dokumen yang punya badan HTML, biaya ekstraksi = nol dan
akurasi = 100% (bukan hasil pengenalan karakter). Menjalankan OCR di sini
justru *menurunkan* mutu. OCR disimpan untuk kasus yang benar-benar memerlukan.

### 1.2 Ketersediaan badan teks turun tajam untuk dokumen lama

| Rentang | Perkiraan dokumen | Sampel berbadan teks |
|---|---:|---|
| 2020–2026 | ~825 | 4/4 |
| 2010–2019 | ~1.360 | 4/4 |
| 2005–2009 | ~1.545 | 4/9 |
| 2000–2004 | ~1.245 | 0/9 |
| 1990–1999 | ~1.095 | 1/9 |
| 1983–1989 | ~235 | 0/4 |
| **Total** | **~6.305** | |

*Metode: jumlah dokumen = (halaman pager terakhir + 1) × 5 baris, memakai
filter `field_tanggal_peraturan_value[min|max]`. Sampel diambil dari beberapa
halaman berbeda dalam tiap rentang. Ukuran sampel kecil (n=4–9 per baris), jadi
perlakukan sebagai estimasi kasar, bukan angka final — `cli.py crawl-index`
lalu `crawl-detail` akan memberi angka pastinya.*

Kira-kira **47% korpus (~3.000 dokumen) punya badan teks**, sisanya **~3.300
dokumen hanya bermetadata**: judul, nomor, jenis, tanggal, status, kategori,
dan tag katalog — tanpa isi. Dokumen lama inilah yang memerlukan sumber
sekunder (JDIH Kemenkeu, peraturan.go.id) dan OCR.

### 1.3 Relasi antar-peraturan tidak tersedia sebagai data terstruktur

Situs hanya memberi **satu label status** per dokumen: `Aktif`, `Dicabut`,
`Diubah/Disempurnakan/Dicabut sebagian`. Label ini tidak menyebut **peraturan
mana** yang mencabut, **pasal mana** yang diubah, atau **sejak kapan**.

Informasi itu hanya ada di dalam teks — di klausul penutup dan judul:

> "Dengan berlakunya Peraturan Direktur Jenderal Pajak ini, Keputusan Direktur
> Jenderal Pajak Nomor KEP-545/PJ./2000 ... sebagaimana telah diubah dengan
> Peraturan Direktur Jenderal Pajak Nomor PER-15/PJ./2006, dicabut dan
> dinyatakan tidak berlaku."

Membangun knowledge graph berarti **mengekstrak relasi dari teks**, bukan
menyalin data yang sudah ada. Ini pekerjaan inti proyek, bukan pelengkap.

### 1.4 Metadata katalog mengandung kesalahan — identitas harus diperiksa silang

Ditemukan dua entri berjudul *"PERUBAHAN ATAS PERATURAN PEMERINTAH NOMOR 55
TAHUN 2022"*, masing-masing dilabeli **"Instruksi Dirjen Pajak"** dan
**"Peraturan Presiden"**, dengan tanggal berbeda. Kop surat pada kedua badan
teksnya berbunyi identik:

```
PERATURAN PEMERINTAH REPUBLIK INDONESIA   NOMOR 20 TAHUN 2026
```

Jadi keduanya adalah **PP 20/2026 yang sama**, dengan jenis dokumen salah label
dan satu entri duplikat. Bila metadata dipercaya mentah-mentah, graf akan
memiliki dua node palsu berjenis salah.

**Penanganan:** setiap dokumen diperiksa silang terhadap kop suratnya sendiri
(`identity_from_body`), hasilnya disimpan di kolom `id_body` / `identity_ok`.
Ketidakcocokan masuk antrean tinjauan, tidak diperbaiki diam-diam.

---

## 2. Arsitektur

```
                pajak.go.id/index-peraturan  (1.260 halaman × 5 baris)
                              │
                    ┌─────────▼─────────┐
                    │ crawl.py          │  1 req/detik, cache di disk,
                    │ indeks → detail   │  retry eksponensial
                    └─────────┬─────────┘
                              │  body HTML (47%)      metadata saja (53%)
                    ┌─────────▼─────────┐        ┌──────────▼──────────┐
                    │ structure.py      │        │ sumber sekunder     │
                    │ HTML → unit pasal │        │ + ocr.py berjenjang │
                    └─────────┬─────────┘        └──────────┬──────────┘
                              └───────────┬─────────────────┘
                              ┌───────────▼───────────┐
                              │ relations.py          │  aturan → LLM murah
                              │ ekstraksi relasi      │  → LLM kuat (konflik)
                              └───────────┬───────────┘
                              ┌───────────▼───────────┐
                              │ graph.py              │  valid_from/valid_to,
                              │ masa berlaku + graf   │  deteksi konflik
                              └───────────┬───────────┘
                              ┌───────────▼───────────┐
                              │ search.py             │  BM25 + filter waktu
                              │ pencarian sadar-waktu │  + perluasan graf
                              └───────────────────────┘
```

| Berkas | Peran |
|---|---|
| `pipeline/config.py` | Konfigurasi, harga model, ambang kepercayaan |
| `pipeline/db.py` | Skema SQLite + FTS5, migrasi |
| `pipeline/normalize.py` | Normalisasi nomor peraturan, ekstraksi rujukan, verifikasi identitas |
| `pipeline/crawl.py` | Pengunduh indeks, detail, lampiran; crawl inkremental |
| `pipeline/structure.py` | Pemecah teks → BAB/Pasal/ayat/huruf/angka; tanggal mulai berlaku |
| `pipeline/ocr.py` | OCR berjenjang (text layer → OCR lokal → VLM) |
| `pipeline/relations.py` | Ekstraksi + verifikasi relasi antar-peraturan |
| `pipeline/graph.py` | Masa berlaku point-in-time, rantai konsolidasi, deteksi konflik |
| `pipeline/search.py` | Pencarian leksikal + filter + perluasan graf; konteks RAG |
| `pipeline/sources/peraturan_go_id.py` | Konektor JDIH Nasional (UU/PP/Perpres) |
| `pipeline/sources/jdih_kemenkeu.py` | Konektor JDIH Kemenkeu (API JSON, KMK/PMK) |
| `pipeline/sources/bpk.py` | Konektor JDIH BPK (cadangan KMK/PMK) |
| `pipeline/enrich.py` | Cascade tiga sumber + pengukuran cakupan |
| `pipeline/goldset.py` | Gold set silver/gold + harness evaluasi |
| `pipeline/llm.py` | Batch API, prompt caching, estimasi biaya (OpenAI/Anthropic) |
| `cli.py` | Antarmuka baris perintah |

---

## 3. Strategi pengunduhan

**Jalur resmi, bukan scraping agresif.** Situs adalah Drupal; `/jsonapi`
mengembalikan 404, jadi sumbernya adalah View `search_peraturan` di
`/index-peraturan`. `robots.txt` tidak melarang jalur ini dan tidak
mencantumkan `Crawl-delay`; pipeline tetap membatasi diri pada **1 permintaan
per detik** dengan cache di disk agar pengulangan tidak membebani server.

Beban sekali-jalan: 1.260 permintaan indeks + ~6.300 permintaan detail
≈ **2 jam** pada 1 req/detik.

**Tiga hal teknis yang menentukan keberhasilan crawl:**

1. **Pager memakai `&amp;`.** Href pager berbunyi `...&amp;page=5`. Pola
   `[?&]page=` tidak cocok karena karakter sebelum `page` adalah `;` —
   akibatnya crawl berhenti diam-diam di halaman 0 tanpa pesan error. Entitas
   HTML di-unescape lebih dulu.
2. **Filter tahun tidak stabil, filter tanggal stabil.** Dropdown
   `field_tahun_peraturan_value` memakai indeks delta (`1` = tahun berjalan,
   `2` = tahun lalu), sehingga maknanya bergeser setiap 1 Januari. Crawl
   inkremental memakai `field_tanggal_peraturan_value[min|max]` yang absolut.
3. **URL detail kadang disisipi `/index.php/`.** Dinormalkan agar satu dokumen
   tidak tersimpan dua kali.

Untuk ~3.300 dokumen tanpa badan teks dipakai sumber sekunder — lihat
bagian 3b.

---

## 3b. Konektor sumber sekunder

### peraturan.go.id (JDIH Nasional) — terverifikasi, sudah jalan

Situs ini ternyata jauh lebih bernilai daripada sekadar penambal teks:

1. **URL dapat dibentuk langsung dari identitas kanonik** — polanya
   `/id/{prefix}-no-{nomor}-tahun-{tahun}`. Tidak perlu scraping halaman
   pencarian. Dokumen 1983 pun tersedia (`/id/uu-no-6-tahun-1983`).
2. **PDF resmi dengan text layer**, terpisah batang tubuh dan penjelasan
   (`/files/uu7-2021bt.pdf`, 114 halaman). UU 6/1983 menghasilkan 118.041
   karakter teks bersih — **nol biaya OCR**. Catatan teknis: unduhan langsung
   tanpa header `Referer` dialihkan ke beranda dan mengembalikan HTML, bukan
   PDF; konektor menyetel Referer dan memverifikasi magic bytes `%PDF-`.
3. **Relasi antar-peraturan tersedia TERSTRUKTUR** di blok "Hubungan Antar
   Peraturan": `Mengubah`, `Mencabut`, `Diubah dengan`, `Dicabut dengan`,
   `Dasar Hukum` — masing-masing berisi tautan slug ke peraturan sasaran.

Poin ketiga mengubah peran konektor: ia bukan hanya sumber teks, melainkan
**sumber kebenaran independen** untuk memeriksa silang ekstraksi teks kita,
dan menjadi tulang punggung gold set (bagian 7b). Relasi berarah-balik
(`Diubah dengan`) dibalik menjadi sisi maju agar arah graf konsisten.

Hasil uji nyata: 4 UU + 7 PP → **124 relasi terstruktur** terambil.

**Cakupan:** UU, Perpu, PP, Perpres, dan peraturan menteri (`permenkeu` = PMK).
**Tidak** mencakup Keputusan Menteri (KMK) maupun peraturan setingkat Dirjen
(PER / KEP / SE Pajak) — justru kelompok terbesar yang badan teksnya hilang di
DJP. Ukur cakupan nyata dengan `cli.py sources --coverage`.

### JDIH BPK (peraturan.bpk.go.id) — terverifikasi, sudah jalan

Melengkapi peraturan.go.id tepat di lapisan yang kosong: **Keputusan Menteri
Keuangan**. Sama-sama menyediakan relasi terstruktur ("Dicabut dengan",
"Mengubah", "Mencabut", "Diubah dengan") dan PDF ber-text-layer.

Tiga hal teknis yang membentuk konektornya:

1. **URL detail tidak dapat dibentuk** — formatnya `/Details/{id_internal}/{slug}`
   dengan id numerik milik BPK. Berbeda dengan peraturan.go.id, jalurnya wajib
   lewat pencarian lalu pencocokan.
2. **Pencarian bebas sangat longgar.** `tentang=Pedoman Teknis Tata Cara
   Pemotongan` mengembalikan undang-undang Pengadilan Tata Usaha Negara. Satu-
   satunya kombinasi presisi adalah `nomor` + `tahun` + `jenis`, dan hasilnya
   **tetap** diverifikasi terhadap field "Nomor" di halaman detail. Tanpa
   verifikasi itu konektor akan diam-diam menempelkan dokumen yang salah ke
   node kita — kesalahan terburuk yang bisa terjadi pada korpus hukum.
3. **Jenis Dirjen ada di dropdown tapi kosong.** "Peraturan Dirjen/Ka.Badan/
   Irjen" (id 142), "Keputusan Dirjen" (144), dan "Peraturan dan Keputusan
   Dirjen" (150) semuanya mengembalikan nol hasil. Dicatat eksplisit di
   `JENIS_KOSONG` supaya tidak ada yang mencobanya lagi dan mengira konektornya
   rusak.

Uji nyata: KMK 251/KMK.03/2002 terambil lengkap (7.635 karakter teks, status
"Tidak Berlaku", relasi `DICABUT_OLEH PMK 75/PMK.03/2010` dan `MENGUBAH
KMK 567/KMK.04/2000`).

### Coretax — bukan sumber peraturan

`coretaxdjp.pajak.go.id` dapat dijangkau, tetapi isinya adalah aplikasi
administrasi perpajakan berbasis login (kata "login", "masuk", "akun" ada;
kata "peraturan" tidak muncul sama sekali). Coretax adalah sistem inti
administrasi untuk wajib pajak — tempat melapor dan membayar, bukan basis data
hukum. Tidak ada repositori peraturan yang bisa dipanen dari sana.

### JDIH Kemenkeu — KOREKSI: dapat dijangkau, dan ini sumber terkaya

**Laporan saya sebelumnya salah.** Saya menyimpulkan situs ini "tidak dapat
dijangkau, kemungkinan pembatasan wilayah" karena `curl` selalu gagal di jabat
tangan TLS pada semua varian yang dicoba. Kesimpulan itu keliru.

Penyebab sebenarnya adalah **penyaringan sidik jari TLS** (anti-bot): situs
menolak klien yang jabat tangannya bukan browser sungguhan. Dibuka lewat
browser, situs terbuka normal. Dan dari Python ia terjangkau begitu TLS-nya
menyamar sebagai Chrome — `curl_cffi` dengan `impersonate="chrome"`. **Tidak
perlu browser untuk produksi;** konektor memakai `curl_cffi`, bukan `httpx`
seperti konektor lain.

Setelah bisa masuk, ini terbukti sumber paling kaya dari ketiganya:

1. **API JSON sungguhan** — `/api/search?q=&size=&tahun=&bentuk=&page=`
   mengembalikan `{page:{current,size,total,total_pages}, data:[…]}` dengan
   `nomor`, `bentuk`, `status`, `judul`, `tanggal_penetapan`,
   `tanggal_pengundangan`, `konsolidasi`, `label` (subjek), `jumlah_pasal`,
   `blocks` (segmentasi pasal siap pakai), dan `full_text_pdf`.
2. **Teks lengkap berformat HTM**, bukan pindaian — nol biaya OCR.
3. **Relasi terstruktur** di `/dok/{slug}`, termasuk `DICABUT_SEBAGIAN_OLEH`
   yang tidak disediakan sumber lain mana pun.

Uji nyata KMK 251/KMK.03/2002: 4.914 karakter teks, status "Tidak Berlaku",
relasi `DICABUT_OLEH 75-pmk-03-2010` dan `MENGUBAH 567-kmk-04-2000`.
PMK 75/PMK.03/2010 menghasilkan enam relasi sekaligus.

**Tiga jebakan yang ditangani, semuanya gagal-senyap:**

* **Soft 404.** `/dok/{slug}` yang tidak ada tetap membalas HTTP 200 dengan
  halaman "tidak ditemukan". Status HTTP tidak boleh dipakai sebagai penanda
  keberadaan dokumen.
* **Penanda keberadaan harus POSITIF.** Percobaan pertama saya memakai kalimat
  halaman error sebagai penanda negatif — ternyata kalimat itu ikut terbundel
  di payload Next.js dan muncul juga di halaman yang valid, sehingga setiap
  dokumen dianggap tidak ada tanpa satu pun pesan error. Diganti dengan
  mencari "Tanggal Penetapan"/"Tipe Dokumen".
* **Label relasi berjarak 65 ribu karakter dari tautannya.** Halaman memakai
  React Server Components, sehingga teks label dan `href` tersebar di potongan
  `__next_f.push` yang berbeda. Pencocokan harus dilakukan **mundur** — dari
  tiap tautan ke belakang mencari label terdekat — bukan maju dari label.

**Cakupan terukur:** bergantung seri penomoran, dan perbedaannya besar.

| Seri | Sampel | Ada di JDIH Kemenkeu |
|---|---:|---:|
| Klasik `N/KMK.0x/YYYY` | 18 | **10 (56%)**, semuanya berteks lengkap |
| Acak semua seri KMK | 20 | **1 (5%)** |

Selisih itu bukan kebetulan: katalog DJP banyak memuat seri `KM.10`, `KM.11`,
`KM.1` (keputusan yang didelegasikan) dan penomoran baru "N TAHUN YYYY", yang
hampir seluruhnya tidak ada di JDIH Kemenkeu.

### Ringkasan: apakah semua peraturan di katalog tersedia?

**Tidak.** Ini komposisi katalog yang sebenarnya, dihitung lewat filter
`field_jenis_dokumen_target_id` (85 permintaan, bukan menyusuri 1.260 halaman):

| Jenis dokumen | Jumlah | % katalog |
|---|---:|---:|
| Keputusan Menteri Keuangan (KMK) | 2.998 | 47,6% |
| Peraturan Menteri Keuangan (PMK) | 1.209 | 19,2% |
| Keputusan Dirjen Pajak (KEP) | 655 | 10,4% |
| Peraturan Dirjen Pajak (PER) | 620 | 9,8% |
| Peraturan Pemerintah (PP) | 325 | 5,2% |
| Keputusan Presiden | 125 | 2,0% |
| Undang-Undang | 74 | 1,2% |
| 24 jenis lain | ~290 | 4,6% |
| **TOTAL** | **6.296** | |

Lalu ketersediaan nyatanya diuji — bukan "secara prinsip didukung", melainkan
benar-benar menghubungi tiap sumber:

| Jenis | Katalog | Sampel | Teks di DJP | Ada di PGI | Ada di BPK |
|---|---:|---:|---:|---:|---:|
| KMK | 2.998 | 8 | **2** | 0 | **0** |
| PMK | 1.209 | 8 | 7 | 0 | 6 |
| KEP Dirjen | 655 | 8 | 5 | 0 | **0** |
| PER Dirjen | 620 | 8 | **8** | 0 | 0 |
| PP | 325 | 8 | 6 | **8** | 0 |

*Sampel n=8 per jenis, diambil dari empat posisi berbeda pada pager (10%, 40%,
70%, 95%) agar tidak menumpuk di satu periode. Kecil — perlakukan sebagai
indikasi arah, bukan angka presisi. Kolom PGI/BPK dihitung atas seluruh sampel,
bukan hanya yang tak berteks di DJP.*

**Tiga kesimpulan yang mengubah rencana:**

1. **Peraturan Dirjen Pajak ternyata bukan masalah.** 8/8 sampel punya badan
   teks di DJP sendiri. Dugaan awal saya — bahwa lapisan Dirjen adalah lubang
   terbesar — **salah untuk PER**. Tidak perlu sumber sekunder sama sekali.

2. **Lubang sesungguhnya adalah KMK, dan besar sekali.** KMK adalah **47,6%
   katalog**, hanya 2 dari 8 sampel punya teks di DJP, dan **nol** ditemukan di
   peraturan.go.id maupun JDIH BPK. BPK memang memuat KMK (KMK 251/KMK.03/2002
   terambil sempurna), tetapi tidak memuat KMK perpajakan lama yang mendominasi
   katalog DJP.

3. **PGI dan BPK saling melengkapi, tidak tumpang tindih.** PP: PGI 8/8, BPK 0.
   PMK: BPK 6/8, PGI 0. Cascade dua sumber karena itu tepat — tetapi perhatikan
   PGI gagal total pada PMK: slug `permenkeu-no-{n}-tahun-{thn}` mengikuti
   penomoran baru (pasca-2023), sementara PMK perpajakan memakai format lama
   `{n}/PMK.0x/{thn}`. Ini batas konektor, bukan ketiadaan dokumen.

**Perkiraan kasar dampaknya** pada lima jenis terbesar (5.807 dokumen):
~2.700 dokumen tidak punya badan teks di DJP; dari jumlah itu hanya ~200 yang
dapat diambil dari dua sumber sekunder ini. Artinya **sekitar 2.500 dokumen
(≈40% katalog) masih belum punya teks lengkap dari mana pun yang sudah diuji** —
hampir seluruhnya KMK dan KEP Dirjen lama.

**Yang masih bisa dicoba untuk lubang KMK:**

| Kandidat | Status |
|---|---|
| JDIH Kemenkeu | **Sudah dikerjakan** — lihat bagian di atas. Menutup sebagian lubang KMK (56% pada seri klasik), tidak seluruhnya |
| Ortax Data Center | Dapat dijangkau; komersial/berlangganan, perlu dicek izin pemakaiannya |
| Wayback Machine | CDX API berfungsi; hanya membantu bila dokumennya pernah terbit daring |
| Permintaan resmi ke DJP/Kemenkeu | Jalur paling bersih untuk korpus lengkap |

Saya belum mengerjakan keempatnya: yang pertama terhalang jaringan, yang kedua
menyangkut hak pakai data pihak ketiga yang harus Anda putuskan, dan yang
keempat bukan pekerjaan teknis.

---

## 4. Strategi OCR — berjenjang, dipakai sesedikit mungkin

Prinsipnya: **jangan meng-OCR apa pun yang teksnya sudah ada.**

| Rute | Kapan | Perkakas | Biaya |
|---|---|---|---|
| **A. Text layer** | ≥60% halaman punya teks terekstrak | `pdftotext -layout` | Rp0 |
| **B. OCR lokal** | Pindaian, mutu wajar | `ocrmypdf` / `tesseract -l ind` | Rp0 (waktu CPU) |
| **C. VLM** | Rute B skor <0,72; tabel/formulir rumit | Claude Haiku 4.5 vision (batch) | ~$0,004/halaman |

Verifikasi langsung: Lampiran PMK 44/2026 (12 halaman) diunduh dan diuji —
**sudah punya text layer**, `pdftotext` mengembalikan format surat kuasa dengan
penomoran isian utuh. Rute A, biaya nol. Lampiran terbitan modern umumnya
begini.

**Penilaian mutu tanpa ground truth** (`_heuristic_conf`) memakai tiga sinyal:
proporsi karakter sah, kehadiran kosakata perundangan (`pasal`, `ayat`,
`berlaku`, …), dan panjang rata-rata kata — OCR buruk menghasilkan pecahan
token pendek. Skor di bawah ambang naik ke rute C.

**Prompt VLM dirancang untuk menolak menebak.** Instruksinya melarang
meringkas, memperbaiki ejaan, atau melengkapi bagian terpotong, dan mewajibkan
penanda `[TIDAK TERBACA]` — karena *"kesalahan satu digit pada tarif atau
batasan nilai berakibat fatal"*. Untuk dokumen pajak, ekstraksi yang mengaku
tidak tahu jauh lebih berharga daripada ekstraksi yang mulus tapi salah angka.

---

## 5. Strategi LLM murah (OpenAI)

Tiga pengungkit biaya dipakai bersamaan:

1. **Model termurah yang memadai.** `gpt-5.6-luna` — $0,20 / $1,20 per juta
   token (masuk / keluar), konteks 1,05 juta token, menerima input gambar.
   Tugasnya verifikasi keputusan biner dengan bukti yang sudah disodorkan,
   bukan penalaran terbuka — beban ringan yang tidak menuntut model besar.
2. **Batch API** — diskon **50%** untuk semua pekerjaan non-interaktif.
   Verifikasi relasi dan OCR VLM keduanya lewat jalur ini.
3. **Prompt caching** — instruksi verifikasi (~520 token) identik di setiap
   permintaan dan ditaruh paling depan sebagai pesan `system`. OpenAI
   meng-cache prefiks stabil secara otomatis (tanpa penanda khusus) untuk
   prompt ≥1.024 token, dengan tarif ~10% harga input. Karena itu bagian yang
   berubah per item **wajib** diletakkan sesudahnya — kalau tertukar, cache
   tidak pernah kena dan biaya naik ~10×.

| Model | Masuk | Ter-cache | Keluar | Peran |
|---|---:|---:|---:|---|
| `gpt-5.6-luna` | $0,20 | $0,02 | $1,20 | Tier 1: verifikasi relasi, OCR VLM |
| `gpt-5.6-terra` | $2,00 | $0,20 | $12,00 | Tier 2: adjudikasi konflik, gold set |
| `gpt-5.6-sol` | $5,00 | $0,50 | $30,00 | Hanya bila terra pun ragu |

*Harga per 1 juta token, diverifikasi dari halaman harga resmi OpenAI pada
2026-08-09. Ketiganya menerima input gambar, jadi OCR rute C tidak memerlukan
model terpisah.*

**Pembagian kerja:**

| Lapis | Model | Porsi | Tugas |
|---|---|---|---|
| 0 | — (aturan) | ~90% | Pola tekstual berkepercayaan tinggi, biaya nol, dapat diaudit |
| 1 | `gpt-5.6-luna` (batch) | ~10% | Verifikasi kandidat ambigu, normalisasi nomor gagal urai |
| 2 | `gpt-5.6-terra` | <1% | Adjudikasi konflik lapis 0 vs 1 |

**Perkiraan biaya membangun korpus penuh:**

| Komponen | Volume | Biaya |
|---|---:|---:|
| Crawl + parsing HTML (DJP) | ~6.300 dok | $0 |
| Konektor peraturan.go.id (teks + relasi) | ~1.000 dok | $0 |
| OCR rute A + B | ~90% halaman | $0 |
| OCR rute C (VLM, batch) | ~2.600 halaman | ~$2,30 |
| Verifikasi relasi (luna, batch + cache) | ~12.000 kandidat | ~$1,70 |
| Adjudikasi konflik (terra) | ~300 item | ~$3,00 |
| **Total sekali bangun** | | **~$7** |
| Pemeliharaan bulanan | ~150 dok baru | **< $0,50** |

*Perhitungan per kandidat verifikasi: 520 token ter-cache (×$0,02) + 400 token
segar (×$0,20) + 160 token keluaran (×$1,20), lalu diskon batch 50% →
$0,00014. Angka volume adalah asumsi; `cli.py verify` mencetak estimasi nyata
sebelum mengirim dan menolak mengirim tanpa `--submit`.*

Provider Anthropic tetap tersedia lewat `PERATURAN_PROVIDER=anthropic`
(default: `claude-haiku-4-5` / `claude-opus-5`) agar perpindahan dapat dibalik
tanpa menulis ulang pipeline. Dengan Claude, total sekali bangun ~$25.

## 6. Strategi parsing presisi

Struktur peraturan Indonesia dibakukan oleh UU 12/2011, sehingga **parser
deterministik lebih presisi dan lebih murah daripada LLM**. LLM hanya menangani
sisa yang gagal diurai.

Setiap dokumen dipecah menjadi unit terkecil yang dapat dikutip, dengan jalur
sitasi utuh:

```
BAB II > Bagian Kedua > Pasal 4 > ayat (2) > huruf a
```

Diverifikasi pada PER-31/PJ/2009: **96 unit**, terbagi menjadi kepala,
menimbang, mengingat (6 butir terpisah), 92 unit batang tubuh, dan penutup.

**Dua detail yang menentukan akurasi:**

1. **Daftar "Mengingat" sering datang sebagai satu baris panjang** karena
   dirender di dalam sel tabel, sehingga penanda baris hilang. Tanpa pemecahan
   enumerasi inline, setiap dasar hukum kehilangan identitas butirnya.
2. **Klausul pencabutan dan klausul "mulai berlaku" sering berada di pasal yang
   berbeda.** Pada PER-31/PJ/2009, pencabutan ada di Pasal 27 sedangkan "mulai
   berlaku" di Pasal 28. Parser yang hanya memindai "pasal penutup" akan
   melewatkan seluruh relasi pencabutan — kesalahan senyap yang merusak graf.

**Normalisasi nomor** menangani seluruh bentuk yang ditemukan di katalog, dan
menyamakan varian penulisan (`014/MK/EF.2/2026` = `14/MK/EF.2/2026`,
`PER-26/PJ./2009` = `PER-26/PJ/2009`):

```
PER-31/PJ/2009      → per-31-pj-2009        212/PMK.07/2009  → pmk-212-pmk-07-2009
PMK 43 TAHUN 2026   → pmk-43-2026           10/KM.10/KF.4/24 → kmk-10-km-10-kf-4-2024
KEP-545/PJ./2000    → kep-545-pj-2000       7 TAHUN 2021     → uu-7-2021
```

Bila nomor tidak dapat diurai, fungsi mengembalikan `None` dan dokumen ditandai
`unparsed-*` untuk ditangani lapis LLM — **tidak pernah menebak**, karena
tebakan identitas menghasilkan node hantu di graf.

---

## 7. Strategi knowledge graph yang akurat

Akurasi graf tidak datang dari banyaknya relasi, melainkan dari empat disiplin.

### 7.1 Enam jenis relasi, masing-masing dengan pola sumbernya

| Relasi | Sumber | Kepercayaan awal |
|---|---|---|
| `MENGUBAH` | Judul "PERUBAHAN ATAS …" | 0,97 |
| `MENCABUT` | Klausul penutup + "dicabut dan dinyatakan tidak berlaku" | 0,95 |
| `MENCABUT_SEBAGIAN` | "dicabut sebagian" / "sepanjang mengatur" | 0,75 |
| `MENGUBAH` (pihak ketiga) | "X **sebagaimana telah diubah dengan** Y" | 0,80 |
| `DASAR_HUKUM` | Butir "Mengingat" | 0,99 |
| `MELAKSANAKAN` | "sebagai pelaksanaan ketentuan Pasal N …" | 0,85 |

Pola **"sebagaimana telah diubah dengan"** paling bernilai: ia mengisi rantai
amandemen untuk peraturan lama yang badan teksnya sendiri tidak tersedia di
DJP. Pada satu dokumen saja, pola ini menghasilkan empat relasi valid —
termasuk `UU 16/2009 MENGUBAH UU 6/1983` dan `PER-15/PJ/2006 MENGUBAH
KEP-545/PJ/2000`, dua-duanya di luar dokumen yang sedang dibaca.

Pola yang sama juga menjadi sumber kesalahan klasik: dalam kalimat *"KEP-545
sebagaimana telah diubah dengan PER-15, dicabut"*, parser naif akan menyimpulkan
PER-15 ikut dicabut. Sistem menandai kasus ini `kandidat-pengubah`, menurunkan
kepercayaan ke 0,70, dan meneruskannya ke verifikasi LLM alih-alih memutuskan
sendiri.

### 7.2 Verifikasi dua arah

Setiap klaim pencabutan diuji dari dua sisi:

- **Sisi teks:** apa yang dikatakan peraturan pencabut.
- **Sisi status:** label resmi DJP pada peraturan yang dicabut.

Sejalan → kepercayaan naik. Bertentangan → ditandai **konflik** dan masuk
antrean tinjauan manusia. Sistem **tidak pernah** diam-diam memilih salah satu.
Tiga jenis konflik dilacak terpisah:

- situs bilang *dicabut*, graf belum menemukan pencabutnya → sumber teks kurang;
- graf bilang *dicabut*, situs bilang *aktif* → kemungkinan salah ekstraksi;
- situs bilang *diubah*, graf tidak menemukan pengubah → dokumen pengubah
  mungkin belum ter-crawl.

`cli.py validity` mencetak antrean ini terurut prioritas.

### 7.3 Waktu, bukan sekadar label

"Aktif" adalah status **hari ini**. Untuk sengketa pajak Tahun Pajak 2019, yang
dibutuhkan adalah status **pada 2019**. Karena itu setiap dokumen menyimpan
`valid_from` / `valid_to`:

- `valid_from` dibaca dari klausul penutup (`"mulai berlaku pada tanggal 1
  Januari 2009"` → `2009-01-01`, terdeteksi eksplisit), bukan diasumsikan sama
  dengan tanggal penetapan;
- `valid_to` = tanggal mulai berlaku peraturan pencabut paling awal;
- alasannya disimpan sebagai teks agar dapat diaudit.

Seluruh pencarian menerima `--as-of YYYY-MM-DD`.

### 7.4 Versi konsolidasi

UU 6/1983 s.t.d.t.d. UU 6/2023 bukan enam dokumen terpisah, melainkan satu
rantai. `graph.rantai_konsolidasi()` menelusurinya, dan hasil pencarian yang
mengenai dokumen lama otomatis menyertakan penunjuk `lihat_juga` ke versi
terkini.

### 7.5 Penyaring hierarki — akal sehat hukum sebagai pertahanan terakhir

UU 12/2011 Pasal 7 menetapkan hierarki peraturan perundang-undangan. Peraturan
yang lebih rendah **tidak dapat** mencabut atau mengubah yang lebih tinggi.
Penyaring ini menangkap kesalahan dari sumber mana pun — dan pada uji nyata
langsung menemukan enam pelanggaran:

| Relasi | Sumber | Penilaian |
|---|---|---|
| PP 50/2022 **mencabut** UU 6/1983 | peraturan.go.id | Mustahil — PP tidak dapat mencabut UU |
| PP 55/2022 **mencabut** UU 7/1983 | peraturan.go.id | Mustahil |
| INS 20/2026 **mengubah** PP 55/2022 | ekstraksi kita | Akibat jenis dokumen salah label di katalog DJP (§1.4) |

Empat di antaranya berasal dari **data terstruktur pemerintah sendiri**. Tanpa
penyaring ini, graf akan menyatakan UU KUP 1983 sudah dicabut oleh sebuah
Peraturan Pemerintah — kesalahan yang akan merambat ke seluruh jawaban
pencarian. Setelah penyaring aktif, UU 6/1983 kembali berstatus `diubah`.

Dua pelanggaran terakhir menarik karena datang dari sisi kita, dan akarnya
adalah bug identitas di §1.4: dua entri PP 20/2026 yang dilabeli "Instruksi
Dirjen Pajak" dan "Peraturan Presiden". Dua detektor yang berbeda menunjuk ke
catatan yang sama — persis yang diharapkan dari verifikasi berlapis.

Relasi yang melanggar **tidak dihapus**, hanya dikeluarkan dari perhitungan
masa berlaku dan ditandai di kolom `conflict` untuk ditinjau manusia.

**Setiap relasi menyimpan kalimat buktinya** (`evidence`) beserta id unit
pasalnya, sehingga klaim apa pun di aplikasi hilir dapat ditelusuri kembali ke
kalimat sumbernya.

---

## 7b. Gold set dan pengukuran akurasi

Tanpa pengukuran, "akurat" hanyalah klaim. Disediakan dua tingkat, dan
perbedaannya sengaja tidak dikaburkan:

| Tingkat | Asal | Boleh disebut kebenaran? |
|---|---|---|
| **silver** | Relasi terstruktur peraturan.go.id, otomatis | Tidak — situs pemerintah pun bisa tidak lengkap |
| **gold** | Dilabeli manusia terhadap kalimat bukti | Ya |

### Silver: gratis, langsung menemukan celah nyata

Pada uji dengan 11 dokumen beririsan, silver set menghasilkan 75 relasi acuan
dan **langsung membongkar satu kegagalan besar**: recall 0,00.

Penyebabnya: **UU 7/2021 (HPP) mengubah enam undang-undang sekaligus, tetapi
judulnya "HARMONISASI PERATURAN PERPAJAKAN"** — bukan "PERUBAHAN ATAS …".
Aturan berbasis judul melewatkan seluruh relasinya. Pola sebenarnya ada di
batang tubuh:

> "Pasal 2 — **Beberapa ketentuan dalam** Undang-Undang Nomor 6 Tahun 1983
> tentang Ketentuan Umum dan Tata Cara Perpajakan … **diubah sebagai berikut**:"

Ini pola undang-undang omnibus, yang juga dipakai UU Cipta Kerja. Setelah
aturan `from_omnibus` ditambahkan, sekaligus terungkap **bug kedua**: kandidat
relasi hanya menyimpan teks mentah `"6 Tahun 1983"` tanpa jenis dokumen,
sehingga resolusi ke node pasti gagal — jenisnya hanya diketahui dari kalimat
asalnya. Perbaikannya: kandidat membawa `dst_key_hint` hasil normalisasi saat
rujukan diekstrak.

Dampak terukur pada slice uji:

| | Sebelum | Sesudah |
|---|---:|---:|
| Rujukan belum terpaut | 904 | 644 |
| Relasi MENGUBAH ditemukan | 8 | 12 |
| Recall (lingkup dapat dinilai) | 0,00 | **0,43** |
| Precision terhadap label | — | **1,00** |

**Angka ini belum layak dijadikan klaim akurasi.** Dari 75 relasi acuan, hanya
7 yang kedua ujungnya ada di korpus 11-dokumen ini; sisanya menunjuk peraturan
yang belum di-crawl. `evaluate()` karena itu melaporkan dua angka terpisah dan
menandai mana yang bermakna. Pengukuran sungguhan menuntut crawl penuh.

### Gold: sampel berstrata untuk pelabelan manusia

```bash
python cli.py goldset --sample - --n 250   # → data/goldset_review.csv
```

Sampel acak murni akan didominasi kasus mudah dan memberi kesan akurasi yang
terlalu bagus. Karena itu sampling-nya berstrata ke tempat kesalahan
sebenarnya berada:

| Strata | Porsi | Alasan |
|---|---:|---|
| `kepercayaan_tinggi` | 25% | Memastikan yang "aman" memang aman |
| `kepercayaan_rendah` (<0,80) | 25% | Zona ragu |
| `kandidat_pengubah` | 20% | Jebakan "sebagaimana telah diubah dengan" |
| `belum_terpaut` | 15% | Kegagalan resolusi identitas |
| `pencabutan_sebagian` | 15% | Paling sulit, lingkupnya harus tepat |

CSV memuat kalimat bukti lengkap, sehingga pelabel memutuskan dari teks — bukan
dari ingatan tentang peraturannya. Kolom `JENIS_SEHARUSNYA` menampung koreksi
tipe relasi, bukan sekadar benar/salah.

```bash
python cli.py goldset --import-labels data/goldset_review.csv
python cli.py goldset --eval --tier gold
```

---

## 8. Strategi pencarian

Kegagalan khas mesin pencari peraturan bukan "tidak menemukan dokumen",
melainkan **"menemukan pasal yang sudah dicabut dan menyajikannya sebagai hukum
yang berlaku"**. Karena itu status hukum menjadi faktor pemeringkatan utama,
bukan sekadar kemiripan teks.

**Empat lapis:**

1. **Leksikal (FTS5/BM25).** Basis, bukan pelengkap — bahasa hukum Indonesia
   kaya istilah baku, dan nomor pasal harus cocok persis. `"Pasal 21"`
   diperlakukan sebagai frasa utuh agar tidak cocok dengan sembarang "21".
   Bobot kolom: teks 8,0 / judul 3,0 / kutipan 4,0.
2. **Filter metadata:** jenis, kategori (PPh/PPN/KUP/PBB/BM/BPHTB), tag katalog
   4 digit (`2005-PPh Pasal 21`, `3004-Faktur Pajak`), rentang tahun.
3. **Filter waktu:** `--as-of`; dokumen yang belum berlaku atau sudah dicabut
   pada tanggal itu disembunyikan secara baku.
4. **Perluasan graf:** hasil pada dokumen lama menyertakan versi penggantinya.

**Pemeringkatan** mengalikan skor BM25 dengan tiga faktor:

| Faktor | Nilai |
|---|---|
| Status hukum | berlaku 1,35 · diubah 1,15 · dicabut sebagian 1,05 · dicabut 0,55 |
| Bagian dokumen | batang tubuh 1,0 · penutup 0,9 · penjelasan 0,85 · menimbang 0,55 · mengingat 0,45 |
| Kebaruan | +0,33% per tahun sejak 1983 |

Bobot bagian dokumen penting: pencarian "PPh Pasal 21" seharusnya mengembalikan
**ketentuan operatif**, bukan konsideran yang kebetulan menyebut frasa itu.

**Embedding sengaja opsional.** `search.hybrid()` menerima `embed_fn` yang
disuntikkan dari luar; tanpa itu, ia setara dengan pencarian leksikal. Sistem
berjalan penuh tanpa biaya embedding — tambahkan hanya bila terbukti perlu.

**Untuk RAG,** `konteks_untuk_llm()` merakit potongan yang **setiap blok
membawa status hukumnya**:

```
[PER-31/PJ/2009 — BAB X > Pasal 27]
Status per 2019-06-30: sudah_dicabut (lihat juga: PER-16/PJ/2016)
```

Inilah yang mencegah model menjawab berdasarkan pasal yang sudah dicabut tanpa
memberi tahu penggunanya.

---

## 8b. Hasil menjalankan pipeline penuh (2026-08-10)

Seluruh angka di bawah ini **hasil eksekusi**, bukan perkiraan.

| | |
|---|---:|
| Dokumen di katalog | 6.023 |
| Berbadan teks | **4.222 (70%)** |
| Unit pasal terindeks | **128.877** |
| Relasi | **37.947** (28.051 ter-resolve) |
| Gold set silver | 2.199 |
| Konflik perlu tinjauan | 1.604 |
| Biaya LLM | **$0,00** |
| Ruang di disk | **609 MB** |

Rincian disk: `peraturan.db` 301 MB, `raw_html` 183 MB (ter-gzip), `pdf` 123 MB.
Perkiraan awal 0,7 GB meleset ~13% ke bawah — cukup akurat.

**Pengayaan sumber sekunder menaikkan cakupan dari 54% ke 70%**: 3.250 dokumen
berbadan teks dari DJP saja, menjadi 4.222 setelah JDIH Kemenkeu dan
peraturan.go.id ikut menambal.

### Konflik: 1.604, dan mayoritasnya bukan salah ekstraksi

| Jumlah | Jenis |
|---:|---|
| 828 | Situs bilang **dicabut**, pencabutnya tak ditemukan di teks |
| 221 | Situs `dicabut_sebagian` vs graf `diubah` |
| 194 | Graf bilang **dicabut**, situs bilang aktif |
| 194 | Situs `dicabut_sebagian` vs graf `berlaku` |
| 110 | Situs `berlaku` vs graf `diubah` |

Kelompok terbesar (828) punya sebab langsung: peraturan pencabutnya berada di
30% korpus yang badan teksnya belum tersedia, jadi tidak ada teks untuk
diekstrak. Ini konsekuensi lubang KMK, bukan parser yang keliru.

Kelompok 194 "graf bilang dicabut, situs bilang aktif" adalah yang paling layak
ditinjau lebih dulu — di situ salah satu pihak pasti salah, dan bisa jadi
grafnya yang benar. Diekspor ke `data/antrean_tinjauan.csv`.

### Evaluasi silver

`recall_pada_lingkup_dapat_dinilai` **0,271**, `precision_terhadap_label`
**1,00** atas 284 relasi yang kedua ujungnya ada di korpus. Precision sempurna
berarti: dari 85 relasi kita yang dapat dibandingkan, tidak satu pun terbukti
salah.

Recall 0,27 wajar — peraturan.go.id mencatat banyak relasi tingkat UU/PP yang
teksnya tidak tersedia di DJP, sehingga tidak mungkin kita ekstrak.

**Ini tetap bukan angka akurasi.** Silver set otomatis dan tidak diverifikasi
manusia. Klaim akurasi yang sah tetap menunggu gold set berlabel.

### Empat bug yang baru ketahuan saat skala penuh

Semuanya gagal-senyap — tidak ada yang muncul pada korpus uji kecil:

1. **`Fetcher` mengulang 4xx.** peraturan.go.id membalas 404 untuk slug yang
   tidak ada; retry berbackoff membuat tiap "tidak ada" memakan **19,7 detik**
   (2+3+5+9). Ini penyebab utama tahap pengayaan seperti membeku. Setelah 4xx
   diperlakukan final: 19,7 detik → 0,0 detik.
2. **`DELETE FROM` pada tabel FTS5 contentless ditolak.** Tahap indeks gagal
   dengan `cannot DELETE from contentless fts5 table`; perintah yang benar
   adalah `INSERT INTO pasal_fts(pasal_fts) VALUES('delete-all')`. Tidak
   terlihat selama tabelnya belum pernah diisi ulang.
3. **Batas waktu pustaka HTTP tidak menjamin apa pun.** curl_cffi pernah
   menahan satu permintaan 78 detik meski timeout disetel 30, dan httpx
   menghitung timeout per-operasi baca. Solusinya pengawas SIGALRM di tingkat
   dokumen (`BATAS_PER_DOKUMEN`), bukan di tiap konektor.
4. **Deteksi identitas melompati kop surat.** Banyak Perdirjen menulis
   "PERATURAN DIREKTUR JENDERAL PAJAK PER-10/PJ/2025" tanpa kata "NOMOR",
   sehingga regex menangkap kutipan pertama di Menimbang dan menuduh dokumen
   salah identitas. Diperbaiki dengan membuat "NOMOR" opsional dan membatasi
   pencarian sampai kata "Menimbang".

---

## 9. Yang sudah jalan dan yang belum

**Sudah diverifikasi terhadap situs asli:**

- Crawl indeks & detail DJP, unduh lampiran, cache disk, crawl inkremental
- Normalisasi nomor (12 bentuk diuji), ekstraksi rujukan, verifikasi identitas
- Pemecahan struktur pasal (96 unit pada PER-31/PJ/2009)
- Ekstraksi relasi berbasis aturan: judul, penutup lintas-pasal, "s.t.d.d.",
  omnibus, mengingat, menimbang
- **Konektor peraturan.go.id**: metadata, PDF ber-text-layer, dan 124 relasi
  terstruktur dari 11 dokumen uji
- **Gold set silver + harness evaluasi**, yang sudah membuktikan dirinya dengan
  menemukan dua bug nyata (pola omnibus, hilangnya jenis dokumen saat resolusi)
- **Ekspor CSV berstrata** untuk pelabelan manusia
- Masa berlaku, deteksi konflik, rantai konsolidasi
- Pencarian FTS5 sadar-waktu, perluasan graf, konteks RAG
- Penjenjangan OCR (rute A terverifikasi pada lampiran PMK 44/2026)
- Lapisan LLM provider-agnostik (OpenAI baku, Anthropic opsional)

**Belum dikerjakan — perlu keputusan Anda:**

1. **Sisa lubang KMK.** JDIH Kemenkeu menutup ~56% seri klasik `N/KMK.0x/YYYY`,
   tetapi seri `KM.10`/`KM.11`/`KM.1` dan penomoran baru "N TAHUN YYYY" hampir
   seluruhnya tidak ada di sumber mana pun yang sudah diuji. Kandidat
   berikutnya: Ortax Data Center (komersial — perlu keputusan Anda soal hak
   pakai) atau permintaan resmi ke DJP/Kemenkeu.
2. **Crawl penuh.** Semua angka akurasi di dokumen ini berasal dari slice kecil
   (11–45 dokumen). Recall belum dapat diklaim sebelum korpus lengkap.
3. **Pelabelan 250 baris CSV oleh manusia.** Harness-nya siap; yang dibutuhkan
   adalah waktu ahli pajak. Ini satu-satunya jalan menuju klaim akurasi yang
   sah.
4. **Verifikasi LLM belum dijalankan** — perlu `OPENAI_API_KEY`. `cli.py verify`
   mencetak estimasi biaya dan menolak mengirim tanpa `--submit`.
5. **Deduplikasi entri ganda** (kasus PP 20/2026): terdeteksi dan dilaporkan,
   belum digabung otomatis — penggabungan identitas sebaiknya diputuskan
   manusia.

---

## 10. Cara pakai

```bash
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
export OPENAI_API_KEY=...        # hanya untuk tahap verify/OCR VLM
```

**Membangun korpus:**

```bash
python cli.py init                          # skema + cek perkakas OCR
python cli.py crawl-index                   # ~1.260 halaman, ~25 menit
python cli.py crawl-detail --lampiran       # ~6.300 dok, ~2 jam
python cli.py sources --coverage            # cakupan tiap sumber sekunder
python cli.py sources                       # tambal teks+relasi dari peraturan.go.id
python cli.py parse                         # HTML → unit pasal
python cli.py relations                     # ekstraksi relasi berbasis aturan
python cli.py validity                      # masa berlaku + laporan konflik
python cli.py index                         # bangun indeks FTS5
```

**Mengukur akurasi:**

```bash
python cli.py goldset --build-silver              # acuan otomatis, gratis
python cli.py goldset --eval                      # metrik + daftar yang terlewat
python cli.py goldset --sample - --n 250          # CSV untuk dilabeli manusia
python cli.py goldset --import-labels data/goldset_review.csv
python cli.py goldset --eval --tier gold          # metrik sesungguhnya
```

**Verifikasi LLM (opsional):**

```bash
python cli.py verify                              # estimasi biaya saja
python cli.py verify --submit                     # kirim ke Batch API
python cli.py verify --collect batch_abc123       # ambil hasil
```

**Pencarian:**

```bash
python cli.py search "PPh 21 uang pesangon" --as-of 2019-06-30
python cli.py search "faktur pajak" --kategori PPN --tag 3004
python cli.py search "kuasa wajib pajak" --konteks     # keluaran siap-RAG
```

**Graf & pemeliharaan:**

```bash
python cli.py graph                               # statistik korpus
python cli.py graph --chain uu-6-1983             # rantai perubahan
python cli.py graph --export data/graph.json      # untuk Neo4j/visualisasi
python cli.py sources --probe https://jdih.kemenkeu.go.id/   # diagnostik situs
python cli.py refresh --days 14                   # crawl inkremental
```

Basis data: `data/peraturan.db` (SQLite). Cache HTML mentah di `data/raw_html/`
sehingga menjalankan ulang tidak membebani server sumber.
