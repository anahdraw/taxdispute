# PDF Saver untuk Microsoft Edge (macOS)

Ekstensi Manifest V3 untuk menemukan dan mengunduh PDF yang tersedia pada halaman aktif. PDF dapat berasal dari URL tab, tautan, `iframe`, `embed`, `object`, atau resource PDF yang sudah terlihat oleh halaman. Untuk e-book yang sebenarnya berupa halaman HTML, versi 1.1 menyediakan fallback ke dialog cetak Edge.

## Instalasi di Edge macOS

1. Buka `edge://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**.
4. Pilih folder `browser-extensions/edge-pdf-saver` ini.
5. Sematkan **PDF Saver untuk Edge** dari menu Extensions bila diinginkan.

## Pemakaian

1. Buka halaman yang memuat PDF dan pastikan Anda sudah login jika situs mensyaratkannya.
2. Klik ikon ekstensi.
3. Pilih PDF yang terdeteksi, lalu klik **Unduh**.
4. Unduhan batch masuk ke folder `Downloads/PDF Saver` secara default.

Jika situs tidak menyediakan berkas PDF dan popup menampilkan **E-book berbentuk halaman HTML**:

1. Pastikan semua bagian yang memang boleh Anda baca sudah tampil di halaman.
2. Klik **Cetak e-book yang terlihat**.
3. Pada dialog Edge, pilih **Save as PDF**.

Fitur cetak hanya menyimpan konten yang dirender dan dapat diakses oleh akun Anda. Fitur ini tidak membuka bagian premium atau terkunci.

Edge mungkin meminta izin untuk beberapa unduhan otomatis. Izinkan hanya pada situs yang Anda percayai.

## Batasan yang disengaja

- Hanya URL `http://` dan `https://` yang diterima.
- Ekstensi tidak membobol DRM, paywall, autentikasi, hak akses, atau kebijakan `view-only`.
- Ekstensi tidak menyimpan hasil render canvas, menyatukan potongan halaman, menyadap respons tersembunyi, atau mengonversi URL `blob:`/`data:`.
- Jika server menolak unduhan, mengharuskan header khusus, atau tidak pernah menyediakan berkas PDF asli, ekstensi tidak akan melewati pembatasan tersebut.
- Gunakan hanya untuk dokumen yang Anda miliki atau diizinkan untuk diunduh.

### Catatan DDTC

Beberapa e-book DDTC disajikan sebagai konten HTML, bukan berkas `.pdf`. Pada halaman seperti ini, hasil pemindaian URL PDF memang kosong dan tombol cetak HTML adalah metode yang sesuai. Jika akun tidak memiliki akses ke bagian tertentu, bagian tersebut tidak akan masuk ke PDF hasil cetak.

## Privasi

Pemindaian berjalan saat popup dibuka dan hanya pada tab aktif. Ekstensi tidak memakai server eksternal, analitik, atau telemetry. Daftar URL tidak dikirim ke pihak lain.

## Pengujian

```sh
cd browser-extensions/edge-pdf-saver
npm test
```
