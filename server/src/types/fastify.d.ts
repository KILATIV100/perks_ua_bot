import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    io?: SocketIOServer;
  }
}
