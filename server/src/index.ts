/**
 * Server Entry Point — Modular Monolith
 *
 * Module layout:
 *   modules/loyalty/   — Wheel of Fortune, points, redemption codes
 *   modules/games/     — TIC_TAC_TOE sessions, PERKIE_JUMP score submission, Socket.IO
 *   modules/users/     — User sync, profile
 *   modules/orders/    — Cart, orders (delegates to routes/orders.ts during migration)
 *   modules/products/  — Menu, categories
 *   shared/            — PrismaClient singleton, timezone utils, Telegram utils, auth middleware
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import socketio from 'fastify-socket.io';
import { PrismaClient } from '@prisma/client';
import { seedProducts } from './data/seedData.js';

// ── Module routes ────────────────────────────────────────────────────────────
import { loyaltyRoutes } from './modules/loyalty/loyalty.routes.js';
import { gameRoutes } from './modules/games/games.routes.js';
import { setupGameSockets } from './modules/games/games.sockets.js';
// import { userRoutes } from './modules/users/users.routes.js'; // Enable when removing legacy routes
import { productRoutes } from './modules/products/products.routes.js';

// ── Legacy routes (kept during migration; remove once fully migrated) ────────
import { orderRoutes } from './routes/orders.js';
import { locationRoutes } from './routes/locations.js';
import { adminRoutes } from './routes/admin.js';
// Legacy spin/redeem under /api/user/* (backward compat while clients migrate to /api/loyalty/*)
import { userRoutes as legacyUserRoutes } from './routes/users.js';

// Fix BigInt JSON serialization
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const OWNER_TELEGRAM_ID = '7363233852';

const prisma = new PrismaClient({ log: ['error', 'warn'] });

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

app.decorate('prisma', prisma);

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', async () => 'OK');

// ── Module routes ────────────────────────────────────────────────────────────
app.register(loyaltyRoutes, { prefix: '/api/loyalty' });
app.register(gameRoutes, { prefix: '/api/games' });
app.register(productRoutes, { prefix: '/api/products' });

// ── Legacy routes (complete implementations; new modules delegate here for now) ─
// /api/user — handles sync, spin, redeem, profile (full implementation)
app.register(legacyUserRoutes, { prefix: '/api/user' });
app.register(orderRoutes, { prefix: '/api/orders' });
app.register(locationRoutes, { prefix: '/api/locations' });
app.register(adminRoutes, { prefix: '/api/admin' });

// NOTE: userRoutes (new module) is not registered separately to avoid route
// conflicts with legacyUserRoutes. During migration, remove legacyUserRoutes
// and uncomment the line below:
// app.register(userRoutes, { prefix: '/api/user' });

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

async function autoSeedProducts(): Promise<void> {
  const count = await prisma.product.count();
  if (count === 0) {
    console.log('[AutoSeed] Seeding products...');
    await prisma.product.createMany({ data: seedProducts });
  }
}

async function start(): Promise<void> {
  try {
    await ensureOwnerExists();
    await autoSeedProducts();
    await app.ready();
    if (app.io) {
      setupGameSockets(app.io, prisma);
    }
    await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
