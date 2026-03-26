import { getKyivDateString, getNextKyivMidnight } from './utils/timezone.js';

type LegacySetArg = 'EX' | 'PX' | 'NX' | 'XX' | number;

type SetOptions = {
  expiration?: { type: 'EX' | 'PX'; value: number };
  condition?: 'NX' | 'XX';
};

interface RedisClientLike {
  isReady?: boolean;
  isOpen?: boolean;
  connect: () => Promise<void>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: SetOptions) => Promise<'OK' | null>;
  del: (keys: string[] | string) => Promise<number>;
  exists: (key: string) => Promise<number>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
}

class InMemoryRedisService {
  private readonly store = new Map<string, { value: string; expiresAt?: number }>();

  constructor() {
    setInterval(() => this.cleanup(), 60_000).unref();
  }

  get status(): string {
    return 'ready';
  }

  async connect(): Promise<void> {}

  async get(key: string): Promise<string | null> {
    this.cleanup();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ...args: LegacySetArg[]): Promise<'OK' | null> {
    let expiresAt: number | undefined;
    let nx = false;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (typeof arg !== 'string') continue;
      const upper = arg.toUpperCase();

      if (upper === 'EX') {
        expiresAt = Date.now() + Number(args[i + 1]) * 1000;
        i += 1;
      } else if (upper === 'PX') {
        expiresAt = Date.now() + Number(args[i + 1]);
        i += 1;
      } else if (upper === 'NX') {
        nx = true;
      }
    }

    if (nx && (await this.get(key)) !== null) {
      return null;
    }

    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
    }
    return removed;
  }

  async exists(key: string): Promise<number> {
    const value = await this.get(key);
    return value === null ? 0 : 1;
  }

  async incr(key: string): Promise<number> {
    const current = Number((await this.get(key)) ?? 0);
    const next = current + 1;
    const expiresAt = this.store.get(key)?.expiresAt;
    this.store.set(key, { value: String(next), expiresAt });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async canSendPushNotification(userId: number): Promise<boolean> {
    const dateKey = getKyivDateString();
    const key = `push_limit:${userId}:${dateKey}`;
    const count = await this.incr(key);

    if (count === 1) {
      const ttlSeconds = Math.max(1, Math.ceil((getNextKyivMidnight().getTime() - Date.now()) / 1000));
      await this.expire(key, ttlSeconds);
    }

    return count <= 2;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }
}

class RedisService {
  private readonly client: RedisClientLike;

  constructor(redisUrl: string) {
    const createClient = this.resolveCreateClient();

    this.client = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries: number) => Math.min(retries * 200, 2_000),
      },
    }) as RedisClientLike;

    this.client.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Redis] Connection error:', message);
    });

    this.client.on('connect', () => {
      console.log('[Redis] Connected');
    });
  }

  get status(): string {
    return this.client.isReady ? 'ready' : 'connecting';
  }

  async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ...args: LegacySetArg[]): Promise<'OK' | null> {
    let expiration: { type: 'EX' | 'PX'; value: number } | undefined;
    let condition: 'NX' | 'XX' | undefined;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (typeof arg !== 'string') continue;
      const upper = arg.toUpperCase();

      if ((upper === 'EX' || upper === 'PX') && typeof args[i + 1] === 'number') {
        expiration = { type: upper, value: args[i + 1] as number };
        i += 1;
      } else if (upper === 'NX' || upper === 'XX') {
        condition = upper;
      }
    }

    const options: SetOptions = {};
    if (expiration) options.expiration = expiration;
    if (condition) options.condition = condition;

    return this.client.set(key, value, options);
  }

  async del(...keys: string[]): Promise<number> {
    return this.client.del(keys);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async canSendPushNotification(userId: number): Promise<boolean> {
    const dateKey = getKyivDateString();
    const key = `push_limit:${userId}:${dateKey}`;
    const count = await this.incr(key);

    if (count === 1) {
      const ttlSeconds = Math.max(1, Math.ceil((getNextKyivMidnight().getTime() - Date.now()) / 1000));
      await this.expire(key, ttlSeconds);
    }

    return count <= 2;
  }

  private resolveCreateClient(): (options: any) => RedisClientLike {
    try {
      const redisModule = require('redis') as { createClient?: (options: any) => RedisClientLike };
      if (typeof redisModule.createClient === 'function') {
        return redisModule.createClient;
      }
    } catch (error) {
      console.warn('[Redis] `redis` package is unavailable, falling back to ioredis compatibility mode');
    }

    const IORedis = require('ioredis') as new (url: string, options?: Record<string, unknown>) => {
      on: (event: string, listener: (...args: unknown[]) => void) => void;
      connect: () => Promise<void>;
      get: (key: string) => Promise<string | null>;
      set: (key: string, value: string, ...args: LegacySetArg[]) => Promise<'OK' | null>;
      del: (...keys: string[]) => Promise<number>;
      exists: (key: string) => Promise<number>;
      incr: (key: string) => Promise<number>;
      expire: (key: string, seconds: number) => Promise<number>;
      status: string;
    };

    return (options: { url: string; socket?: { reconnectStrategy?: (retries: number) => number } }) => {
      const client = new IORedis(options.url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => options.socket?.reconnectStrategy?.(times) ?? Math.min(times * 200, 2_000),
        lazyConnect: true,
      });

      const adapted: RedisClientLike = {
        isReady: client.status === 'ready',
        isOpen: client.status === 'ready' || client.status === 'connecting',
        connect: () => client.connect().then(() => undefined),
        on: (event, listener) => {
          client.on(event, listener);
        },
        get: (key) => client.get(key),
        set: (key, value, setOptions) => {
          const args: LegacySetArg[] = [];
          if (setOptions?.expiration) {
            args.push(setOptions.expiration.type, setOptions.expiration.value);
          }
          if (setOptions?.condition) {
            args.push(setOptions.condition);
          }
          return client.set(key, value, ...args);
        },
        del: (keys) => Array.isArray(keys) ? client.del(...keys) : client.del(keys),
        exists: (key) => client.exists(key),
        incr: (key) => client.incr(key),
        expire: (key, seconds) => client.expire(key, seconds),
      };

      return adapted;
    };
  }
}

const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new RedisService(redisUrl) : new InMemoryRedisService();

if (!redisUrl) {
  console.warn('[Redis] REDIS_URL not set — using in-memory fallback (not for production)');
}

export { redis, RedisService };
