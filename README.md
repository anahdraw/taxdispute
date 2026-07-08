# RSM Tax Dispute Agentic Advisor

RSM Tax Dispute Agentic Advisor adalah prototype berbasis Next.js untuk membantu workflow sengketa pajak: upload putusan, ekstraksi data terstruktur, pencarian putusan pembanding, RAG chatbot untuk putusan dan peraturan, analisis risiko, scoring transparan, dan pembuatan draft Word/PDF untuk direview advisor.

Live prototype: https://taxdispute.vercel.app/

> Prototype ini membantu analisis awal. Hasil ekstraksi, scoring, chatbot, dan draft rekomendasi tetap harus direview oleh professional pajak atau kuasa hukum sebelum digunakan.

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

- **Guided Flow**: upload PDF, ekstraksi LLM, analisis risiko, scoring, dan report draft.
- **Decision Database**: penyimpanan metadata putusan, hasil ekstraksi JSON, confidence extraction, pagination, detail page per putusan, re-extract/edit/delete untuk admin.
- **Dispute Analysis**: RAG chatbot untuk bertanya atas database putusan dan peraturan, termasuk visualisasi sederhana untuk distribusi outcome.
- **Regulations**: import/update peraturan dari input manual, Ortax reference, dan Excel/CSV list; smart regulation bot untuk menelaah aturan.
- **Reports**: database report yang pernah dibuat agar user bisa membuka dan mengunduh ulang tanpa analisis ulang.
- **Reference Viewer**: halaman referensi untuk PDF putusan/peraturan dengan pencarian dan smartbot context.
- **Admin Center**: activity logs, user management, privacy & access control, dan API/integration check.
- **Bilingual UI**: Bahasa Indonesia dan English.
- **Export**: dokumen Word/PDF dengan identitas RSM dan struktur report yang lebih rapi.

## Arsitektur Singkat

```text
Browser UI (Next.js)
  -> API Routes (Next.js server runtime)
    -> OpenAI Responses API for extraction, analysis, chatbot
    -> Vercel Blob for PDF object storage
    -> PostgreSQL/Neon for decisions, reports, regulations, users, logs
    -> Local fallback/mock data for prototype demo
```

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

## Privacy & Access Control

Prototype memakai dua konsep terpisah:

- **Role**: kewenangan sistem, yaitu `admin` atau `user`.
- **Tier**: paket SaaS, yaitu `Silver`, `Gold`, atau `Platinum`.

Tier saat ini:

| Tier | Cocok untuk | Akses utama |
| --- | --- | --- |
| Silver | User awal / reviewer ringan | Dashboard, Guided Flow, Dispute Analysis, Reports |
| Gold | Tim advisor | Silver + read-only Decision Database dan Regulations |
| Platinum | Organisasi/admin | Full access, admin center, database/regulation write controls |

Kontrol yang sudah ada:

- Session cookie server-side dengan HttpOnly, SameSite, dan Secure-aware config.
- Password user disimpan sebagai hash `scrypt`, bukan plaintext.
- API admin memakai server-side role guard.
- API database putusan dan peraturan memakai tier guard.
- Activity log untuk login, upload, ekstraksi, export, update aturan, dan admin action.
- API list memakai pagination dan summary payload; detail lengkap dimuat saat dibutuhkan.

Untuk SaaS production, tambahkan tenant isolation, object-level RBAC, SSO/MFA, billing metering, data retention policy, dan audit export.

## Demo Login

Default seed user:

| Role | Username | Password | Tier |
| --- | --- | --- | --- |
| Admin | `admin` | `Admin@RSM2026` | Platinum |
| User | `user` | `User@RSM2026` | Silver |

Untuk production, ganti password default, set `TDP_AUTH_SECRET`, dan gunakan identity provider/SSO.

## Local Setup

Kebutuhan:

- Node.js 20+
- npm
- Optional: Python 3.9+ untuk prototype Streamlit lama

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
- **Browser/local fallback**: hanya untuk prototype jika database belum tersedia.

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

## Streamlit Prototype Lama

Prototype Python/Streamlit masih disimpan untuk referensi dan workflow lokal:

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
