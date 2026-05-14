# GitHub and Vercel Deployment Notes

This repository contains a local Streamlit prototype plus a lightweight Vercel deployment shell.

## Recommended GitHub Repository

- Owner: `anahdraw`
- Suggested repository name: `tax-dispute-simple-advisor`
- Visibility: private during prototype stage

Keep the repository private while it may contain tax workflow logic, client examples, or internal analysis methods.

## Files Safe to Commit

Commit the application source and documentation:

- `prototype_app.py`
- `tax_dispute_core.py`
- `tax_regulation_connector.py`
- `requirements.txt`
- `.env.example`
- `.gitignore`
- `.vercelignore`
- `.python-version`
- `vercel.json`
- `api/health.py`
- `index.html`
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

These are already covered by `.gitignore` and `.vercelignore`.

## Local Run

```bash
python3 -m pip install -r requirements.txt
python3 -m streamlit run prototype_app.py --server.address 127.0.0.1 --server.port 8501
```

Open:

```text
http://127.0.0.1:8501
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

## Vercel Reality Check

The full current app is Streamlit. Vercel is excellent for static sites, frontend frameworks, and serverless functions, but Streamlit expects a long-running Python web process with WebSocket-style interaction and local file/session state.

This repo therefore includes:

- `index.html`: a public Vercel landing page.
- `api/health.py`: a small Python Vercel Function at `/api/health`.
- `vercel.json`: routing, Python runtime, and bundle exclusion rules.

For a true live version of the full product, choose one of these paths:

1. Deploy Streamlit on a serverful Python host such as Streamlit Community Cloud, Render, Railway, Fly.io, Azure App Service, or a VPS.
2. Convert the frontend to Next.js for Vercel and move the Python logic into API services.
3. Keep Vercel as the public landing/dashboard shell, then link to the Streamlit app hosted elsewhere.

## Deploy the Vercel Shell

After the GitHub repository is pushed:

1. Open Vercel Dashboard.
2. Import `anahdraw/tax-dispute-simple-advisor`.
3. Framework preset: `Other`.
4. Build command: leave empty.
5. Output directory: leave empty.
6. Add environment variables if needed.
7. Deploy.

Health endpoint:

```text
https://your-project.vercel.app/api/health
```

## Push to GitHub

If using GitHub CLI:

```bash
git init
git add .
git commit -m "Initial tax dispute prototype"
gh repo create anahdraw/tax-dispute-simple-advisor --private --source=. --remote=origin --push
```

If the repository already exists:

```bash
git init
git add .
git commit -m "Initial tax dispute prototype"
git branch -M main
git remote add origin git@github.com:anahdraw/tax-dispute-simple-advisor.git
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
