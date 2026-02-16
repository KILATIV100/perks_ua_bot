/**
 * Legacy User Routes — kept only for bot compatibility.
 *
 * POST /api/user/sync          — Sync user data from Telegram (bot uses this)
 * GET  /api/user/:telegramId   — Get user data
 *
 * NOTE: spin and redeem endpoints have been removed.
 * Use v2 endpoints instead: POST /api/loyalty/spin, POST /api/loyalty/redeem
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { sendTelegramMessage } from '../shared/utils/telegram.js';

// Owner Telegram ID
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID || '7363233852';

/**
 * Notify Owner about new user
 */
async function notifyOwnerNewUser(firstName: string | undefined, telegramId: string): Promise<void> {
  const message = `🆕 *Новий клієнт у системі!*\n\n` +
    `👤 Ім'я: ${firstName || 'Невідомо'}\n` +
    `🆔 ID: \`${telegramId}\``;

  sendTelegramMessage(Number(OWNER_TELEGRAM_ID), message).catch(() => {});
}

// Validation schemas
const syncUserSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  username: z.string().optional(),
  firstName: z.string().optional(),
  referrerId: z.union([z.number(), z.string()]).transform(String).optional(),
});

export async function userRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // POST /api/user/sync - Sync user data from Telegram
  app.post('sync', async (request, reply) => {
    try {
      const body = syncUserSchema.parse(request.body);

      // Check if user exists (to detect new users)
      const existingUser = await app.prisma.user.findUnique({
        where: { telegramId: body.telegramId },
        select: { id: true },
      });

      const isNewUser = !existingUser;

      // Check if referrer is valid for new user
      // FIX: store referrer's internal ID, not telegramId
      let validReferrerInternalId: string | null = null;
      let referrerTelegramId: string | null = null;
      if (isNewUser && body.referrerId && body.referrerId !== body.telegramId) {
        const referrer = await app.prisma.user.findUnique({
          where: { telegramId: body.referrerId },
          select: { id: true, telegramId: true },
        });
        if (referrer) {
          validReferrerInternalId = referrer.id;
          referrerTelegramId = referrer.telegramId;
        }
      }

      const isOwner = String(body.telegramId) === OWNER_TELEGRAM_ID;

      // Create or update user; if new + referred, give +5 bonus immediately
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
          points: validReferrerInternalId ? 5 : 0,
          totalSpins: 0,
          referredById: validReferrerInternalId,
          role: isOwner ? 'OWNER' : 'USER',
        },
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          points: true,
          totalSpins: true,
          lastSpinDate: true,
          role: true,
          createdAt: true,
          referredById: true,
        },
      });

      // Notify OWNER about new user
      if (isNewUser) {
        notifyOwnerNewUser(body.firstName, body.telegramId);

        // Notify referrer that their friend joined
        if (validReferrerInternalId && referrerTelegramId) {
          const userName = body.firstName || 'Новий користувач';
          const referralMsg = `🎉 *${userName}* приєднався до PerkUp за твоїм запрошенням!\n\n` +
            `Друг отримав *+5 балів* одразу. Ти отримаєш *+10 балів* після першого обертання колеса цим другом.`;
          sendTelegramMessage(Number(referrerTelegramId), referralMsg).catch(() => {});

          // Notify new user about their referral bonus
          const bonusMsg = `🎁 *Вітаємо! Ти отримав +5 балів* за реєстрацію по запрошенню!\n\nКрутни колесо, щоб заробити ще більше!`;
          sendTelegramMessage(Number(body.telegramId), bonusMsg).catch(() => {});
        }
      }

      return reply.send({
        user,
      });
    } catch (error) {
      app.log.error({ err: error }, 'User sync error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to sync user' });
    }
  });

  // GET /api/user/:telegramId - Get user data
  app.get<{ Params: { telegramId: string } }>(':telegramId', async (request, reply) => {
    try {
      const telegramId = request.params.telegramId;

      const user = await app.prisma.user.findUnique({
        where: { telegramId },
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          points: true,
          totalSpins: true,
          lastSpinDate: true,
          createdAt: true,
        },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      return reply.send({ user });
    } catch (error) {
      app.log.error({ err: error }, 'Get user error');
      return reply.status(500).send({ error: 'Failed to get user' });
    }
  });
}
