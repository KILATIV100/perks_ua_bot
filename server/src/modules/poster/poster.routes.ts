/**
 * Poster POS Integration Routes
 *
 * POST /sync-menu   — Manual menu sync trigger (admin only)
 * GET  /analytics   — Poster analytics for owner dashboard
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PosterService } from './poster.service.js';

export async function posterRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  const posterService = new PosterService(app.prisma);

  /**
   * Manual menu sync (admin/owner only)
   */
  app.post('/sync-menu', async (request, reply) => {
    const { telegramId } = request.body as { telegramId?: string };

    if (telegramId) {
      const user = await app.prisma.user.findUnique({
        where: { telegramId },
        select: { role: true },
      });
      if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    }

    const result = await posterService.syncMenu();
    return reply.send(result);
  });

  /**
   * Poster analytics for owner dashboard
   */
  app.get('/analytics', async (request, reply) => {
    const { spotId } = request.query as { spotId?: string };
    const result = await posterService.getAnalytics(
      spotId ? parseInt(spotId, 10) : undefined
    );
    return reply.send(result);
  });
}
