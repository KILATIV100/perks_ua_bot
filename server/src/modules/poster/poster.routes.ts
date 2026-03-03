/**
 * Poster POS Integration Routes
 *
 * POST /webhook     — Poster webhook receiver (transaction.create, product.update)
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
   * Poster webhook endpoint
   * Called by Poster when events occur (transaction.create, product.update, etc.)
   */
  app.post('/webhook', async (request, reply) => {
    const payload = request.body as {
      account: string;
      object: string;
      object_id: number;
      action: string;
      data?: string;
      time?: string;
    };

    console.log(`[Poster Webhook] ${payload.object}.${payload.action} #${payload.object_id}`);

    if (payload.object === 'transaction' && payload.action === 'added') {
      const result = await posterService.processTransactionWebhook(payload);

      if (result.success && result.userId) {
        // Notify user via bot about earned points
        // This will be handled by the bot's push notification system
        try {
          const user = await app.prisma.user.findUnique({
            where: { id: result.userId },
            select: { telegramId: true },
          });

          if (user) {
            // Emit event for bot to pick up
            if (app.io) {
              app.io.emit('poster:points-earned', {
                telegramId: user.telegramId,
                pointsEarned: result.pointsEarned,
                newBalance: result.newBalance,
              });
            }
          }
        } catch (err) {
          console.error('[Poster Webhook] Failed to emit notification:', err);
        }
      }

      return reply.send({ success: true });
    }

    if (payload.object === 'product' && payload.action === 'changed') {
      // Invalidate menu cache and re-sync
      await posterService.syncMenu();
      return reply.send({ success: true });
    }

    return reply.send({ success: true });
  });

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
