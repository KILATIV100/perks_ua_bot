/**
 * Users Module — HTTP Routes
 *
 * POST /api/user/sync  — Create or update user from Telegram WebApp data
 * GET  /api/user/:id   — Get user profile
 *
 * Spin and Redeem have been moved to the loyalty module (/api/loyalty/*).
 * For backward compatibility, /api/user/spin and /api/user/redeem still work
 * (they are registered in the legacy users.ts route file via index.ts).
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { sendTelegramMessage } from '../../shared/utils/telegram.js';

const OWNER_TELEGRAM_ID = '7363233852';

const syncUserSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  username: z.string().optional(),
  firstName: z.string().optional(),
  referrerId: z.union([z.number(), z.string()]).transform(String).optional(),
});

export async function userRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  // POST /api/user/sync
  app.post('sync', async (request, reply) => {
    try {
      const body = syncUserSchema.parse(request.body);

      const existingUser = await app.prisma.user.findUnique({
        where: { telegramId: body.telegramId },
        select: { id: true },
      });
      const isNewUser = !existingUser;

      let validReferrerId: string | null = null;
      if (isNewUser && body.referrerId && body.referrerId !== body.telegramId) {
        const referrer = await app.prisma.user.findUnique({
          where: { telegramId: body.referrerId },
          select: { id: true },
        });
        if (referrer) validReferrerId = body.referrerId;
      }

      const isOwner = body.telegramId === OWNER_TELEGRAM_ID;

      const user = await app.prisma.user.upsert({
        where: { telegramId: body.telegramId },
        update: {
          username: body.username,
          firstName: body.firstName,
          ...(isOwner ? { role: 'OWNER' } : {}),
        },
        create: {
          telegramId: body.telegramId,
          username: body.username,
          firstName: body.firstName,
          points: validReferrerId ? 5 : 0,
          totalSpins: 0,
          referredById: validReferrerId,
          role: isOwner ? 'OWNER' : 'USER',
        },
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          points: true,
          totalSpins: true,
          lastSpin: true,
          lastSpinDate: true,
          role: true,
          createdAt: true,
          referredById: true,
        },
      });

      if (isNewUser) {
        // Notify owner
        sendTelegramMessage(
          OWNER_TELEGRAM_ID,
          `🆕 *Новий клієнт у системі!*\n\n👤 Ім'я: ${body.firstName ?? 'Невідомо'}\n🆔 ID: \`${body.telegramId}\``,
        );

        if (validReferrerId) {
          const userName = body.firstName ?? 'Новий користувач';
          sendTelegramMessage(
            Number(validReferrerId),
            `🎉 *${userName}* приєднався до PerkUp за твоїм запрошенням!\n\nДруг отримав *+5 балів* одразу. Ти отримаєш *+10 балів* після першого обертання колеса цим другом.`,
          );
          sendTelegramMessage(
            Number(body.telegramId),
            `🎁 *Вітаємо! Ти отримав +5 балів* за реєстрацію по запрошенню!\n\nКрутни колесо, щоб заробити ще більше!`,
          );
        }
      }

      return reply.send({ user });
    } catch (error) {
      app.log.error({ err: error }, 'User sync error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to sync user' });
    }
  });

  // GET /api/user/:telegramId
  app.get<{ Params: { telegramId: string } }>(':telegramId', async (request, reply) => {
    try {
      const user = await app.prisma.user.findUnique({
        where: { telegramId: request.params.telegramId },
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          points: true,
          totalSpins: true,
          lastSpin: true,
          lastSpinDate: true,
          role: true,
          createdAt: true,
        },
      });
      if (!user) return reply.status(404).send({ error: 'User not found' });
      return reply.send({ user });
    } catch (error) {
      app.log.error({ err: error }, 'Get user error');
      return reply.status(500).send({ error: 'Failed to get user' });
    }
  });
}
