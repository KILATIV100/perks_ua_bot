import { PrismaClient } from '@prisma/client';
import { getKyivDateString, getNextKyivMidnight } from '../../shared/kyiv-time.js';

const SPIN_REWARDS = [5, 10, 15];
const MAX_SPIN_DISTANCE_METERS = 100;

const DEV_TELEGRAM_IDS = ['7363233852'];

interface SpinResult {
  success: true;
  reward: number;
  referralBonus: number;
  newBalance: number;
  nextSpinAt: string;
}

interface SpinError {
  error: string;
  message: string;
  remainingMs?: number;
  nextSpinAt?: string;
  nearestLocation?: string;
  distance?: number | null;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
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

export async function processSpinRequest(
  prisma: PrismaClient,
  telegramId: string,
  userLat?: number,
  userLng?: number,
  devMode?: boolean,
  log?: { info: Function; error: Function; warn: Function }
): Promise<{ status: number; body: SpinResult | SpinError }> {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    return { status: 404, body: { error: 'NotFound', message: 'User not found' } };
  }

  // Dev mode bypass
  const isDevUser = DEV_TELEGRAM_IDS.includes(String(telegramId));
  const bypassGeoCheck = isDevUser || devMode === true;

  if (bypassGeoCheck) {
    log?.info(`[Dev Mode] telegramId: ${telegramId}, bypassing geolocation check`);
  }

  // Geolocation check
  if (!bypassGeoCheck) {
    if (userLat === undefined || userLng === undefined) {
      return {
        status: 400,
        body: { error: 'NoLocation', message: 'Щоб крутнути колесо, потрібно надати доступ до геолокації.' },
      };
    }

    const activeLocations = await prisma.location.findMany({
      where: { status: 'active', lat: { not: null }, long: { not: null } },
      select: { id: true, name: true, lat: true, long: true },
    });

    let nearestLocation: { name: string; distance: number } | null = null;
    let isNearby = false;

    for (const location of activeLocations) {
      if (location.lat !== null && location.long !== null) {
        const distance = calculateDistance(userLat, userLng, location.lat, location.long);
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
      return {
        status: 403,
        body: {
          error: 'TooFar',
          message: "Бро, ти задалеко. Підходь ближче до кав'ярні, щоб крутнути колесо!",
          nearestLocation: nearestLocation?.name,
          distance: nearestLocation ? Math.round(nearestLocation.distance) : null,
        },
      };
    }
  }

  // Cooldown check: reset at 00:00 Kyiv time
  const now = new Date();
  const todayKyivDate = getKyivDateString();

  if (user.lastSpinDate && user.lastSpinDate >= todayKyivDate) {
    const nextMidnight = getNextKyivMidnight();
    const remainingMs = nextMidnight.getTime() - now.getTime();
    return {
      status: 429,
      body: {
        error: 'Cooldown',
        message: 'Бро, ти вже сьогодні випробував удачу. Приходь завтра за новими бонусами!',
        remainingMs,
        nextSpinAt: nextMidnight.toISOString(),
      },
    };
  }

  // Random reward
  const reward = SPIN_REWARDS[Math.floor(Math.random() * SPIN_REWARDS.length)];

  const updatedUser = await prisma.user.update({
    where: { telegramId },
    data: {
      points: { increment: reward },
      totalSpins: { increment: 1 },
      lastSpin: now,
      lastSpinDate: todayKyivDate,
    },
    select: { id: true, telegramId: true, points: true, totalSpins: true, firstName: true },
  });

  // Referral bonus: first spin by a referred user → +10 to referrer
  if (user.referredById && user.totalSpins === 0) {
    try {
      await prisma.user.update({
        where: { telegramId: user.referredById },
        data: { points: { increment: 10 } },
      });
      log?.info(`[Referral Bonus] +10 to referrer ${user.referredById}`);
    } catch (refError) {
      log?.error({ err: refError }, 'Failed to process referral bonus');
    }
  }

  const nextMidnight = getNextKyivMidnight();

  return {
    status: 200,
    body: {
      success: true,
      reward,
      referralBonus: 0,
      newBalance: updatedUser.points,
      nextSpinAt: nextMidnight.toISOString(),
    },
  };
}
