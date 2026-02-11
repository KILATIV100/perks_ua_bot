import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { sendTelegramMessage, notifyOwnerNewUser } from '../../shared/telegram.js';

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
        if (referrer) {
          validReferrerId = body.referrerId;
        }
      }

      const user = await app.prisma.user.upsert({
        where: { telegramId: body.telegramId },
        update: {
          username: body.username,
          firstName: body.firstName,
        },
        create: {
          telegramId: body.telegramId,
          username: body.username,
          firstName: body.firstName,
          points: validReferrerId ? 5 : 0,
          totalSpins: 0,
          referredById: validReferrerId,
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
        notifyOwnerNewUser(body.firstName, body.telegramId);

        if (validReferrerId) {
          const userName = body.firstName || 'Новий користувач';
          const referralMsg = `🎉 *${userName}* приєднався до PerkUp за твоїм запрошенням!\n\n` +
            `Друг отримав *+5 балів* одразу. Ти отримаєш *+10 балів* після першого обертання колеса цим другом.`;
          sendTelegramMessage(Number(validReferrerId), referralMsg).catch(() => {});

          const bonusMsg = `🎁 *Вітаємо! Ти отримав +5 балів* за реєстрацію по запрошенню!\n\nКрутни колесо, щоб заробити ще більше!`;
          sendTelegramMessage(Number(body.telegramId), bonusMsg).catch(() => {});
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

  // GET /api/user/:telegramId - Get user data
  app.get<{ Params: { telegramId: string } }>(':telegramId', async (request, reply) => {
    try {
      const { telegramId } = request.params;

      const user = await app.prisma.user.findUnique({
        where: { telegramId },
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          points: true,
          totalSpins: true,
          lastSpin: true,
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
