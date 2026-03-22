---
name: pleiades-stack
description: Summarize, audit, and operate the current Pleiades web + backend stack and deployment layout. Use when working on Pleiades deployments, repo structure, environment variables, or when someone asks to “summarize .backend/.web/-prod”, how prod differs from dev, or what services (FastAPI/Traefik/Next.js/Vercel) are involved.
---

# Pleiades stack (current)

## Canonical repos/dirs on this host

- `~/pleiades.backend` — backend control plane (FastAPI) + Traefik + tenant container orchestration.
- `/root/pleiades.web` — Next.js frontend (dev repo, **this is the pull source**).
- `/root/pleiades-prod` — production-shaped copy of `/root/pleiades.web` (contains `.vercel/` + prod env file); intended to be the “deployable” web app.

For the latest snapshot summary and key files, read:

- `references/stack-summary.md`

## One-command FE deploy (pull + resync + Vercel)

Script:

- `scripts/deploy_web_vercel_pleiadesian.sh`

What it does (current flow on this host):

- `git pull` in `/root/pleiades.web` (canonical dev repo)
- `rsync` → `/root/pleiades-prod`
- in `/root/pleiades-prod`: `vercel pull` → `vercel build --prod` → `vercel deploy --prebuilt --prod`

Run:

- `bash /root/openclaw/skills/pleiades-stack/scripts/deploy_web_vercel_pleiadesian.sh`

Notes / safety:

- Rsync excludes: `node_modules/`, `.next/`, `.env*`, `.git/`
- Prod rsync also excludes `.vercel/` so it won’t delete your linked Vercel project settings.
- The script aborts if the source repo has uncommitted changes (override with `FORCE=1`).
- Requires `vercel` CLI to be installed + authenticated, and `/root/pleiades-prod` linked to the intended Vercel project (pleiadesian).

## What to do when asked to “summarize .backend .web and -prod”

1. Summarize each directory:
   - purpose
   - framework/runtime
   - how to run locally
   - key entrypoints
   - env vars (names only; do not paste secrets/tokens)
2. Call out differences between `pleiades.web` and `pleiades-prod`.
3. Identify the deployment path:
   - Web: Vercel/Next.js
   - Backend: Docker Compose (Traefik + FastAPI) + Docker SDK for provisioning tenant containers

## Safety / redaction rules

- Never paste full contents of `.env*` files if they contain secrets (e.g., `VERCEL_OIDC_TOKEN`, API keys).
- When needed, list variable _names_ and what they’re for; redact values.
