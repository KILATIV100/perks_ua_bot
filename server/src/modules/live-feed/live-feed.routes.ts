/**
 * Live Feed Module — Real-time order activity stream
 *
 * GET /recent  — Get recent activity for live feed display
 * GET /stats   — Get current live stats (hit of the day, weather, now playing)
 *
 * WebSocket events are emitted from poster webhook handler:
 *   'live-feed:order'  — New anonymized order
 *   'live-feed:stats'  — Updated stats
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function liveFeedRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {

  /**
   * Get recent orders for live feed (anonymized)
   */
  app.get('/recent', async (request, reply) => {
    const { limit } = request.query as { limit?: string };
    const take = Math.min(parseInt(limit || '20', 10), 50);

    const recentOrders = await app.prisma.order.findMany({
      where: {
        status: { in: ['COMPLETED', 'PREPARING', 'READY'] },
      },
      include: {
        location: { select: { name: true, slug: true } },
        items: {
          include: { product: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    const feed = recentOrders.map(order => ({
      id: order.id,
      location: order.location.name,
      items: order.items.map(i => ({
        name: i.product.name,
        quantity: i.quantity,
      })),
      timeAgo: getTimeAgo(order.createdAt),
      createdAt: order.createdAt,
    }));

    return reply.send({ feed });
  });

  /**
   * Get live stats: hit of the day, track info, weather
   */
  app.get('/stats', async (request, reply) => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });
    const todayStart = new Date(`${today}T00:00:00+02:00`);

    // Hit of the day (most ordered product today)
    const todayOrders = await app.prisma.orderItem.findMany({
      where: {
        order: {
          status: 'COMPLETED',
          createdAt: { gte: todayStart },
        },
      },
      include: { product: { select: { name: true } } },
    });

    const productCounts: Record<string, number> = {};
    for (const item of todayOrders) {
      const name = item.product.name;
      productCounts[name] = (productCounts[name] || 0) + item.quantity;
    }

    const hitOfDay = Object.entries(productCounts)
      .sort(([, a], [, b]) => b - a)[0];

    // Total orders today
    const totalOrdersToday = await app.prisma.order.count({
      where: {
        status: 'COMPLETED',
        createdAt: { gte: todayStart },
      },
    });

    // Active users today
    const activeUsersToday = await app.prisma.user.count({
      where: {
        lastActiveAt: { gte: todayStart },
      },
    });

    return reply.send({
      hitOfDay: hitOfDay ? { name: hitOfDay[0], count: hitOfDay[1] } : null,
      totalOrdersToday,
      activeUsersToday,
      date: today,
    });
  });
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'щойно';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} хв тому`;
  const hours = Math.floor(minutes / 60);
  return `${hours} год тому`;
}
