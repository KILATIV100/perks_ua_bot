#!/bin/sh
# Railway startup script.
# Waits for PostgreSQL to be reachable, then applies migrations and starts the server.
# Services in Railway start concurrently — the DB may not be ready immediately.

set -e

MAX_RETRIES=15
RETRY=0
WAIT_SEC=4

echo "[start] Waiting for PostgreSQL to be reachable..."

# Baseline: if the DB already has tables (from prior `prisma db push`) but no
# _prisma_migrations table, mark the init migration as already applied so that
# `migrate deploy` doesn't try to re-create existing tables (P3005).
# This is safe to run repeatedly — once the migration is recorded it's a no-op.
echo "[start] Baselining initial migration (safe no-op if already done)..."
npx prisma migrate resolve --applied "20250214000000_init" 2>/dev/null || true

until npx prisma migrate deploy; do
  RETRY=$((RETRY + 1))

  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "[start] ERROR: Database still unreachable after $MAX_RETRIES attempts."
    echo "[start] Check that:"
    echo "  1. The PostgreSQL service is in the same Railway project & environment."
    echo "  2. DATABASE_URL is set and uses the correct hostname."
    exit 1
  fi

  echo "[start] Database not ready yet (attempt $RETRY/$MAX_RETRIES). Retrying in ${WAIT_SEC}s..."
  sleep "$WAIT_SEC"
done

echo "[start] Migrations applied successfully."

# Seed is optional — the server auto-seeds on startup if tables are empty.
echo "[start] Running seed (optional)..."
npx prisma db seed || echo "[start] Seed skipped or failed (non-fatal, server will auto-seed)."

echo "[start] Starting server..."
exec node dist/index.js
