#!/usr/bin/env bash
# Menjalankan seluruh pipeline dari awal sampai siap dicari.
#
# Aman dijalankan ulang: setiap tahap melewati pekerjaan yang sudah selesai
# (crawl-detail hanya mengambil yang belum ada badan teksnya, sources hanya
# menambal yang masih kosong, cache HTML dipakai ulang). Kalau proses terputus,
# jalankan lagi perintah yang sama.
#
# Pemakaian:
#   ./jalankan_semua.sh            # semua tahap
#   ./jalankan_semua.sh 3          # mulai dari tahap 3
set -uo pipefail
cd "$(dirname "$0")"
PY=./.venv/bin/python
LOG=data/jalankan.log
MULAI="${1:-1}"

catat() { printf '\n===== [%s] %s =====\n' "$(date +%H:%M:%S)" "$1" | tee -a "$LOG"; }
ukuran() { du -sh data 2>/dev/null | cut -f1; }

catat "MULAI (dari tahap $MULAI) — ruang terpakai sekarang: $(ukuran)"

if [ "$MULAI" -le 1 ]; then
  catat "1/8 indeks katalog"
  $PY cli.py crawl-index 2>&1 | tee -a "$LOG" | tail -3
fi

if [ "$MULAI" -le 2 ]; then
  catat "2/8 halaman detail + lampiran (tahap terpanjang, ~1,5-2 jam)"
  $PY cli.py crawl-detail --lampiran 2>&1 | tee -a "$LOG" | tail -5
fi

if [ "$MULAI" -le 3 ]; then
  catat "3/8 pengayaan sumber sekunder (peraturan.go.id -> JDIH Kemenkeu -> BPK)"
  $PY cli.py sources 2>&1 | tee -a "$LOG" | tail -12
fi

if [ "$MULAI" -le 4 ]; then
  # Tahap ini menyapu SELURUH dokumen berjenis yang didukung, termasuk yang
  # sudah punya badan teks dari DJP. Teksnya memang tidak diperlukan lagi,
  # tetapi relasi terstrukturnya sangat berharga: itulah acuan silang yang
  # dipakai gold set silver untuk mengukur akurasi ekstraksi teks kita.
  catat "3b/8 pengayaan menyeluruh (semua dokumen, untuk relasi terstruktur)"
  $PY cli.py sources --all --no-pdf 2>&1 | tee -a "$LOG" | tail -12
fi

if [ "$MULAI" -le 5 ]; then
  catat "4/8 pemecahan struktur pasal"
  $PY cli.py parse 2>&1 | tee -a "$LOG" | tail -3
fi

if [ "$MULAI" -le 6 ]; then
  catat "5/8 ekstraksi relasi + gold set silver"
  $PY cli.py relations 2>&1 | tee -a "$LOG" | tail -3
  $PY cli.py goldset --build-silver 2>&1 | tee -a "$LOG" | tail -4
fi

if [ "$MULAI" -le 7 ]; then
  catat "6/8 masa berlaku + deteksi konflik"
  $PY cli.py validity --show 5 2>&1 | tee -a "$LOG" | tail -14
fi

if [ "$MULAI" -le 8 ]; then
  catat "7/8 indeks pencarian FTS5"
  $PY cli.py index 2>&1 | tee -a "$LOG" | tail -2
  $PY -c "
import sqlite3
c=sqlite3.connect('data/peraturan.db'); c.execute('VACUUM'); c.close()
print('  basis data dirapikan (VACUUM)')" 2>&1 | tee -a "$LOG"
fi

catat "SELESAI — ruang terpakai: $(ukuran)"
$PY cli.py graph 2>&1 | tee -a "$LOG"
