# Deployment Guide (Frontend on Vercel + Backend on RunPod/Railway)

This project works best with a split deployment:

- **Frontend**: Next.js on **Vercel**
- **API backend**: FastAPI on **Railway** (or Render)
- **GPU-heavy jobs**: **RunPod** serverless endpoint (called only from the backend)

---

## 1) Prepare environment variables

### Frontend (`frontend/.env.local` for local dev)

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

The frontend never needs RunPod credentials.

For production Vercel, set `NEXT_PUBLIC_API_BASE_URL` to your deployed backend URL, for example:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-backend.up.railway.app
```

### Backend (`backend` service env vars)

```bash
BACKEND_CORS_ORIGINS=https://your-frontend.vercel.app,http://localhost:3000
RUNPOD_API_KEY=<your-runpod-api-key>
RUNPOD_ENDPOINT_ID=<your-endpoint-id>
```

Use comma-separated values for all allowed frontend origins.

Optional backend settings:

- `RUNPOD_POLL_INTERVAL_S` (default `1.0`): how often the backend polls RunPod for new progress.
- `RUNPOD_JOB_TIMEOUT_S` (default `7200`): the backend cancels a job that runs longer than this.

### RunPod worker (`runpod-worker` endpoint env vars)

- `ML_DEVICE` (optional): `cuda` or `cpu`. Defaults to `cuda` when a GPU is visible, otherwise `cpu`.
- `TEMPLATE_PATH` (optional): path to `Na12Mn11Zr1O24.cif`. Defaults to `../template/` next to `model.py`.

---

## 2) Deploy backend API (Railway recommended)

1. Push repository to GitHub.
2. In Railway, create a new project from the repo.
3. Set **Root Directory** to `backend`.
4. Railway detects Dockerfile (`backend/Dockerfile`) and builds automatically.
5. Add env vars:
   - `BACKEND_CORS_ORIGINS=https://your-frontend.vercel.app`
   - `RUNPOD_API_KEY=<your-runpod-api-key>`
   - `RUNPOD_ENDPOINT_ID=<your-endpoint-id>`
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
4. Deploy.
5. Open your Vercel URL and test API-dependent features.

---

## 4) RunPod integration

The frontend calls FastAPI; FastAPI calls RunPod, so the RunPod API key stays on the backend.

- `runpod-worker/handler.py` is a generator handler: each progress item it yields is published on the job's `/stream` endpoint.
- The backend submits each job with `/run`, polls `/stream/{job_id}`, and forwards every item to the browser as a server-sent event, so progress shows live.
- The Stop buttons, and a browser disconnecting mid-run, cancel the RunPod job with `/cancel/{job_id}`.

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
