/**
 * Points Log Module — Audit trail for all points transactions
 *
 * GET /          — Get user's points history
 * GET /summary   — Get points summary (earned, spent, by type)
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function pointsLogRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {

  /**
   * Get user's points log
   */
  app.get('/', async (request, reply) => {
    const { telegramId, limit, offset } = request.query as {
      telegramId: string;
      limit?: string;
      offset?: string;
    };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const take = Math.min(parseInt(limit || '50', 10), 100);
    const skip = parseInt(offset || '0', 10);

    const [logs, total] = await Promise.all([
      app.prisma.pointsLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      app.prisma.pointsLog.count({ where: { userId: user.id } }),
    ]);

    return reply.send({
      logs,
      total,
      balance: user.points,
      level: user.level,
    });
  });

  /**
   * Get points summary by type
   */
  app.get('/summary', async (request, reply) => {
    const { telegramId } = request.query as { telegramId: string };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const logs = await app.prisma.pointsLog.findMany({
      where: { userId: user.id },
    });

    const summary: Record<string, { earned: number; spent: number; count: number }> = {};

    for (const log of logs) {
      if (!summary[log.type]) {
        summary[log.type] = { earned: 0, spent: 0, count: 0 };
      }
      if (log.amount > 0) {
        summary[log.type].earned += log.amount;
      } else {
        summary[log.type].spent += Math.abs(log.amount);
      }
      summary[log.type].count++;
    }

    const totalEarned = logs.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0);
    const totalSpent = logs.filter(l => l.amount < 0).reduce((s, l) => s + Math.abs(l.amount), 0);

    return reply.send({
      balance: user.points,
      level: user.level,
      totalEarned,
      totalSpent,
      byType: summary,
    });
  });
}
