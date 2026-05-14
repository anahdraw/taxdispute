# GitHub and Vercel Deployment Notes

This repository contains two app surfaces:

- The preserved local Streamlit prototype for the full Python workflow.
- A new Next.js app for Vercel deployment, created without changing local Streamlit data, uploads, SQLite files, or PDF sources.

## Recommended GitHub Repository

- Owner: `anahdraw`
- Suggested repository name: `tax-dispute-simple-advisor`
- Visibility: private during prototype stage

Keep the repository private while it may contain tax workflow logic, client examples, or internal analysis methods.

## Files Safe to Commit

Commit the application source and documentation:

- `app/`
- `lib/`
- `package.json`
- `package-lock.json`
- `next.config.mjs`
- `tsconfig.json`
- `next-env.d.ts`
- `prototype_app.py`
- `tax_dispute_core.py`
- `tax_regulation_connector.py`
- `requirements.txt`
- `.env.example`
- `.gitignore`
- `.vercelignore`
- `.python-version`
- `vercel.json`
- `README.md`
- `DEPLOYMENT.md`
- `assets/rsm_logo.svg`
- `LLM_ARCHITECTURE.md`
- `PROTOTYPE_REVIEW.md`

Do not commit:

- `.env`
- `data/`
- `uploads/`
- `*.sqlite`
- source PDF decisions
- generated Word/PDF/Excel/PowerPoint exports
- `node_modules/`
- `.next/`

These are already covered by `.gitignore` and `.vercelignore`.

## Local Run: Streamlit Prototype

```bash
python3 -m pip install -r requirements.txt
python3 -m streamlit run prototype_app.py --server.address 127.0.0.1 --server.port 8501
```

Open:

```text
http://127.0.0.1:8501
```

## Local Run: Next.js Vercel App

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Production build check:

```bash
npm run build
```

## Environment Variables

Use `.env.example` as the template.

```bash
OPENAI_API_KEY=sk-...
TDP_LLM_MODEL=gpt-5.5
TDP_REASONING_EFFORT=low
TDP_TEXT_VERBOSITY=low
```

For Vercel, add secrets in Project Settings, not in the repository.

Minimum Vercel environment variables for LLM analysis and the regulation chatbot:

```bash
OPENAI_API_KEY=sk-...
TDP_LLM_MODEL=gpt-5.4-mini
TDP_REASONING_EFFORT=low
TDP_TEXT_VERBOSITY=low
```

If `OPENAI_API_KEY` is not configured, `/api/analyze` and `/api/regulation-chat` still return local fallback output and show a status message in the UI.

## Vercel Architecture

The Vercel version is now a Next.js application:

- `app/page.tsx`: RSM-styled UI with dashboard, guided case analysis, regulations, reports, and language switch.
- `app/api/health/route.ts`: health endpoint.
- `app/api/analyze/route.ts`: server-side demo analysis endpoint.
- `lib/analyze.ts`: simple scoring, comparable decision selection, and draft recommendation generation.
- `lib/mock-data.ts`: sanitized demo decision and regulation dataset for the Vercel app.

The old Streamlit app remains in place for local Python workflows. The Next.js app does not read local SQLite data, uploads, or confidential PDFs during Vercel deployment.

For a production Vercel-native product, move these parts out of local files:

1. Store documents in Vercel Blob, S3, GCS, Azure Blob, or another managed object store.
2. Store extracted metadata and analytics in PostgreSQL, Supabase, Neon, PlanetScale, or another managed database.
3. Move OCR/PDF extraction into a background worker or Python service.
4. Call OpenAI/LLM APIs only from server routes or backend services.
5. Add authentication, authorization, and audit logging before handling taxpayer documents.

## Deploy to Vercel

After the GitHub repository is pushed:

1. Open Vercel Dashboard.
2. Import `anahdraw/taxdispute`.
3. Framework preset: `Next.js`.
4. Build command: `npm run build`.
5. Install command: `npm install`.
6. Output directory: leave as the Next.js default.
7. Add environment variables if needed.
8. Deploy.

Health endpoint:

```text
https://your-project.vercel.app/api/health
```

Analyze endpoint:

```text
https://your-project.vercel.app/api/analyze
```

## Push to GitHub

If using GitHub CLI:

```bash
git init
git add .
git commit -m "Add Next.js Vercel app"
gh repo create anahdraw/taxdispute --private --source=. --remote=origin --push
```

If the repository already exists:

```bash
git init
git add .
git commit -m "Add Next.js Vercel app"
git branch -M main
git remote add origin git@github.com:anahdraw/taxdispute.git
git push -u origin main
```

## Production Checklist

- Replace SQLite with PostgreSQL or another managed database.
- Move uploaded documents to object storage such as S3, GCS, Azure Blob, or Vercel Blob.
- Add authentication and role-based access.
- Add audit logs for extraction and recommendation generation.
- Add PII/NPWP masking where needed.
- Add test coverage for extraction, duplicate detection, report export, and language switching.
- Confirm legal permission for downloaded regulation and decision data.
- Separate public demo data from confidential client documents.
