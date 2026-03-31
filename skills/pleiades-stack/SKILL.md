---
name: pleiades-stack
description: Comprehensive reference for the Pleiades platform tech stack, architecture, API surface, directory layouts, deployment model, and operational procedures. Use when working on any Pleiades component (backend, web, mobile, OpenClaw agent runtime), debugging deployments, understanding the API, or answering questions about the system architecture.
---

# Pleiades Stack Reference (current)

> Last updated: 2026-03-31

## Platform Overview

Pleiades is a **multi-tenant AI co-worker platform** that provisions isolated AI agent instances (powered by OpenClaw/thinclaw) for each customer. The system consists of four main components:

| Component | Tech | Repo dir | Deployed to |
|---|---|---|---|
| **Backend** (Control Plane) | FastAPI + Python 3.11 | `pleiades.backend/` | VPS (Docker Compose) |
| **Web** (Frontend) | Next.js 16 + React 19 | `pleiades.web/` | Vercel |
| **Mobile** | Flutter 3.5 + Dart | `pleiades.mobile/` | Android/iOS |
| **Agent Runtime** (OpenClaw) | Node.js + TypeScript | `thinclaw/` | Docker containers (per-tenant) |

## Detailed Stack Reference

For the full directory layouts, API docs, database schema, env vars, and deployment procedures, read:

- `references/stack-summary.md`

For backend implementation-level deep dives (tenant lifecycle, OpenClaw runtime layout, gateway scope/auth behavior, and endpoint auth matrix), read sections **8-13** in `references/stack-summary.md`.

For Unity surface integration (session persistence, new-session semantics, history import, WS telemetry, and endpoint contracts), read sections **15-16** in `references/stack-summary.md`.

## Quick Facts

### Backend (`pleiades.backend/`)
- **Framework**: FastAPI ≥0.115 + Uvicorn
- **DB**: PostgreSQL 16 (docker-compose service) / SQLite for local dev
- **ORM**: SQLAlchemy 2.x + Alembic migrations
- **Auth**: JWT (HS256, 7-day tokens) + bcrypt passwords
- **Container orchestration**: Docker SDK for Python (mounts Docker socket)
- **Reverse proxy**: Traefik v3.2 (Docker label auto-discovery)
- **Entry**: `app/main.py` → `uvicorn app.main:app --host 0.0.0.0 --port 8000`
- **Unity surface**: `/api/surfaces/unity/*` (credentialed HTTP + WS bridge into tenant OpenClaw gateway)
  - Supports conversation choices extraction and `choice_id` turn passing.
  - Per-key (60/min) and per-session (30/min) sliding-window rate limiting.
- **Unity credential policy**: tenant users can mint keys for their own tenant; admins can mint for any tenant

### Web (`pleiades.web/`)
- **Framework**: Next.js 16.1.6 (App Router)
- **UI**: React 19.2 + Tailwind CSS v4 + shadcn/ui + Radix UI
- **State**: Zustand 5.x
- **HTTP**: Axios
- **Fonts**: Space Grotesk + Plus Jakarta Sans (Google Fonts)
- **Analytics**: Vercel Analytics
- **Middleware**: Cookie-based route protection (JWT token in cookie)

### Mobile (`pleiades.mobile/`)
- **Framework**: Flutter (Dart SDK ≥3.5)
- **State**: Riverpod 2.6
- **Navigation**: GoRouter 14.6
- **HTTP**: Dio 5.7
- **Auth storage**: flutter_secure_storage
- **Flow**: Splash → Login/Register → Plan → Provisioning → WhatsApp

### Agent Runtime (`thinclaw/`)
- **Engine**: OpenClaw (Node.js, TypeScript monorepo)
- **Gateway port**: 18789
- **Health check**: `GET /healthz`
- **WebSocket gateway**: `ws://<container>:18789/__openclaw__/gateway/ws`
- **Protocol**: Custom frame protocol (version 3), NOT JSON-RPC
- **Channels**: WhatsApp (Baileys), Web, Line, Telegram
- **Features**: Agents, cron, plugins, memory, sessions, image generation, TTS, web search, media understanding, context engine

## Deployment Model

### Backend (VPS)
```
docker-compose up -d   # in pleiades.backend/
```
Services: `traefik` (ports 8081/8443/8080), `postgres` (internal), `backend` (port 8000).
Network: `pleiades-net` (external, shared with tenant containers).

### Frontend (Vercel)
- One-command deploy script: `scripts/deploy_web_vercel_pleiadesian.sh`
- Flow: `git pull` in `pleiades.web` → `rsync` → `pleiades-prod` → `vercel build --prod` → `vercel deploy --prebuilt --prod`

### Tenant Containers
- Image: `pleiades/openclaw:latest`
- Naming: `pleiades-tenant-{id}`
- Volume: `pleiades-tenant-{id}-data` at `/app/.openclaw`
- Shared workspace bind: `/root/.openclaw/workspace` → `/app/.openclaw/workspace` (rw)
- Debug port: `18000 + tenant_id`
- Traefik auto-routes: `tenant-{id}.pleiades.ai`
- Resource tiers: starter (1.5GB/1CPU), growth (2GB/1.5CPU), enterprise (3GB/2CPU)

#### Rebuild & Update Workflow
1. **Rebuild image**: `cd ~/thinclaw && git pull && docker build -t pleiades/openclaw:latest .`
2. **Update all**: `POST /api/instances/update-all` (Admin only, zero data loss).
3. **Update single**: `POST /api/instances/{id}/update` (zero data loss).
4. **Fresh Start**: Stop → Delete → Start (wipes data volume).

## Safety / Redaction Rules

- **Never** paste full contents of `.env*` files containing secrets.
- List variable _names_ and what they control; redact values.
- Never expose `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `MCP_API_KEY_SALT`, `DASHBOARD_APPROVAL_SALT`, `POSTGRES_PASSWORD`, JWT `SECRET_KEY`, or `VERCEL_OIDC_TOKEN`.

## What To Do When Asked About the Stack

1. Summarize each component: purpose, framework, how to run locally, key entrypoints, env vars (names only).
2. Identify the deployment path for each component.
3. If asked about the API, refer to the route-level docs in `references/stack-summary.md`.
4. If asked about provisioning, explain the 5-step background process (configure → docker create → inject config → fix ownership → start).
5. If asked about WhatsApp pairing, explain both QR and phone-code flows via SSE.
