#!/bin/sh
# Railway startup script.
# Waits for PostgreSQL to be reachable before running migrations and starting the server.
# Services in Railway start concurrently — the DB may not be ready immediately.

set -e

MAX_RETRIES=15
RETRY=0
WAIT_SEC=4

echo "[start] Waiting for PostgreSQL to be reachable..."

until npx prisma db push --skip-generate --accept-data-loss; do
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

echo "[start] Schema applied. Running seed..."
npx prisma db seed

echo "[start] Starting server..."
exec node dist/index.js
