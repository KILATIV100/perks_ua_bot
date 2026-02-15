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
# _prisma_migrations table, create it and mark the init migration as applied
# so `migrate deploy` won't try to re-create existing tables (P3005).
# This is idempotent — the INSERT uses WHERE NOT EXISTS.
echo "[start] Baselining initial migration (safe no-op if already done)..."
npx prisma db execute --stdin <<'SQL' 2>/dev/null || true
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36)  PRIMARY KEY NOT NULL,
    "checksum"              VARCHAR(64)  NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER      NOT NULL DEFAULT 0
);
INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
SELECT gen_random_uuid(), '318d2c792f17f90e3a4c6935f0f2d77d85d7343e97248df86d047cc21588d57d', '20250214000000_init', now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20250214000000_init');
SQL

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
