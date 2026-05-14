# TestData

Folder ini dipakai untuk menguji apakah aplikasi dapat mengambil dan mengekstrak file PDF dari folder lokal.

PDF asli tidak di-commit ke Git karena file `*.pdf` di-ignore. Untuk membuat fixture PDF dummy yang aman:

```bash
python3 scripts/run_testdata_ingest.py --generate-samples
```

Untuk menjalankan test ingest dari folder ini:

```bash
python3 scripts/run_testdata_ingest.py --testdata TestData
```

Untuk menjadikan PDF tanpa text layer sebagai kegagalan test:

```bash
python3 scripts/run_testdata_ingest.py --testdata TestData --require-completed
```

Secara default script memakai SQLite temporary, sehingga tidak mengubah database prototype di `data/`.
