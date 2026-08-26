# Alpha AI Jurist

**Tax Intelligence. Trusted Judgment.**

Alpha AI Jurist adalah platform Tax & Legal AI berbasis Next.js untuk membantu workflow sengketa pajak: upload putusan, ekstraksi data terstruktur, pencarian putusan pembanding, RAG chatbot untuk putusan dan peraturan, analisis risiko, scoring transparan, dan pembuatan draft Word/PDF untuk direview advisor.

Live app: https://taxdispute.vercel.app/

> Aplikasi ini membantu analisis awal. Hasil ekstraksi, scoring, chatbot, dan draft rekomendasi tetap harus direview oleh professional pajak atau kuasa hukum sebelum digunakan.

## Status Integritas Aplikasi

Pemeriksaan terakhir dilakukan lokal sebelum update dokumentasi:

| Check | Command | Status |
| --- | --- | --- |
| TypeScript / lint | `npm run lint` | Passed |
| Production build | `npm run build` | Passed |
| Runtime smoke test | `npm run start -- --hostname 127.0.0.1 --port 3010` | Passed |
| Home page | `GET /` | HTTP 200 |
| Health JSON | `GET /api/health?format=json` | OK |

Catatan lokal: jika `.env` belum diisi, health JSON akan menandai OpenAI, Blob, Database, dan Auth Secret sebagai `not configured`. Itu normal untuk mesin lokal tanpa secret.

## Fitur Utama

- **Analisis Putusan Tingkat Lanjut / Advanced Dispute Analysis**: ruang kerja Platinum untuk upload PDF, ekstraksi LLM, analisis risiko, scoring, dan pembuatan report draft.
- **Decision Database**: penyimpanan metadata putusan, hasil ekstraksi JSON, confidence extraction, pagination, detail page per putusan, re-extract/edit/delete untuk admin.
- **Dispute Analysis**: RAG chatbot untuk bertanya atas database putusan dan peraturan, termasuk visualisasi sederhana untuk distribusi outcome.
- **Regulations**: import/update peraturan dari input manual, daftar Excel/CSV, serta PDF sumber resmi; smart regulation bot untuk menelaah aturan.
- **Reports**: satu repository terpusat untuk report yang pernah dibuat agar user bisa membuka, memperbarui, dan mengunduh ulang tanpa analisis ulang.
- **TP Local File (Platinum)**: workflow native Next.js untuk menyusun Local File dari dokumen sumber, mengekstrak profil dan transaksi afiliasi, melakukan review advisor, lalu mengekspor draft Word terstruktur.
- **Reference Viewer**: halaman referensi untuk PDF putusan/peraturan dengan pencarian dan smartbot context.
- **Admin Center**: activity logs, user management, privacy & access control, pengaturan paket, prompt management per fitur, serta API/integration check.
- **Bilingual UI**: Bahasa Indonesia dan English.
- **Export**: dokumen Word/PDF dengan identitas Alpha AI Jurist dan struktur report yang lebih rapi.

## Arsitektur Singkat

```text
Browser UI (Next.js)
  -> API Routes (Next.js server runtime)
    -> OpenAI Responses API for extraction, analysis, chatbot
    -> Vercel Blob for PDF object storage
    -> PostgreSQL/Neon for decisions, reports, regulations, users, logs
    -> Local rule-based mode if integrations are not configured
```

### TP Local File Native

Modul TP Local File dipindahkan langsung ke framework Next.js yang sama, tanpa service Django/Celery/Redis terpisah. Alur pengguna:

1. Pilih kategori dan unggah dokumen sumber pertama. Profil perusahaan direkomendasikan, tetapi pengguna dapat memulai dari dokumen kepemilikan, laporan keuangan, kebijakan TP, kontrak afiliasi, atau dokumen pendukung lain.
2. Sistem membuat proyek Local File dan menyimpan file ke private Vercel Blob; raw storage URL tidak digunakan untuk akses pengguna.
3. LLM mengekstrak fakta terstruktur, kutipan, dan lokator halaman, lalu menggabungkan data antar dokumen secara non-destruktif. Nilai yang bertentangan masuk conflict queue.
4. Pengguna mereview profil perusahaan, pihak afiliasi, transaksi terkendali, informasi keuangan, metode, PLI, dan parameter kesebandingan.
5. Workflow agent yang durable menjalankan intake, extraction inventory, gap analysis, research, verification, section drafting, assembly, dan QA. Setiap tahap memiliki checkpoint, dependency, retry, serta quality gate; browser tidak harus tetap terbuka bila Vercel Cron dan `CRON_SECRET` telah dikonfigurasi.
6. Bila `TAVILY_API_KEY` tersedia dan advisor memberikan persetujuan eksplisit melalui checkbox, sistem menjalankan riset eksternal memakai deskriptor usaha yang telah difilter. Hasil dipisahkan menjadi sumber resmi, konteks industri, dan kandidat pembanding awal dengan URL, kualitas sumber, retrieval score, alasan kecocokan, perbedaan material, serta keterbatasan screening. Pencarian kandidat hanya dijalankan bila deskriptor produk/transaksi cukup spesifik; annual report dan exchange filing diprioritaskan di atas directory/discovery pages.
7. Draft Local File dapat diunduh dalam format Word dengan identitas Alpha AI Jurist, evidence register, unresolved-item appendix, dan audit trail riset eksternal. Final approval tetap merupakan tindakan manusia atas versi yang sama.

Riset Tavily bersifat **discovery evidence**. Kandidat web belum menjadi pembanding final sebelum advisor menyelesaikan pemeriksaan independensi, kepemilikan, FAR, produk/pasar, periode keuangan, kerugian berulang, ketersediaan data, serta acceptance/rejection log dari database komersial. Nama klien, NPWP, nilai transaksi, dan nama pihak afiliasi tidak dimasukkan ke kueri eksternal.

Data proyek disimpan di tabel `tp_local_file_projects`; file sumber tetap berada di Blob. Akses fitur dibatasi untuk paket Platinum melalui server-side feature guard.

Komponen penting:

| Area | File / Folder |
| --- | --- |
| UI utama | `app/page.tsx` |
| Decision detail page | `app/decisions/[slug]/page.tsx` |
| Reference viewer | `app/references/[kind]/[slug]/page.tsx` |
| API routes | `app/api/*` |
| Auth/session | `lib/auth.ts`, `lib/admin.ts`, `lib/password.ts` |
| Database adapter | `lib/db.ts` |
| LLM integration | `lib/openai.ts` |
| Extraction model | `lib/extraction.ts` |
| Scoring and analysis | `lib/analyze.ts`, `lib/scorecard.ts` |
| Report generation | `lib/report.ts` |
| RAG ranking | `lib/smart-chat.ts`, `lib/case-search.ts` |
| TP Local File UI | `app/tp-local-file-panel.tsx` |
| TP Local File model/API | `lib/tp-local-file.ts`, `app/api/tp-local-files/*` |
| TP agent contracts/runtime/queue | `lib/tp-agent-workflow.ts`, `lib/tp-agent-runtime.ts`, `lib/tp-agent-queue.ts`, `lib/tp-agent-worker.ts` |
| TP Local File Word export | `lib/tp-local-file-report.ts` |

## Privacy & Access Control

Aplikasi memakai dua konsep terpisah:

- **Role**: kewenangan sistem, yaitu `admin` atau `user`.
- **Tier**: paket SaaS, yaitu `Silver`, `Gold`, atau `Platinum`.

Tier saat ini:

| Tier | Cocok untuk | Akses utama |
| --- | --- | --- |
| Silver | User awal / reviewer ringan | Dashboard, Dispute Analysis, Reports |
| Gold | Tim advisor | Silver + read-only Decision Database dan Regulations |
| Platinum | Organisasi/advisor senior | Gold + Advanced Dispute Analysis dan seluruh workflow lanjutan |

Kontrol yang sudah ada:

- Session cookie server-side dengan HttpOnly, SameSite, dan Secure-aware config.
- Password user disimpan sebagai hash `scrypt`, bukan plaintext.
- API admin memakai server-side role guard.
- API database putusan dan peraturan memakai tier guard.
- Activity log untuk login, upload, ekstraksi, export, update aturan, dan admin action.
- API list memakai pagination dan summary payload; detail lengkap dimuat saat dibutuhkan.
- Konfigurasi akses/limit Silver, Gold, dan Platinum dapat diubah admin dan diberlakukan kembali oleh server-side feature guard.
- Prompt ekstraksi, analisis lanjutan, Dispute Analysis, Regulation RAG, dan Reference Assistant dikelola per fitur dan per bahasa melalui Admin Center.

Untuk SaaS production, tambahkan tenant isolation, object-level RBAC, SSO/MFA, billing metering, data retention policy, dan audit export.

## Initial Login Credentials

Initial seed user disimpan di `lib/admin.ts`. Saat database aktif, user awal disalin ke tabel `app_users` dan password disimpan sebagai hash `scrypt`, bukan plaintext. Gunakan Admin Center -> User management untuk mengganti password pada database yang sudah berjalan.

Untuk production, ganti password awal, set `TDP_AUTH_SECRET`, dan gunakan identity provider/SSO.

## Local Setup

### Workspace dan private storage lokal

Fondasi tenant/client/matter memakai penyimpanan lokal secara default saat development, walaupun `.env.local` berisi `DATABASE_URL` cloud. Metadata persisten disimpan atomik di `data/local-workspace`; file privat berada di `data/private-storage` dengan key ter-scope tenant/client/matter/user dan tidak memiliki URL publik.

```bash
TDP_WORKSPACE_STORE=local
TDP_SEARCH_STORE=local
TDP_DEFAULT_TENANT_AUTO_ENROLL=
TDP_LOCAL_WORKSPACE_ROOT=
TDP_PRIVATE_STORAGE_ROOT=
TDP_PRIVATE_UPLOAD_MAX_MB=50
```

Set `TDP_WORKSPACE_STORE=database` hanya ketika migrasi PostgreSQL tenant sudah memang ingin digunakan. API lokal yang tersedia: `/api/workspaces`, `/api/clients`, `/api/matters`, `/api/private-files`, dan `/api/research-workspace`. Jalankan pengujian isolasi dan persistence dengan `npm run test:workspace`.

Trusted Search memakai korpus lokal (`TDP_SEARCH_STORE=local`) secara default dan tidak mengakses `DATABASE_URL`. Mode lokal menggabungkan kartu peraturan seed serta putusan demo yang selalu diberi status `review_required`. `TDP_SEARCH_STORE=database` adalah opt-in terpisah setelah schema dimigrasikan; loader search tersebut hanya menjalankan `SELECT`, tetapi implementasi ranking saat ini masih BM25 in-memory untuk pilot lokal—belum index produksi untuk 80 ribu putusan. Jalankan `npm run test:trust` untuk memeriksa hybrid search, isolasi, abstention, dan validasi sitasi.

#### Snapshot peraturan dari pipeline Anahdraw

Source code pipeline ikut disimpan secara portabel di `tools/peraturan-pipeline`.
Basis data besarnya tidak masuk Git; arahkan `TDP_REGULATION_PIPELINE_DB` ke
`peraturan.db` yang dipindahkan ke laptop/drive data. Importer selalu membacanya
secara read-only:

```bash
npm run import:regulations
TDP_LOCAL_REGULATION_SNAPSHOT=data/regulation-pipeline-import/next-regulations.jsonl.gz npm run dev
```

Di Windows PowerShell gunakan `$env:TDP_REGULATION_PIPELINE_DB =
"D:\\AAJuristData\\peraturan-pipeline\\peraturan.db"`. Petunjuk lengkap ada di
`docs/WINDOWS_MIGRATION_HANDOFF_2026-08-26.md`.

Snapshot membawa teks pasal/diktum, locator, hash, status temporal, dan relasi yang sudah dinormalisasi. Hanya URL HTTPS pemerintah `*.go.id` dipertahankan sebagai URL sitasi; sumber sekunder tetap searchable tetapi berstatus `review_required`, dan nama situs eksternal disaring dari teks. Graph dan antrean tinjauan dibuat dengan `npm run quality:regulations`; benchmark seed-vs-pipeline tersimpan lewat `npm run eval:regulations:pipeline`. Benchmark ini adalah development gate, bukan sertifikasi akurasi hukum.

Untuk menjalankan seluruh agent lokal berurutan (import → citation/graph review → benchmark), gunakan `npm run pipeline:regulations`; tambahkan `-- --skip-import` bila snapshot sudah ada.

Setelah import lokal selesai, `.env.local` dapat menunjuk ke `data/regulation-pipeline-import/next-regulations.jsonl.gz`; loader membaca snapshot secara read-only dan menyimpannya di cache proses agar tidak decompress ulang pada setiap request. Snapshot ini sengaja tidak masuk Git/deployment artifact.

#### Buku Praktis Pajak sebagai ground truth

Buku referensi yang diberikan pengguna diproyeksikan terpisah dari retrieval
corpus. Setiap pasangan QA menyimpan kutipan minimum, halaman PDF, dan
penjelasan tambahan; graph menyimpan jalur sumber → QA → konsep → rujukan
aturan sebagai navigasi dan evaluasi, bukan sebagai bukti hukum primer.

```bash
npm run import:book-ground-truth
npm run eval:book-ground-truth
```

PDF lokal disajikan melalui `/api/reference-pdfs/buku-praktis-pajak-2025` dan
dapat diarahkan ke lokasi lain dengan `TDP_BOOK_PDF_PATH`. Untuk deployment,
unggah PDF ke private/object storage lalu arahkan route tersebut ke storage
yang diizinkan; jangan mengandalkan path Downloads lokal.

`TDP_DEFAULT_TENANT_AUTO_ENROLL` boleh dikosongkan. Default aman sistem adalah `true` hanya saat store lokal dipakai di non-production, serta `false` pada production atau mode database. Karena itu user production harus memperoleh membership melalui provisioning/admin yang eksplisit; jangan mengaktifkan flag ini di production kecuali memang menghendaki seluruh user masuk tenant default. Tenant yang sudah diarsipkan tetap ditolak walaupun membership lama masih ada. Client bersifat bersama untuk seluruh member yang sah dalam tenant; ACL terpisah diterapkan pada matter, bukan pada client.

Kebutuhan:

- Node.js 20+
- npm
- Optional: Python 3.9+ untuk aplikasi Streamlit lokal lama

Install dependency:

```bash
npm install
```

Salin env template:

```bash
cp .env.example .env
```

Isi minimal untuk fitur penuh:

```bash
OPENAI_API_KEY=sk-...
TDP_LLM_MODEL=gpt-5.4-mini
TDP_AUTH_SECRET=replace-with-a-long-random-secret
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx
CRON_SECRET=replace-with-a-long-random-cron-secret
TDP_CONFIDENTIAL_LLM_POLICY=onprem_only
DATABASE_URL=postgres://user:password@host/db?sslmode=require
TAVILY_API_KEY=tvly-...
TAVILY_PROJECT_ID=alpha-ai-jurist
```

Jalankan lokal:

```bash
npm run dev
```

Untuk mengosongkan antrean agent TP secara lokal dari terminal lain:

```bash
npm run worker:tp
```

Perintah worker memerlukan `CRON_SECRET` dan, bila URL development bukan `http://127.0.0.1:3000`, `TP_AGENT_WORKER_URL`.
Verification dan drafting yang memuat data rahasia hanya memakai model `local-onprem` secara default. Aktifkan `allow_openai` hanya setelah persetujuan engagement dan privasi terdokumentasi.

Buka:

```text
http://localhost:3000
```

Build production lokal:

```bash
npm run lint
npm run build
npm run start
```

Sinkronisasi sumber resmi Gelombang 3 (P3B/MLI, manual Coretax, formulir, dan kurs):

```bash
npm run sync:wave3
npm run test:wave3
npm run eval:wave3
npm run test:wave4
npm run eval:wave4
npm run build:lightrag-manifest
npm run build:search-index
npm run test:wave5
npm run eval:wave5
```

Gelombang 4 tersedia di `/workbench` setelah memilih client dan matter di `/workspace`. Modul ini menggabungkan evidence matrix, precedent navigator, drafting studio, calculation engine, regulatory impact, serta workflow/approval dalam satu scope perkara. Lihat `docs/WAVE4_DIFFERENTIATION_2026-08-21.md` untuk kontrak, benchmark, dan batas production.

Gelombang 5 tersedia untuk admin di `/enterprise`. Implementasi lokal mencakup persistent candidate index dengan hydration ke 157.924 chunk sumber, manifest full-corpus LightRAG yang dikunci oleh count+hash, durable queue lokal, metrik tanpa prompt/PII, cost budget, retention dry-run, serta backup hash verification dan restore rehearsal. Jalankan:

```bash
npm run backup:enterprise
npm run verify:backup
npm run rehearse:dr
```

Status “siap lokal” tidak sama dengan “siap produksi multi-node”. Gap produksi dan bukti benchmark ada di `docs/WAVE5_ENTERPRISE_GAP_REPORT_2026-08-22.md`.

Registry ringkas yang dipakai aplikasi berada di `content/official-knowledge`. Salinan berkas untuk audit checksum disimpan lokal di `outputs/knowledge-acquisition` dan tidak ikut Git/deployment.

## Health Check

Human-readable health page:

```text
/api/health
```

JSON health endpoint:

```text
/api/health?format=json
```

Admin integration check:

```text
/api/admin/check
```

## Data dan Storage

Data production disimpan melalui:

- **Vercel Blob**: PDF putusan/peraturan.
- **PostgreSQL/Neon**: metadata putusan, hasil ekstraksi, report, regulation cards, users, logs.
- **Browser/local mode**: dipakai saat database belum tersedia di lingkungan lokal.

Jangan commit:

- `.env`
- `data/`
- `uploads/`
- file `.sqlite`, `.db`
- PDF putusan rahasia
- generated Word/PDF/Excel/PowerPoint
- `node_modules/`
- `.next/`

## Import Data

Import putusan dari Excel:

```bash
npm run import:excel
```

Test data PDF berada di:

```text
TestData/
```

Test case lama:

```text
TEST_CASES.md
```

## Streamlit App Lama

Aplikasi Python/Streamlit masih disimpan untuk referensi dan workflow lokal:

```bash
python3 -m pip install -r requirements.txt
python3 -m streamlit run prototype_app.py --server.address 127.0.0.1 --server.port 8501
```

Next.js/Vercel adalah surface utama untuk deployment online.

## Deployment

Lihat detail lengkap di:

```text
DEPLOYMENT.md
```

Ringkas:

1. Push repository ke GitHub.
2. Import repository di Vercel.
3. Framework preset: Next.js.
4. Build command: `npm run build`.
5. Install command: `npm install`.
6. Set environment variables.
7. Deploy.
8. Cek `/api/health?format=json`.

## Known Limitations

- OCR penuh untuk PDF scan belum menjadi pipeline background khusus.
- Persistent lexical candidate index dan hydration/reranking sudah tersedia lokal; vector embeddings masih kosong dan backend distributed FTS/vector belum tersedia.
- Manifest LightRAG mencakup seluruh corpus, tetapi full ingestion belum diaktifkan; pilot 58 dokumen ditolak karena count/hash tidak cocok.
- Multi-tenant isolation belum diterapkan penuh di database schema.
- Billing/metering belum aktif walaupun tier model sudah tersedia.
- OIDC SSO, MFA enrollment, offsite backup, dan cross-region DR belum tersedia; policy/readiness guard tidak boleh dianggap implementasi provider.
- LLM output harus tetap direview manusia.
