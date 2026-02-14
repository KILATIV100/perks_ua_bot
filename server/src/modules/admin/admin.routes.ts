/**
 * Admin Module — HTTP Routes (v2.0)
 *
 * JWT-protected endpoints for Admin Panel + legacy bot-compatible endpoints.
 *
 * Admin endpoints (ADMIN | OWNER):
 *   GET    /api/admin/orders          — Active order queue
 *   POST   /api/admin/verify-code     — Validate & confirm redemption code (4-digit)
 *   GET    /api/admin/check-role      — Check user role (legacy, no JWT)
 *
 * Owner endpoints (OWNER only):
 *   GET    /api/admin/stats           — 24h analytics
 *   GET    /api/admin/list            — Admin list
 *   PATCH  /api/admin/set-role        — Change user role
 *   GET    /api/admin/export-users    — Export all users
 *   GET    /api/admin/all-users       — Get all users for broadcast
 *   POST   /api/admin/add-points      — God mode: add points to owner
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireOwner, type JwtPayload } from '../../shared/jwt.js';
import { sendTelegramMessage } from '../../shared/utils/telegram.js';
import { redis } from '../../shared/redis.js';

const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID || '7363233852';
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID || OWNER_TELEGRAM_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;

// ── Schemas ────────────────────────────────────────────────────────────────

const verifyCodeSchema = z.object({
  code: z.string().regex(/^\d{4}$/, 'Невірний формат коду. Очікується 4 цифри.'),
  // Legacy support: adminTelegramId for bot-based verification
  adminTelegramId: z.union([z.number(), z.string()]).transform(String).optional(),
});

const setRoleSchema = z.object({
  targetTelegramId: z.union([z.number(), z.string()]).transform(String),
  newRole: z.enum(['USER', 'ADMIN', 'OWNER']),
  // Legacy support
  requesterId: z.union([z.number(), z.string()]).transform(String).optional(),
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function notifyChat(chatId: string, text: string, parseMode = 'HTML', replyMarkup?: object): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    };
    if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[Admin] Failed to notify chat:', err);
  }
}

/** Resolve userId from JWT or legacy telegramId param */
async function resolveAdmin(
  request: FastifyRequest,
  prisma: FastifyInstance['prisma'],
): Promise<{ userId: string; role: string; telegramId: string } | null> {
  // Try JWT first
  const jwtUser = (request as FastifyRequest & { user?: JwtPayload }).user;
  if (jwtUser) {
    const user = await prisma.user.findUnique({
      where: { id: jwtUser.userId },
      select: { id: true, role: true, telegramId: true },
    });
    if (!user) return null;
    return { userId: user.id, role: user.role, telegramId: user.telegramId };
  }

  // Legacy: telegramId in query or body
  const telegramId =
    (request.query as Record<string, string>)?.requesterId ||
    (request.query as Record<string, string>)?.telegramId ||
    (request.body as Record<string, string>)?.adminTelegramId ||
    (request.body as Record<string, string>)?.requesterId;

  if (telegramId) {
    const user = await prisma.user.findUnique({
      where: { telegramId: String(telegramId) },
      select: { id: true, role: true, telegramId: true },
    });
    if (!user) return null;
    return { userId: user.id, role: user.role, telegramId: user.telegramId };
  }

  return null;
}

// ── Route Plugin ───────────────────────────────────────────────────────────

export async function adminModuleRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {

  // ────────────────────────────────────────────────────────────────────────
  // POST /api/admin/verify-code — Validate & confirm 4-digit redemption code
  // ────────────────────────────────────────────────────────────────────────
  app.post('verify-code', async (request, reply) => {
    try {
      const body = verifyCodeSchema.parse(request.body);
      const admin = await resolveAdmin(request, app.prisma);

      if (!admin || (admin.role !== 'ADMIN' && admin.role !== 'OWNER')) {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Тільки адмін або власник може верифікувати коди.' });
      }

      // Find the code
      const redemptionCode = await app.prisma.redemptionCode.findUnique({
        where: { code: body.code },
        include: {
          user: {
            select: { id: true, telegramId: true, firstName: true, username: true },
          },
        },
      });

      if (!redemptionCode) {
        return reply.status(404).send({
          error: 'CodeNotFound',
          message: 'Код не знайдено. Перевірте правильність введення.',
        });
      }

      if (redemptionCode.usedAt) {
        return reply.status(400).send({
          error: 'CodeAlreadyUsed',
          message: `Код вже використано ${redemptionCode.usedAt ? new Date(redemptionCode.usedAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }) : ''}.`,
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
          usedAt: now,
          usedByAdminId: admin.userId,
        },
      });

      // Clear Redis cache
      await redis.del(`redeem:${body.code}`);

      app.log.info(`[Code Verified] code: ${body.code}, user: ${redemptionCode.user.telegramId}, verifiedBy: ${admin.telegramId}`);

      // Notify Owner Chat
      const timeStr = now.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
      notifyChat(
        OWNER_CHAT_ID,
        `🔔 <b>Нова видача кави!</b>\n\n👤 Адмін: ${admin.telegramId}\n🎫 Код: <code>${body.code}</code>\n📉 Списано: ${redemptionCode.pointsSpent} балів\n🕒 Час: ${timeStr}`,
      ).catch(() => {});

      return reply.send({
        success: true,
        message: `Код підтверджено! Списано ${redemptionCode.pointsSpent} балів. Видайте напій.`,
        user: {
          firstName: redemptionCode.user.firstName,
          username: redemptionCode.user.username,
          telegramId: redemptionCode.user.telegramId,
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

  // ────────────────────────────────────────────────────────────────────────
  // GET /api/admin/orders — Active order queue for admin panel
  // ────────────────────────────────────────────────────────────────────────
  app.get('orders', async (request, reply) => {
    try {
      const admin = await resolveAdmin(request, app.prisma);
      if (!admin || (admin.role !== 'ADMIN' && admin.role !== 'OWNER')) {
        return reply.status(403).send({ error: 'FORBIDDEN' });
      }

      const status = (request.query as Record<string, string>)?.status;
      const whereClause: Record<string, unknown> = {};
      if (status) {
        whereClause.status = status;
      } else {
        whereClause.status = { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'] };
      }

      const orders = await app.prisma.order.findMany({
        where: whereClause,
        include: {
          user: { select: { telegramId: true, firstName: true, username: true } },
          location: { select: { name: true, slug: true } },
          items: { include: { product: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return reply.send({ orders });
    } catch (error) {
      app.log.error({ err: error }, 'Admin orders error');
      return reply.status(500).send({ error: 'Failed to get orders' });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET /api/admin/stats — 24h analytics (Owner only)
  // ────────────────────────────────────────────────────────────────────────
  app.get('stats', async (request, reply) => {
    try {
      const admin = await resolveAdmin(request, app.prisma);
      if (!admin || admin.role !== 'OWNER') {
        return reply.status(403).send({ error: 'FORBIDDEN' });
      }

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [newUsersCount, spinsCount, freeDrinksCount, totalUsers, pointsAgg, ordersCount] =
        await Promise.all([
          app.prisma.user.count({ where: { createdAt: { gte: yesterday } } }),
          app.prisma.spinHistory.count({ where: { createdAt: { gte: yesterday } } }),
          app.prisma.redemptionCode.count({ where: { usedAt: { gte: yesterday } } }),
          app.prisma.user.count(),
          app.prisma.user.aggregate({ _sum: { points: true } }),
          app.prisma.order.count({ where: { createdAt: { gte: yesterday } } }),
        ]);

      return reply.send({
        period: '24h',
        newUsers: newUsersCount,
        spins: spinsCount,
        freeDrinks: freeDrinksCount,
        orders: ordersCount,
        totalUsers,
        totalPointsInCirculation: pointsAgg._sum.points || 0,
        generatedAt: now.toISOString(),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Stats error');
      return reply.status(500).send({ error: 'Failed to get stats' });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET /api/admin/check-role — Check user role (legacy, no JWT required)
  // ────────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { telegramId: string } }>('check-role', async (request, reply) => {
    try {
      const telegramId = request.query.telegramId;
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

  // ────────────────────────────────────────────────────────────────────────
  // GET /api/admin/list — Admin list (Owner only)
  // ────────────────────────────────────────────────────────────────────────
  app.get('list', async (request, reply) => {
    try {
      const admin = await resolveAdmin(request, app.prisma);
      if (!admin || admin.role !== 'OWNER') {
        return reply.status(403).send({ error: 'FORBIDDEN' });
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

  // ────────────────────────────────────────────────────────────────────────
  // PATCH /api/admin/set-role — Change user role (Owner only)
  // ────────────────────────────────────────────────────────────────────────
  app.patch('set-role', async (request, reply) => {
    try {
      const body = setRoleSchema.parse(request.body);
      const admin = await resolveAdmin(request, app.prisma);

      if (!admin || admin.role !== 'OWNER') {
        return reply.status(403).send({ error: 'FORBIDDEN' });
      }

      if (admin.telegramId === body.targetTelegramId && body.newRole !== 'OWNER') {
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

  // ────────────────────────────────────────────────────────────────────────
  // GET /api/admin/export-users — Export all users (Owner only)
  // ────────────────────────────────────────────────────────────────────────
  app.get('export-users', async (request, reply) => {
    try {
      const admin = await resolveAdmin(request, app.prisma);
      if (!admin || admin.role !== 'OWNER') {
        return reply.status(403).send({ error: 'FORBIDDEN' });
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

  // ────────────────────────────────────────────────────────────────────────
  // GET /api/admin/all-users — Get all users for broadcast (Owner only)
  // ────────────────────────────────────────────────────────────────────────
  app.get('all-users', async (request, reply) => {
    try {
      const admin = await resolveAdmin(request, app.prisma);
      if (!admin || admin.role !== 'OWNER') {
        return reply.status(403).send({ error: 'FORBIDDEN' });
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

  // ────────────────────────────────────────────────────────────────────────
  // POST /api/admin/add-points — God Mode (Owner only)
  // ────────────────────────────────────────────────────────────────────────
  app.post<{ Body: { telegramId?: string; points: number } }>('add-points', async (request, reply) => {
    try {
      const admin = await resolveAdmin(request, app.prisma);
      if (!admin || admin.role !== 'OWNER') {
        return reply.status(403).send({ error: 'FORBIDDEN' });
      }

      const { points } = request.body;
      const targetTelegramId = request.body.telegramId || admin.telegramId;

      // Only allow Owner to add points to themselves
      if (targetTelegramId !== OWNER_TELEGRAM_ID && targetTelegramId !== admin.telegramId) {
        return reply.status(403).send({ error: 'Only Owner can add points to themselves.' });
      }

      const user = await app.prisma.user.upsert({
        where: { telegramId: targetTelegramId },
        update: { points: { increment: points } },
        create: { telegramId: targetTelegramId, points, role: 'OWNER' },
        select: { telegramId: true, firstName: true, points: true },
      });

      return reply.send({ success: true, newBalance: user.points, added: points });
    } catch (error) {
      app.log.error({ err: error }, 'Add points error');
      return reply.status(500).send({ error: 'Failed to add points' });
    }
  });
}
