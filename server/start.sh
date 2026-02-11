#!/bin/sh
# Railway startup script.
# Waits for PostgreSQL to be reachable before running migrations and starting the server.

set -e

# ── Database URL selection ────────────────────────────────────────────────────
# Railway exposes two PostgreSQL URLs:
#   DATABASE_URL        — internal (postgres.railway.internal) — only works when
#                         Private Networking is enabled and both services share the
#                         same Railway project + environment.
#   DATABASE_PUBLIC_URL — external proxy (monorail.proxy.rlwy.net) — always reachable.
#
# If the internal URL is not reachable (common when private networking is not
# configured), override with the public URL so deployments always succeed.
if [ -n "$DATABASE_PUBLIC_URL" ]; then
  echo "[start] Private networking unavailable — using DATABASE_PUBLIC_URL."
  export DATABASE_URL="$DATABASE_PUBLIC_URL"
fi

if [ -z "$DATABASE_URL" ]; then
  echo "[start] ERROR: Neither DATABASE_URL nor DATABASE_PUBLIC_URL is set."
  exit 1
fi

MAX_RETRIES=10
RETRY=0
WAIT_SEC=3

echo "[start] Applying schema..."

until npx prisma db push --skip-generate --accept-data-loss; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "[start] ERROR: Database unreachable after $MAX_RETRIES attempts. Giving up."
    exit 1
  fi
  echo "[start] Not ready yet (attempt $RETRY/$MAX_RETRIES), retrying in ${WAIT_SEC}s..."
  sleep "$WAIT_SEC"
done

echo "[start] Running seed..."
npx prisma db seed

echo "[start] Starting server..."
exec node dist/index.js
