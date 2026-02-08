import Fastify from 'fastify';
import cors from '@fastify/cors';
import socketio from 'fastify-socket.io';
import { PrismaClient } from '@prisma/client';
import { locationRoutes } from './routes/locations.js';
import { orderRoutes } from './routes/orders.js';
import { userRoutes } from './routes/users.js';
import { adminRoutes } from './routes/admin.js';
import { productRoutes } from './routes/products.js';
import { gameRoutes, setupGameSockets } from './routes/games.js';
import { seedProducts } from './data/seedData.js';

// Fix BigInt JSON serialization
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const OWNER_TELEGRAM_ID = '7363233852';

const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

const app = Fastify({
  logger: true,
  ignoreTrailingSlash: true // ВИПРАВЛЕНО: прибирає 404 помилку
});

// Register Socket.io for games
app.register(socketio, {
  cors: { origin: '*' }
});

// Register CORS
app.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

app.decorate('prisma', prisma);

// Health check
app.get('/health', async () => 'OK');

// Register routes
app.register(locationRoutes, { prefix: '/api/locations' });
app.register(productRoutes, { prefix: '/api/products' });
app.register(orderRoutes, { prefix: '/api/orders' });
app.register(userRoutes, { prefix: '/api/user' });
app.register(adminRoutes, { prefix: '/api/admin' });
app.register(gameRoutes, { prefix: '/api/games' });

// Ensure Owner exists
const ensureOwnerExists = async () => {
  try {
    await prisma.user.upsert({
      where: { telegramId: OWNER_TELEGRAM_ID },
      update: { role: 'OWNER' },
      create: { telegramId: OWNER_TELEGRAM_ID, role: 'OWNER' },
    });
  } catch (error) {
    console.error('Failed to ensure owner exists:', error);
  }
};

// Seed products if empty
const autoSeedProducts = async () => {
  const count = await prisma.product.count();
  if (count === 0) {
    console.log('[AutoSeed] Seeding products...');
    await prisma.product.createMany({ data: seedProducts });
  }
};

const start = async () => {
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
};

start();
