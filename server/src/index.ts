/**
 * Server Entry Point — PerkUp v2.0 Modular Monolith
 *
 * Module layout:
 *   modules/auth/       — Telegram initData validation + JWT tokens
 *   modules/loyalty/    — Wheel of Fortune, points, redemption codes
 *   modules/orders/     — Cart, orders, state machine
 *   modules/games/      — TIC_TAC_TOE (online + AI), PERKY_JUMP
 *   modules/products/   — Menu, categories
 *   modules/admin/      — Admin panel API, code verification, stats
 *   modules/referral/   — Referral links & stats
 *   modules/radio/      — Playlist, likes
 *   shared/             — PrismaClient, Redis, JWT, timezone utils, Telegram utils
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import socketio from 'fastify-socket.io';
import { PrismaClient } from '@prisma/client';
import { redis } from './shared/redis.js';
import { seedProducts, seedLocations, seedTracks } from './data/seedData.js';

// ── Module routes ────────────────────────────────────────────────────────────
import { authRoutes } from './modules/auth/auth.routes.js';
import { loyaltyRoutes } from './modules/loyalty/loyalty.routes.js';
import { gameRoutes } from './modules/games/games.routes.js';
import { setupGameSockets } from './modules/games/games.sockets.js';
import { productRoutes } from './modules/products/products.routes.js';
import { orderRoutes as orderModuleRoutes } from './modules/orders/orders.routes.js';
import { adminModuleRoutes } from './modules/admin/admin.routes.js';
import { referralRoutes } from './modules/referral/referral.routes.js';
import { radioRoutes } from './modules/radio/radio.routes.js';

// ── Legacy routes (kept during migration) ────────────────────────────────────
import { orderRoutes as legacyOrderRoutes } from './routes/orders.js';
import { locationRoutes } from './routes/locations.js';
import { adminRoutes as legacyAdminRoutes } from './routes/admin.js';
import { userRoutes as legacyUserRoutes } from './routes/users.js';

// Fix BigInt JSON serialization
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID || '7363233852';

const prisma = new PrismaClient({
  log: ['error', 'warn'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

const app = Fastify({
  logger: true,
  ignoreTrailingSlash: true,
});

// ── Plugins ──────────────────────────────────────────────────────────────────
app.register(socketio, { cors: { origin: '*' } });

app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'Telegram-Init-Data'],
  credentials: true,
});

// Rate limiting (global baseline; modules can override per-route)
app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

app.decorate('prisma', prisma);

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', async (_req, reply) => reply.send({ status: 'ok', version: '2.0.0' }));

// ── v2.0 Module routes ──────────────────────────────────────────────────────
app.register(authRoutes, { prefix: '/api/auth' });
app.register(loyaltyRoutes, { prefix: '/api/loyalty' });
app.register(gameRoutes, { prefix: '/api/games' });
app.register(productRoutes, { prefix: '/api/products' });
app.register(orderModuleRoutes, { prefix: '/api/orders' });
app.register(adminModuleRoutes, { prefix: '/api/admin' });
app.register(referralRoutes, { prefix: '/api/referral' });
app.register(radioRoutes, { prefix: '/api/radio' });

// ── Legacy routes (backward compat — remove once all clients migrated) ───────
app.register(legacyUserRoutes, { prefix: '/api/user' });
app.register(legacyOrderRoutes, { prefix: '/api/legacy/orders' });
app.register(locationRoutes, { prefix: '/api/locations' });
app.register(legacyAdminRoutes, { prefix: '/api/legacy/admin' });

// ── Startup tasks ─────────────────────────────────────────────────────────────
async function ensureOwnerExists(): Promise<void> {
  try {
    await prisma.user.upsert({
      where: { telegramId: OWNER_TELEGRAM_ID },
      update: { role: 'OWNER' },
      create: { telegramId: OWNER_TELEGRAM_ID, role: 'OWNER' },
    });
  } catch (err) {
    console.error('Failed to ensure owner exists:', err);
  }
}

async function autoSeedLocations(): Promise<void> {
  console.log('[AutoSeed] Syncing locations...');

  const kronaLocation = seedLocations.find((location) => location.slug === 'zhk-krona-park-2');
  if (!kronaLocation) {
    throw new Error('Location seed "zhk-krona-park-2" is missing');
  }

  await prisma.$transaction(async (tx) => {
    const legacySlug = 'zhk-lisovyi-kvartal';
    const legacyLocation = await tx.location.findUnique({ where: { slug: legacySlug } });
    const kronaRecord = await tx.location.findUnique({ where: { slug: kronaLocation.slug } });

    if (legacyLocation && !kronaRecord) {
      await tx.location.update({
        where: { slug: legacySlug },
        data: {
          slug: kronaLocation.slug,
          name: kronaLocation.name,
          address: kronaLocation.address,
          latitude: kronaLocation.latitude,
          longitude: kronaLocation.longitude,
          hasOrdering: kronaLocation.hasOrdering,
          isViewOnly: kronaLocation.isViewOnly,
          isActive: kronaLocation.isActive,
        },
      });
    }

    if (legacyLocation && kronaRecord) {
      await tx.location.delete({ where: { slug: legacySlug } });
    }

    for (const loc of seedLocations) {
      await tx.location.upsert({
        where: { slug: loc.slug },
        update: {
          name: loc.name,
          address: loc.address,
          latitude: loc.latitude,
          longitude: loc.longitude,
          hasOrdering: loc.hasOrdering,
          isViewOnly: loc.isViewOnly,
          isActive: loc.isActive,
        },
        create: loc,
      });
    }
  });
}

async function autoSeedProducts(): Promise<void> {
  const count = await prisma.product.count();
  if (count === 0) {
    console.log('[AutoSeed] Seeding products...');
    await prisma.product.createMany({ data: seedProducts });
  }
}


async function autoSeedTracks(): Promise<void> {
  const count = await prisma.track.count();
  if (count === 0) {
    console.log('[AutoSeed] Seeding radio tracks...');
    await prisma.track.createMany({ data: seedTracks });
  }
}

async function connectRedis(): Promise<void> {
  try {
    if (typeof redis.connect === 'function' && (redis as unknown as { status?: string }).status !== 'ready') {
      await redis.connect();
    }
  } catch (err) {
    console.warn('[Redis] Connection failed (using fallback):', err);
  }
}

async function start(): Promise<void> {
  try {
    await app.ready();

    // Debug: print all registered routes
    console.log('[routes] Registered routes:');
    console.log(app.printRoutes({ commonPrefix: false }));

    if (app.io) {
      setupGameSockets(app.io, prisma);
    }
    // Connect Redis BEFORE server starts to ensure locks & idempotency work from first request
    await connectRedis();

    await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });

    // Post-start tasks run in background (non-critical)
    ensureOwnerExists().catch((e) => app.log.error(e, '[startup] owner setup failed'));
    autoSeedLocations().catch((e) => app.log.error(e, '[startup] location seed failed'));
    autoSeedProducts().catch((e) => app.log.error(e, '[startup] product seed failed'));
    autoSeedTracks().catch((e) => app.log.error(e, '[startup] tracks seed failed'));
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown — disconnect Prisma to release DB pool
async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] Received ${signal}, closing...`);
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
