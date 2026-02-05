import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

// Telegram Bot API
const BOT_TOKEN = process.env.BOT_TOKEN;

/**
 * Send message to user via Telegram Bot
 */
async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  if (!BOT_TOKEN) {
    console.log('[Telegram] BOT_TOKEN not set, skipping notification');
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      console.log(`[Telegram] Failed to send message: ${response.status}`);
    }
  } catch (error) {
    console.log('[Telegram] Error sending message:', error);
  }
}

// Validation schemas
const syncUserSchema = z.object({
  telegramId: z.number(),
  username: z.string().optional(),
  firstName: z.string().optional(),
});

const spinSchema = z.object({
  telegramId: z.number(),
  userLat: z.number().optional(),
  userLng: z.number().optional(),
  devMode: z.boolean().optional(),
});

// Spin cooldown in milliseconds (24 hours)
const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Possible spin rewards
const SPIN_REWARDS = [5, 10, 15];

// Maximum distance to spin (50 meters)
const MAX_SPIN_DISTANCE_METERS = 50;

// Dev mode: bypass geolocation check for these telegram IDs
const DEV_TELEGRAM_IDS = [
  7363233852, // Owner/Developer
];

/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in meters
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

export async function userRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // POST /api/user/sync - Sync user data from Telegram
  app.post('/sync', async (request, reply) => {
    try {
      const body = syncUserSchema.parse(request.body);

      app.log.info(`[User Sync] telegramId: ${body.telegramId}, username: ${body.username || 'N/A'}`);

      const user = await app.prisma.user.upsert({
        where: { telegramId: BigInt(body.telegramId) },
        update: {
          username: body.username,
          firstName: body.firstName,
        },
        create: {
          telegramId: BigInt(body.telegramId),
          username: body.username,
          firstName: body.firstName,
          points: 0,
          totalSpins: 0,
        },
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          points: true,
          totalSpins: true,
          lastSpin: true,
          createdAt: true,
        },
      });

      // Convert BigInt to string for JSON serialization
      return reply.send({
        user: {
          ...user,
          telegramId: user.telegramId.toString(),
        },
      });
    } catch (error) {
      app.log.error({ err: error }, 'User sync error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to sync user' });
    }
  });

  // POST /api/user/spin - Spin the wheel of fortune
  app.post('/spin', async (request, reply) => {
    try {
      const body = spinSchema.parse(request.body);

      app.log.info(`[Spin Attempt] telegramId: ${body.telegramId}, coords: ${body.userLat}, ${body.userLng}`);

      // Find user
      const user = await app.prisma.user.findUnique({
        where: { telegramId: BigInt(body.telegramId) },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Check if dev mode is enabled (bypass geolocation)
      const isDevUser = DEV_TELEGRAM_IDS.includes(body.telegramId);
      const isDevMode = body.devMode === true;
      const bypassGeoCheck = isDevUser || isDevMode;

      if (bypassGeoCheck) {
        app.log.info(`[Dev Mode] telegramId: ${body.telegramId}, bypassing geolocation check (isDevUser: ${isDevUser}, devMode: ${isDevMode})`);
      }

      // Only check geolocation if not in dev mode
      if (!bypassGeoCheck) {
        // Require coordinates if not in dev mode
        if (body.userLat === undefined || body.userLng === undefined) {
          return reply.status(400).send({
            error: 'NoLocation',
            message: 'Щоб крутнути колесо, потрібно надати доступ до геолокації.',
          });
        }

        // Get all active locations with coordinates
        const activeLocations = await app.prisma.location.findMany({
          where: {
            status: 'active',
            lat: { not: null },
            long: { not: null },
          },
          select: {
            id: true,
            name: true,
            lat: true,
            long: true,
          },
        });

        // Check if user is within 50m of any active location
        let nearestLocation: { name: string; distance: number } | null = null;
        let isNearby = false;

        for (const location of activeLocations) {
          if (location.lat !== null && location.long !== null) {
            const distance = calculateDistance(
              body.userLat,
              body.userLng,
              location.lat,
              location.long
            );

            app.log.info(`[Distance Check] ${location.name}: ${Math.round(distance)}m`);

            if (!nearestLocation || distance < nearestLocation.distance) {
              nearestLocation = { name: location.name, distance };
            }

            if (distance <= MAX_SPIN_DISTANCE_METERS) {
              isNearby = true;
              break;
            }
          }
        }

        if (!isNearby) {
          const distanceInfo = nearestLocation
            ? `Найближча точка: ${nearestLocation.name} (${Math.round(nearestLocation.distance)}м)`
            : '';

          app.log.info(`[Spin Denied] telegramId: ${body.telegramId}, too far. ${distanceInfo}`);

          return reply.status(403).send({
            error: 'TooFar',
            message: "Бро, ти задалеко. Підходь ближче до кав'ярні, щоб крутнути колесо!",
            nearestLocation: nearestLocation?.name,
            distance: nearestLocation ? Math.round(nearestLocation.distance) : null,
          });
        }
      }

      // Check cooldown
      const now = new Date();
      if (user.lastSpin) {
        const timeSinceLastSpin = now.getTime() - user.lastSpin.getTime();
        if (timeSinceLastSpin < SPIN_COOLDOWN_MS) {
          const remainingMs = SPIN_COOLDOWN_MS - timeSinceLastSpin;
          const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));

          app.log.info(`[Spin Cooldown] telegramId: ${body.telegramId}, remaining: ${remainingHours}h`);

          return reply.status(429).send({
            error: 'Cooldown',
            message: `Наступне обертання доступне через ${remainingHours} год.`,
            remainingMs,
            nextSpinAt: new Date(user.lastSpin.getTime() + SPIN_COOLDOWN_MS).toISOString(),
          });
        }
      }

      // Random reward
      const reward = SPIN_REWARDS[Math.floor(Math.random() * SPIN_REWARDS.length)];

      // Update user
      const updatedUser = await app.prisma.user.update({
        where: { telegramId: BigInt(body.telegramId) },
        data: {
          points: { increment: reward },
          totalSpins: { increment: 1 },
          lastSpin: now,
        },
        select: {
          id: true,
          telegramId: true,
          points: true,
          totalSpins: true,
          lastSpin: true,
          firstName: true,
        },
      });

      app.log.info(`[Spin Success] telegramId: ${body.telegramId}, reward: ${reward}, total: ${updatedUser.points}, spins: ${updatedUser.totalSpins}`);

      // Send notification via Telegram bot
      const userName = updatedUser.firstName || 'Друже';
      const message = `🎉 *${userName}, вітаємо!*\n\nТи виграв *${reward} балів* на Колесі Фортуни!\n\n💰 Твій баланс: *${updatedUser.points}* балів\n🎡 Всього обертань: *${updatedUser.totalSpins}*`;

      // Send async, don't wait for it
      sendTelegramMessage(body.telegramId, message).catch((err) => {
        app.log.error({ err }, 'Failed to send spin notification');
      });

      return reply.send({
        success: true,
        reward,
        newBalance: updatedUser.points,
        nextSpinAt: new Date(now.getTime() + SPIN_COOLDOWN_MS).toISOString(),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Spin error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to process spin' });
    }
  });

  // GET /api/user/:telegramId - Get user data
  app.get<{ Params: { telegramId: string } }>('/:telegramId', async (request, reply) => {
    try {
      const telegramId = BigInt(request.params.telegramId);

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
          createdAt: true,
        },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      return reply.send({
        user: {
          ...user,
          telegramId: user.telegramId.toString(),
        },
      });
    } catch (error) {
      app.log.error({ err: error }, 'Get user error');
      return reply.status(500).send({ error: 'Failed to get user' });
    }
  });
}
