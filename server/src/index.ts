import Fastify from 'fastify';
import cors from '@fastify/cors';
import socketio from 'fastify-socket.io';
import { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';

// Modules
import { userRoutes } from './modules/users/users.routes.js';
import { loyaltyRoutes } from './modules/loyalty/loyalty.routes.js';
import { gameRoutes } from './modules/games/games.routes.js';
import { setupGameSockets } from './modules/games/games.sockets.js';
import { orderRoutes } from './modules/orders/orders.routes.js';
import { productRoutes } from './modules/products/products.routes.js';
import { locationRoutes } from './modules/products/locations.routes.js';
import { adminRoutes } from './shared/admin.routes.js';

// Fix BigInt JSON serialization
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const OWNER_TELEGRAM_ID = '7363233852';

const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    io: SocketIOServer;
  }
}

const app = Fastify({
  logger: true,
  ignoreTrailingSlash: true,
});

// Register Socket.io for games
app.register(socketio, {
  cors: { origin: '*' },
});

// Register CORS
app.register(cors, {
  origin: true,
  credentials: true,
});

app.decorate('prisma', prisma);

// Health check
app.get('/health', async () => 'OK');

// Register modular routes
app.register(locationRoutes, { prefix: '/api/locations' });
app.register(productRoutes, { prefix: '/api/products' });
app.register(orderRoutes, { prefix: '/api/orders' });
app.register(userRoutes, { prefix: '/api/user' });
app.register(loyaltyRoutes, { prefix: '/api/user' });
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
    console.log('[Startup] Owner ensured');
  } catch (error) {
    console.error('Failed to ensure owner exists:', error);
  }
};

// Auto-seed products if empty
const autoSeedProducts = async () => {
  const count = await prisma.product.count();
  if (count > 0) {
    console.log(`[Startup] Products: ${count} (skip seed)`);
    return;
  }

  console.log('[AutoSeed] Seeding products...');
  const products = [
    { name: 'Espresso', description: null, volume: '30 мл', price: 55, category: 'Кава', type: 'MENU' as const, imageUrl: null },
    { name: 'Americano', description: null, volume: '200 мл', price: 65, category: 'Кава', type: 'MENU' as const, imageUrl: null },
    { name: 'Cappuccino', description: null, volume: '250 мл', price: 75, category: 'Кава', type: 'MENU' as const, imageUrl: null },
    { name: 'Latte', description: null, volume: '300 мл', price: 80, category: 'Кава', type: 'MENU' as const, imageUrl: null },
    { name: 'Flat White', description: null, volume: '200 мл', price: 80, category: 'Кава', type: 'MENU' as const, imageUrl: null },
    { name: 'Raf', description: null, volume: '250 мл', price: 90, category: 'Кава', type: 'MENU' as const, imageUrl: null },
    { name: 'Mocha', description: null, volume: '300 мл', price: 90, category: 'Кава', type: 'MENU' as const, imageUrl: null },
    { name: 'Hot Chocolate', description: null, volume: '250 мл', price: 70, category: 'Інші напої', type: 'MENU' as const, imageUrl: null },
    { name: 'Matcha Latte', description: null, volume: '300 мл', price: 90, category: 'Інші напої', type: 'MENU' as const, imageUrl: null },
    { name: 'Чай', description: null, volume: '300 мл', price: 55, category: 'Інші напої', type: 'MENU' as const, imageUrl: null },
    { name: 'Круасан', description: null, volume: null, price: 65, category: 'Їжа', type: 'MENU' as const, imageUrl: null },
    { name: 'Сирники', description: null, volume: null, price: 85, category: 'Їжа', type: 'MENU' as const, imageUrl: null },
    { name: 'Тост з авокадо', description: null, volume: null, price: 95, category: 'Їжа', type: 'MENU' as const, imageUrl: null },
    { name: 'Zavari Ethiopia', description: null, volume: '200 г', price: 380, category: 'Кава на продаж', type: 'BEANS' as const, imageUrl: null },
    { name: 'Zavari Italy blend', description: null, volume: '200 г', price: 340, category: 'Кава на продаж', type: 'BEANS' as const, imageUrl: null },
    { name: 'Zavari Guatemala', description: null, volume: '200 г', price: 300, category: 'Кава на продаж', type: 'BEANS' as const, imageUrl: null },
    { name: 'Zavari Santos', description: null, volume: '200 г', price: 340, category: 'Кава на продаж', type: 'BEANS' as const, imageUrl: null },
    { name: 'Кава Ethiopia', description: 'Зерно, свіжий смак', volume: '250 г', price: 380, category: 'Кава на продаж', type: 'BEANS' as const, imageUrl: null },
    { name: 'Худі "PerkUp Original"', description: 'Стильне худі з логотипом PerkUp', volume: null, price: 1200, category: 'Мерч', type: 'MERCH' as const, imageUrl: null },
    { name: 'Термочашка "Coffee Lover"', description: 'Термочашка з фірмовим дизайном', volume: '350 мл', price: 450, category: 'Мерч', type: 'MERCH' as const, imageUrl: null },
  ];

  for (const p of products) {
    await prisma.product.create({ data: p });
  }
  console.log(`[AutoSeed] Seeded ${products.length} products`);
};

// Auto-seed locations if empty
const autoSeedLocations = async () => {
  const count = await prisma.location.count();
  if (count > 0) {
    console.log(`[Startup] Locations: ${count} (skip seed)`);
    return;
  }

  console.log('[AutoSeed] Seeding locations...');
  const locations = [
    { name: 'PerkUp Центр', address: 'вул. Хрещатик, 22', lat: 50.4501, long: 30.5234, status: 'active' as const, canPreorder: true },
    { name: 'PerkUp Поділ', address: 'вул. Сагайдачного, 10', lat: 50.4633, long: 30.5178, status: 'active' as const, canPreorder: true },
    { name: 'Mark Mall', address: 'ТРЦ Mark Mall, 1 поверх', lat: 50.4400, long: 30.5100, status: 'active' as const, canPreorder: false },
  ];

  for (const loc of locations) {
    await prisma.location.create({ data: loc });
  }
  console.log(`[AutoSeed] Seeded ${locations.length} locations`);
};

// Setup Socket.IO game handlers after app is ready
app.ready().then(() => {
  if (app.io) {
    setupGameSockets(app.io, prisma);
    console.log('[Startup] Socket.IO game handlers registered');
  }
});

const start = async () => {
  try {
    await ensureOwnerExists();
    await autoSeedProducts();
    await autoSeedLocations();
    await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
