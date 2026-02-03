import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { locationRoutes } from './routes/locations.js';
import { orderRoutes } from './routes/orders.js';

// Prisma client - uses DATABASE_URL from environment
const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

const app = Fastify({
  logger: true,
});

// CORS allowed origins
const allowedOrigins: (string | RegExp)[] = [
  // Production domain
  'https://perkup.com.ua',
  'https://www.perkup.com.ua',
  /\.perkup\.com\.ua$/,
  // Railway domains
  /\.railway\.app$/,
  /\.up\.railway\.app$/,
  // Local development
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

// Register CORS
app.register(cors, {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// Decorate with Prisma
app.decorate('prisma', prisma);

// Health check - simple response for Railway
app.get('/health', async (_request, reply) => {
  return reply.code(200).send('OK');
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
    // Verify database connection on startup
    await prisma.$connect();
    console.log('✅ Database connected');

    const port = parseInt(process.env.PORT || '3000', 10);
    const host = '0.0.0.0';

    await app.listen({ port, host });
    console.log(`🚀 Server running on http://${host}:${port}`);
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
