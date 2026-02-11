import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { OWNER_TELEGRAM_ID } from './telegram.js';

const setRoleSchema = z.object({
  requesterId: z.union([z.number(), z.string()]).transform(String),
  targetTelegramId: z.union([z.number(), z.string()]).transform(String),
  newRole: z.enum(['USER', 'ADMIN', 'OWNER']),
});

export async function adminRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // GET /api/admin/list
  app.get<{ Querystring: { requesterId: string } }>('list', async (request, reply) => {
    try {
      const requesterId = request.query.requesterId;
      const requester = await app.prisma.user.findUnique({ where: { telegramId: requesterId } });
      if (!requester || requester.role !== 'OWNER') {
        return reply.status(403).send({ error: 'Access denied. Only Owner can view admin list.' });
      }

      const admins = await app.prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'OWNER'] } },
        select: { id: true, telegramId: true, username: true, firstName: true, role: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      return reply.send({ admins });
    } catch (error) {
      app.log.error({ err: error }, 'Admin list error');
      return reply.status(500).send({ error: 'Failed to get admin list' });
    }
  });

  // PATCH /api/admin/set-role
  app.patch('set-role', async (request, reply) => {
    try {
      const body = setRoleSchema.parse(request.body);
      const requester = await app.prisma.user.findUnique({ where: { telegramId: body.requesterId } });
      if (!requester || requester.role !== 'OWNER') {
        return reply.status(403).send({ error: 'Access denied. Only Owner can change roles.' });
      }

      if (body.requesterId === body.targetTelegramId && body.newRole !== 'OWNER') {
        return reply.status(400).send({ error: 'Cannot demote yourself from Owner.' });
      }

      const targetUser = await app.prisma.user.upsert({
        where: { telegramId: body.targetTelegramId },
        update: { role: body.newRole },
        create: { telegramId: body.targetTelegramId, role: body.newRole },
        select: { id: true, telegramId: true, username: true, firstName: true, role: true },
      });

      return reply.send({ success: true, user: targetUser });
    } catch (error) {
      app.log.error({ err: error }, 'Set role error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to set role' });
    }
  });

  // GET /api/admin/stats
  app.get<{ Querystring: { requesterId: string } }>('stats', async (request, reply) => {
    try {
      const requesterId = request.query.requesterId;
      const requester = await app.prisma.user.findUnique({ where: { telegramId: requesterId } });
      if (!requester || requester.role !== 'OWNER') {
        return reply.status(403).send({ error: 'Access denied.' });
      }

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [newUsersCount, spinsCount, totalUsers, pointsAgg] = await Promise.all([
        app.prisma.user.count({ where: { createdAt: { gte: yesterday } } }),
        app.prisma.user.count({ where: { lastSpin: { gte: yesterday } } }),
        app.prisma.user.count(),
        app.prisma.user.aggregate({ _sum: { points: true } }),
      ]);

      return reply.send({
        period: '24h',
        newUsers: newUsersCount,
        spins: spinsCount,
        totalUsers,
        totalPointsInCirculation: pointsAgg._sum.points || 0,
        generatedAt: now.toISOString(),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Stats error');
      return reply.status(500).send({ error: 'Failed to get stats' });
    }
  });

  // GET /api/admin/check-role
  app.get<{ Querystring: { telegramId: string } }>('check-role', async (request, reply) => {
    try {
      const telegramId = request.query.telegramId;
      const user = await app.prisma.user.findUnique({ where: { telegramId }, select: { role: true } });
      return reply.send({
        role: user?.role || 'USER',
        isAdmin: user?.role === 'ADMIN' || user?.role === 'OWNER',
        isOwner: user?.role === 'OWNER',
      });
    } catch (error) {
      app.log.error({ err: error }, 'Check role error');
      return reply.status(500).send({ error: 'Failed to check role' });
    }
  });

  // GET /api/admin/export-users
  app.get<{ Querystring: { requesterId: string } }>('export-users', async (request, reply) => {
    try {
      const requesterId = request.query.requesterId;
      const requester = await app.prisma.user.findUnique({ where: { telegramId: requesterId } });
      if (!requester || requester.role !== 'OWNER') {
        return reply.status(403).send({ error: 'Access denied.' });
      }

      const users = await app.prisma.user.findMany({
        select: {
          id: true, telegramId: true, username: true, firstName: true, lastName: true,
          points: true, totalSpins: true, role: true, createdAt: true, updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      return reply.send({
        exportedAt: new Date().toISOString(),
        totalUsers: users.length,
        totalPoints: users.reduce((sum, u) => sum + u.points, 0),
        totalSpins: users.reduce((sum, u) => sum + u.totalSpins, 0),
        users,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Export users error');
      return reply.status(500).send({ error: 'Failed to export users' });
    }
  });

  // GET /api/admin/all-users
  app.get<{ Querystring: { requesterId: string } }>('all-users', async (request, reply) => {
    try {
      const requesterId = request.query.requesterId;
      const requester = await app.prisma.user.findUnique({ where: { telegramId: requesterId } });
      if (!requester || requester.role !== 'OWNER') {
        return reply.status(403).send({ error: 'Access denied.' });
      }

      const users = await app.prisma.user.findMany({
        select: { telegramId: true, firstName: true },
      });

      return reply.send({ users, total: users.length });
    } catch (error) {
      app.log.error({ err: error }, 'All users error');
      return reply.status(500).send({ error: 'Failed to get users' });
    }
  });

  // POST /api/admin/add-points - God Mode for Owner
  app.post<{ Body: { telegramId: string; points: number } }>('add-points', async (request, reply) => {
    try {
      const { telegramId, points } = request.body;

      if (telegramId !== OWNER_TELEGRAM_ID) {
        return reply.status(403).send({ error: 'Access denied.' });
      }

      const user = await app.prisma.user.upsert({
        where: { telegramId },
        update: { points: { increment: points } },
        create: { telegramId, points, role: 'OWNER' },
        select: { telegramId: true, firstName: true, points: true },
      });

      return reply.send({ success: true, newBalance: user.points, added: points });
    } catch (error) {
      app.log.error({ err: error }, 'Add points error');
      return reply.status(500).send({ error: 'Failed to add points' });
    }
  });
}
