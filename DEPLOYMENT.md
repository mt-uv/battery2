# Deployment Guide (Frontend on Vercel + Backend on RunPod/Railway)

This project works best with a split deployment:

- **Frontend**: Next.js on **Vercel**
- **API backend**: FastAPI on **Railway** (or Render)
- **GPU-heavy jobs**: **RunPod** (called from your backend or from Next.js API route)

---

## 1) Prepare environment variables

### Frontend (`frontend/.env.local` for local dev)

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
RUNPOD_ENDPOINT=https://api.runpod.ai/v2/<your-endpoint-id>/run
RUNPOD_API_KEY=<your-runpod-api-key>
```

For production Vercel, set `NEXT_PUBLIC_API_BASE_URL` to your deployed backend URL, for example:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-backend.up.railway.app
```

### Backend (`backend` service env vars)

```bash
BACKEND_CORS_ORIGINS=https://your-frontend.vercel.app,http://localhost:3000
```

Use comma-separated values for all allowed frontend origins.

---

## 2) Deploy backend API (Railway recommended)

1. Push repository to GitHub.
2. In Railway, create a new project from the repo.
3. Set **Root Directory** to `backend`.
4. Railway detects Dockerfile (`backend/Dockerfile`) and builds automatically.
5. Add env var:
   - `BACKEND_CORS_ORIGINS=https://your-frontend.vercel.app`
6. Deploy and copy the public backend URL.
7. Verify:
   - `GET https://your-backend.up.railway.app/health` should return `{"status":"ok"}`.


> Note: `backend/Dockerfile` now starts FastAPI with Uvicorn (`main:app`).
> If you also run a RunPod serverless worker, deploy that worker separately from this API service.

> Alternative: use **Render** with the same `backend` folder and env variable.

---

## 3) Deploy frontend to Vercel

1. Import GitHub repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. Add environment variables in Vercel Project Settings:
   - `NEXT_PUBLIC_API_BASE_URL=https://your-backend.up.railway.app`
   - `RUNPOD_ENDPOINT=https://api.runpod.ai/v2/<endpoint-id>/run`
   - `RUNPOD_API_KEY=<your-runpod-api-key>`
4. Deploy.
5. Open your Vercel URL and test API-dependent features.

---

## 4) RunPod integration options

You have two valid patterns:

### Option A (recommended): Backend calls RunPod

- Keep secrets in backend only.
- Frontend calls FastAPI; FastAPI calls RunPod.

### Option B (already scaffolded): Next.js API route calls RunPod

- This repo has `frontend/app/api/runpod/route.ts`.
- Frontend can call `/api/runpod`, and Vercel server-side code forwards to RunPod using `RUNPOD_*` secrets.

---

## 5) SSE / live updates checklist

Because your app streams live updates, verify these in production:

1. Use absolute backend URL via `NEXT_PUBLIC_API_BASE_URL`.
2. Backend CORS must include the Vercel domain.
3. Keep backend instances warm enough to avoid cold-start delays.
4. Ensure your hosting tier supports long-lived HTTP responses (`text/event-stream`).

---

## 6) Local-to-production migration checklist

- [ ] Replace hardcoded localhost URLs with env-based API URL (done in frontend code).
- [ ] Configure production CORS via `BACKEND_CORS_ORIGINS`.
- [ ] Deploy backend and verify `/health`.
- [ ] Deploy frontend with `NEXT_PUBLIC_API_BASE_URL`.
- [ ] Test: screening stream, relaxation stream, and MD stream.
