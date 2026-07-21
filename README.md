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
2. Sistem membuat proyek Local File dan menyimpan file ke Vercel Blob.
3. LLM mengekstrak fakta terstruktur dan menggabungkan data antar dokumen dengan jejak sumber.
4. Pengguna mereview profil perusahaan, pihak afiliasi, transaksi terkendali, informasi keuangan, metode, PLI, dan parameter kesebandingan.
5. Advisor analysis menyusun ringkasan, analisis fungsi-aset-risiko, justifikasi metode, risiko, dan daftar bukti yang masih diperlukan.
6. Draft Local File dapat diunduh dalam format Word dengan identitas Alpha AI Jurist.

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
DATABASE_URL=postgres://user:password@host/db?sslmode=require
```

Jalankan lokal:

```bash
npm run dev
```

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
- RAG ranking masih lightweight cosine/keyword; production idealnya memakai embeddings + hybrid search.
- Multi-tenant isolation belum diterapkan penuh di database schema.
- Billing/metering belum aktif walaupun tier model sudah tersedia.
- LLM output harus tetap direview manusia.
