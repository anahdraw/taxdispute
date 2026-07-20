# Deployment Guide

Dokumen ini menjelaskan cara menjalankan, memverifikasi, dan men-deploy RSM Tax Dispute Agentic Advisor sebagai aplikasi Next.js di Vercel.

## 1. Deployment Target

Recommended target:

- Repository: `https://github.com/anahdraw/taxdispute`
- Hosting: Vercel
- Runtime: Next.js server routes
- Object storage: Vercel Blob
- Database: Vercel Postgres / Neon PostgreSQL
- LLM: OpenAI Responses API

Production URL saat ini:

```text
https://taxdispute.vercel.app/
```

## 2. Pre-Deployment Integrity Check

Jalankan sebelum push/deploy:

```bash
npm install
npm run lint
npm run build
```

Smoke test lokal setelah build:

```bash
npm run start -- --hostname 127.0.0.1 --port 3010
curl -sS 'http://127.0.0.1:3010/api/health?format=json'
```

Expected result:

- `ok: true`
- `runtime: "nextjs"`
- `service: "tax-dispute-agentic-advisor"`

Jika env secrets belum dipasang lokal, field `openaiConfigured`, `blobConfigured`, `databaseConfigured`, atau `authSecretConfigured` dapat bernilai `false`. Itu bukan build error, tetapi berarti fitur terkait belum siap.

## 3. Required Environment Variables

Set di Vercel Project Settings -> Environment Variables.

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes for LLM features | LLM extraction, analysis, chatbot |
| `TDP_LLM_MODEL` | Recommended | Default model, e.g. `gpt-5.4-mini` |
| `TDP_REASONING_EFFORT` | Optional | Reasoning effort, e.g. `low` |
| `TDP_TEXT_VERBOSITY` | Optional | Response verbosity, e.g. `low` |
| `TDP_AUTH_SECRET` | Yes for production | HMAC signing secret for login cookies |
| `BLOB_READ_WRITE_TOKEN` | Yes for PDF upload/storage | Vercel Blob read/write token |
| `DATABASE_URL` | Yes for persistence | PostgreSQL connection URL |
| `POSTGRES_URL` | Optional fallback | Some Vercel/Postgres integrations use this |

Example:

```bash
OPENAI_API_KEY=sk-...
TDP_LLM_MODEL=gpt-5.4-mini
TDP_REASONING_EFFORT=low
TDP_TEXT_VERBOSITY=low
TDP_AUTH_SECRET=replace-with-a-long-random-secret
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx
DATABASE_URL=postgres://user:password@host/db?sslmode=require
```

Important:

- Never commit `.env`.
- Use a long random `TDP_AUTH_SECRET` in production.
- Use public Vercel Blob if the app needs direct browser PDF links.
- For private Blob, PDF viewer links need signed read URL support.

## 4. Vercel Project Setup

1. Open Vercel Dashboard.
2. Click **Add New Project**.
3. Import `anahdraw/taxdispute`.
4. Framework preset: **Next.js**.
5. Install command: `npm install`.
6. Build command: `npm run build`.
7. Output directory: leave default.
8. Add environment variables.
9. Deploy.

The repository includes:

- `vercel.json` with Next.js framework setting and security headers.
- `.vercelignore` to exclude local data, test artifacts, generated binaries, and source PDFs.

## 5. Storage Setup

### Vercel Blob

Use Vercel Dashboard:

1. Project -> Storage.
2. Create or connect Blob store.
3. Prefer a public store for PDF viewer behavior.
4. Pull or copy `BLOB_READ_WRITE_TOKEN` into Vercel env.

Used for:

- Decision PDFs
- Regulation PDFs if available
- Direct PDF viewer links

### PostgreSQL / Neon

Use Vercel Postgres, Neon, Supabase, or another managed Postgres database.

Set:

```bash
DATABASE_URL=postgres://...
```

The app creates required tables automatically on first use:

- `decision_documents`
- `tax_reports`
- `tax_regulations`
- `app_users`
- `activity_logs`

No manual migration command is currently required.

## 6. Authentication and SaaS Access Model

Current app supports:

- `admin` role
- `user` role
- `Silver`, `Gold`, `Platinum` SaaS tiers

Access behavior:

| Capability | Silver | Gold | Platinum |
| --- | --- | --- | --- |
| Dashboard | Yes | Yes | Yes |
| Advanced Dispute Analysis | No | No | Yes |
| Dispute Analysis chatbot | Yes | Yes | Yes |
| Reports | Yes | Yes | Yes |
| Read Decision Database | No | Yes | Yes |
| Read Regulations | No | Yes | Yes |
| Upload/extract/delete database documents | Admin only | Admin only | Admin only |
| Admin Center | Admin role only | Admin role only | Admin role only |

For production SaaS, add:

- Tenant ID on all persisted records.
- Object-level RBAC for case/report/regulation access.
- SSO/MFA.
- Billing and usage metering.
- Admin approval workflow for destructive actions.

Admin dapat mengubah limit dan feature access setiap paket melalui **Admin Center -> Settings -> Access plans**. Perubahan disimpan di database dan dipakai oleh guard API server-side. Prompt setiap workflow dikelola di **Prompt management**; endpoint user biasa hanya menerima konfigurasi akses dan tidak mengembalikan isi prompt.

## 7. Post-Deployment Verification

After Vercel deploy completes:

1. Open the app:

```text
https://taxdispute.vercel.app/
```

2. Open health JSON:

```text
https://taxdispute.vercel.app/api/health?format=json
```

3. Confirm:

```json
{
  "ok": true,
  "runtime": "nextjs",
  "openaiConfigured": true,
  "blobConfigured": true,
  "databaseConfigured": true,
  "authSecretConfigured": true
}
```

4. Login as admin.
5. Go to **Admin Center -> Settings -> AI & system**.
6. Confirm database table counts are visible.
7. Upload a small PDF in **Decision Database**.
8. Click **Upload + Extract**.
9. Open the linked decision page.
10. Create a report in **Advanced Dispute Analysis** with a Platinum account and verify it appears in the central **Reports** repository.

## 8. Git Workflow

Recommended routine:

```bash
git status --short
npm run lint
npm run build
git add README.md DEPLOYMENT.md app lib package.json package-lock.json next.config.mjs tsconfig.json vercel.json .env.example
git commit -m "Update deployment documentation"
git push
```

Avoid staging confidential or generated files.

## 9. Files Safe to Commit

Safe:

- `app/`
- `lib/`
- `components/`
- `public/`
- `assets/`
- `package.json`
- `package-lock.json`
- `next.config.mjs`
- `tsconfig.json`
- `vercel.json`
- `.env.example`
- `.gitignore`
- `.vercelignore`
- `README.md`
- `DEPLOYMENT.md`
- source scripts that do not contain secrets

Do not commit:

- `.env`
- `.env.local`
- `.vercel/`
- `node_modules/`
- `.next/`
- `data/`
- `uploads/`
- `*.sqlite`, `*.db`
- confidential PDF decisions
- generated `.docx`, `.pdf`, `.pptx`, `.xlsx`, `.zip`

## 10. Troubleshooting

### Build fails on Vercel

Run locally:

```bash
npm run lint
npm run build
```

Common causes:

- Missing dependency in `package.json`.
- TypeScript mismatch.
- Using browser-only APIs inside server components without guards.

### `/api/health` says OpenAI is missing

Add:

```bash
OPENAI_API_KEY=sk-...
```

Then redeploy.

### Upload fails

Check:

- `BLOB_READ_WRITE_TOKEN` exists in Vercel env.
- Blob store is connected to the same project.
- PDF file size is within browser and Vercel route limits.
- For private Blob, use signed URL logic before exposing PDF links.

### Data disappears after refresh

Database is probably not configured. Add:

```bash
DATABASE_URL=postgres://...
```

Then run Admin -> API check.

### User can login but cannot see database menu

Check Admin -> User management:

- Role must be active.
- Tier must be Gold or Platinum for read access to Decision Database and Regulations.
- Admin-only writes still require role `admin`.

### Health endpoint shows `authSecretConfigured: false`

Set:

```bash
TDP_AUTH_SECRET=long-random-value
```

Without this, the app can still run locally, but production cookie signing should use an explicit secret.

## 11. Production Hardening Checklist

- Replace initial users and passwords.
- Enforce tenant isolation in every table and API query.
- Add SSO/MFA.
- Add rate limits by user/tier.
- Add retention/delete policies for taxpayer documents.
- Add encryption policy and key management review.
- Add audit export.
- Add automated tests for extraction, reports, auth, tier gates, and PDF viewer.
- Add monitoring and alerting for API error rates.
- Review legal permission for regulation/decision data ingestion.
