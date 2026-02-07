import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { locationRoutes } from './routes/locations.js';
import { orderRoutes } from './routes/orders.js';
import { userRoutes } from './routes/users.js';
import { adminRoutes } from './routes/admin.js';
import { productRoutes } from './routes/products.js';

// Fix BigInt JSON serialization
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Owner Telegram ID (as string)
const OWNER_TELEGRAM_ID = '7363233852';

// Prisma client - uses DATABASE_URL from environment
const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

const app = Fastify({
  logger: true,
  ignoreTrailingSlash: true,
});

// CORS configuration
const allowedOrigins = [
  // Production domains
  'https://perkup.com.ua',
  'https://www.perkup.com.ua',
  // Local development
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

// Pattern-based origins (Railway, subdomains)
const allowedPatterns = [
  /^https:\/\/.*\.perkup\.com\.ua$/,
  /^https:\/\/.*\.railway\.app$/,
  /^https:\/\/.*\.up\.railway\.app$/,
];

// Origin validation function
const isOriginAllowed = (origin: string | undefined): boolean => {
  if (!origin) return true; // Allow requests without origin (e.g., mobile apps, Postman)
  if (allowedOrigins.includes(origin)) return true;
  return allowedPatterns.some(pattern => pattern.test(origin));
};

// Register CORS with full configuration
app.register(cors, {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
  ],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400, // 24 hours - cache preflight requests
  preflight: true,
  strictPreflight: false,
});

// Decorate with Prisma
app.decorate('prisma', prisma);

// Health check - simple response for Railway
app.get('/health', async (_request, reply) => {
  return reply.code(200).send('OK');
});

// Register routes
app.register(locationRoutes, { prefix: '/api/locations' });
app.register(productRoutes, { prefix: '/api/products' });
app.register(orderRoutes, { prefix: '/api/orders' });
app.register(userRoutes, { prefix: '/api/user' });
app.register(adminRoutes, { prefix: '/api/admin' });

// Graceful shutdown
const gracefulShutdown = async (): Promise<void> => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Ensure Owner exists with OWNER role
const ensureOwnerExists = async (): Promise<void> => {
  try {
    const owner = await prisma.user.upsert({
      where: { telegramId: OWNER_TELEGRAM_ID },
      update: { role: 'OWNER' },
      create: {
        telegramId: OWNER_TELEGRAM_ID,
        role: 'OWNER',
      },
    });
    console.log(`Owner verified: telegramId=${owner.telegramId}, role=${owner.role}`);
  } catch (error) {
    console.error('Failed to ensure owner exists:', error);
  }
};

// Auto-seed products if database is empty
const autoSeedProducts = async (): Promise<void> => {
  try {
    const productCount = await prisma.product.count();
    console.log(`[Server] Product count in DB: ${productCount}`);
    if (productCount === 0) {
      const products = [
        // ===== Кава =====
        { name: 'Еспресо', description: null, volume: '110 мл', price: 40, category: 'Кава', imageUrl: null },
        { name: 'Допіо', description: null, volume: '180 мл', price: 60, category: 'Кава', imageUrl: null },
        { name: 'Американо', description: null, volume: '180 мл', price: 40, category: 'Кава', imageUrl: null },
        { name: 'Американо з молоком', description: null, volume: '180 мл', price: 50, category: 'Кава', imageUrl: null },
        { name: 'Макіато', description: 'Еспресо з молоком', volume: '180 мл', price: 50, category: 'Кава', imageUrl: null },
        { name: 'Капучіно', description: null, volume: '180 мл', price: 55, category: 'Кава', imageUrl: null },
        { name: 'Капучіно', description: null, volume: '250 мл', price: 65, category: 'Кава', imageUrl: null },
        { name: 'Капучіно', description: null, volume: '350 мл', price: 85, category: 'Кава', imageUrl: null },
        { name: 'Лате', description: null, volume: '350 мл', price: 75, category: 'Кава', imageUrl: null },
        { name: 'Лате', description: null, volume: '450 мл', price: 85, category: 'Кава', imageUrl: null },
        { name: 'Флет уайт', description: null, volume: '180 мл', price: 65, category: 'Кава', imageUrl: null },
        { name: 'Флет уайт', description: null, volume: '250 мл', price: 80, category: 'Кава', imageUrl: null },
        { name: 'Раф', description: null, volume: '250 мл', price: 100, category: 'Кава', imageUrl: null },
        { name: 'Раф', description: null, volume: '350 мл', price: 150, category: 'Кава', imageUrl: null },
        { name: 'Фільтр кава', description: null, volume: '250 мл', price: 55, category: 'Кава', imageUrl: null },
        { name: 'Фільтр кава', description: null, volume: '350 мл', price: 65, category: 'Кава', imageUrl: null },
        { name: 'Мокачіно', description: null, volume: '350 мл', price: 95, category: 'Кава', imageUrl: null },
        { name: 'Капуоранж', description: null, volume: '250 мл', price: 90, category: 'Кава', imageUrl: null },
        { name: 'Капуоранж', description: null, volume: '350 мл', price: 140, category: 'Кава', imageUrl: null },
        { name: 'Чорний оксамит', description: null, volume: '250 мл', price: 85, category: 'Кава', imageUrl: null },
        { name: 'Чорний оксамит', description: null, volume: '400 мл', price: 95, category: 'Кава', imageUrl: null },
        { name: 'Раф дубайський шоколад', description: null, volume: '250 мл', price: 150, category: 'Кава', imageUrl: null },
        { name: 'Раф дубайський шоколад', description: null, volume: '400 мл', price: 200, category: 'Кава', imageUrl: null },
        { name: 'Лате сирна груша', description: null, volume: '250 мл', price: 95, category: 'Кава', imageUrl: null },
        { name: 'Лате сирна груша', description: null, volume: '400 мл', price: 125, category: 'Кава', imageUrl: null },
        { name: 'Гарбузове лате', description: null, volume: '250 мл', price: 85, category: 'Кава', imageUrl: null },
        { name: 'Гарбузове лате', description: null, volume: '400 мл', price: 95, category: 'Кава', imageUrl: null },
        // ===== Холодні напої =====
        { name: 'ICE-лате', description: null, volume: null, price: 95, category: 'Холодні напої', imageUrl: null },
        { name: 'ICE-какао', description: null, volume: null, price: 95, category: 'Холодні напої', imageUrl: null },
        { name: 'ICE-матча', description: null, volume: null, price: 110, category: 'Холодні напої', imageUrl: null },
        { name: 'ICE-раф', description: null, volume: null, price: 130, category: 'Холодні напої', imageUrl: null },
        { name: 'Джміль (Бамбл)', description: null, volume: null, price: 110, category: 'Холодні напої', imageUrl: null },
        { name: 'Еспресо-тонік', description: null, volume: null, price: 95, category: 'Холодні напої', imageUrl: null },
        { name: 'Матча тонік', description: null, volume: null, price: 110, category: 'Холодні напої', imageUrl: null },
        { name: 'Матча оранж', description: null, volume: null, price: 110, category: 'Холодні напої', imageUrl: null },
        { name: 'Лимонад класичний', description: null, volume: null, price: 95, category: 'Холодні напої', imageUrl: null },
        { name: 'Лимонад манго-маракуя', description: null, volume: null, price: 95, category: 'Холодні напої', imageUrl: null },
        { name: 'Лимонад полуниця-лічі', description: null, volume: null, price: 95, category: 'Холодні напої', imageUrl: null },
        { name: 'Апероль', description: 'Безалкогольний', volume: null, price: 95, category: 'Холодні напої', imageUrl: null },
        { name: 'Блакитна лагуна', description: 'Безалкогольний', volume: null, price: 95, category: 'Холодні напої', imageUrl: null },
        { name: 'Мохіто', description: 'Безалкогольний', volume: null, price: 110, category: 'Холодні напої', imageUrl: null },
        { name: 'Фрапе', description: null, volume: null, price: 140, category: 'Холодні напої', imageUrl: null },
        { name: 'Молочний коктейль', description: null, volume: null, price: 110, category: 'Холодні напої', imageUrl: null },
        { name: 'Глясе', description: null, volume: '250 мл', price: 95, category: 'Холодні напої', imageUrl: null },
        { name: 'Coca-Cola', description: null, volume: '0.5 л', price: 35, category: 'Холодні напої', imageUrl: null },
        { name: 'Fanta', description: null, volume: '0.5 л', price: 35, category: 'Холодні напої', imageUrl: null },
        { name: 'Sprite', description: null, volume: '0.5 л', price: 35, category: 'Холодні напої', imageUrl: null },
        { name: 'Енергетик Монстр', description: null, volume: null, price: 90, category: 'Холодні напої', imageUrl: null },
        { name: 'Енергетик Бьорн', description: null, volume: null, price: 60, category: 'Холодні напої', imageUrl: null },
        // ===== Не кава =====
        { name: 'Какао', description: null, volume: '250 мл', price: 65, category: 'Не кава', imageUrl: null },
        { name: 'Какао', description: null, volume: '350 мл', price: 75, category: 'Не кава', imageUrl: null },
        { name: 'Матча', description: null, volume: '250 мл', price: 85, category: 'Не кава', imageUrl: null },
        { name: 'Чай натуральний', description: null, volume: '500 мл', price: 70, category: 'Не кава', imageUrl: null },
        { name: 'Чай листовий', description: null, volume: '500 мл', price: 40, category: 'Не кава', imageUrl: null },
        { name: 'Гарячий шоколад', description: null, volume: '350 мл', price: 110, category: 'Не кава', imageUrl: null },
        { name: 'Глінтвейн б/а', description: null, volume: '250 мл', price: 95, category: 'Не кава', imageUrl: null },
        { name: 'Глінтвейн б/а', description: null, volume: '400 мл', price: 125, category: 'Не кава', imageUrl: null },
        { name: 'Бебічіно', description: null, volume: '250 мл', price: 90, category: 'Не кава', imageUrl: null },
        { name: 'Бебічіно', description: null, volume: '350 мл', price: 130, category: 'Не кава', imageUrl: null },
        // ===== Їжа =====
        { name: 'Хот-дог', description: null, volume: null, price: 70, category: 'Їжа', imageUrl: null },
        { name: 'Бургер', description: null, volume: null, price: 70, category: 'Їжа', imageUrl: null },
        { name: 'Сендвіч', description: null, volume: null, price: 65, category: 'Їжа', imageUrl: null },
        { name: 'Київський сирник', description: null, volume: null, price: 90, category: 'Їжа', imageUrl: null },
        { name: 'Трубочка зі згущеним молоком', description: null, volume: null, price: 55, category: 'Їжа', imageUrl: null },
        { name: 'Горішок зі згущеним молоком', description: null, volume: null, price: 30, category: 'Їжа', imageUrl: null },
        { name: 'Макарун', description: null, volume: null, price: 75, category: 'Їжа', imageUrl: null },
        { name: 'Картопля кремова', description: null, volume: null, price: 65, category: 'Їжа', imageUrl: null },
        { name: 'Круасан Ньюйоркер', description: null, volume: null, price: 55, category: 'Їжа', imageUrl: null },
        // ===== Кава на продаж =====
        { name: 'Zavari Ethiopia', description: null, volume: '200 г', price: 380, category: 'Кава на продаж', imageUrl: null },
        { name: 'Zavari Italy blend', description: null, volume: '200 г', price: 340, category: 'Кава на продаж', imageUrl: null },
        { name: 'Zavari Guatemala', description: null, volume: '200 г', price: 300, category: 'Кава на продаж', imageUrl: null },
        { name: 'Zavari Santos', description: null, volume: '200 г', price: 340, category: 'Кава на продаж', imageUrl: null },
      ];

      await prisma.product.createMany({ data: products });
      console.log(`[Server] Seeded ${products.length} products`);
    }

    // Auto-seed locations if empty
    const locationCount = await prisma.location.count();
    console.log(`[Server] Location count in DB: ${locationCount}`);
    if (locationCount === 0) {
      const locations = [
        { name: 'Mark Mall', lat: 50.51485367479439, long: 30.78219892858682, address: 'ТРЦ Mark Mall, Бровари', status: 'active' as const, canPreorder: false },
        { name: 'Парк "Приозерний"', lat: 50.50128659421246, long: 30.754029265863245, address: 'Парк Приозерний, Бровари', status: 'active' as const, canPreorder: true },
        { name: 'ЖК "Лісовий квартал"', lat: 50.51758555255138, long: 30.783235338021694, address: 'ЖК Лісовий квартал, Бровари', status: 'coming_soon' as const, canPreorder: false },
      ];
      for (const loc of locations) {
        await prisma.location.create({ data: loc });
      }
      console.log(`[Server] Seeded ${locations.length} locations`);
    }
  } catch (error) {
    console.error('[Server] AutoSeed error:', error);
  }
};

// Start server
const start = async (): Promise<void> => {
  try {
    // Verify database connection on startup
    await prisma.$connect();
    console.log('[Server] DB connected');

    await ensureOwnerExists();
    await autoSeedProducts();

    // Log registered routes so 404s are easy to debug
    console.log('[Server] Routes:\n' + app.printRoutes());

    const port = parseInt(process.env.PORT || '3000', 10);
    const host = '0.0.0.0';

    await app.listen({ port, host });
    console.log(`[Server] Running on http://${host}:${port}`);
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    app.log.error(err);
    process.exit(1);
  }
};

start();

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
