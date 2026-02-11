/**
 * Loyalty Module — HTTP Routes
 *
 * POST /api/loyalty/spin   — Wheel of Fortune
 * POST /api/loyalty/redeem — Exchange points for a free-drink code
 *
 * These routes delegate all business logic to loyalty.service.ts.
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { processSpin, processRedeem } from './loyalty.service.js';

const spinSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  userLat: z.number().optional(),
  userLng: z.number().optional(),
  devMode: z.boolean().optional(),
});

const redeemSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
});

export async function loyaltyRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  // POST /api/loyalty/spin
  app.post('spin', async (request, reply) => {
    try {
      const body = spinSchema.parse(request.body);
      const result = await processSpin(app.prisma, {
        telegramId: body.telegramId,
        userLat: body.userLat,
        userLng: body.userLng,
        devMode: body.devMode,
      });

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          UserNotFound: 404,
          NoLocation: 400,
          TooFar: 403,
          Cooldown: 429,
        };
        return reply.status(statusMap[result.error] ?? 400).send(result);
      }

      return reply.send(result);
    } catch (error) {
      app.log.error({ err: error }, 'Spin route error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to process spin' });
    }
  });

  // POST /api/loyalty/redeem
  app.post('redeem', async (request, reply) => {
    try {
      const body = redeemSchema.parse(request.body);
      const result = await processRedeem(app.prisma, { telegramId: body.telegramId });

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          UserNotFound: 404,
          InsufficientPoints: 400,
        };
        return reply.status(statusMap[result.error] ?? 400).send(result);
      }

      return reply.send(result);
    } catch (error) {
      app.log.error({ err: error }, 'Redeem route error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to process redemption' });
    }
  });
}
