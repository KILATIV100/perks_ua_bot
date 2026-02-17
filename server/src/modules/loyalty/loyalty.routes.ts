/**
 * Loyalty Module — HTTP Routes (v2.0)
 *
 * POST /api/loyalty/spin          — Spin the Wheel of Fortune
 * GET  /api/loyalty/wheel-status  — Can spin? + time until next
 * POST /api/loyalty/redeem        — Create redemption code
 * GET  /api/loyalty/history       — Spin & redemption history
 * GET  /api/loyalty/balance       — Current balance
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { processSpin, processRedeem } from './loyalty.service.js';
import { requireAuth, type JwtPayload } from '../../shared/jwt.js';
import { hasSpunTodayKyiv, getNextKyivMidnight } from '../../shared/utils/timezone.js';

// ── Schemas ──────────────────────────────────────────────────────────────────

const spinSchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

// Also support legacy format
const legacySpinSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  userLat: z.number().optional(),
  userLng: z.number().optional(),
});

const legacyRedeemSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
});

// ── Routes ───────────────────────────────────────────────────────────────────

export async function loyaltyRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {

  // POST /api/loyalty/spin — New JWT-based endpoint
  app.post('/spin', async (request, reply) => {
    try {
      // Try JWT auth first
      const authHeader = request.headers.authorization;
      let userId: string | undefined;
      let telegramId: string | undefined;

      if (authHeader?.startsWith('Bearer ')) {
        const { verifyAccessToken } = await import('../../shared/jwt.js');
        const payload = verifyAccessToken(authHeader.slice(7));
        if (payload) {
          userId = payload.userId;
          const user = await app.prisma.user.findUnique({
            where: { id: userId },
            select: { telegramId: true },
          });
          telegramId = user?.telegramId;
        }
      }

      // Fallback to legacy telegramId in body
      if (!userId) {
        const legacyBody = legacySpinSchema.safeParse(request.body);
        if (legacyBody.success) {
          const user = await app.prisma.user.findUnique({
            where: { telegramId: legacyBody.data.telegramId },
            select: { id: true, telegramId: true },
          });
          if (user) {
            userId = user.id;
            telegramId = user.telegramId;
          }
        }
      }

      if (!userId || !telegramId) {
        return reply.status(401).send({ ok: false, error: 'UNAUTHORIZED' });
      }

      const body = request.body as Record<string, unknown>;
      const latitude = (body.latitude ?? body.userLat) as number | undefined;
      const longitude = (body.longitude ?? body.userLng) as number | undefined;
      const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;

      const result = await processSpin(app.prisma, {
        userId,
        telegramId,
        latitude,
        longitude,
        idempotencyKey,
      });

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          USER_NOT_FOUND: 404,
          NO_LOCATION: 400,
          OUT_OF_RANGE: 403,
          ALREADY_SPUN_TODAY: 429,
          SPIN_IN_PROGRESS: 409,
        };
        return reply.status(statusMap[result.error] ?? 400).send(result);
      }

      return reply.send(result);
    } catch (error) {
      app.log.error({ err: error }, 'Spin route error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'INVALID_REQUEST', details: error.errors });
      }
      return reply.status(500).send({ error: 'SPIN_FAILED' });
    }
  });

  // GET /api/loyalty/wheel-status
  app.get('/wheel-status', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { userId } = (request as FastifyRequest & { user: JwtPayload }).user;

      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { lastSpinDate: true, points: true },
      });

      if (!user) {
        return reply.status(404).send({ error: 'USER_NOT_FOUND' });
      }

      const canSpin = !hasSpunTodayKyiv(user.lastSpinDate);
      const nextSpinAvailable = canSpin ? null : getNextKyivMidnight().toISOString();

      return reply.send({
        canSpin,
        nextSpinAvailable,
        currentBalance: user.points,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Wheel status error');
      return reply.status(500).send({ error: 'FAILED' });
    }
  });

  // POST /api/loyalty/redeem
  app.post('/redeem', async (request, reply) => {
    try {
      let userId: string | undefined;
      let telegramId: string | undefined;

      // Try JWT auth
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const { verifyAccessToken } = await import('../../shared/jwt.js');
        const payload = verifyAccessToken(authHeader.slice(7));
        if (payload) {
          userId = payload.userId;
          const user = await app.prisma.user.findUnique({
            where: { id: userId },
            select: { telegramId: true },
          });
          telegramId = user?.telegramId;
        }
      }

      // Fallback to legacy
      if (!userId) {
        const legacyBody = legacyRedeemSchema.safeParse(request.body);
        if (legacyBody.success) {
          const user = await app.prisma.user.findUnique({
            where: { telegramId: legacyBody.data.telegramId },
            select: { id: true, telegramId: true },
          });
          if (user) {
            userId = user.id;
            telegramId = user.telegramId;
          }
        }
      }

      if (!userId || !telegramId) {
        return reply.status(401).send({ ok: false, error: 'UNAUTHORIZED' });
      }

      const result = await processRedeem(app.prisma, { userId, telegramId });

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          USER_NOT_FOUND: 404,
          INSUFFICIENT_POINTS: 400,
          ACTIVE_CODE_EXISTS: 409,
          CODE_GENERATION_FAILED: 500,
        };
        return reply.status(statusMap[result.error] ?? 400).send(result);
      }

      return reply.send(result);
    } catch (error) {
      app.log.error({ err: error }, 'Redeem route error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'INVALID_REQUEST', details: error.errors });
      }
      return reply.status(500).send({ error: 'REDEEM_FAILED' });
    }
  });

  // GET /api/loyalty/history
  app.get('/history', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { userId } = (request as FastifyRequest & { user: JwtPayload }).user;

      const [spins, redemptions] = await Promise.all([
        app.prisma.spinHistory.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        app.prisma.redemptionCode.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      ]);

      return reply.send({ spins, redemptions });
    } catch (error) {
      app.log.error({ err: error }, 'History error');
      return reply.status(500).send({ error: 'FAILED' });
    }
  });

  // GET /api/loyalty/balance
  app.get('/balance', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { userId } = (request as FastifyRequest & { user: JwtPayload }).user;

      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { points: true, totalSpins: true },
      });

      if (!user) {
        return reply.status(404).send({ error: 'USER_NOT_FOUND' });
      }

      return reply.send({ balance: user.points, totalSpins: user.totalSpins });
    } catch (error) {
      app.log.error({ err: error }, 'Balance error');
      return reply.status(500).send({ error: 'FAILED' });
    }
  });
}
