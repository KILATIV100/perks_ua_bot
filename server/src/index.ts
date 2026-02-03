import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { locationRoutes } from './routes/locations.js';
import { orderRoutes } from './routes/orders.js';

const prisma = new PrismaClient();

const app = Fastify({
  logger: true,
});

// Register CORS for perkup.com.ua domain
app.register(cors, {
  origin: [
    'https://perkup.com.ua',
    'https://www.perkup.com.ua',
    /\.perkup\.com\.ua$/,
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// Decorate with Prisma
app.decorate('prisma', prisma);

// Health check
app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register routes
app.register(locationRoutes, { prefix: '/api/locations' });
app.register(orderRoutes, { prefix: '/api/orders' });

// Graceful shutdown
const gracefulShutdown = async (): Promise<void> => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const start = async (): Promise<void> => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = '0.0.0.0';

    await app.listen({ port, host });
    console.log(`🚀 Server running on http://${host}:${port}`);
  } catch (err) {
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
