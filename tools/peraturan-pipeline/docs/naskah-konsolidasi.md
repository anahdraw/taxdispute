# Naskah konsolidasi sebagai lapisan dasar

## Apa yang SDSN isi, dan apa yang tidak

Korpus dari katalog DJP menyimpan **naskah asli** dan **undang-undang pengubah**
sebagai dokumen terpisah. Yang tidak ada di sana adalah bunyi pasal *sebagaimana
berlaku sekarang* — hasil semua perubahan digabung. Padahal itulah yang dikutip
orang saat bekerja.

SDSN Edisi 2023 mengisi lapisan itu untuk enam undang-undang inti:

| Naskah | Pasal | Unit | Konsolidasi s.d. | Tanda amandemen |
|---|---|---|---|---|
| UU 6/1983 KUP | 81 | 704 | UU 6/2023 | 7 |
| UU 7/1983 PPh | 52 | 537 | UU 6/2023 | 7 |
| UU 8/1983 PPN | 33 | 382 | UU 7/2021 | 5 |
| UU 12/1985 PBB | 29 | 148 | UU 12/1994 | – |
| UU 10/2020 Bea Meterai | 32 | 198 | (asli) | – |
| UU 7/2021 HPP BAB V–VII | 13 | 214 | (asli) | – |

Yang **tidak** dicakup: seluruh peraturan pelaksana. PMK, PER Dirjen, KMK, SE —
6.290 dokumen sisanya — tetap datang dari katalog. SDSN adalah fondasi tingkat
undang-undang, bukan pengganti korpus.

## Jawaban: bisakah ini jadi dasar?

Bisa, sebagai **lapisan puncak hierarki**, dengan tiga syarat yang sudah dipenuhi:

1. **Tidak menimpa naskah asli.** UU 6/1983 versi asli dan versi konsolidasi 2023
   adalah dua dokumen yang sama-sama sah dikutip — yang pertama untuk sengketa
   atas peristiwa lama, yang kedua untuk keadaan sekarang. Karena itu naskah
   konsolidasi disimpan dengan id sendiri (`uu-6-1983@konsolidasi-2023`) dan
   ditautkan lewat relasi `KONSOLIDASI_DARI`.
2. **Penjelasan dipisahkan dari batang tubuh.** SDSN menyelipkan "Penjelasan
   Pasal N" tepat setelah tiap pasal. Bila tidak dipisah, penjelasan akan
   dikutip seolah bunyi pasalnya. 443 unit kini bertanda `penjelasan`.
3. **Edisinya diikat pada waktu.** Ini edisi 2023. Perubahan setelah itu tidak
   tercakup, dan `konsolidasi_sampai` menyatakannya per naskah — bukan
   diasumsikan mutakhir selamanya.

Batasnya harus jelas: SDSN 2023 **tidak** memuat perubahan pasca-2023. Ia dasar
yang kuat, bukan sumber kebenaran terakhir.

## Penanda bintang: provenance per ketentuan

Konvensi "pakai bintang" pada SDSN memberi sesuatu yang tidak tersedia dari
sumber mana pun yang sudah dipakai: **perubahan keberapa yang melahirkan rumusan
ini**.

    *)       UU 9/1994        ***)     UU 28/2007      *****)   UU 11/2020
    **)      UU 16/2000       ****)    UU 16/2009      ******)  UU 7/2021
    *******) UU 6/2023

593 unit membawa tanda semacam ini. Pertanyaan "rumusan Pasal 4 ayat (2) huruf i
berasal dari perubahan mana?" kini dijawab dari data, bukan dari membandingkan
naskah secara manual.

**Dua hal yang sengaja tidak dilakukan.** Pertama, tanda tidak disalin dari induk
ke anak. Pasal 4 bertanda `******)`, tetapi huruf di dalamnya bisa berasal dari
perubahan yang lebih tua; menyalin akan mengklaim lebih dari yang tertulis.
`sdsn.asal_rumusan()` melaporkan warisan sebagai warisan. Kedua, legenda resmi
UU KUP dan PPh hanya mencantumkan **enam** perubahan padahal batang tubuhnya
memakai tujuh bintang — cacat pada dokumen sumber. Nilai ketujuh dipulihkan dari
judul dan disimpan di `legenda_disimpulkan`, dengan confidence 0.75 dan method
`sdsn-inferensi`, terpisah dari yang benar-benar tercetak.

## Bentuk penyimpanan

| Bentuk | Peran | Kapan dipakai |
|---|---|---|
| `sdsn-2023.json` | kanonik | pohon bersarang, seluruh atribut per simpul; sumber untuk regenerasi bentuk lain |
| `sdsn-2023.jsonl` | muat | satu baris per unit dapat dikutip; untuk indeks dan graf |
| `sdsn-2023.md` | baca | dibaca manusia, di-*diff* di git antar edisi |
| PDF asli | bukti | rujukan terakhir bila ada sengketa pembacaan |

JSON yang kanonik, bukan Markdown — karena tiap simpul membawa atribut
(`amandemen`, `bagian_dok`, `level`) yang tidak punya tempat alami di Markdown
tanpa mengarang konvensi baru. Markdown adalah turunan, dan boleh dibuat ulang
kapan saja.

## Leveling

Hierarki mengikuti UU 12/2011:

    undang_undang 0 > bab 1 > bagian 2 > paragraf 3 > pasal 4 > ayat 5 > huruf 6 > angka 7

Angka level dipakai agar hubungan induk–anak dihitung, bukan ditebak. Setiap unit
menyimpan `path` yang dapat langsung jadi sitasi:

    uu-7-1983@konsolidasi-2023#bab-iii-pasal-4-ayat-2-huruf-i
    BAB III > Pasal 4 > ayat (2) > huruf i

## Rencana graf pengetahuan

Simpul dan sisi yang **sudah** terpasang di basis data:

    (naskah konsolidasi) --KONSOLIDASI_DARI--> (naskah asli)
    (naskah konsolidasi) --MENCAKUP_PERUBAHAN--> (tiap UU pengubah, per tanda)

Digabung dengan relasi yang sudah ada dari korpus (`MENCABUT`, `MENGUBAH`,
`DASAR_HUKUM`, `MELAKSANAKAN`), tiga pertanyaan menjadi terjawab yang sebelumnya
tidak:

1. **"Apa bunyi Pasal 4 UU PPh sekarang?"** → naskah konsolidasi, bukan hasil
   merakit sendiri dari naskah asli plus enam UU pengubah.
2. **"Perubahan mana yang sudah masuk ke naskah ini?"** → dari sisi
   `MENCAKUP_PERUBAHAN`, bukan dari membaca legenda.
3. **"Peraturan pelaksana mana yang menggantung pada pasal ini?"** → dari
   `MELAKSANAKAN` yang menunjuk ke naskah asli, disambung lewat
   `KONSOLIDASI_DARI`.

Langkah berikutnya yang belum dikerjakan: menautkan `MELAKSANAKAN` sampai ke
**tingkat pasal**, bukan hanya tingkat dokumen. PMK biasanya menyebut pasal
tertentu ("sebagaimana dimaksud dalam Pasal 32C Undang-Undang Pajak
Penghasilan"), dan sitasi itu sudah ada di teks — tinggal diurai. Setelah itu,
pertanyaan "kalau Pasal 32C berubah, PMK mana saja yang terdampak?" dapat dijawab
dari graf.

## Profil per bentuk peraturan

Satu setelan untuk semua dokumen adalah asumsi yang tidak tahan uji. Bentuk
peraturan Indonesia berbeda-beda, dan `pipeline/profil.py` menyatakan
perbedaannya:

| Bentuk | Satuan kutipan | OCR |
|---|---|---|
| UU, PP, Perpres | pasal (+ penjelasan) | 300 dpi, psm 6 |
| PMK, PER Dirjen | pasal | 300 dpi, psm 6 |
| KMK, KEP, Keppres | **diktum** (KESATU, KEDUA) | 300 dpi, psm 6 |
| SE | angka | 300 dpi, psm 6 |
| lampiran tabel/tarif | baris | **400 dpi, psm 4**, ambang 0.88 |

Lampiran dinilai dengan profilnya sendiri, bukan profil induknya: lampiran tarif
pada sebuah PMK lebih mirip tabel daripada mirip PMK. `--psm 4` menjaga kolom
tetap terpisah; memaksakan `--psm 6` pada tabel adalah penyebab lazim angka
tercampur antar kolom. Ambangnya lebih tinggi karena salah baca satu digit tarif
berakibat langsung pada perhitungan — kesalahan yang dapat ditoleransi pada
narasi tidak dapat ditoleransi pada angka.

Profil juga dipakai untuk **mendeteksi kegagalan parsing**. Tidak ada pasal di
KMK itu wajar; tidak ada pasal di UU berarti pengurai gagal. Pemeriksaan itu
menemukan cacat besar: pengurai tidak pernah diajari membaca Keputusan sama
sekali. Setelah diktum ditambahkan, 964 dokumen (3.424 unit) yang tadinya satu
gumpalan teks kini punya unit yang dapat dikutip, dan dokumen ganjil turun dari
1.260 (30%) ke 391 (9%). Sisanya tercatat di `data/parsing_ganjil.csv`.

## Cara menjalankan

```bash
./.venv/bin/python cli.py sdsn "UU Pajak Terbaru SDSN 2023 7.1_0.pdf"
```

Satu perintah: PDF → JSON/JSONL/Markdown → basis data → indeks pencarian.
Tambahkan `--tanpa-db` untuk ekspor berkas saja.

## Antarmuka

```bash
./.venv/bin/python server.py
```

Buka `http://127.0.0.1:8765`. Tiga tab:

- **Tanya** — pertanyaan bebas, hasil per pasal. Tidak ada pemanggilan LLM:
  jawaban adalah kutipan pasal yang benar-benar ada, lengkap dengan sitasi,
  status hukum pada tanggal yang dipilih, dan lencana cakupan istilah. Bila
  tidak ada yang cocok, itu yang dikatakan — bukan ditambal kalimat yang
  terdengar meyakinkan.
- **Aturan** — daftar 6.029 peraturan dengan penyaring jenis, tahun, dan ada
  atau tidaknya naskah. Klik untuk melihat daftar pasal, klik lagi untuk
  membaca satu pasal.
- **Pemeriksaan** — tujuh pemeriksaan mutu, masing-masing dengan contoh nyata.

Server memakai `http.server` pustaka baku dan membuka basis data dalam mode
**baca-saja**: alat pemeriksa tidak boleh bisa mengubah yang diperiksanya.

## Tinjauan: dari temuan menjadi keputusan

Tab **Tinjauan** mengubah tiap temuan mutu menjadi kasus yang dapat diputus,
berisi: apa yang salah, bukti yang mendasarinya, usul perbaikannya, dan tingkat
keyakinan **berikut alasannya** — angka 0,93 tanpa kalimat penjelas tidak dapat
diperiksa siapa pun.

Tiga prinsip menentukan bentuknya:

**Semua perbaikan otomatis dapat dibatalkan.** Tiap perubahan menulis baris
audit berisi nilai lamanya sebelum menimpa. Tanpa itu, "perbaikan otomatis"
hanyalah kerusakan yang tidak tercatat. Satu tombol mengembalikan nilai lama dan
memasukkan kasusnya kembali ke antrean.

**Tidak ada yang dihapus.** Entri kembar ditandai, bukan dibuang. Menghapus
catatan resmi berdasarkan simpulan kita sendiri adalah kerugian yang tidak dapat
dipulihkan bila ternyata keliru.

**Arah kesalahan menentukan boleh-tidaknya otomatis.** Bila graf menemukan lebih
*sedikit* daripada situs — situs bilang dicabut, graf tidak menemukan
pencabutnya — itu keterbatasan yang sudah dikenal, dan mengikuti situs aman.
Bila graf mengklaim lebih *banyak* — graf bilang dicabut padahal situs bilang
aktif — kita akan menyatakan sebuah aturan mati berdasarkan telusur sendiri.
Arah itu tidak pernah diselesaikan otomatis, berapa pun rapinya polanya.

### Hasil auto-resolve

| Masalah | Total | Otomatis | Sisa untuk manusia |
|---|---|---|---|
| Status berselisih | 1.604 | **1.355** | 249 |
| Melanggar hierarki | 106 | **106** | 0 |
| Sitasi menggantung | 2.472 | **237** | 2.235 |
| Identitas tidak cocok | 127 | **51** | 76 |
| Naskah kembar | 6 | 0 | 6 |
| Parsing tidak wajar | 391 | 0 | 391 |
| Naskah tidak tersedia | 1.801 | 0 | 1.801 |

1.749 kasus selesai otomatis lewat 3.168 perubahan kolom, semuanya tercatat dan
dapat dibatalkan satu per satu.

### Dasar tiap keputusan otomatis

- **Status berselisih (0,97)** — kedua status sama-sama berarti masih berlaku;
  perubahan tidak mengakhiri keberlakuan. Bukan konflik, hanya beda penamaan.
- **Status berselisih (0,93)** — situs menyatakan dicabut, graf tidak menemukan
  pencabutnya. Ketiadaan sisi relasi bukan bukti pencabutan tidak terjadi.
- **Hierarki (0,91)** — pelanggaran dapat dipastikan dari jenis kedua dokumen
  tanpa menafsir isinya. Keyakinannya turun ke 0,20 agar tersaring di semua
  konsumen; `compute_validity` memang sudah melewatinya, tetapi ekspor graf dan
  perluasan hasil pencarian menyaring lewat `confidence`.
- **Identitas (0,92)** — nomor pokok dan tahun cocok, hanya kode unit berbeda
  penulisan. Itu tidak mengubah dokumen yang ditunjuk.
- **Sitasi menggantung (0,90)** — kode unitnya (KMK.01, PMK.01, `N/P`, `N/M`)
  menandai peraturan organisasi atau pengangkatan, di luar lingkup katalog
  pajak. Ketidakhadirannya bukan cacat.

Yang tersisa untuk manusia justru yang paling menuntut penilaian: 249 kasus di
mana graf melawan penerbitnya, 76 dokumen yang kop naskahnya menyebut nomor
sama sekali lain, dan 391 dokumen yang penyebab gagal uraikannya hanya dapat
diketahui dengan membuka naskahnya.

```bash
./.venv/bin/python cli.py tinjau --bangun --auto     # dari baris perintah
./.venv/bin/python cli.py tinjau --batalkan status:kep-1-pj-7-1993
```

## Terbitan berkala dipisahkan dari daftar peraturan

Dua jenis KMK terbit berulang dengan bentuk tetap: **nilai kurs** (mingguan,
1.358 penerbitan) dan **tarif bunga sanksi administratif** (bulanan, 70
penerbitan). Bersama-sama keduanya adalah **1.428 dokumen — 23,7% korpus**.

Keduanya secara hukum peraturan, tetapi secara penggunaan bukan. Tidak ada yang
membaca KMK kurs untuk mengetahui normanya; yang dicari adalah **angkanya pada
tanggal tertentu**. Membiarkannya di daftar peraturan membuat daftar itu nyaris
tidak dapat ditelusuri, sementara angka yang sebenarnya dicari tetap terkubur di
dalam teks.

Setelah dipisah, daftar peraturan turun **6.029 → 4.601**. Dokumennya tidak
dihapus dan tetap dapat dikutip — kutipan resmi tetap menunjuk nomor KMK-nya;
yang berubah hanya cara menemukannya. Penyaring `berkala=kurs` mengembalikannya
ke daftar bila memang dicari.

### Yang diurai

| | Penerbitan | Baris angka | Rentang |
|---|---|---|---|
| Nilai kurs | 1.358 | 17.499 | 1997-10-27 – 2026-08-04 |
| Tarif bunga | 70 | 397 | 2020-12-01 – 2026-07-31 |

Dua hal yang menyulitkan dan cara menanganinya:

**Dua konvensi angka bercampur.** Korpus memuat `13.665,00` (Indonesia) dan
`15,615.00` (Inggris), kadang berselang tahun. Menganggap salah satunya sebagai
satu-satunya bentuk membuat kurs 2024 terbaca ribuan kali lipat — atau tidak
terbaca sama sekali. Aturannya: bila kedua pemisah muncul, yang **paling kanan**
adalah pemisah desimal; itu berlaku pada kedua konvensi tanpa perlu menebak.
Sesudah diperbaiki, baris terurai naik 7.128 → 17.499.

**Masa berlaku angka bukan tanggal penetapan.** KMK kurs ditetapkan beberapa
hari sebelum angkanya berlaku. Memakai tanggal penetapan akan mengembalikan
kurs minggu yang salah pada tanggal-tanggal batas, jadi periodenya dibaca dari
judul atau diktum ("berlaku untuk tanggal 7 Januari 2026 sampai dengan 13
Januari 2026"). Penerbitan lama menulis tanggal awal tanpa tahun — tahunnya
diambil dari tanggal akhir, dan bila itu membuat awal melewati akhir, berarti
periodenya melintasi pergantian tahun.

Uji kewajaran: USD per tahun berkisar 7.100 (1998, puncak krisis 14.100) sampai
16.754–18.056 (2026). Tidak ada nilai yang salah magnitudo.

### Tab Kurs & Tarif

Tanggal dapat digeser tiga cara: kotak tanggal, tombol ◀ ▶ yang melompat satu
**penerbitan penuh** (bukan satu hari — angkanya hanya berubah saat penerbitan
berganti), dan penggeser yang membentang sepanjang seluruh rentang arsip.

Bila tanggal yang diminta jatuh di celah antar-penerbitan — dan celah memang ada,
karena tidak semua minggu terarsip — yang ditampilkan adalah penerbitan terdekat
sebelumnya **disertai peringatan bahwa masanya sudah lewat**. Diam-diam
menampilkan angka periode lain tanpa mengatakannya adalah cara paling halus untuk
menyesatkan.

Untuk kurs, di bawah tabel ada grafik pergerakan tiga tahun terakhir — SVG
sederhana, tanpa satu pun pustaka tambahan.

```bash
./.venv/bin/python cli.py berkala --bangun
./.venv/bin/python cli.py berkala --tanggal 2026-03-05
./.venv/bin/python cli.py berkala --tanggal 2026-02-10 --jenis tarif_bunga
```

## Verifikasi ke repositori lain

Kasus tersulit di antrean tinjauan adalah 249 peraturan yang telusur relasinya
menyimpulkan sudah dicabut, sementara situs DJP masih menyebutnya aktif. Dari
data sendiri kasus itu tidak dapat diputus — dan salah putus di sini berarti
menyatakan aturan yang hidup itu mati.

Yang dapat memutuskannya adalah penerbit lain yang memuat dokumen yang sama:

    peraturan.go.id   JDIH Nasional, resmi lintas kementerian
    JDIH Kemenkeu     penerbit langsung PMK dan KMK
    JDIH BPK          basis data dengan penandaan status yang rapi

Ketiganya ditanya, bukan berhenti di yang pertama menjawab. Untuk **mengambil
naskah**, berhenti di sumber pertama memang benar — satu salinan cukup. Untuk
**memutuskan status**, justru kesepakatan antar sumber yang jadi dasarnya, dan
itu tidak diketahui tanpa bertanya kepada semuanya.

### Aturan putusan

| Keadaan | Putusan | Keyakinan |
|---|---|---|
| 1 sumber menyatakan status | ikuti sumber | 0,88 |
| 2 sumber sepakat | ikuti sumber | 0,94 |
| 3 sumber sepakat | ikuti sumber | 0,96 |
| Sumber berselisih | **tetap terbuka** | 0 |
| Memuat dokumen tetapi tanpa label status | tetap terbuka | 0 |
| Tidak satu pun memuat | tetap terbuka, dicatat alasannya | 0 |
| Sumber gagal dihubungi | tetap terbuka, **dibedakan dari "tidak memuat"** | 0 |

Keyakinan tidak pernah mencapai satu: repositori pun dapat tertinggal
memperbarui. Perselisihan antar penerbit resmi tidak diselesaikan dengan suara
terbanyak oleh program — itu keputusan yang harus diambil manusia.

Gangguan jaringan dibedakan tegas dari ketiadaan dokumen. Menyamakan keduanya
mengubah kegagalan koneksi menjadi pernyataan tentang isi repositori.

### Dasar tersimpan, bukan disimpulkan ulang

Tiap kasus yang ditutup membawa `sumber_resolusi`: nama sumber, URL persisnya,
label status **apa adanya**, dan waktu pengambilan. Kartu tinjauan menampilkan
semuanya berikut tautan yang dapat dibuka sendiri — tanpa tautan, "sudah
diverifikasi" hanyalah klaim. Saringan status punya pilihan khusus
"diputus oleh sumber lain" untuk memisahkannya dari yang diselesaikan dari data
sendiri.

Bila sebuah kasus diputus sumber luar, kartunya menampilkan keyakinan **baru**
itu, bukan keyakinan awal. Menampilkan "40%, tidak pernah otomatis" pada kasus
yang justru sudah diselesaikan otomatis adalah kontradiksi yang membuat seluruh
angka kehilangan arti.

### Dua cacat yang ditemukan saat membangunnya

**Konektor JDIH Kemenkeu tidak pernah cocok.** Katalog DJP menulis nomor tanpa
awalan jenis ("72 TAHUN 2023"), JDIH menulisnya lengkap ("PMK 72 TAHUN 2023"),
dan pencocokan string membuat keduanya tidak pernah bertemu. Kegagalan itu tidak
terlihat — ia hanya tampak sebagai "dokumen tidak ada di sumber lain", persis
kesimpulan palsu yang paling berbahaya di sini. Sekarang pencocokan memakai
komponen nomor (`no`, `tahun`, `bentuk`). Perbandingan akhiran sempat
dipertimbangkan dan ditolak: "172tahun2023" berakhiran "72tahun2023", sehingga
PMK 72 akan tercocokkan dengan PMK 172.

**Arah relasi pencabutan terbalik.** Rancangan awal memperlakukan `MENCABUT` dan
`DICABUT_OLEH` sama. PMK 72/2023 mencabut empat PMK lama — memperlakukannya sama
akan menyatakan setiap peraturan pencabut sebagai dirinya sendiri telah dicabut.
Hanya relasi masuk yang menjadi bukti.

```bash
./.venv/bin/python cli.py verifikasi --jalankan --selesaikan
./.venv/bin/python cli.py verifikasi --jalankan --batas 20   # sebagian saja
```

## Bentuk tanpa kode: semuanya dapat ditelusur

76 dokumen tercatat tanpa `jenis_code`. Itu **bukan** dokumen yang identitasnya
tidak diketahui — label jenisnya ada dan terbaca di katalog ("Keputusan Bersama
Dirjen", "Surat Dirjen Bea dan Cukai", …). Yang hilang hanya kode pendeknya,
dan akibatnya dokumen-dokumen itu lenyap dari setiap penyaring, pemetaan
hierarki, dan pemeriksaan mutu yang bekerja atas kode.

15 bentuk ditambahkan ke peta, dan **seluruh 76 pulih dari peta — nol tersisa,
nol yang perlu diturunkan secara kasar**:

| Bentuk | Jumlah | Kode |
|---|---|---|
| Keputusan Bersama Dirjen | 18 | SKB-DJ |
| Surat Dirjen Bea dan Cukai | 15 | S-DJBC |
| Keputusan Bersama Menteri | 14 | SKB-M |
| Peraturan BKPM | 6 | PER-BKPM |
| Keputusan Menteri Perindustrian | 5 | KEPMENPERIN |
| Surat Dirjen Anggaran | 3 | S-DJA |
| Keputusan Menteri Tenaga Kerja | 3 | KEPMENAKER |
| Keputusan Ketua Pengadilan Pajak | 3 | KEP-PP |
| lainnya (7 bentuk) | 9 | — |

Dua di antaranya janggal: `184/PMK.03/2007` berlabel "Peraturan Menteri
Keuangan" dan `KEP-545/PJ./2000` berlabel "Keputusan Dirjen Pajak" — keduanya
sudah lama ada di peta, tetapi kodenya memang tidak pernah ditulis.

Untuk bentuk yang belum pernah muncul, `turunkan_kode()` menurunkan kode dari
labelnya (kata pembuka menentukan bentuk, sisanya menyebut penerbit) dan
menandainya sebagai turunan. Hilang diam-diam lebih buruk daripada berkode
kasar, asalkan yang kasar itu ditandai sehingga dapat dirapikan.

## Peta hierarki

Menaruh 6.029 dokumen dalam satu daftar rata membuat Keputusan Menteri tampak
setara Undang-Undang. Keduanya tidak berada di tangga yang sama — bahkan tidak
berada di tangga sama sekali.

**Tiga golongan yang tidak boleh dicampur:**

*Pengaturan* (regeling) — norma yang mengikat umum. Inilah yang disusun UU
12/2011 Pasal 7 ayat (1) menjadi tujuh tingkat. Peraturan Menteri dan Peraturan
Dirjen tidak disebut di tangga itu, tetapi Pasal 8 ayat (1) mengakui
keberadaannya sepanjang diperintahkan peraturan yang lebih tinggi.

*Penetapan* (beschikking) — Keputusan. Konkret, individual, sekali-selesai.
Mengutipnya sebagai dasar norma umum adalah kekeliruan yang lazim.

*Kebijakan internal* — Surat Edaran, Instruksi, Nota Dinas, Pengumuman.
Mengikat aparat, bukan Wajib Pajak.

| Golongan | Dokumen |
|---|---|
| Pengaturan | 2.382 |
| Penetapan | 2.182 |
| Kebijakan internal | 37 |
| **Total** | **4.601** ✓ |

Rinciannya (tanpa terbitan berkala):

```
Pengaturan
  Tingkat 3 — UU / Perppu       84    UU 79 · PERPU 5
  Tingkat 4 — PP               323    PP 323
  Tingkat 5 — Perpres           48    PERPRES 48
  Di luar tangga Pasal 7     1.927    PMK 1.177 · PER 603 · PERMENDAG 114 · …
Penetapan
  Di luar tangga Pasal 7     2.182    KMK 1.378 · KEP 631 · KEPPRES 125 · …
Kebijakan internal
  Di luar tangga Pasal 7        37    S-DJBC 15 · PENG 12 · …
```

Angkanya cocok persis dengan jumlah korpus. Bentuk yang belum dipetakan tetap
ditampilkan, tidak disembunyikan: selisih yang tidak dijelaskan menghapus
kepercayaan pada seluruh angka.

**Temuan: korpus ini tidak memuat satu pun Surat Edaran.** Katalog peraturan
DJP memang tidak mencakupnya — SE punya katalog tersendiri di pajak.go.id.
Padahal SE banyak dipakai dalam praktik. Ini kekosongan yang perlu diketahui
sebelum korpus dipakai untuk menjawab pertanyaan operasional.

Tab **Hierarki** menampilkan peta ini dengan batang status per bentuk, dan tiap
kode dapat diklik untuk menurun ke daftar dokumennya — lengkap dengan dasar
kedudukannya, karena itulah yang menentukan boleh-tidaknya dokumen dipakai
sebagai dasar hukum.

```bash
./.venv/bin/python cli.py hierarki --lengkapi-kode
./.venv/bin/python cli.py hierarki --berkala     # dengan kurs & tarif bunga
```

## Analisis celah terhadap katalog lain

Dua katalog diperiksa. Keduanya layanan berlangganan, dan **yang diambil hanya
metadata dari daftar publik** — naskah lengkapnya berbayar dan tidak disentuh.
Hasil di sini adalah daftar "apa yang perlu dicari", bukan salinan isinya.

### Ortax Data Center — dapat dienumerasi penuh

Daftarnya dilayani `POST /api/search/aturan` tanpa perlu masuk akun, sudah
terstruktur, 20.722 dokumen. Seluruhnya terbaca dalam 118 detik.

**Selisih 20.722 − 6.029 bukan jumlah peraturan pajak yang kita lewatkan.**
Menyajikannya begitu menyesatkan: sebagian besar adalah lingkup yang memang
lebih luas — bea masuk, cukai, perdagangan, PNBP, OJK. Dibatasi ke kategori
perpajakan (PPh, PPN, KUP, PBB, BPHTB):

| Bentuk yang kita bawa | Di Ortax | Sudah ada | **Celah** |
|---|---|---|---|
| KMK | 2.248 | 2.049 | **199** |
| Pengumuman | 121 | 10 | **111** |
| PMK | 765 | 668 | **97** |
| KEP Dirjen | 629 | 547 | **82** |
| PER Dirjen | 589 | 538 | **51** |
| Perpres | 23 | 9 | **14** |
| lainnya | — | — | 48 |
| **Total** | | | **602** |

**Bentuk yang belum kita bawa sama sekali — 8.076**, dan dua di antaranya besar:

- **Surat Dirjen Pajak — 4.955** dokumen berkategori pajak, kita punya nol.
- **Surat Edaran Dirjen Pajak — 2.906**, kita punya nol. Ini menegaskan
  kekosongan yang sudah tampak di peta hierarki: katalog peraturan DJP memang
  tidak memuat SE, padahal SE dipakai sehari-hari.

Daftar lengkapnya di `data/celah_pajak.csv` (8.678 baris, dengan tautan Ortax
untuk tiap dokumen).

### DDTC Perpajakan — tidak dipakai sebagai sumber otomatis

Daftarnya tidak dapat dienumerasi: setiap pencarian hanya menampilkan "100 data
teratas dari 15.748 hasil". Alamat dokumennya deterministik, jadi sempat dibuat
konektor pemeriksa status — lalu dibatalkan setelah ketahuan tidak dapat
dipercaya.

**Halaman DDTC dirakit oleh JavaScript.** Klien HTTP biasa menerima cangkang
yang sama persis untuk dokumen yang ada maupun yang mengada-ada: judul sama,
tanpa `h1`, dan pengalihan ke 404 baru terjadi setelah skrip berjalan. Percobaan
pertama tampak berhasil — PMK 72/2023 mengembalikan "Berlaku" — tetapi kata itu
berasal dari kerangka halaman, dan alamat yang jelas palsu pun menjawab sama.

Sumber yang memberi jawaban meyakinkan untuk pertanyaan apa pun lebih berbahaya
daripada sumber yang tidak menjawab. Karena itu DDTC hanya menyediakan
`ddtc.tautan()` — pembentuk alamat, supaya peninjau dibawa langsung ke halaman
yang tepat dan membaca sendiri dengan langganannya.

### Dua cacat pemadanan yang ditemukan dan diperbaiki

**Nomor tanpa awalan jenis.** Ortax menulis "43 Tahun 2026", korpus menyimpan
"PMK 43 TAHUN 2026", dan penormal menuntut awalan itu. Akibatnya setiap PMK, PP,
dan UU bernomor sederhana dilaporkan hilang padahal ada — PMK 43/2026 salah satu
buktinya. Kesalahannya tidak muncul sebagai galat; ia tampak sebagai celah yang
meyakinkan.

**Tahun diambil dari angka pertama.** "S-2099/PJ.51/1995" memuat dua rangkaian
empat digit, dan yang pertama adalah nomor urut. Tahun terbaca 2099 — cukup
masuk akal untuk lolos pemeriksaan sepintas, cukup salah untuk merusak setiap
pemadanan yang memakainya. Sekarang diambil dari rangkaian terakhir.

```bash
./.venv/bin/python cli.py celah --ambil --hanya-pajak
./.venv/bin/python cli.py celah --hanya-pajak --ekspor data/celah_pajak.csv
```


## Mengapa naskah Ortax tidak diambil

Sempat dicoba memakai Chrome pengguna dengan akun berlangganan. Dua hal
membatalkannya, dan yang kedua menentukan.

**Chrome tidak terhubung.** Ekstensi Claude in Chrome belum terpasang atau
belum masuk akun yang sama, sehingga sesi peramban pengguna tidak terjangkau.

**Ortax melarangnya secara tegas — dan akun tidak mengubah itu.** Naskah
lengkapnya justru terbuka tanpa login sama sekali: satu permintaan HTTP biasa
mengembalikan seluruh isi PMK 43/2026, 17 pasal sampai blok tanda tangan, tanpa
paywall. Yang menghalangi bukan teknis, melainkan pemberitahuan yang tertanam di
setiap dokumen:

> "Dokumen ini diketik ulang dan diperuntukan secara ekslusif untuk
> www.ortax.org dan TaxBaseX. Pengambilan dokumen ini yang dilakukan tanpa ijin
> adalah tindakan ilegal."

Memakai akun berlangganan tidak membuat pengambilan massal menjadi diizinkan; ia
hanya memindahkan akibatnya ke pemilik akun. Karena itu tidak ada pengunduh
massal yang dibangun untuk Ortax.

**Yang tetap sah.** Peraturannya sendiri milik publik — UU 28/2014 Pasal 42
mengecualikan peraturan perundang-undangan dari hak cipta. Yang eksklusif hanya
hasil ketikan ulang Ortax. Daftar celah sudah memberi nomor dan tahun tiap
dokumen, dan dokumen yang sama dapat diambil dari sumber resmi. Uji pada 12
dokumen celah 2024–2026: **6 terambil** dari JDIH Kemenkeu dan peraturan.go.id.

**Surat Edaran tetap buntu.** Katalog peraturan DJP memuat 39 jenis dokumen dan
tidak satu pun Surat Edaran; alamat `/id/surat-edaran` mengembalikan 404, dan
pencarian situs tidak menemukan SE tertentu. 2.906 SE berkategori pajak yang
ada di Ortax karena itu tidak punya sumber resmi yang dapat ditelusuri
otomatis — perlu permintaan resmi ke DJP, atau langganan yang mengizinkan.

### Celah palsu yang ditemukan dan diperbaiki

Angka celah semula 602 mengandung kesalahan pemadanan. Korpus menyimpan nomor
PER Dirjen lama sebagai `"1 TAHUN 2024"` — tanpa awalan jenis — sedangkan Ortax
menulis `"PER-1/PJ/2024"`. Dua konvensi untuk dokumen yang sama, dan kuncinya
tidak pernah bertemu, sehingga PER-1, PER-3, dan PER-4 tahun 2024 dilaporkan
hilang padahal ada.

Lapis pemadanan ketiga ditambahkan: (jenis, angka pokok, tahun), dan **hanya**
untuk nomor korpus yang benar-benar tanpa kode unit. Membukanya untuk nomor
berunit akan menyamakan "37/MK/EF.2/2026" dengan "37/KM.10/2026" — nomor pokok
dan tahun sama, dokumennya berlainan. Diperiksa: 692 kunci longgar terbentuk,
7 bertabrakan, dan ketujuhnya adalah pasangan naskah asli–konsolidasi, bukan
dokumen berbeda.

Celah terkoreksi: **602 → 595**.

## Pengisian celah dari sumber resmi

Daftar celah memberi jenis, nomor, dan tahun. Dokumen yang sama diambil dari
**repositori resmi**, bukan dari katalog yang menemukan celahnya — peraturannya
milik publik (UU 28/2014 Pasal 42), yang tidak milik publik hanyalah hasil
ketikan ulang sebuah penerbit atas naskah itu.

### Yang tidak dicoba, dan mengapa

Dari 595 celah dalam lingkup, hanya **380** yang masuk akal dicoba. PER Dirjen,
KEP Dirjen, Pengumuman, Instruksi, dan Nota Dinas (258 dokumen) adalah terbitan
DJP sendiri dan tidak dimuat di JDIH Kemenkeu, peraturan.go.id, maupun JDIH BPK.
Mencobanya hanya menghasilkan "tidak ditemukan" — kalimat yang terbaca seolah
dokumennya tidak ada, padahal sumbernya saja yang keliru.

### Perayapan DJP kita ternyata tidak bolong

Dugaan awal: celah PER/KEP/PENG berarti perayapan kita ke situs DJP melewatkan
sesuatu. Diperiksa langsung terhadap katalog DJP untuk tahun 2026:

| | Dokumen 2026 | Tanggal terbaru |
|---|---|---|
| Katalog DJP | 53 | 2026-07-28 |
| Korpus kita | 53 | 2026-07-28 |

Cocok persis. Katalog peraturan DJP memang lebih sempit daripada koleksi Ortax —
Pengumuman seperti `PENG-46/PJ.09/2026` tidak ada di sana, dan alamat
`/id/pengumuman` maupun `/id/siaran-pers` mengembalikan 404. Jadi celah pada
bentuk-bentuk itu bukan cacat perayapan, melainkan batas katalog sumbernya.

### Hasil

**97 dokumen masuk dari 380 yang dicoba (26%), membawa 1.562 unit pasal baru.**
Korpus 6.029 → 6.124, celah dalam lingkup 595 → 498.

| Bentuk | Dicoba | Masuk | |
|---|---|---|---|
| PMK | 97 | **94** | 97% |
| KMK | 195 | 2 | 1% |
| PP | 4 | 1 | |
| Perpres, Perpu, Perda, Keppres, dll | 84 | 0 | |

Sumbernya nyaris seluruhnya JDIH Kemenkeu (95 dokumen, 1.546 unit); satu dari
peraturan.go.id dan satu dari JDIH BPK.

Urutan pengambilan sengaja dari yang **paling lama**, bukan terbaru: dokumen
bulan berjalan paling sering belum terbit di repositori lain, dan mengurutkannya
terbaru-dulu membuat hasil awal tampak jauh lebih buruk daripada kenyataannya.

Pola yang muncul jelas: **JDIH Kemenkeu memuat hampir seluruh PMK yang kita
lewatkan, tetapi nyaris tidak memuat KMK lama.** KMK memang keputusan
administratif yang tidak selalu diarsipkan lintas repositori.

Dokumen yang masuk ditandai `source` sesuai repositori asalnya — bukan `djp` —
sehingga korpus tetap dapat menjawab "dari mana salinan ini datang" tanpa
menebak. Dokumen yang sudah ada tidak ditimpa.

```bash
./.venv/bin/python cli.py isi-celah --jalankan
./.venv/bin/python cli.py isi-celah --jalankan --jenis PMK --tahun-min 2015
```


### Integrasi, bukan sekadar penyimpanan

Dokumen yang baru masuk semula berstatus "tidak diketahui" karena belum punya
baris masa berlaku — terurai dan tersimpan, tetapi berperingkat rendah di
pencarian dan tampil tanpa status. Menyisakannya begitu berarti pekerjaan
setengah jadi yang tampak selesai.

Setelah relasi dan masa berlaku dihitung ulang: **93 dari 97** dokumen baru
punya status (79 berlaku, 7 diubah, 7 dicabut), dan seluruhnya terindeks untuk
pencarian.

Keadaan korpus sekarang: **6.124 peraturan · 4.323 berisi naskah ·
142.255 unit pasal · 38.597 relasi**.

## Pengambilan dari Ortax

Setelah ditimbang pemilik pekerjaan, naskah diambil juga dari Ortax untuk
dokumen yang tidak ada di repositori resmi mana pun. Dasarnya: peraturan
perundang-undangan dikecualikan dari hak cipta oleh UU 28/2014 Pasal 42, dan
ketikan ulang yang setia atas teks yang sudah publik tidak melahirkan hak cipta
baru karena tidak ada orisinalitas di dalamnya. Larangan pada halaman Ortax
adalah ketentuan layanan situs, bukan hak cipta atas peraturannya.

Sumber resmi tetap didahulukan; Ortax hanya ditanya bila sumber resmi tidak
memberi naskah. Untuk bentuk terbitan Dirjen Pajak — yang pasti tidak ada di
repositori resmi — ketiga permintaan resmi dilewati: pada 3.000 dokumen itu
9.000 permintaan sia-sia yang hasilnya sudah diketahui nihil sejak awal.

### Hasil

**3.372 dokumen masuk dari 3.615 (93%)**, korpus 6.124 → 9.398.

| Bentuk | Masuk | Unit |
|---|---|---|
| **Surat Edaran** | **2.754** | 5.951 |
| KMK | 193 | 1.148 |
| Pengumuman | 111 | 152 |
| KEP Dirjen | 81 | 628 |
| PER Dirjen | 47 | 831 |
| lainnya | 186 | ~3.200 |

Surat Edaran dari **nol** menjadi 2.754 — 1980-an 368, 1990-an 1.182,
2000-an 715, 2010-an 390, 2020-an 99. Ini kekosongan terbesar korpus sejak awal:
katalog peraturan DJP memuat 39 jenis dokumen dan tidak satu pun Surat Edaran,
padahal SE dipakai sehari-hari.

Celah dalam lingkup: **595 → 163**. Sisanya didominasi 148 SE yang naskahnya
tidak terambil. `S-PJ` (4.955 Surat Dirjen) sengaja belum dikerjakan — ia
kebijakan internal, nilainya paling rendah.

### Empat cacat yang ditemukan sebelum menjalankan massal

**Naskah Ortax datang tanpa satu pun jeda baris.** Satu paragraf panjang,
sedangkan pengurai struktur bekerja per baris — seluruh 3.615 dokumen akan masuk
sebagai satu unit dan tidak dapat dikutip per pasal, yang menghapus manfaat
korpusnya. `rapikan_naskah()` memulihkan jeda pada kata pembuka resmi,
"Pasal N", "BAB N", dan kata urutan diktum. Uji pada PMK 43/2026: 1 unit → 22.

Ayat `(1)` dan huruf `a.` sengaja tidak dipecah membabi buta: keduanya lazim
muncul di tengah kalimat sebagai rujukan ("sebagaimana dimaksud pada ayat (2)"),
dan memecahnya di sana mematahkan kalimat menjadi unit palsu. Ayat dipecah hanya
bila didahului akhir kalimat, atau bila menempel langsung pada judul pasalnya.

**Kalimat pengantar muncul dua kali**, di awal dan di akhir naskah. Yang di akhir
akan terbaca sebagai penutup dokumen. Keduanya dibuang — itu bukan norma.

**Judul terisi pengulangan nomor** ("SURAT EDARAN DIRJEN PAJAK NOMOR: SE -
106/PJ/1984") alih-alih perihalnya. Perihal yang benar ada di daftar katalog,
jadi itu yang didahulukan.

**Dokumen yang gagal di sumber resmi tidak dapat dicoba ulang.** Kegagalan itu
menyatakan "tidak ada di tiga repositori resmi", bukan "tidak ada di mana pun".
193 KMK terjebak di sana sampai antrean dibuka untuk percobaan kedua.

### Satu cacat yang baru ketahuan sesudahnya

96 dokumen tercatat `masuk` padahal tidak ada yang tersimpan: naskahnya didapat,
tetapi nomornya tidak dapat dinormalkan menjadi kunci (Perda dan Keputusan
Gubernur berpola lain, ditambah sisa mojibake). Melaporkannya sebagai berhasil
membuat celah yang masih terbuka tampak sudah tertutup. Statusnya kini
`gagal_simpan`, dan angka sebenarnya **3.372**, bukan 3.468.

### Keadaan korpus

**9.398 peraturan · 7.597 berisi naskah · 153.914 unit pasal · 42.452 relasi**

| Sumber | Dokumen |
|---|---|
| DJP (katalog utama) | 5.051 |
| Ortax | 3.274 |
| JDIH Kemenkeu | 779 |
| peraturan.go.id | 282 |
| SDSN konsolidasi | 6 |

```bash
./.venv/bin/python cli.py isi-celah --jalankan --ortax
```

## Pemeriksaan ulang setelah korpus membesar

Korpus tumbuh 6.029 → 10.535 dengan 4.411 dokumen yang belum pernah diperiksa.
Enam cacat ditemukan; empat memerlukan perbaikan kode.

### Naskah narasi diberi pasal yang tidak ada

Penataan ulang naskah Ortax memecah baris di setiap "Pasal N". Untuk Peraturan
Menteri itu benar. Untuk Surat Edaran — yang tidak berpasal sama sekali —
setiap rujukan di tengah kalimat ("sebagaimana dimaksud dalam Pasal 17D
Undang-Undang KUP") berubah menjadi judul pasal, dan korpus mendapat **1.644
sitasi ke pasal yang tidak pernah ada**.

Mengarang struktur lebih berbahaya daripada kurang mengurai: yang kurang
terurai tampak jelas kurang, sedangkan pasal palsu terlihat sah dan akan
dikutip orang.

Cacat kedua berakar sama: butir bernomor tidak pernah dipecah karena pengurai
hanya memecahnya bila sudah ada pasal. SE-8/PJ/2026 sepanjang **291.276 aksara
masuk sebagai satu unit**.

Keduanya diperbaiki dengan membuat penataan ulang sadar bentuk dokumen —
narasi dipecah di butir bernomor dan tidak di "Pasal N" — lalu naskah yang
terlanjur tersimpan diperbaiki tanpa mengunduh ulang.

| | Sebelum | Sesudah |
|---|---|---|
| Unit pada dokumen narasi | 4.552 | **27.628** |
| Sitasi ke pasal palsu | 1.644 | **0** |

### Pemeriksaan mutu yang salah menilai dirinya sendiri

"Parsing tidak wajar" melonjak ke 2.594 (34%). Ditelusuri: dari ~2.100 dokumen
ber-unit sedikit, **hanya 17 yang benar-benar cacat**. Sisanya surat pendek, di
mana satu-dua unit memang jawaban yang benar — pemeriksaannya menghitung unit
tanpa melihat panjang naskah, sehingga 2.000 temuan palsu menenggelamkan 17
yang sungguhan. Sekarang sadar panjang: seri ditandai hanya bila naskahnya di
atas 15.000 aksara dan unitnya di bawah satu per 6.000 aksara.

### Analisis celah yang melaporkan terlalu sedikit

`PER-12/PJ/2017` dikategorikan **"Lainnya"** oleh Ortax, padahal judulnya
"pencabutan Peraturan Direktur Jenderal Pajak Nomor PER-17/PJ/2013". Peraturan
Dirjen Pajak adalah peraturan perpajakan menurut penerbitnya, apa pun label
topik yang diberikan katalog luar.

Penyaring kategori kini mengecualikan bentuk terbitan otoritas pajak. Celah yang
sebenarnya: **163 → 1.158** — 995 dokumen tersembunyi di balik label yang tidak
andal. Sesudah pengisian: **17**.

### Celah nomor urut — pemeriksaan baru

Membaca pola penomoran korpus sendiri, tanpa katalog mana pun. Bila satu tahun
memuat PER-1 sampai PER-26 tetapi PER-5 dan PER-21 tidak ada, dua dokumen itu
hilang — dan ini satu-satunya cara menemukan yang hilang dari SEMUA sumber.

**429 seri diperiksa, 45 bercelah, 615 nomor hilang**, dan hanya 34 di antaranya
masih ada di Ortax. Sisanya tidak dimiliki sumber mana pun yang dapat dijangkau.

Seri terlalu pendek atau terlalu jarang dilewati: tiga dokumen bernomor 2, 5,
dan 40 bukan bukti 37 dokumen hilang, melainkan bukti bahwa pola penomorannya
tidak diketahui.

### Penomoran

4.411 dokumen Ortax dibandingkan nomor katalognya dengan nomor pada kop
naskahnya sendiri: **98,9% cocok**, 24 berbeda (mis. katalog `SE-3/PJ.43/1991`
sedangkan kopnya `SE-03/PJ.43/1990`), 25 kop tidak terbaca.

### Keadaan korpus

**10.535 peraturan · 8.734 berisi naskah · 174.905 unit · 44.495 relasi**

Surat Edaran: 0 → **3.592**.

| Sumber | Dokumen |
|---|---|
| DJP | 5.051 |
| Ortax | 4.411 |
| JDIH Kemenkeu | 779 |
| peraturan.go.id | 282 |

## Alat inspeksi manual

Tab **Tinjauan** adalah tempat semua temuan mutu diperiksa satu per satu, dan ia
sudah menampung dua pemeriksaan terbaru.

Antreannya sempat basi: tabel temuan dibangun ketika korpus masih 6.029, dan
4.506 dokumen yang masuk sesudahnya tidak pernah menghasilkan temuan. Setelah
dibangun ulang, **1.857 keputusan yang sudah diambil tetap dipertahankan** —
keputusan manusia adalah data termahal di sistem ini dan tidak boleh hilang
karena pemeriksaan dijalankan lagi.

| Pemeriksaan | Antre | Selesai otomatis |
|---|---|---|
| Sitasi menggantung | 2.537 | 308 |
| Naskah tidak tersedia | 1.801 | 0 |
| Parsing tidak wajar | 783 | 0 |
| Konflik status | 79 | 1.543 |
| Identitas tidak cocok | 76 | 51 |
| **Penomoran berselisih** | **63** | 0 |
| **Celah nomor urut** | **45** | 0 |
| Naskah kembar | 7 | 1 |
| Melanggar hierarki | 0 | 282 |

### Dua jenis kasus baru

**Celah nomor urut** — satu kasus untuk satu seri, bukan satu kasus per nomor.
Peninjau memutuskan "apakah seri ini benar-benar bolong" sekali, lalu
menindaklanjuti seluruh nomornya; memecahnya per nomor melahirkan ratusan kasus
yang jawabannya sama. Keyakinannya 0,62 bila sebagian nomor terbukti ada di
katalog lain, dan 0,35 bila tidak — karena tanpa bukti dari luar, lompatan nomor
juga dapat berarti dokumennya memang tidak pernah terbit.

**Penomoran berselisih** — nomor katalog dibaca ulang terhadap kop naskah apa
adanya, sehingga ia menjangkau dokumen dari sumber mana pun, bukan hanya yang
dirayapi dari DJP. Keyakinan 0,40: perbedaannya pasti, tetapi mana yang benar
hanya dapat ditentukan dengan membaca naskahnya.

Keduanya sengaja tanpa usul otomatis. Tidak ada perbaikan yang dapat diterapkan
tanpa membuka dokumennya, dan menawarkan tombol "terapkan" untuk keputusan
semacam itu hanya mengundang persetujuan tanpa pemeriksaan.

## Dasar hierarki dan visualisasinya

### Dasar

| Golongan | Dasar |
|---|---|
| Tangga 7 tingkat | **UU 12/2011 Pasal 7 ayat (1)** huruf a–g |
| Peraturan menteri & lembaga | **UU 12/2011 Pasal 8 ayat (1) dan (2)** — diakui keberadaannya dan mengikat sepanjang diperintahkan peraturan yang lebih tinggi atau dibentuk berdasarkan kewenangan |
| Penetapan (Keputusan) | **UU 30/2014 Pasal 1 angka 7** — Keputusan Administrasi Pemerintahan bersifat konkret, individual, dan final; karena itu bukan peraturan perundang-undangan menurut **UU 12/2011 Pasal 1 angka 2** |
| Kebijakan internal (SE, Instruksi) | tidak memenuhi **UU 12/2011 Pasal 1 angka 2** (tidak mengikat umum); dalam doktrin hukum administrasi disebut peraturan kebijakan (*beleidsregel*) |

Dua golongan pertama bersandar pada bunyi undang-undang. Golongan ketiga
bersandar pada undang-undang untuk sifat Keputusannya, tetapi penggolongan
Surat Edaran sebagai peraturan kebijakan adalah **doktrin**, bukan bunyi pasal —
dan itu disebut apa adanya di halaman, bukan disamarkan menjadi sitasi yang
terdengar sama pastinya.

### Diagram

Tab **Hierarki** membuka dengan diagram SVG yang menunjukkan kedudukan, bukan
jumlah. Tiga keputusan bentuknya:

**Anak tangga digambar sama lebar.** Lebar yang sebanding dengan jumlah dokumen
akan membuat PMK (1.271) tampak lebih besar daripada Undang-Undang (79) —
padahal yang digambarkan justru kebalikannya: kedudukan hukum, yang tidak ada
hubungannya dengan banyaknya dokumen.

**Tingkat yang kosong tetap digambar**, dengan garis putus-putus dan keterangan
"tidak ada di korpus ini". Tangga yang dipotong sampai tingkat yang kebetulan
kita punya akan membuat pembaca menyangka Peraturan Daerah tidak ada dalam
hierarki — padahal ia hanya tidak ada di sini. Empat dari tujuh tingkat kosong:
UUD, TAP MPR, dan kedua Perda.

**Peraturan menteri menempel lewat kurung, bukan sebagai anak tangga.** Ia
diakui keberadaannya tetapi tidak diberi tingkat, dan menggambarnya sebagai
tingkat kedelapan akan mengarang sesuatu yang tidak ada di undang-undangnya.

**Garis merah putus-putus** memisahkan Penetapan dan Kebijakan internal dari
seluruh tangga, dengan label "di bawah garis ini: bukan peraturan
perundang-undangan". Ini pesan utamanya: 6.530 dokumen — lebih banyak daripada
seluruh yang di atas garis — tidak dapat dipakai sebagai dasar norma umum.

## Visualisasi graf relasi

Korpus memuat 10.535 simpul dan 44.495 sisi. Menggambar semuanya sekaligus
menghasilkan gumpalan yang tidak menjawab pertanyaan apa pun. Yang berguna
adalah graf di sekitar **satu** peraturan, karena itulah bentuk pertanyaan yang
sebenarnya diajukan: "aturan ini bersandar pada apa, mencabut apa, dan siapa
yang melaksanakannya".

### Empat keputusan bentuk

**Arah sisi dipisahkan kiri dan kanan.** Relasi keluar — apa yang dilakukan
peraturan ini — di kiri; relasi masuk — apa yang dilakukan peraturan lain
terhadapnya — di kanan. Menggambar keduanya bercampur membuat "mencabut" dan
"dicabut oleh" tidak terbedakan, dan itu justru pembedaan yang paling
menentukan.

**Sisi yang belum tertaut tetap digambar**, sebagai simpul bergaris
putus-putus. Menyembunyikannya membuat graf tampak lebih lengkap daripada
kenyataannya, dan pembaca menyangka sudah melihat seluruh sandaran hukum sebuah
aturan padahal belum.

**Kelompok dipotong, tetapi jumlah penuhnya selalu disebut.** UU 7/1983 menjadi
dasar hukum bagi 2.156 peraturan; menggambar semuanya membuat gambarnya tidak
terbaca, sedangkan memotong tanpa mengatakan berapa yang dipotong membuat
pembaca menyangka itu seluruhnya. Judul kelompok berbunyi "menjadi dasar bagi
(10 dari 2.156)".

**Ambangnya sama dengan yang dipakai sistem** — keyakinan ≥ 0,75, sama seperti
perhitungan masa berlaku. Graf yang dilihat orang harus graf yang dipakai
menghitung, bukan versi yang lebih longgar.

Urutan kelompok bukan menurut jumlah: pencabutan lebih dulu, sandaran hukum
terakhir. `DASAR_HUKUM` paling banyak jumlahnya tetapi paling sedikit akibatnya;
menaruhnya di atas akan mengubur pencabutan yang justru menentukan keberlakuan.

Setiap simpul dapat diklik untuk memindahkan pusat graf — sehingga rantai
"aturan ini dicabut oleh itu, yang kemudian diubah oleh yang lain" dapat
ditelusuri tanpa meninggalkan halaman.

### Cacat yang ditemukan saat membangunnya

Graf pertama menampilkan **"UU 7/1983 dicabut oleh PMK-141/PMK.03/2010"** —
mustahil, karena PMK tidak dapat mencabut undang-undang. Ditelusuri: 51
pelanggaran hierarki masih berkeyakinan penuh meski antrean tinjauan
melaporkan semuanya sudah diselesaikan.

Sebabnya id kasus dibentuk dari `relation.id`. Kolom itu autoincrement dan
**diberi ulang setiap kali relasi dibangun ulang**, sehingga pelanggaran baru
mewarisi id — dan karenanya status "sudah diselesaikan" — milik kasus lama yang
tidak berhubungan. Diperiksa: nol perbaikan mendarat di relasi yang salah, tetapi
51 pelanggaran lolos tanpa pernah ditangani.

Id kasus kini dibentuk dari isi relasinya (`src ~ tipe ~ dst`). Satu cacat
lanjutan muncul sesudahnya: relasi yang sama dapat tercatat lebih dari sekali
dengan keyakinan berbeda, dan kunci berbasis isi menyatukannya menjadi satu
kasus — sehingga hanya satu baris yang diperbaiki. Usulnya kini menyasar seluruh
baris kembar.

**Pelanggaran hierarki berkeyakinan tinggi: 51 → 0.**

## Simpul kembar di graf: satu dokumen tampil dua kali

Graf menampilkan `563-kmk-03-2003` sebagai simpul berbayang "belum ada di
korpus" tepat di sebelah `563/KMK.03/2003` yang ada — dua simpul untuk satu
dokumen. Tiga sebab berbeda, ketiganya diperbaiki.

**Slug sumber luar disimpan apa adanya.** JDIH Kemenkeu menyebut sasaran
relasinya dengan slug miliknya sendiri (`563-kmk-03-2003`), sedangkan
`enrich.py` memakai pengurai slug milik peraturan.go.id untuk membacanya —
bentuknya berbeda, jadi selalu gagal dan slug tersimpan mentah sebagai
`dst_raw`. **1.260 relasi** tertaut setelah slug dipadankan dengan kunci korpus
tanpa awalan jenisnya. Pemadanan hanya diterima bila cocok **tepat satu**
dokumen; diperiksa, nol yang ambigu. Jalur pemadanannya ditandai `+slug` pada
kolom `method` supaya tetap terlihat bahwa ia lebih longgar daripada pemadanan
kunci penuh.

**Spasi di dalam nomor memotong rujukan.** Naskah lama menulis
`291/KMK. 05/1997`, dan pola penangkap rujukan berhenti di spasi itu —
menghasilkan `291/KMK.` yang tidak akan pernah tertaut ke dokumen mana pun.
Pola kini mengizinkan spasi tepat sesudah titik pada kode unit, dan penormal
merapatkannya. Diuji terhadap delapan bentuk nomor yang sudah benar: semuanya
tetap benar.

**Baris lama tidak tergantikan.** Pembangunan ulang relasi memakai *upsert*
berdasarkan `dst_raw`, sehingga baris terpotong tidak tertimpa oleh versi
benarnya — keduanya tinggal berdampingan. 23 baris terpotong dihapus, dan hanya
yang **sudah punya pengganti tertaut** dari sumber dan jenis relasi yang sama;
tanpa syarat itu penghapusan akan membuang rujukan yang belum ada gantinya.

| | Sebelum | Sesudah |
|---|---|---|
| Relasi menggantung | 11.593 | **10.332** |
| Relasi tertaut | 32.902 | **34.189** |
| Rujukan terpotong | 24 | **1** |

Yang tersisa menggantung sebagian besar memang di luar korpus: Keppres
pengangkatan (`20/P`, `187/M`) dan KMK organisasi, yang sudah diklasifikasikan
di antrean tinjauan sebagai di luar lingkup katalog pajak.

```bash
./.venv/bin/python cli.py tautkan --terapkan
```

## "Ada di korpus" tidak sama dengan "naskahnya ada"

Ditelusuri dari satu dokumen: `KEP-386/PJ/2010` tercatat lengkap metadatanya di
korpus, dari katalog DJP, tetapi `has_body=0` — kosong isinya. Analisis celah
tidak pernah mengambilnya karena penyaringnya bertanya **"dokumennya ada di
korpus?"**, bukan **"naskahnya ada?"**.

Ternyata itu berlaku luas: **1.657 dari 1.801 dokumen tanpa naskah justru dimuat
katalog Ortax** dan tidak pernah diambil karena alasan yang sama. Dokumen
semacam itu tidak dapat dicari maupun dikutip; ia hanya terhitung dalam jumlah.

| | Sebelum | Sesudah |
|---|---|---|
| Tanpa naskah | 1.801 | **667** |
| Berisi naskah | 8.734 | **9.884** |
| Unit pasal | 174.905 | **187.051** |

1.165 dokumen terisi. Penyimpan diperbaiki sekaligus: dokumen yang **sudah
punya naskah** tetap tidak ditimpa — salinan DJP rujukan utama — tetapi mengisi
badan yang **kosong** bukan mengganti apa pun. `source` diberi tanda gabungan
(`djp+ortax`) supaya tetap terbaca bahwa metadatanya dari DJP sedangkan
naskahnya dari tempat lain.

### Antrean tinjauan yang menumpuk kasus mati

Sesudah pengisian, antrean masih menampilkan **1.801 naskah kosong** padahal
sebenarnya tinggal 667. Kasus yang masalahnya sudah teratasi lewat jalan lain
tidak pernah dicabut, sehingga peninjau akan mengerjakan 1.134 dokumen yang
naskahnya sudah terisi.

`bangun()` kini menutup kasus yang tidak dihasilkan lagi oleh pemeriksaannya,
dengan status `tidak_berlaku_lagi`. **Ditutup, bukan dihapus**: riwayat bahwa
masalah itu pernah ada tetap berguna, dan menghapusnya akan menyembunyikan
bahwa korpus pernah berada dalam keadaan itu.

**Antrean 5.742 → 3.700**, 2.042 kasus mati ditutup.

### Batas DDTC

Yang publik: naskah lengkap dan label status. Yang terkunci di balik akun: tab
**Riwayat** dan **Peraturan Terkait** — dicoba dibuka, yang muncul ajakan
mendaftar, dan datanya tidak ada di halaman maupun di lalu lintas jaringannya.
Riwayat itu justru rantai pencabutan yang kita bangun sendiri dari teks.

### Keadaan korpus

**10.551 peraturan · 9.884 berisi naskah (93,7%) · 187.051 unit · 52.820 relasi**

| Pemeriksaan | Sebelum | Sekarang |
|---|---|---|
| Naskah tidak tersedia | 1.801 (17,1%) | **667 (6,3%)** |
| Parsing tidak wajar | 783 | 836 (8,5%) |
| Status berselisih | 1.611 | **1.407 (13,3%)** |
| Celah terhadap Ortax | 17 | **16** |

---

## DDTC sebagai sumber: koreksi atas kesimpulan sendiri

Modul `pipeline/sources/ddtc.py` memuat catatan bahwa DDTC tidak dapat dipakai
sebagai konektor, karena percobaan pertama mengembalikan status "Berlaku" untuk
alamat yang jelas-jelas palsu. Catatan itu benar tentang **apa yang terjadi**,
tetapi salah tentang **sebabnya**. Yang keliru bukan sumbernya; yang keliru
tekniknya — yang dibaca adalah markup yang dirakit JavaScript, sedangkan datanya
sudah ikut terkirim pada HTML dalam bentuk payload React Server Component.

Dengan payload itu:

- **Daftar** datang terstruktur: `title`, `jenis_peraturan`, `nomor`,
  `target_url`, `description` (perihal), `status`, `date_berlaku`, ditambah
  `total_data` dan `total_page` sehingga kelengkapannya dapat diperiksa.
- **Dokumen** memuat objek metadata utuh — nomor, tahun, `tanggal_efektif`, dan
  `status.title` — beserta naskah lengkap di dalam `#detail__content`.
- **Naskahnya berstruktur tabel** dengan penanda huruf dan angka pada selnya
  sendiri. Ini kebalikan dari Ortax, yang mengirim naskah tanpa satu pun baris
  baru sehingga seluruh dokumen menjadi satu unit dan harus dibentuk ulang
  dengan heuristik.

Yang tidak terbuka: **Riwayat** dan **Peraturan Terkait**. Keduanya menjawab
`related: "$undefined"` dengan `is_logged_in: false`. Jadi rantai pencabutan
milik DDTC tetap di balik langganan, dan tidak diambil.

### Penjaga yang tetap dipasang

Kekeliruan lama tidak dijawab dengan optimisme, melainkan dengan `_sah()`: satu
dokumen diterima hanya bila metadatanya ada dan slug-nya cocok, naskahnya lebih
dari 400 aksara, dan penanda strukturnya ada. Slug karangan
(`perda-kabupaten-tidak-ada-999-tahun-2099`,
`peraturan-gubernur-provinsi-bali-9999-tahun-2026`) ditolak; slug yang salah
tebak untuk dokumen nyata (`keputusan-dirjen-pajak-kep-386pj2010`) juga ditolak,
bukan dijawab dengan kerangka halaman.

### Daerah menuntut identitas yang memuat daerahnya

"Perda 1 Tahun 2024" bukan identitas — setiap kabupaten dan setiap provinsi
punya satu. Pada 532 peraturan daerah dari Ortax, 28 identitas bertabrakan dan
56 naskah akan saling menimpa, tanpa satu pun galat yang terlihat: yang hilang
bukan barisnya, melainkan naskah yang tersimpan lebih dahulu. Ortax bahkan
menandai "peraturan bupati nomor 46 tahun 2021" sebagai PERDA.

`normalize.kunci_daerah()` menaruh daerahnya pada medan `unit` — tempat yang
memang sudah ada untuk pembeda semacam ini ("PJ" pada PER-31/PJ/2009) — sehingga
`perda-1-provinsi-bali-2024` dan `perda-1-kab-buleleng-2024` menjadi dua
dokumen, dan seluruh hilir memahaminya tanpa perubahan skema.

### Tiga kekeliruan yang ditemukan lewat angka yang tidak cocok

1. **Kategori Ortax menyembunyikan pajak daerah.** 332 dari 391 Perda bertanda
   "Lainnya", padahal judulnya "tata cara pemungutan pajak barang dan jasa
   tertentu" dan "nilai jual objek pajak" — taksonomi PPh/PPN/KUP/PBB/BPHTB
   tidak punya tempat untuk PDRD. Ini kelas kekeliruan yang sama yang sudah
   pernah diperbaiki untuk bentuk terbitan DJP; `JENIS_PAJAK_DAERAH` menutupnya.
2. **Pemisah kartu yang hanya ada di satu sisi.** Kartu daerah punya medan
   `image`, kartu pusat tidak. Memotong daftar lewat medan itu membuat sisi
   pusat terbaca satu baris per halaman: 35 Inpres menjadi 4. Diganti dengan
   jendela antar-kecocokan kepala kartu, yang ada di kedua sisi.
3. **Batas tahun yang memotong sejarah.** Dengan `TAHUN_AWAL = 1970`,
   penelusuran UU berhenti di 325 dari 352 — yang hilang adalah undang-undang
   sebelum 1970. Kekurangan itu tidak tampak sebagai galat, melainkan sebagai
   daftar yang sudah selesai. Batasnya diturunkan ke 1800.

Ketiganya punya bentuk yang sama: angka yang salah tetap terbaca wajar. Itu
sebabnya `total_data` dari payload selalu dibandingkan dengan jumlah yang
sungguh terambil, dan selisihnya dicetak — bukan disimpan diam-diam.

### Status DDTC: bukti, bukan putusan

`verifikasi.SUMBER_RESMI` kini membedakan repositori resmi (peraturan.go.id,
JDIH Kemenkeu, JDIH BPK) dari sumber sekunder. DDTC terkurasi dan berguna,
tetapi ia penerbit swasta: bila hanya DDTC yang menyatakan sesuatu, yang kita
punya adalah pembacaan pihak ketiga. Karena itu keyakinannya 0,62 — di bawah
ambang penyelesaian otomatis 0,88 — sehingga perkaranya naik ke peninjau alih-
alih diputus program. Bila ia sepakat dengan sumber resmi, keyakinannya naik
0,02.

Statusnya ikut pada daftar katalog, jadi 15.761 penilaian pusat tersedia tanpa
satu pun pengambilan halaman tambahan.

---

## Tiga kekeliruan penguraian yang ditemukan lewat satu dokumen

Perda Kabupaten Buleleng 9/2023 dibuka di antarmuka untuk memeriksa hasil
penyerapan, dan daftar pasalnya mulai dari **Pasal 4**. Ketentuan umum, ruang
lingkup, dan jenis pajak tidak ada. Tiga sebab yang berbeda, semuanya diam.

### 1. Penjelasan menimpa batang tubuh

`Unit.unit_id()` menyertakan nama bagian dokumen ke dalam kunci hanya untuk
`menimbang`, `mengingat`, dan `penutup_meta`. `penjelasan` tertinggal — sehingga
penjelasan Pasal 1 memakai kunci yang sama persis dengan batang tubuh Pasal 1,
dan `INSERT OR REPLACE` membuat yang datang belakangan menang. Penjelasan selalu
datang belakangan.

Yang terkena hanya pasal yang batang tubuhnya **tidak berayat**, karena hanya
itu yang berkunci sependek penjelasannya. Itu justru pasal yang paling sering
dicari: definisi, ruang lingkup, penutup. Pada sampel 400 dokumen berpenjelasan,
**212 terkena** dan 1.751 unit hilang.

Kuncinya sekarang menyertakan bagian dokumen untuk semua bagian selain batang
tubuh.

### 2. `store_units` melaporkan masukan, bukan simpanan

Fungsinya mengembalikan `len(units)`. Karena penimpaan terjadi di dalam basis
data, angka itu menyembunyikan tepat kegagalan yang paling perlu terlihat: 505
unit dilaporkan, 502 tersimpan, dan tiga yang hilang adalah pasal ketentuan
umum. Sekarang yang dikembalikan hasil `COUNT(*)` sesudah menyimpan.

### 3. Pasal bernomor Romawi tidak dikenali

Lihat catatan pada `structure.RE_PASAL`. Peraturan pengubah memakai "Pasal I"
untuk perubahannya dan "Pasal II" untuk mulai berlakunya; keduanya tidak
terbaca, sehingga klausul "mulai berlaku" menempel ke pasal Arab terakhir dan
seluruh isi pasal yang diubah ditandai `penutup`.

**Yang menyatukan ketiganya:** tidak satu pun menimbulkan galat. Dokumennya
tersimpan, jumlahnya bertambah, antarmukanya bekerja. Yang salah hanya isinya —
dan hanya terlihat karena satu dokumen dibuka dan dibaca.

---

## Hierarki: lapis daerah dan tingkat yang bergantung pada daerahnya

Perda menempati **dua** tingkat pada Pasal 7 ayat (1): huruf f untuk provinsi,
huruf g untuk kabupaten/kota. Pemisahan itu bukan tata letak — Perda
kabupaten/kota tidak boleh bertentangan dengan Perda provinsi. Karena korpus
menyimpan keduanya di bawah satu kode `PERDA`, tingkatnya hanya dapat dijawab
oleh daerahnya, dan `peta()` sekarang memisahkannya di dalam kueri.

Perda yang daerahnya tidak diketahui — 316 warisan Ortax — ditampilkan
**terpisah**, bukan dimasukkan ke kabupaten/kota karena bukan provinsi.
Menebaknya akan menampilkan tangga yang salah justru pada bagian yang paling
mudah dipercaya.

Lapis yang ditambahkan beserta dasarnya:

| Bentuk | Kedudukan | Dasar |
|---|---|---|
| Qanun | setingkat Perda | Pasal 7 f/g jo. UU 11/2006 Pasal 1 angka 21 |
| Peraturan Gubernur/Bupati/Wali Kota | diakui di luar tangga | Pasal 8 ayat (1) dan (2) |
| Keputusan Gubernur/Bupati/Wali Kota, Keputusan DPRD | penetapan | UU 30/2014 Pasal 1 angka 7 |
| Instruksi Gubernur, Surat Edaran Gubernur | kebijakan internal | doktrin beleidsregel |

Pasal 8 ayat (1) menyebut gubernur dan bupati/wali kota secara eksplisit,
sejajar dengan menteri. Jadi peraturan kepala daerah bukan "tingkat kedelapan"
di bawah tangga Pasal 7; ia diakui di luar tangga.

---

## Mengukur dulu, menelusuri kemudian

Penelusuran penuh katalog pusat DDTC ditinggalkan setelah berjalan lebih dari
sejam dan baru sampai bentuk ke-40 dari 117. Sebabnya bukan lambatnya jaringan:
daftar mentok di 100 hasil, PMK punya 3.516 dokumen di 23 tahun — rata-rata 153
setahun — sehingga hampir **setiap** tahun menuntut dua arah urutan ditambah
penambalan nomor satu per satu. PMK sendiri diperkirakan 2,5 jam.

Padahal yang ingin diketahui lebih dahulu bukan daftarnya, melainkan apakah ada
selisih. Dan `total_data` sudah menjawabnya dalam satu permintaan.
`jumlah()` menanyakan itu; membandingkan 22 bentuk yang korpus kita memang bawa
selesai dalam satu menit:

| Bentuk | DDTC | Kita | Selisih |
|---|---|---|---|
| PMK | 3.516 | 1.273 | +2.243 |
| PP | 942 | 326 | +616 |
| Perpres | 447 | 62 | +385 |
| UU | 352 | 79 | +273 |
| KMK | 2.515 | 3.004 | **−489** |
| Pengumuman | 217 | 253 | **−36** |

Dua baris terakhir yang membuat angka ini dapat dipercaya: selisihnya berjalan
ke **dua arah**. Korpus kita berasal dari katalog DJP yang khusus perpajakan dan
membawa seluruh KMK kurs dan tarif bunga; "Perpajakan DDTC" mencakup seluruh
fiskal termasuk bea masuk dan cukai. Jadi sebagian selisih adalah perbedaan
lingkup, bukan dokumen yang hilang — pembedaan yang sama yang sudah dijaga untuk
Ortax di `celah.py`.

Enumerasi penuh kemudian dijalankan hanya untuk lapis atas tangga Pasal 7 — UU,
Perpu, PP, Perpres, Inpres, Keppres — karena itu yang menjawab masalah lain:
**86.737 rujukan menggantung**, dengan 60 sasaran teratas menutup 60% di
antaranya. Yang paling sering dirujuk adalah UU 23/2014 (5.003 kali), PP 9/2015
(3.524), PP 58/2005 (3.194), UU 33/2004 (2.899) — dasar hukum yang dikutip
hampir setiap Perda pada "Mengingat". Korpus yang tidak dapat menyelesaikan
dasar hukum dokumennya sendiri punya lubang, dan lubang itu bukan soal lingkup.

Hasilnya: 1.954 dokumen, setiap bentuk lengkap (352/352, 942/942, 447/447),
nol mentok, **79 permintaan**.

## Status DDTC sebagai bukti: dua pemetaan yang melebihkan

Kosakata status DDTC lebih halus daripada yang `bakukan()` tangani, dan dua di
antaranya salah dengan arah yang berbeda:

- `"Sebagian Sudah Tidak Berlaku karena Diganti/Dicabut"` terbaca `dicabut`,
  karena pola "tidak berlaku" diperiksa lebih dahulu. Pencabutan sebagian
  menjadi pencabutan penuh — dan itu mematikan ketentuan yang justru masih
  berlaku. Melebihkan pencabutan sama merusaknya dengan melewatkannya; bedanya,
  yang ini tampak seperti kehati-hatian. Sekarang `dicabut_sebagian`, dan
  `_masih_hidup()` mengembalikan None untuknya: tidak ada satu jawaban yang
  benar pada tingkat dokumen, jadi labelnya disimpan sebagai bukti bagi
  peninjau alih-alih dipaksa menjadi putusan.
- `"Perubahan atau Penyempurnaan"` terbaca `tidak_diketahui` karena peta hanya
  mengenal "disempurnakan", bukan "penyempurnaan". 42 dokumen kehilangan status
  yang sebenarnya dinyatakan.

Perbandingan pertama atas 388 dokumen yang kita punya: **293 sepakat, 53
berselisih, 42 DDTC bisu.** Yang paling perlu ditinjau adalah 26 dokumen yang
DDTC nyatakan dicabut sedangkan kita masih menghitungnya berlaku — dan
sebabnya jelas begitu dilihat: peraturan pencabutnya belum ada di korpus, jadi
relasi pencabutan tidak pernah terbentuk. Ini arah kekeliruan yang paling
berbahaya, dan justru yang tidak dapat ditemukan dari dalam korpus sendiri.

---

## Di mana PDF disimpan, dan mengapa hampir tidak ada

`data/pdf/` — 339 berkas, 121 MB. Di sebelahnya `data/raw_html/` (192 MB, HTML
sumber) dan `data/ocr/` (kosong: jalur OCR belum pernah dijalankan pada korpus
ini). Tautan berkas ke dokumennya ada di tabel `attachment`
(`reg_id`, `url`, `local_path`, `pages`, `route`, `ocr_conf`).

**296 dari 339 berkas itu yatim.** Bukan karena unduhannya gagal — berkasnya ada
dan utuh — melainkan karena jalur yang mengunduh berbeda dari jalur yang
mencatat:

| Jalur | Menulis baris `attachment`? | Berkas |
|---|---|---|
| `crawl.download_attachments` (lampiran DJP) | ya, beserta `local_path` | 43 |
| konektor `peraturan_go_id` | tidak — PDF diunduh hanya untuk diambil teksnya | 286 |
| konektor `bpk` | tidak, sama | 10 |

Konektor verifikasi menamai berkasnya dari alamat sumber (`pgi-uu40-2004.pdf`),
mengambil teksnya, lalu melupakan berkasnya. Akibatnya bukan berkas yang hilang
melainkan berkas yang **tidak dapat ditemukan**: naskah resminya ada di disk, dan
tidak ada satu pun kueri yang menghubungkannya dengan peraturannya.

`pipeline/tautkan_pdf.py` memulihkan tautannya tanpa mengunduh apa pun.
Namanya masih memuat identitasnya, tetapi dalam bentuk yang sudah kehilangan
pemisahnya, sehingga satu nama sering punya beberapa tafsir:

- `pgi-uu40-2004.pdf` → UU 40/2004
- `pgi-PP+NO+147+TH+2000.pdf` → `+` spasi ter-URL-encode, "NO"/"TH" singkatan
- `pgi-PP0031994.pdf` → angka menyatu tanpa pemisah: PP 3/1994 **atau** PP 31994/1994
- `bpk-KMK_20458_KMK.04_2003.pdf` → tiap `_` bisa berarti awal "%20" (spasi)
  atau pemisah "/", dan pada satu nama keduanya muncul bersamaan
- `pgi-kp10-1999.pdf` → "kp" = Keppres, `pgi-ps101-2006.pdf` → "ps" = Perpres;
  singkatan peraturan.go.id sendiri, tidak ada di peta jenis mana pun

Karena itu tafsirnya tidak dipilih oleh aturan penamaan melainkan oleh korpus:
semua kombinasi dibangkitkan, lalu **tepat satu** yang menunjuk dokumen nyata
diterima. Dua yang menunjuk dokumen nyata berarti namanya tidak cukup
membedakan, dan itu dilaporkan, bukan dipilih. Lapis kedua memadankan tanpa kode
unit — nama berkas sering menulis "KMK 222 Tahun 2002" untuk dokumen yang
kuncinya `kmk-222-kmk-03-2002`; itu bukan dokumen lain, itu nomor yang sama
ditulis lebih pendek.

Hasil: **295 dari 296 tertaut**, nol ambigu, nol tak terurai. Sisa satu —
`pgi-kp17-1998.pdf` → Keppres 17/1998 — adalah temuan tersendiri: kita punya PDF
resminya, dokumennya belum ada di korpus.

**Yang tetap kurang:** 20.127 dari 20.459 dokumen tidak punya PDF resmi
tersimpan. Sebabnya bukan kegagalan; belum pernah ada langkah yang mengunduh PDF
secara sengaja. Naskah DDTC datang sebagai teks, dan PDF aslinya di balik
langganan (`access_file_ori: false`, `asset: null` tanpa masuk). Untuk keperluan
kepastian hukum — mengutip pindaian resmi, bukan transkripsi — pindaiannya perlu
diambil per dokumen dari peraturan.go.id atau JDIH.

---

## Ortax menyimpan naskahnya dua kali, dan yang mudah ditemukan bukan yang lengkap

Medan `articleBody` pada blok JSON-LD ada di setiap halaman, langsung terbaca,
dan untuk sebagian besar dokumen memang memuat naskah lengkap. Karena itu tidak
ada yang tampak salah selama 5.874 dokumen masuk lewat sana. Dua hal yang tidak
terlihat:

**Strukturnya.** `articleBody` adalah satu paragraf tanpa satu pun jeda baris,
sehingga jedanya harus dikira-kira dari pola kata (`rapikan_naskah`). Hasilnya
bermedian **5 baris per dokumen**; 2.836 dokumen tersimpan dengan kurang dari 5
baris. Naskah yang sama juga ada di halaman itu sebagai `<div id="isiaturan">` di
dalam payload RSC — HTML bertabel, dengan penanda huruf dan angka pada selnya
sendiri. Perda 26994 memberi **141 baris** dari sana, melawan 29 baris hasil
pengiraan; pada uji 20 dokumen, baris rata-rata naik 13,1 → 64,3.

Akibatnya bukan pada panjang naskah melainkan pada apa yang dapat dicari:
dokumen bersatuan lima baris tidak dapat dikutip per pasal, dan pencarian
pasalnya mengembalikan seluruh dokumen sebagai satu blok.

**Kelengkapannya, pada sebagian bentuk.** Untuk Surat Dirjen Pajak,
`articleBody` hanya cuplikan 300 aksara berakhiran "…", dan halaman itu sendiri
menandainya `isFullContent: false`. S-PJ 962/PJ.6/2005: 304 aksara lewat
`articleBody`, **4.994** lewat `isiaturan`.

Ini bentuk kegagalan yang paling berbahaya di seluruh pekerjaan ini: cuplikan
tersimpan sebagai naskah yang sah, lengkap dengan judul dan nomor yang benar.
Dokumennya terhitung masuk, dapat dicari, dapat dikutip — dan isinya potongan
kalimat pertama. Bila 6.642 Surat Dirjen diambil sebelum ini diketahui, seluruhnya
akan masuk sebagai cuplikan, dan tidak ada satu pun angka pemeriksaan yang akan
menunjukkannya.

Korpus lama nyaris tak terkena: hanya **2** naskah tersimpan yang berupa
cuplikan. Yang terkena luas hanya strukturnya, dan `ulang_ortax.py`
memperbaikinya dengan ambang **jumlah baris**, bukan panjang — naskah baru bisa
lebih pendek karena markup tidak lagi ikut terhitung, jadi panjang bukan ukuran
yang benar. Naskah lama dipertahankan bila yang baru tidak lebih berstruktur.

### Kehilangan kode saat memperbaikinya

Suntingan untuk memperbaiki pembaca ini membabat blok `rapikan_naskah` beserta
`RE_PECAH*`, `BENTUK_NARASI`, `JEDA_MINIMUM`, dan `RE_PENGANTAR` dari
`ortax.py` — perbaikan yang dulu menghapus 1.644 pasal palsu pada Surat Edaran.
Proyek ini bukan repositori git, jadi tidak ada yang dapat dipulihkan dari
sana; blok itu diambil kembali dari transkrip sesi dan diverifikasi ulang.
Pelajarannya bukan tentang regex: **indeks potongan dihitung terhadap teks
sebelum penggantian, lalu dipakai pada teks sesudahnya.**

## Kelengkapan yang dihitung terhadap himpunan yang salah

`_lengkapi_nomor` berhenti bila `len(kumpul) >= total`. `kumpul` memuat hasil
seluruh penelusuran, sedangkan `total` adalah jumlah satu potongan — satu bentuk
pada satu tahun. Untuk PMK, `kumpul` sudah berisi ribuan dokumen ketika tahun
2008 diperiksa terhadap `total = 253`, jadi syarat berhentinya terpenuhi
seketika: penambalan berhenti sebelum dimulai, dan laporannya berbunyi
**"tambal 0"** — seolah tidak ada yang perlu ditambal.

Hasilnya PMK terkumpul 3.202 dari 3.516. Yang menyelamatkan bukan pemeriksaan
lain melainkan `mentok`, yang membandingkan angka per potongan dan menyebut
delapan tahun (2007–2014) yang masing-masing berhenti tepat di 200. Angka yang
terpotong tidak boleh terbaca sebagai angka yang lengkap — dan di sini itulah
satu-satunya hal yang membuatnya terlihat.

Sekarang setiap potongan punya himpunannya sendiri (`potong`), dan `kumpul` hanya
menerima hasilnya setelah potongan itu selesai.

---

## Penanda yang hanya ada sebagai struktur

Pengambilan ulang Ortax lewat `isiaturan` mula-mula membuat satu Surat Edaran
**berbaris 5 → 118 tetapi unitnya 6 → 3.** Naik pada ukuran yang dipakai, turun
pada ukuran yang sebenarnya penting.

Sebabnya: Ortax menandai butirnya sebagai `<ol><li>`, dan **nomornya dirender
oleh peramban — tidak ada di dalam teks.** Mengubah HTML menjadi teks apa adanya
menghasilkan sederet kalimat tanpa satu pun penanda, dan pengurai struktur yang
bekerja dari penanda tidak dapat memisahkannya. Ditambah `<br>` yang tidak
dimasukkan sebagai pemisah baris, sehingga judul menyatu: "SURAT EDARAN DIREKTUR
JENDERAL PAJAKNOMOR SE - 15/PJ.6/2005TENTANG…".

`_nomori_butir()` memulihkan nomornya. Itu bukan mengarang: nomor tersebut
memang bagian dari dokumennya, hanya disimpan sebagai struktur alih-alih sebagai
aksara. Daftar tak berurut (`<ul>`) diberi tanda hubung, karena di sana memang
tidak ada nomor. Sesudahnya: SE 15/PJ.6/2005 unit 6 → 39, SE 9/PJ.7/2005 5 → 45,
nol pasal palsu.

**Yang paling perlu dicatat adalah ukurannya, bukan perbaikannya.** Ukuran
penerimaan semula "jumlah baris", dan dengan ukuran itu naskah yang strukturnya
lebih buruk akan diterima untuk 4.623 dokumen — dengan laporan yang terlihat
membaik. Ukuran yang benar adalah **jumlah unit**, karena itulah yang menentukan
apakah sebuah dokumen dapat dicari dan dikutip per pasal. Sesudah diganti: pada
uji 25 dokumen, unit rata-rata 7,2 → 29,8.

Ambang pemicu penguraian narasi juga diperbaiki di `structure.py`: syaratnya
semula panjang naskah lebih dari 2.000 aksara, dipilih ketika yang diurai baru
peraturan. Surat justru pendek — Surat Dirjen bermedian 2.059 aksara — sehingga
603 surat berbutir bernomor di atas 1.500 aksara tersimpan sebagai satu unit
tunggal, dan 43% seluruh Surat Dirjen hanya punya satu unit. Sekarang pemicunya
ada tidaknya butir (`_ada_butir`), bukan panjangnya. Pemeriksaan regresi pada
enam bentuk (Perda, PMK, UU, PP, SE, KEP): unit hanya bertambah atau tetap, nol
yang turun.

---

## Awalan tiga huruf menimpa bentuk dari taksonomi — dan mengapa itu dibiarkan

Pada 7.845 baris katalog, kode bentuk yang diturunkan `normalize_nomor` berbeda
dari kode yang diberikan pemanggilnya, karena `PREFIX_CODES` diperiksa lebih
dahulu daripada argumen `jenis`:

| Dari taksonomi | Menjadi | Baris |
|---|---|---|
| S-PJ (Surat Dirjen Pajak) | S | 6.632 |
| PERDJBC (Peraturan Dirjen Bea Cukai) | PER (Dirjen Pajak) | 298 |
| KEPDJBC | KEP (Dirjen Pajak) | 270 |
| SE-DJBC | SE (Dirjen Pajak) | 172 |
| KEPMENAKER | KEP | 55 |

Terlihat seperti dua penerbit yang berbeda dilebur menjadi satu. Diperiksa, dan
ternyata tidak:

- Kolom `jenis_code` pada tabel `regulation` diisi dari **taksonomi sumber**,
  bukan dari `RegID.jenis_code`. Yang tersimpan tetap `PERDJBC`, `SE-DJBC`,
  `S-PJ`.
- Kuncinya terpisah lewat **unitnya**: `per-44-bc-2011` melawan
  `per-31-pj-2009`. Nol id ganda di seluruh korpus.
- Kedua sisi perbandingan melewati fungsi yang sama, jadi rujukan tetap
  bertemu dengan dokumennya.

Jadi penimpaan itu kosmetik di dalam `RegID` dan tidak dibiarkan karena
diabaikan, melainkan karena mengubahnya akan mengubah kunci seluruh korpus untuk
memperbaiki medan yang tidak dipakai menyimpan apa pun — risiko besar untuk
keuntungan nol. Yang dicatat di sini justru supaya lain kali tidak "diperbaiki"
tanpa memeriksa dulu apa yang sebenarnya rusak.

## Nomor yang gagal diurai karena tanda baca dan aksara tak tampak

Katalog fiskal DDTC menyisakan 35 dokumen tanpa kunci. Empat sebab, semuanya
tentang penulisan, bukan tentang nomornya:

1. **Nomor beranak pada bentuk berunit** — "164.1/PMK.05/2007". Dukungan nomor
   anak sebelumnya hanya ada pada bentuk "N TAHUN YYYY". 16 dokumen.
2. **Aksara lebar-nol di ujung nomor** — "134/PMK.010/2020" diikuti tujuh
   aksara tak tampak (U+200B dan kawanannya). Pola nomor menuntut empat digit di
   ujung, dan di ujungnya ada yang tidak terlihat siapa pun. `_clean` kini
   membuangnya lebih dahulu.
3. **Titik sesudah awalan** — Keputusan Menteri Tenaga Kerja menulis
   "KEP.289/MEN/XII/2011", bukan "KEP-289/…". 17 dokumen.
4. **Tahun dua digit** — "156/Kp/VII/95". Konvensi yang berbeda; dua dokumen,
   dibiarkan tanpa kunci alih-alih ditebak.

Hasil: 35 → **2** tanpa kunci dari 3.812, tanpa satu pun regresi pada bentuk
yang sudah bekerja.

---

## Membaca satu aturan utuh: naskah penuh, bergulir, dapat dicari di dalamnya

Sebelum ini ada dua tampilan, dan keduanya menjawab pertanyaan lain dari yang
paling sering diajukan: `/api/pasal` memberi **satu** pasal, `/api/daftar-pasal`
memberi **daftar judul** pasalnya. Yang tidak ada: apa isi peraturannya.

`pasal.naskah_penuh()` dan `/api/naskah` mengisi itu — seluruh unit berurut,
setiap unit membawa **kutipannya sendiri**. Kutipan dibentuk di lapisan data,
bukan di tampilan, karena ia bagian dari datanya: yang menyalinnya ke dokumen
lain harus mendapat rujukan yang sama persis dengan yang tersimpan, bukan
rangkaian teks yang kebetulan dirakit antarmuka.

### Kutipan yang tidak dapat dikutip

12.145 dokumen dari DDTC menyimpan **slug basis data** pada kolom `canonical` —
"perda-9-kab-buleleng-2023" — karena `_simpan_dokumen` meneruskan `kunci` ke
kolom yang seharusnya berisi sebutan. Tidak ada galat, tidak ada angka yang
turun; yang rusak hanya satu hal, yaitu satu-satunya hal yang gunanya dipakai di
luar sistem ini. Semua diperbaiki menjadi "PERDA 9/Kab. Buleleng/2023".

### Menggambar ulang seluruh dokumen pada tiap ketukan

Pencarian di dalam aturan mula-mula menggambar ulang seluruh naskah setiap kali
kotak carinya berubah. Pada Perda 505 unit itu terasa lambat tetapi jalan; pada
PP 28/2024 — **4.639 unit** — peramban menggantung, dan pengukurannya sendiri
ikut mati sebelum menghasilkan angka.

Yang berubah saat mencari hanya unit yang memuat istilahnya. Jadi DOM dibangun
sekali, dan tiap pencarian menyentuh dua himpunan kecil saja: unit yang tadinya
tersorot (dipulihkan) dan unit yang sekarang cocok (disorot). Dokumen terbesar
korpus kini merespons ~0,4 detik; median korpus 14 unit, seketika.

Ini kelas kekeliruan yang sama dengan `_lengkapi_nomor` sebelumnya: **ukuran
kerja dihitung terhadap seluruh himpunan padahal yang berubah sebagian kecil.**

---

## Viewer bergaya DDTC, dan chatbot yang tidak mengarang

Fitur sidebar viewer DDTC dibaca dari payload halamannya sendiri: **Indeks,
Peraturan Terkait, Riwayat, Informasi, Perbesar/Perkecil, Kembali ke Atas**.
`web/baca.html` menyediakan seluruhnya — dan dua yang paling berguna, **Riwayat**
dan **Peraturan Terkait**, justru yang DDTC kunci di balik langganan, sedangkan di
sini keduanya datang dari graf relasi korpus sendiri.

Keduanya dipisah karena menjawab pertanyaan berbeda. **Riwayat** adalah nasib
peraturan ini — apa yang mencabut dan mengubahnya, dan apa yang ia cabut.
**Peraturan terkait** adalah tempatnya berdiri — dasar hukumnya dan apa yang
melaksanakannya. Menyatukan keduanya memaksa pembaca memilah sendiri mana yang
mengubah keberlakuan dan mana yang tidak.

### Nomor pasal yang berulang di dalam satu dokumen

PMK 72/2023 memuat **"Pasal 3" dua kali** — seq 18–19 dan seq 24–26. Kuncinya
sama, `INSERT OR REPLACE` membuat yang belakangan menimpa yang di depan, dan 12
dari 158 unitnya lenyap. Pada seluruh korpus: **5.544 dokumen terkena, 47.258
unit hilang** — unit naik 1.070.116 → 1.117.374 setelah diperbaiki.

Pembedanya urutan kemunculan (`~2`, `~3`), bukan `seq`: `seq` bergeser setiap kali
penguraian berubah sedikit saja, dan kunci yang bergeser memutus setiap rujukan
yang pernah menunjuk ke sana.

Taksiran awal dari sampel 600 dokumen menyebut ~189 ribu unit; yang terukur
47.258. Sampelnya kebetulan memuat dokumen yang banyak berulang — pengingat bahwa
ekstrapolasi dari sampel kecil layak disebut sebagai taksiran, bukan sebagai
temuan.

### Chatbot: menemukan, bukan merangkai

`pipeline/tanya.py` membaca penyaring dari pertanyaannya sendiri — "yang masih
berlaku" menyisihkan yang dicabut, "di PMK" membatasi bentuk, "Kota Denpasar"
membatasi daerah — lalu **selalu mengatakan apa yang dibacanya**. Yang
dikembalikan bunyi pasal beserta rujukannya, bukan kalimat yang dirangkai ulang.

Tiga hal yang dijaga, dan masing-masing lahir dari kesalahan yang diperbaiki:

1. **Kata perintah dibuang dari kueri.** Membiarkan "yang masih berlaku" di
   dalam istilah pencarian menaikkan setiap ketentuan penutup, yang memang
   memuat kata "berlaku".
2. **Penyaring tahun diterapkan atas kolam yang diperlebar.** Menyaring 8 hasil
   teratas menurut tahun mengembalikan nol untuk "penyusutan harta berwujud di
   PMK terbitan 2023" — padahal PMK 79/2023 mengaturnya.
3. **Sebutan daerah yang ambigu tidak dipilih diam-diam.** "bandung" cocok ke
   Kota Bandung dan Kab. Bandung; percobaan pertama mengambil yang pertama,
   sehingga pertanyaan tentang kota dijawab dengan peraturan kabupaten tanpa
   satu pun tanda. Sekarang sebutan lengkap diperiksa lebih dahulu, dan bila
   tetap ambigu tidak ada penyaring yang dipasang — hanya keterangan bahwa
   sebutannya kurang jelas.

Penyaring yang **diwarisi** dari pertanyaan sebelumnya juga selalu disebut.
Menulis "tidak ada penyaring tambahan" padahal hasilnya dibatasi ke satu daerah
membuat pembaca menyangka itu seluruh korpus; penyaring yang tak terlihat lebih
menyesatkan daripada tidak ada penyaring.

`susun_naratif()` menyiapkan sambungan LLM tetapi **mati secara baku**. Yang
mencari tidak bergantung pada yang merangkai, jadi menyalakannya nanti hanya
mengubah lapisan penyajian — bukan apa yang ditemukan. Dua penjaga dicatat di
sana untuk dipasang bila dinyalakan: rangkuman tidak boleh menyebut pasal yang
tidak ada di temuan, dan bunyi pasalnya tetap ditampilkan di bawahnya.
