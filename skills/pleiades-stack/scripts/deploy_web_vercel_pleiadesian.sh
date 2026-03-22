#!/usr/bin/env bash
set -euo pipefail

# One-command workflow to pull + resync + deploy the Pleiades FE to Vercel (project: pleiadesian)
#
# Flow:
#   1) git pull in /root/pleiades.web
#   2) rsync -> /root/pleiades-prod
#   4) vercel pull / build / deploy in /root/pleiades-prod
#
# Safety:
#   - excludes node_modules/, .next/, and .env* from rsync
#   - preserves /root/pleiades-prod/.vercel/

# Canonical dev repo on this host
SRC_REPO="/root/pleiades.web"
# Optional: stage dir (kept for compatibility)
STAGE_REPO="/root/pleiades.web"
PROD_REPO="/root/pleiades-prod"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd git
require_cmd rsync
require_cmd vercel

if [[ ! -d "$SRC_REPO/.git" ]]; then
  echo "Source repo not found (expected git repo): $SRC_REPO" >&2
  exit 1
fi

if [[ ! -d "$STAGE_REPO" ]]; then
  echo "Stage dir not found: $STAGE_REPO" >&2
  exit 1
fi

if [[ ! -d "$PROD_REPO" ]]; then
  echo "Prod dir not found: $PROD_REPO" >&2
  exit 1
fi

# Abort if the source repo is dirty unless FORCE=1
cd "$SRC_REPO"
if [[ "${FORCE:-0}" != "1" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Refusing to deploy: source repo has uncommitted changes: $SRC_REPO" >&2
    echo "Commit/stash your changes, or re-run with FORCE=1 to override." >&2
    exit 1
  fi
fi

echo "==> Pulling latest in $SRC_REPO"
git pull

echo "==> rsync: $SRC_REPO -> $PROD_REPO (preserve .vercel/)"
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.next/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.vercel/' \
  "$SRC_REPO/" "$PROD_REPO/"

cd "$PROD_REPO"

echo "==> vercel pull (production)"
vercel pull --yes --environment=production

echo "==> vercel build --prod"
vercel build --prod

echo "==> vercel deploy --prebuilt --prod"
vercel deploy --prebuilt --prod

echo "Done."
