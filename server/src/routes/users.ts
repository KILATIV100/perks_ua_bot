import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

// Telegram Bot API
const BOT_TOKEN = process.env.BOT_TOKEN;

// Owner Telegram ID
const OWNER_TELEGRAM_ID = '7363233852';

/**
 * Send message to user via Telegram Bot
 */
async function sendTelegramMessage(chatId: number | string, text: string): Promise<void> {
  if (!BOT_TOKEN) return;

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });
  } catch {
    // silent
  }
}

/**
 * Notify Owner about new user
 */
async function notifyOwnerNewUser(firstName: string | undefined, telegramId: string): Promise<void> {
  const message = `🆕 *Новий клієнт у системі!*\n\n` +
    `👤 Ім'я: ${firstName || 'Невідомо'}\n` +
    `🆔 ID: \`${telegramId}\``;

  sendTelegramMessage(OWNER_TELEGRAM_ID, message).catch(() => {});
}

const KYIV_TIME_ZONE = 'Europe/Kyiv';

function getKyivDateParts(date = new Date()): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);
  return { year, month, day };
}

function getKyivOffsetMinutes(date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: KYIV_TIME_ZONE,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  });
  const offsetValue = formatter.formatToParts(date).find(part => part.type === 'timeZoneName')?.value || 'GMT+0';
  const match = offsetValue.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  return hours * 60 + Math.sign(hours) * minutes;
}

/**
 * Get today's date string in Kyiv timezone (YYYY-MM-DD)
 */
function getKyivDateString(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: KYIV_TIME_ZONE });
}

/**
 * Get the next midnight in server timezone
 */
function getNextKyivMidnight(): Date {
  const { year, month, day } = getKyivDateParts(new Date());
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  const offsetMinutes = getKyivOffsetMinutes(nextDay);
  const utcMillis = Date.UTC(year, month - 1, day + 1, 0, 0, 0) - offsetMinutes * 60 * 1000;
  return new Date(utcMillis);
}

// Validation schemas - telegramId can be number or string
const syncUserSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  username: z.string().optional(),
  firstName: z.string().optional(),
  referrerId: z.union([z.number(), z.string()]).transform(String).optional(),
});

const spinSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  userLat: z.number().optional(),
  userLng: z.number().optional(),
  devMode: z.boolean().optional(),
});

const redeemSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
});

// Points required for redemption
const REDEEM_POINTS_REQUIRED = 100;

// Possible spin rewards
const SPIN_REWARDS = [5, 10, 15];

// Maximum distance to spin (100 meters)
const MAX_SPIN_DISTANCE_METERS = 100;

// Dev mode: bypass geolocation check for these telegram IDs
const DEV_TELEGRAM_IDS = [
  '7363233852', // Owner/Developer
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

      // Notify OWNER about new user
      if (isNewUser) {
        notifyOwnerNewUser(body.firstName, body.telegramId);

        // Notify referrer that their friend joined
        if (validReferrerId) {
          const userName = body.firstName || 'Новий користувач';
          const referralMsg = `🎉 *${userName}* приєднався до PerkUp за твоїм запрошенням!\n\n` +
            `Друг отримав *+5 балів* одразу. Ти отримаєш *+10 балів* після першого обертання колеса цим другом.`;
          sendTelegramMessage(Number(validReferrerId), referralMsg).catch(() => {});

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

  // POST /api/user/spin - Spin the wheel of fortune
  app.post('spin', async (request, reply) => {
    try {
      const body = spinSchema.parse(request.body);

      app.log.info(`[Spin Attempt] telegramId: ${body.telegramId}, coords: ${body.userLat}, ${body.userLng}`);

      // Find user
      const user = await app.prisma.user.findUnique({
        where: { telegramId: body.telegramId },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Check if dev mode is enabled (bypass geolocation)
      const isDevUser = DEV_TELEGRAM_IDS.includes(String(body.telegramId));
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

        // Check if user is within 100m of any active location
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

      // Check cooldown: reset at server midnight
      const now = new Date();

      const todayString = getKyivDateString(now);
      if (user.lastSpinDate && user.lastSpinDate === todayString) {
        const nextMidnight = getNextKyivMidnight();
        const remainingMs = nextMidnight.getTime() - now.getTime();
        const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));

        app.log.info(`[Spin Cooldown] telegramId: ${body.telegramId}, remaining: ${remainingHours}h (resets at server midnight)`);

        return reply.status(429).send({
          error: 'Cooldown',
          message: 'Бро, ти вже сьогодні випробував удачу. Приходь завтра за новими бонусами!',
          remainingMs,
          nextSpinAt: nextMidnight.toISOString(),
        });
      }

      // Random reward
      const reward = SPIN_REWARDS[Math.floor(Math.random() * SPIN_REWARDS.length)];

      // Update user with lastSpin and lastSpinDate
      const updatedUser = await app.prisma.user.update({
        where: { telegramId: body.telegramId },
        data: {
          points: { increment: reward },
          totalSpins: { increment: 1 },
          lastSpin: now,
          lastSpinDate: todayString,
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

      // Referral bonus: first spin by a referred user → +10 to referrer only
      if (user.referredById && user.totalSpins === 0) {
        try {
          await app.prisma.user.update({
            where: { telegramId: user.referredById },
            data: {
              points: { increment: 10 },
            },
          });

          app.log.info(`[Referral Bonus] +10 to referrer ${user.referredById} (triggered by first spin of ${body.telegramId})`);

          // Notify referrer about the bonus
          const spinnerName = updatedUser.firstName || 'Твій друг';
          const referralBonusMsg = `🎁 *+10 балів за реферала!*\n\n` +
            `${spinnerName} щойно крутнув колесо вперше — ти отримав бонус за запрошення!`;
          sendTelegramMessage(Number(user.referredById), referralBonusMsg).catch((err) => {
            app.log.error({ err }, 'Failed to send referral bonus notification');
          });
        } catch (refError) {
          app.log.error({ err: refError }, 'Failed to process referral bonus');
        }
      }

      // Send notification via Telegram bot
      const userName = updatedUser.firstName || 'Друже';
      const message = `🎉 *${userName}, вітаємо!*\n\nТи виграв *${reward} балів* на Колесі Фортуни!\n\n💰 Твій баланс: *${updatedUser.points}* балів\n🎡 Всього обертань: *${updatedUser.totalSpins}*`;

      // Send async, don't wait for it (convert to number for Telegram API)
      sendTelegramMessage(Number(body.telegramId), message).catch((err) => {
        app.log.error({ err }, 'Failed to send spin notification');
      });

      // Calculate next spin time (next server midnight)
      const nextMidnight = getNextKyivMidnight();

      return reply.send({
        success: true,
        reward,
        referralBonus: 0,
        newBalance: updatedUser.points,
        nextSpinAt: nextMidnight.toISOString(),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Spin error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to process spin' });
    }
  });

  // POST /api/user/redeem - Redeem points for a drink
  app.post('redeem', async (request, reply) => {
    try {
      const body = redeemSchema.parse(request.body);

      app.log.info(`[Redeem Attempt] telegramId: ${body.telegramId}`);

      // Find user
      const user = await app.prisma.user.findUnique({
        where: { telegramId: body.telegramId },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Check if user has enough points
      if (user.points < REDEEM_POINTS_REQUIRED) {
        const pointsNeeded = REDEEM_POINTS_REQUIRED - user.points;
        app.log.info(`[Redeem Denied] telegramId: ${body.telegramId}, points: ${user.points}, need: ${pointsNeeded} more`);

        return reply.status(400).send({
          error: 'InsufficientPoints',
          message: `Недостатньо балів. Потрібно ще ${pointsNeeded} балів.`,
          currentPoints: user.points,
          pointsNeeded,
        });
      }

      // Generate unique code in format XX-00000 (e.g., CO-77341)
      const letterChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      const letters = letterChars.charAt(Math.floor(Math.random() * letterChars.length)) +
                      letterChars.charAt(Math.floor(Math.random() * letterChars.length));
      const numbers = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
      const code = `${letters}-${numbers}`;

      // Code expires in 15 minutes
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      // Deduct points and create redemption code in a transaction
      const [updatedUser] = await app.prisma.$transaction([
        app.prisma.user.update({
          where: { telegramId: body.telegramId },
          data: {
            points: { decrement: REDEEM_POINTS_REQUIRED },
          },
          select: {
            id: true,
            telegramId: true,
            points: true,
            firstName: true,
          },
        }),
        app.prisma.redemptionCode.create({
          data: {
            code,
            userId: user.id,
            expiresAt,
          },
        }),
      ]);

      app.log.info(`[Redeem Success] telegramId: ${body.telegramId}, code: ${code}, remaining: ${updatedUser.points}`);

      // Send notification via Telegram bot
      const userName = updatedUser.firstName || 'Друже';
      const redeemMessage = `🎁 *${userName}, вітаємо!*\n\nТи обміняв 100 балів на безкоштовний напій!\n\n🎟 *Твій код: ${code}*\n\nПокажи цей код баристі, щоб отримати будь-який напій до 100 грн.\n\n⏰ Код дійсний 15 хвилин.\n\n💰 Залишок балів: *${updatedUser.points}*`;

      sendTelegramMessage(Number(body.telegramId), redeemMessage).catch((err) => {
        app.log.error({ err }, 'Failed to send redeem notification');
      });

      return reply.send({
        success: true,
        code,
        newBalance: updatedUser.points,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Redeem error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to process redemption' });
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
          lastSpin: true,
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
