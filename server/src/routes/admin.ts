import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

// Owner Telegram ID
const OWNER_TELEGRAM_ID = 7363233852n;

// Validation schemas
const setRoleSchema = z.object({
  requesterId: z.number(), // Who is making the request
  targetTelegramId: z.number(), // Who is being changed
  newRole: z.enum(['USER', 'ADMIN', 'OWNER']),
});

const verifyCodeSchema = z.object({
  adminTelegramId: z.number(),
  code: z.string().regex(/^[A-Z]{2}-\d{5}$/, 'Invalid code format. Expected: XX-00000'),
});

export async function adminRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // GET /api/admin/list - List all admins (only for Owner)
  app.get<{ Querystring: { requesterId: string } }>('/list', async (request, reply) => {
    try {
      const requesterId = BigInt(request.query.requesterId);

      // Check if requester is Owner
      const requester = await app.prisma.user.findUnique({
        where: { telegramId: requesterId },
      });

      if (!requester || requester.role !== 'OWNER') {
        return reply.status(403).send({ error: 'Access denied. Only Owner can view admin list.' });
      }

      // Get all admins
      const admins = await app.prisma.user.findMany({
        where: {
          role: { in: ['ADMIN', 'OWNER'] },
        },
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          role: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      return reply.send({
        admins: admins.map((admin) => ({
          ...admin,
          telegramId: admin.telegramId.toString(),
        })),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Admin list error');
      return reply.status(500).send({ error: 'Failed to get admin list' });
    }
  });

  // PATCH /api/admin/set-role - Set user role (only for Owner)
  app.patch('/set-role', async (request, reply) => {
    try {
      const body = setRoleSchema.parse(request.body);

      app.log.info(`[Set Role] requester: ${body.requesterId}, target: ${body.targetTelegramId}, newRole: ${body.newRole}`);

      // Check if requester is Owner
      const requester = await app.prisma.user.findUnique({
        where: { telegramId: BigInt(body.requesterId) },
      });

      if (!requester || requester.role !== 'OWNER') {
        return reply.status(403).send({ error: 'Access denied. Only Owner can change roles.' });
      }

      // Prevent changing own role
      if (body.requesterId === body.targetTelegramId && body.newRole !== 'OWNER') {
        return reply.status(400).send({ error: 'Cannot demote yourself from Owner.' });
      }

      // Find or create target user
      const targetUser = await app.prisma.user.upsert({
        where: { telegramId: BigInt(body.targetTelegramId) },
        update: { role: body.newRole },
        create: {
          telegramId: BigInt(body.targetTelegramId),
          role: body.newRole,
        },
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          role: true,
        },
      });

      app.log.info(`[Role Changed] telegramId: ${body.targetTelegramId}, newRole: ${body.newRole}`);

      return reply.send({
        success: true,
        user: {
          ...targetUser,
          telegramId: targetUser.telegramId.toString(),
        },
      });
    } catch (error) {
      app.log.error({ err: error }, 'Set role error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to set role' });
    }
  });

  // POST /api/admin/verify-code - Verify redemption code (for Admin/Owner)
  app.post('/verify-code', async (request, reply) => {
    try {
      const body = verifyCodeSchema.parse(request.body);

      app.log.info(`[Verify Code] admin: ${body.adminTelegramId}, code: ${body.code}`);

      // Check if admin has permission
      const admin = await app.prisma.user.findUnique({
        where: { telegramId: BigInt(body.adminTelegramId) },
      });

      if (!admin || (admin.role !== 'ADMIN' && admin.role !== 'OWNER')) {
        return reply.status(403).send({ error: 'Access denied. Only Admin or Owner can verify codes.' });
      }

      // Find the code
      const redemptionCode = await app.prisma.redemptionCode.findUnique({
        where: { code: body.code },
        include: {
          user: {
            select: {
              id: true,
              telegramId: true,
              firstName: true,
              username: true,
            },
          },
        },
      });

      if (!redemptionCode) {
        return reply.status(404).send({
          error: 'CodeNotFound',
          message: 'Код не знайдено. Перевірте правильність введення.',
        });
      }

      if (redemptionCode.used) {
        return reply.status(400).send({
          error: 'CodeAlreadyUsed',
          message: `Код вже використано ${redemptionCode.usedAt ? new Date(redemptionCode.usedAt).toLocaleString('uk-UA') : ''}.`,
        });
      }

      if (new Date() > redemptionCode.expiresAt) {
        return reply.status(400).send({
          error: 'CodeExpired',
          message: 'Код прострочено. Термін дії закінчився.',
        });
      }

      // Mark code as used
      const now = new Date();
      await app.prisma.redemptionCode.update({
        where: { id: redemptionCode.id },
        data: {
          used: true,
          usedAt: now,
          usedBy: BigInt(body.adminTelegramId),
        },
      });

      app.log.info(`[Code Verified] code: ${body.code}, user: ${redemptionCode.user.telegramId}, verifiedBy: ${body.adminTelegramId}`);

      return reply.send({
        success: true,
        message: 'Код підтверджено! Списано 100 балів. Видайте напій.',
        user: {
          firstName: redemptionCode.user.firstName,
          username: redemptionCode.user.username,
          telegramId: redemptionCode.user.telegramId.toString(),
        },
        code: body.code,
        verifiedAt: now.toISOString(),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Verify code error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to verify code' });
    }
  });

  // GET /api/admin/check-role - Check user role
  app.get<{ Querystring: { telegramId: string } }>('/check-role', async (request, reply) => {
    try {
      const telegramId = BigInt(request.query.telegramId);

      const user = await app.prisma.user.findUnique({
        where: { telegramId },
        select: { role: true },
      });

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
}
