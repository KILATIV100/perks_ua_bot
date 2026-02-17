/**
 * Shared PrismaClient singleton.
 * Use this in non-Fastify contexts (sockets, scripts, tests).
 * Inside Fastify route handlers, prefer app.prisma (decorated instance).
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ['error', 'warn'] });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
