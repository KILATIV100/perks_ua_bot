/**
 * Morning Subscription Module — "Ранок за розкладом"
 *
 * POST /create    — Create a new morning subscription
 * PATCH /:id      — Update subscription (pause, change time, etc.)
 * DELETE /:id     — Cancel subscription
 * GET  /          — Get user's subscriptions
 * GET  /due       — (Internal) Get subscriptions due for execution
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function subscriptionRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {

  /**
   * Create a morning subscription
   */
  app.post('/create', async (request, reply) => {
    const { telegramId, productName, productPosterId, locationId, scheduleTime, daysOfWeek } =
      request.body as {
        telegramId: string;
        productName: string;
        productPosterId?: number;
        locationId: string;
        scheduleTime: string; // "HH:MM"
        daysOfWeek: number[]; // [1,2,3,4,5] = Mon-Fri
      };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    // Validate time format
    if (!/^\d{2}:\d{2}$/.test(scheduleTime)) {
      return reply.status(400).send({ error: 'Invalid time format. Use HH:MM' });
    }

    // Validate days
    if (!daysOfWeek.length || daysOfWeek.some(d => d < 1 || d > 7)) {
      return reply.status(400).send({ error: 'Invalid days. Use 1=Mon...7=Sun' });
    }

    const subscription = await app.prisma.subscription.create({
      data: {
        userId: user.id,
        productName,
        productPosterId,
        locationId,
        scheduleTime,
        daysOfWeek,
      },
      include: {
        location: { select: { name: true } },
      },
    });

    return reply.send({ success: true, subscription });
  });

  /**
   * Get user's subscriptions
   */
  app.get('/', async (request, reply) => {
    const { telegramId } = request.query as { telegramId: string };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const subscriptions = await app.prisma.subscription.findMany({
      where: { userId: user.id },
      include: {
        location: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ subscriptions });
  });

  /**
   * Update subscription (pause, unpause, change time)
   */
  app.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const { telegramId, scheduleTime, daysOfWeek, pausedUntil, isActive } =
      request.body as {
        telegramId: string;
        scheduleTime?: string;
        daysOfWeek?: number[];
        pausedUntil?: string | null;
        isActive?: boolean;
      };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const subscription = await app.prisma.subscription.findUnique({ where: { id } });
    if (!subscription || subscription.userId !== user.id) {
      return reply.status(404).send({ error: 'Subscription not found' });
    }

    const updateData: Record<string, unknown> = {};
    if (scheduleTime) updateData.scheduleTime = scheduleTime;
    if (daysOfWeek) updateData.daysOfWeek = daysOfWeek;
    if (pausedUntil !== undefined) updateData.pausedUntil = pausedUntil ? new Date(pausedUntil) : null;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await app.prisma.subscription.update({
      where: { id },
      data: updateData,
      include: { location: { select: { name: true } } },
    });

    return reply.send({ success: true, subscription: updated });
  });

  /**
   * Cancel subscription
   */
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const { telegramId } = request.query as { telegramId: string };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const subscription = await app.prisma.subscription.findUnique({ where: { id } });
    if (!subscription || subscription.userId !== user.id) {
      return reply.status(404).send({ error: 'Subscription not found' });
    }

    await app.prisma.subscription.delete({ where: { id } });

    return reply.send({ success: true });
  });

  /**
   * Internal: Get subscriptions due now (for cron job)
   */
  app.get('/due', async (request, reply) => {
    const now = new Date();
    const kyivTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Kyiv',
      hour: '2-digit',
      minute: '2-digit',
    }).format(now);

    const dayOfWeek = new Date().toLocaleDateString('en-US', { timeZone: 'Europe/Kyiv', weekday: 'short' });
    const dayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const currentDay = dayMap[dayOfWeek] || 1;

    const subscriptions = await app.prisma.subscription.findMany({
      where: {
        isActive: true,
        scheduleTime: kyivTime,
        daysOfWeek: { has: currentDay },
        OR: [
          { pausedUntil: null },
          { pausedUntil: { lt: now } },
        ],
      },
      include: {
        user: { select: { telegramId: true, firstName: true } },
        location: { select: { name: true } },
      },
    });

    return reply.send({ subscriptions, time: kyivTime, day: currentDay });
  });
}
