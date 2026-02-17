/**
 * Redis Client Singleton
 *
 * Used for:
 * - JWT refresh token storage
 * - Spin locks (race condition protection)
 * - Idempotency keys
 * - Redemption code fast lookup
 * - Game session deduplication
 * - Order expiration tracking
 */

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

let redis: Redis;

if (REDIS_URL) {
  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 2000);
      return delay;
    },
    lazyConnect: true,
  });

  redis.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  redis.on('connect', () => {
    console.log('[Redis] Connected');
  });
} else {
  // In-memory fallback when Redis is not configured
  console.warn('[Redis] REDIS_URL not set — using in-memory fallback (not for production)');

  const store = new Map<string, { value: string; expiresAt?: number }>();

  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  }

  // Cleanup every 60s
  setInterval(cleanup, 60_000);

  const handler: ProxyHandler<Redis> = {
    get(_target, prop: string) {
      if (prop === 'get') {
        return async (key: string) => {
          cleanup();
          const entry = store.get(key);
          if (!entry) return null;
          if (entry.expiresAt && entry.expiresAt <= Date.now()) {
            store.delete(key);
            return null;
          }
          return entry.value;
        };
      }
      if (prop === 'set') {
        return async (key: string, value: string, ...args: unknown[]) => {
          let expiresAt: number | undefined;
          // Handle SET key value EX seconds or SET key value NX EX seconds
          for (let i = 0; i < args.length; i++) {
            if (typeof args[i] === 'string' && (args[i] as string).toUpperCase() === 'EX') {
              expiresAt = Date.now() + Number(args[i + 1]) * 1000;
            }
            if (typeof args[i] === 'string' && (args[i] as string).toUpperCase() === 'NX') {
              if (store.has(key)) {
                const existing = store.get(key)!;
                if (!existing.expiresAt || existing.expiresAt > Date.now()) {
                  return null; // Key already exists
                }
              }
            }
          }
          store.set(key, { value, expiresAt });
          return 'OK';
        };
      }
      if (prop === 'del') {
        return async (...keys: string[]) => {
          let count = 0;
          for (const key of keys) {
            if (store.delete(key)) count++;
          }
          return count;
        };
      }
      if (prop === 'exists') {
        return async (key: string) => {
          cleanup();
          const entry = store.get(key);
          if (!entry) return 0;
          if (entry.expiresAt && entry.expiresAt <= Date.now()) {
            store.delete(key);
            return 0;
          }
          return 1;
        };
      }
      if (prop === 'connect') {
        return async () => {};
      }
      if (prop === 'on' || prop === 'once') {
        return () => {};
      }
      if (prop === 'status') {
        return 'ready';
      }
      // Return no-op for other methods
      return async () => null;
    },
  };

  redis = new Proxy({} as Redis, handler);
}

export { redis };
