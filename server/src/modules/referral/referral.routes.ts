/**
 * Referral Module — HTTP Routes (v2.0)
 *
 * GET  /api/referral/link   — Get referral link for current user
 * GET  /api/referral/stats  — Get referral stats (count, bonus earned)
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { requireAuth, type JwtPayload } from '../../shared/jwt.js';

const BOT_USERNAME = process.env.BOT_USERNAME ?? 'perkup_ua_bot';

/** Resolve userId from JWT or legacy telegramId query param */
async function resolveUser(
  request: FastifyRequest,
  prisma: FastifyInstance['prisma'],
) {
  const jwtUser = (request as FastifyRequest & { user?: JwtPayload }).user;
  if (jwtUser) {
    return prisma.user.findUnique({ where: { id: jwtUser.userId } });
  }

  const telegramId = (request.query as Record<string, string>)?.telegramId;
  if (telegramId) {
    return prisma.user.findUnique({ where: { telegramId: String(telegramId) } });
  }

  return null;
}

export async function referralRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {

  // ── GET /api/referral/link ──────────────────────────────────────────────
  app.get('link', async (request, reply) => {
    try {
      const user = await resolveUser(request, app.prisma);
      if (!user) {
        return reply.status(401).send({ error: 'UNAUTHORIZED' });
      }

      const referralLink = `https://t.me/${BOT_USERNAME}?start=ref_${user.telegramId}`;

      return reply.send({
        referralCode: user.referralCode,
        referralLink,
        telegramLink: referralLink,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Referral link error');
      return reply.status(500).send({ error: 'Failed to get referral link' });
    }
  });

  // ── GET /api/referral/stats ─────────────────────────────────────────────
  app.get('stats', async (request, reply) => {
    try {
      const user = await resolveUser(request, app.prisma);
      if (!user) {
        return reply.status(401).send({ error: 'UNAUTHORIZED' });
      }

      const referralCount = await app.prisma.user.count({
        where: { referredById: user.id },
      });

      // Count referrals that already had their first spin (bonus was paid)
      const activatedReferrals = await app.prisma.user.count({
        where: {
          referredById: user.id,
          totalSpins: { gt: 0 },
        },
      });

      return reply.send({
        referralCode: user.referralCode,
        referralLink: `https://t.me/${BOT_USERNAME}?start=ref_${user.telegramId}`,
        totalReferrals: referralCount,
        activatedReferrals,
        bonusPerReferral: 10,
        totalBonusEarned: activatedReferrals * 10,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Referral stats error');
      return reply.status(500).send({ error: 'Failed to get referral stats' });
    }
  });
}
