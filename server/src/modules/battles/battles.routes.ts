/**
 * Coffee Battles Module
 *
 * POST /create       — Create a new battle challenge
 * POST /:id/accept   — Accept a battle challenge
 * POST /:id/decline  — Decline a battle challenge
 * GET  /active       — Get user's active battles
 * GET  /history      — Get user's battle history
 * GET  /location-battle — Get weekly location battle standings
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function battleRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {

  /**
   * Create a new coffee battle
   */
  app.post('/create', async (request, reply) => {
    const { telegramId, opponentTelegramId, betPoints, category, description, durationDays } =
      request.body as {
        telegramId: string;
        opponentTelegramId: string;
        betPoints: number;
        category: string;
        description?: string;
        durationDays?: number;
      };

    const challenger = await app.prisma.user.findUnique({ where: { telegramId } });
    const opponent = await app.prisma.user.findUnique({
      where: { telegramId: opponentTelegramId },
    });

    if (!challenger || !opponent) {
      return reply.status(404).send({ error: 'User not found' });
    }

    if (challenger.points < betPoints) {
      return reply.status(400).send({ error: 'Not enough points', message: 'Недостатньо балів для ставки' });
    }

    const days = durationDays || 7;
    const endsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const battle = await app.prisma.battle.create({
      data: {
        challengerId: challenger.id,
        opponentId: opponent.id,
        betPoints,
        category,
        description,
        endsAt,
      },
    });

    return reply.send({ success: true, battle });
  });

  /**
   * Accept a battle challenge
   */
  app.post<{ Params: { id: string } }>('/:id/accept', async (request, reply) => {
    const { id } = request.params;
    const { telegramId } = request.body as { telegramId: string };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const battle = await app.prisma.battle.findUnique({ where: { id } });
    if (!battle) return reply.status(404).send({ error: 'Battle not found' });
    if (battle.opponentId !== user.id) {
      return reply.status(403).send({ error: 'Not your battle' });
    }
    if (battle.status !== 'PENDING') {
      return reply.status(400).send({ error: 'Battle already accepted or finished' });
    }

    if (user.points < battle.betPoints) {
      return reply.status(400).send({ error: 'Not enough points' });
    }

    const updated = await app.prisma.battle.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    return reply.send({ success: true, battle: updated });
  });

  /**
   * Decline a battle challenge
   */
  app.post<{ Params: { id: string } }>('/:id/decline', async (request, reply) => {
    const { id } = request.params;
    const { telegramId } = request.body as { telegramId: string };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const battle = await app.prisma.battle.findUnique({ where: { id } });
    if (!battle || battle.opponentId !== user.id || battle.status !== 'PENDING') {
      return reply.status(400).send({ error: 'Cannot decline this battle' });
    }

    const updated = await app.prisma.battle.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    return reply.send({ success: true, battle: updated });
  });

  /**
   * Get user's active battles
   */
  app.get('/active', async (request, reply) => {
    const { telegramId } = request.query as { telegramId: string };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const battles = await app.prisma.battle.findMany({
      where: {
        OR: [{ challengerId: user.id }, { opponentId: user.id }],
        status: { in: ['PENDING', 'ACTIVE'] },
      },
      include: {
        challenger: { select: { firstName: true, username: true, telegramId: true } },
        opponent: { select: { firstName: true, username: true, telegramId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ battles });
  });

  /**
   * Get battle history
   */
  app.get('/history', async (request, reply) => {
    const { telegramId } = request.query as { telegramId: string };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const battles = await app.prisma.battle.findMany({
      where: {
        OR: [{ challengerId: user.id }, { opponentId: user.id }],
        status: 'FINISHED',
      },
      include: {
        challenger: { select: { firstName: true, username: true } },
        opponent: { select: { firstName: true, username: true } },
        winner: { select: { firstName: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return reply.send({ battles });
  });

  /**
   * Get weekly location battle standings
   */
  app.get('/location-battle', async (request, reply) => {
    const now = new Date();
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    const weekKey = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

    const standings = await app.prisma.locationBattleWeekly.findMany({
      where: { weekKey },
      include: {
        location: { select: { name: true, slug: true } },
      },
      orderBy: { totalPoints: 'desc' },
    });

    return reply.send({ weekKey, standings });
  });
}
