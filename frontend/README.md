## Frontend (Next.js)

### Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
RUNPOD_ENDPOINT=https://api.runpod.ai/v2/<endpoint-id>/run
RUNPOD_API_KEY=<your-runpod-api-key>
```

`NEXT_PUBLIC_API_BASE_URL` is used by UI components for REST + SSE endpoints.

### Production (Vercel)

Set Vercel project root to `frontend` and configure:

- `NEXT_PUBLIC_API_BASE_URL=https://<your-backend-host>`
- `RUNPOD_ENDPOINT=...`
- `RUNPOD_API_KEY=...`

See root-level `DEPLOYMENT.md` for complete step-by-step deployment with Railway/RunPod.
