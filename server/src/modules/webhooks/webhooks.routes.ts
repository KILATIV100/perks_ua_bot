import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PosterService } from '../poster/poster.service.js';
import { sendTelegramMessage } from '../../shared/utils/telegram.js';

interface PosterWebhookBody {
  account?: string;
  object?: string;
  object_id?: number | string;
  action?: 'added' | 'changed' | 'removed' | 'accept' | 'close' | 'reject' | string;
  data?: string;
  time?: string;
}

export async function webhooksRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  const posterService = new PosterService(app.prisma);

  // Single Poster webhook endpoint.
  app.post('/poster', async (request, reply) => {
    const payload = (request.body || {}) as PosterWebhookBody;

    // Return immediately to avoid Poster timeout.
    reply.status(200).send({ ok: true });

    setImmediate(async () => {
      try {
        const object = payload.object;
        const action = payload.action;
        const objectId = Number(payload.object_id);

        if (!Number.isFinite(objectId)) return;

        if (object === 'product' || object === 'dish') {
          if (action === 'added' || action === 'changed') {
            await posterService.syncProductByPosterId(objectId);
            return;
          }

          if (action === 'removed') {
            await posterService.softDeleteProductByPosterId(objectId);
            return;
          }
        }


        if (object === 'incoming_order') {
          const order = await app.prisma.order.findFirst({
            where: { posterOrderId: String(objectId) },
            select: { id: true, status: true, user: { select: { telegramId: true } } },
          });

          if (!order) {
            app.log.warn({ objectId, action }, 'Incoming order webhook received but order not found');
            return;
          }

          if (action === 'accept') {
            await app.prisma.order.update({
              where: { id: order.id },
              data: { status: 'PREPARING' },
            });

            if (order.user?.telegramId) {
              try {
                await sendTelegramMessage(Number(order.user.telegramId), '☕️ Бариста вже готує твоє замовлення!');
              } catch (error) {
                app.log.warn({ err: error, orderId: order.id }, 'Failed to send accept notification');
              }
            }
            return;
          }

          if (action === 'close') {
            await app.prisma.order.update({
              where: { id: order.id },
              data: { status: 'READY' },
            });

            if (order.user?.telegramId) {
              try {
                await sendTelegramMessage(Number(order.user.telegramId), '✅ Замовлення готове! Чекаємо на барі.');
              } catch (error) {
                app.log.warn({ err: error, orderId: order.id }, 'Failed to send close notification');
              }
            }
            return;
          }

          if (action === 'reject') {
            await app.prisma.order.update({
              where: { id: order.id },
              data: { status: 'REJECTED' },
            });

            // TODO: trigger payment provider refund flow.
            app.log.warn({ orderId: order.id, posterOrderId: String(objectId) }, 'Order rejected in Poster: refund should be initiated');
            return;
          }

          return;
        }

        if (object === 'transaction' && action === 'added') {
          await posterService.processTransactionWebhook({
            account: payload.account || '',
            object: 'transaction',
            object_id: objectId,
            action: 'added',
            data: payload.data,
            time: payload.time,
          });
        }
      } catch (error) {
        app.log.error({ err: error, payload }, 'Poster webhook async processing failed');
      }
    });
  });

  // Call this endpoint after successful payment verification by payment provider.
  app.post('/payment-verified', async (request, reply) => {
    const body = (request.body || {}) as { orderId?: string };
    const orderId = body.orderId;

    if (!orderId) {
      return reply.status(400).send({ error: 'ORDER_ID_REQUIRED' });
    }

    reply.status(200).send({ ok: true });

    setImmediate(async () => {
      try {
        const result = await posterService.createIncomingOrderForPaidOrder(orderId);
        if (!result.success) {
          app.log.error({ orderId, reason: result.reason }, 'Failed to create Poster incoming order for paid order');
        }
      } catch (error) {
        app.log.error({ err: error, orderId }, 'Payment verified async processing failed');
      }
    });
  });
}
