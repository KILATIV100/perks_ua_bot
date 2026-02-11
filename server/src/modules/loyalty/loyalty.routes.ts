import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { processSpinRequest } from './loyalty.service.js';
import { sendTelegramMessage } from '../../shared/telegram.js';
import { getNextKyivMidnight } from '../../shared/kyiv-time.js';

const spinSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  userLat: z.number().optional(),
  userLng: z.number().optional(),
  devMode: z.boolean().optional(),
});

export async function loyaltyRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // POST /api/user/spin - Spin the wheel of fortune
  app.post('spin', async (request, reply) => {
    try {
      const body = spinSchema.parse(request.body);

      const result = await processSpinRequest(
        app.prisma,
        body.telegramId,
        body.userLat,
        body.userLng,
        body.devMode,
        app.log
      );

      if (result.status !== 200) {
        return reply.status(result.status).send(result.body);
      }

      const successBody = result.body as { success: true; reward: number; newBalance: number; nextSpinAt: string };

      // Get user for notification
      const user = await app.prisma.user.findUnique({
        where: { telegramId: body.telegramId },
        select: { firstName: true, totalSpins: true, referredById: true },
      });

      // Send Telegram notification
      const userName = user?.firstName || 'Друже';
      const message = `🎉 *${userName}, вітаємо!*\n\nТи виграв *${successBody.reward} балів* на Колесі Фортуни!\n\n💰 Твій баланс: *${successBody.newBalance}* балів`;
      sendTelegramMessage(Number(body.telegramId), message).catch(() => {});

      // Referral notification
      if (user?.referredById && user.totalSpins === 1) {
        const referralBonusMsg = `🎁 *+10 балів за реферала!*\n\n${userName} щойно крутнув колесо вперше — ти отримав бонус за запрошення!`;
        sendTelegramMessage(Number(user.referredById), referralBonusMsg).catch(() => {});
      }

      return reply.send(result.body);
    } catch (error) {
      app.log.error({ err: error }, 'Spin error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to process spin' });
    }
  });
}
