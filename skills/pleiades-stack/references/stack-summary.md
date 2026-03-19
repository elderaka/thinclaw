# Pleiades stack summary (observed on host)

Last updated: 2026-03-15

## Backend: `~/pleiades.backend`
**Purpose:** “Pleiades Backend Control Plane” — multi-tenant orchestration backend for Pleiades AI. Manages tenant subscriptions, OpenClaw container provisioning, and rate limiting.

**Tech:**
- Python 3.11+
- FastAPI + Uvicorn
- SQLAlchemy 2.x + Alembic migrations
- Dev DB: SQLite file; Prod target: PostgreSQL (per README)
- Docker SDK for Python for provisioning tenant containers
- Traefik reverse proxy (Docker provider / label-based routing)

**Key files/entrypoints:**
- `app/main.py` — FastAPI app entry
- `app/config.py` — env settings
- `app/routes/` — API routes
- `app/services/` — orchestration/business logic
- `docker-compose.yml` — runs `traefik` + `backend` services; uses external docker network `pleiades-net`
- `Dockerfile` — backend image
- `requirements.txt`

**Compose-level deployment model:**
- Traefik listens on :80/:443 (mapped to host 8081/8443 in compose) + dashboard on 8080.
- Backend container exposes :8000 and is routed by Traefik for `Host(`api.pleiades.ai`)`.
- Backend mounts Docker socket to manage tenant containers and mounts volumes for backend db + tenant data.

**Notable env vars (names only):**
- `DATABASE_URL`
- `OPENCLAW_IMAGE`
- `TENANT_DATA_DIR`
- `DOCKER_NETWORK`
- `BASE_DOMAIN`
- `OPENROUTER_API_KEY` (injected into tenant containers)

## Web (dev): `~/pleiades.web`
**Purpose:** Next.js frontend.

**Tech:**
- Next.js 16.1.x (App Router)
- React 19
- TypeScript
- Tailwind CSS v4 + shadcn tooling
- Zustand (client state)
- Axios (HTTP)

**Key files/entrypoints:**
- `app/` — routes/pages
- `components/` — UI components
- `lib/` — helpers (includes `lib/auth` referenced by middleware)
- `middleware.ts` — cookie-based protection of routes like `/dashboard`, `/admin/*`, `/tenant/*`, etc.
- `next.config.ts`, `eslint.config.mjs`, `components.json`

**Notable env vars:**
- `.env.local` exists (do not paste values in chat); likely includes `NEXT_PUBLIC_BACKEND_URL`.

## Web (prod-shaped): `~/pleiades-prod`
**Purpose:** Copy of the web app intended for production deployment; includes Vercel project metadata.

**What’s different vs `pleiades.web`:**
- Has `.vercel/` directory.
- Has `.env.prod.local` created by Vercel CLI.

**Important:** `.env.prod.local` contains sensitive values (e.g., `VERCEL_OIDC_TOKEN`). Do not commit or paste token values; only reference variable names.

**Notable env vars (names only):**
- `NEXT_PUBLIC_BACKEND_URL`
- `VERCEL*` (multiple)
- `TURBO_*`
