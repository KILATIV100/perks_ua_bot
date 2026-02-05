import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

// Owner Telegram ID
const OWNER_TELEGRAM_ID = 7363233852n;

// Telegram Bot API
const BOT_TOKEN = process.env.BOT_TOKEN;

/**
 * Send message to Owner via Telegram Bot
 */
async function notifyOwner(text: string): Promise<void> {
  if (!BOT_TOKEN) {
    console.log('[Telegram] BOT_TOKEN not set, skipping owner notification');
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: OWNER_TELEGRAM_ID.toString(),
        text,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      console.log(`[Telegram] Failed to notify owner: ${response.status}`);
    }
  } catch (error) {
    console.log('[Telegram] Error notifying owner:', error);
  }
}

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

      // Notify Owner about the verification
      const adminName = admin.firstName || admin.username || `ID: ${body.adminTelegramId}`;
      const timeStr = now.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
      const ownerNotification = `🔔 *Нова видача кави!*\n\n` +
        `👤 Адмін: ${adminName}\n` +
        `🎫 Код: \`${body.code}\`\n` +
        `📉 Списано: 100 балів\n` +
        `🕒 Час: ${timeStr}`;

      notifyOwner(ownerNotification).catch((err) => {
        app.log.error({ err }, 'Failed to notify owner');
      });

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
        adminName,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Verify code error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to verify code' });
    }
  });

  // GET /api/admin/stats - Get 24h statistics (only for Owner)
  app.get<{ Querystring: { requesterId: string } }>('/stats', async (request, reply) => {
    try {
      const requesterId = BigInt(request.query.requesterId);

      // Check if requester is Owner
      const requester = await app.prisma.user.findUnique({
        where: { telegramId: requesterId },
      });

      if (!requester || requester.role !== 'OWNER') {
        return reply.status(403).send({ error: 'Access denied. Only Owner can view stats.' });
      }

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Count new users in last 24h
      const newUsersCount = await app.prisma.user.count({
        where: {
          createdAt: { gte: yesterday },
        },
      });

      // Count spins in last 24h
      const spinsCount = await app.prisma.user.count({
        where: {
          lastSpin: { gte: yesterday },
        },
      });

      // Count verified codes (free drinks) in last 24h
      const freeDrinksCount = await app.prisma.redemptionCode.count({
        where: {
          used: true,
          usedAt: { gte: yesterday },
        },
      });

      // Total users
      const totalUsers = await app.prisma.user.count();

      // Total points in circulation
      const pointsAgg = await app.prisma.user.aggregate({
        _sum: { points: true },
      });

      return reply.send({
        period: '24h',
        newUsers: newUsersCount,
        spins: spinsCount,
        freeDrinks: freeDrinksCount,
        totalUsers,
        totalPointsInCirculation: pointsAgg._sum.points || 0,
        generatedAt: now.toISOString(),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Stats error');
      return reply.status(500).send({ error: 'Failed to get stats' });
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

  // GET /api/admin/export-users - Export all users (only for Owner)
  app.get<{ Querystring: { requesterId: string } }>('/export-users', async (request, reply) => {
    try {
      const requesterId = BigInt(request.query.requesterId);

      // Check if requester is Owner
      const requester = await app.prisma.user.findUnique({
        where: { telegramId: requesterId },
      });

      if (!requester || requester.role !== 'OWNER') {
        return reply.status(403).send({ error: 'Access denied. Only Owner can export users.' });
      }

      // Fetch all users
      const users = await app.prisma.user.findMany({
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          lastName: true,
          points: true,
          totalSpins: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      // Convert BigInt to string for JSON serialization
      const exportData = users.map((user) => ({
        ...user,
        telegramId: user.telegramId.toString(),
      }));

      return reply.send({
        exportedAt: new Date().toISOString(),
        totalUsers: exportData.length,
        totalPoints: exportData.reduce((sum, u) => sum + u.points, 0),
        totalSpins: exportData.reduce((sum, u) => sum + u.totalSpins, 0),
        users: exportData,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Export users error');
      return reply.status(500).send({ error: 'Failed to export users' });
    }
  });
}
