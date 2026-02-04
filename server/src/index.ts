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
    console.log('Connected to DB successfully');

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
