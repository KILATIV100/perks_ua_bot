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


  // POST /api/poster/webhook (compat webhook endpoint)
  app.post('/webhook', async (request, reply) => {
    const body = (request.body || {}) as {
      object?: string;
      action?: string;
      object_id?: string | number;
      account?: string;
      data?: string;
      time?: string;
    };

    reply.status(200).send({ success: true });

    setImmediate(async () => {
      try {
        const object = body.object;
        const action = body.action;
        const objectId = Number(body.object_id);
        if (!Number.isFinite(objectId)) return;

        if ((object === 'product' || object === 'dish') && (action === 'added' || action === 'changed')) {
          await posterService.syncProductByPosterId(objectId);
          return;
        }

        if ((object === 'product' || object === 'dish') && action === 'removed') {
          await posterService.softDeleteProductByPosterId(objectId);
          return;
        }

        if (object === 'incoming_order') {
          const order = await app.prisma.order.findFirst({ where: { posterOrderId: String(objectId) }, select: { id: true } });
          if (!order) return;

          if (action === 'accept') {
            await app.prisma.order.update({ where: { id: order.id }, data: { status: 'PREPARING' } });
            return;
          }
          if (action === 'close') {
            await app.prisma.order.update({ where: { id: order.id }, data: { status: 'READY' } });
            return;
          }
          if (action === 'reject') {
            await app.prisma.order.update({ where: { id: order.id }, data: { status: 'REJECTED' } });
            app.log.warn({ orderId: order.id }, 'Order rejected in Poster: refund should be initiated');
            return;
          }
        }

        if (object === 'transaction' && action === 'added') {
          await posterService.processTransactionWebhook({
            account: body.account || '',
            object: 'transaction',
            object_id: objectId,
            action: 'added',
            data: body.data,
            time: body.time,
          });
        }
      } catch (error) {
        app.log.error({ err: error, body }, 'Poster webhook processing failed');
      }
    });
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
