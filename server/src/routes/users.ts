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

const dnaQuerySchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
});

type TimePreference = 'Ранкова кава' | 'Денна кава' | 'Вечірня кава';

function inferTimePreference(hours: number[]): TimePreference | null {
  if (!hours.length) return null;
  const buckets = { morning: 0, day: 0, evening: 0 };
  for (const h of hours) {
    if (h >= 5 && h < 12) buckets.morning++;
    else if (h >= 12 && h < 18) buckets.day++;
    else buckets.evening++;
  }
  if (buckets.morning >= buckets.day && buckets.morning >= buckets.evening) return 'Ранкова кава';
  if (buckets.day >= buckets.morning && buckets.day >= buckets.evening) return 'Денна кава';
  return 'Вечірня кава';
}

function inferArchetype(topDrink: string | null, timePreference: string | null, sugarFree: number | null): { archetype: string; archetypeDesc: string } {
  if (topDrink?.toLowerCase().includes('еспресо') || topDrink?.toLowerCase().includes('ристрето')) {
    return {
      archetype: 'Справжній бариста',
      archetypeDesc: 'Цінуєш чистий смак кави і не шукаєш компромісів.',
    };
  }
  if ((sugarFree ?? 0) >= 70) {
    return {
      archetype: 'Фокус-режим',
      archetypeDesc: 'Тримаєш курс на продуктивність і мінімум зайвого цукру.',
    };
  }
  if (timePreference === 'Ранкова кава') {
    return {
      archetype: 'Ранковий драйвер',
      archetypeDesc: 'Твій ідеальний день починається з правильної чашки кави.',
    };
  }
  return {
    archetype: 'Кавовий дослідник',
    archetypeDesc: 'Любиш експерименти і відкриваєш нові смаки щотижня.',
  };
}

export async function userRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // POST /api/user/sync - Sync user data from Telegram
  app.post('/sync', async (request, reply) => {
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
  app.get('/dna', async (request, reply) => {
    try {
      const query = dnaQuerySchema.parse(request.query);
      const user = await app.prisma.user.findUnique({
        where: { telegramId: query.telegramId },
        select: { id: true },
      });
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const orders = await app.prisma.order.findMany({
        where: {
          userId: user.id,
          status: { notIn: ['REJECTED', 'CANCELLED', 'EXPIRED'] },
        },
        include: {
          items: {
            include: {
              product: { select: { name: true } },
            },
          },
          location: { select: { name: true } },
        },
      });

      const totalOrders = orders.length;
      if (totalOrders === 0) {
        return reply.send({
          archetype: null,
          archetypeDesc: null,
          archetypeRarity: null,
          topDrink: null,
          timePreference: null,
          sugarFree: null,
          topLocation: null,
          totalOrders,
        });
      }

      const drinkCounts = new Map<string, number>();
      const locationCounts = new Map<string, number>();
      const orderHours: number[] = [];
      let sugarFreeOrders = 0;

      for (const order of orders) {
        orderHours.push(order.createdAt.getHours());
        locationCounts.set(order.location.name, (locationCounts.get(order.location.name) || 0) + 1);

        const names = order.items.map((i) => i.product.name.toLowerCase());
        for (const n of names) {
          drinkCounts.set(n, (drinkCounts.get(n) || 0) + 1);
        }

        const hasSweet = names.some((n) =>
          n.includes('сироп') ||
          n.includes('какао') ||
          n.includes('мокачино') ||
          n.includes('раф') ||
          n.includes('шоколад') ||
          n.includes('цук')
        );
        if (!hasSweet) sugarFreeOrders++;
      }

      const topDrinkEntry = [...drinkCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      const topLocationEntry = [...locationCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      const topDrink = topDrinkEntry ? topDrinkEntry[0].replace(/\b\w/g, (c) => c.toUpperCase()) : null;
      const topLocation = topLocationEntry ? topLocationEntry[0] : null;
      const timePreference = inferTimePreference(orderHours);
      const sugarFree = Math.round((sugarFreeOrders / totalOrders) * 100);

      const profile = inferArchetype(topDrink, timePreference, sugarFree);
      const archetypeRarity = profile.archetype === 'Кавовий дослідник' ? 32 : 18;

      await app.prisma.dnaProfile.upsert({
        where: { userId: user.id },
        update: {
          roastPreference: 'medium',
          milkPreference: 'mixed',
          sweetnessLevel: Math.max(1, Math.min(10, Math.round((100 - sugarFree) / 10))),
          favoriteSyrups: [],
          topDrink,
          timePreference,
          sugarFree,
          topLocation,
          archetype: profile.archetype,
          archetypeDesc: profile.archetypeDesc,
          archetypeRarity,
        },
        create: {
          userId: user.id,
          roastPreference: 'medium',
          milkPreference: 'mixed',
          sweetnessLevel: Math.max(1, Math.min(10, Math.round((100 - sugarFree) / 10))),
          favoriteSyrups: [],
          topDrink,
          timePreference,
          sugarFree,
          topLocation,
          archetype: profile.archetype,
          archetypeDesc: profile.archetypeDesc,
          archetypeRarity,
        },
      });

      return reply.send({
        archetype: profile.archetype,
        archetypeDesc: profile.archetypeDesc,
        archetypeRarity,
        topDrink,
        timePreference,
        sugarFree,
        topLocation,
        totalOrders,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Get DNA error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to get DNA profile' });
    }
  });

  app.get<{ Params: { telegramId: string } }>('/:telegramId', async (request, reply) => {
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
