/**
 * Loyalty Service — Wheel of Fortune & Points Redemption
 *
 * Key design decisions:
 * - All date comparisons use Kyiv timezone (Europe/Kyiv), NOT UTC.
 *   lastSpinDate is stored as "YYYY-MM-DD" in Kyiv time, so the daily reset
 *   happens at exactly 00:00 Kyiv time (UTC+2/UTC+3 depending on DST).
 * - Geolocation check uses Haversine formula (100 m radius).
 * - Referral bonuses are credited once, on the referred user's FIRST spin.
 */

import type { PrismaClient } from '@prisma/client';
import {
  getKyivDateString,
  getNextKyivMidnight,
  hasSpunTodayKyiv,
} from '../../shared/utils/timezone.js';
import { sendTelegramMessage } from '../../shared/utils/telegram.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPIN_REWARDS = [5, 10, 15] as const;
const MAX_SPIN_DISTANCE_METERS = 100;
const REDEEM_POINTS_REQUIRED = 100;
const CODE_EXPIRY_MINUTES = 15;
const DEV_TELEGRAM_IDS = new Set(['7363233852']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpinInput {
  telegramId: string;
  userLat?: number;
  userLng?: number;
  devMode?: boolean;
}

export type SpinResult =
  | { ok: true; reward: number; newBalance: number; nextSpinAt: string }
  | { ok: false; error: string; message: string; remainingMs?: number; nextSpinAt?: string; nearestLocation?: string; distance?: number | null };

export interface RedeemInput {
  telegramId: string;
}

export type RedeemResult =
  | { ok: true; code: string; newBalance: number; expiresAt: string }
  | { ok: false; error: string; message: string; currentPoints?: number; pointsNeeded?: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRadians(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Haversine distance between two coordinates, in metres.
 */
export function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Pick a random spin reward from the reward table.
 */
function pickReward(): number {
  return SPIN_REWARDS[Math.floor(Math.random() * SPIN_REWARDS.length)];
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Process a Wheel-of-Fortune spin request.
 *
 * Flow:
 *  1. Load user
 *  2. Bypass geo-check for dev users / devMode flag
 *  3. Verify user is within 100m of an active location
 *  4. Check daily cooldown using Kyiv date string (resets at 00:00 Kyiv)
 *  5. Award random points, update lastSpinDate
 *  6. Credit referral bonus on first-ever spin
 *  7. Send Telegram notification (fire-and-forget)
 */
export async function processSpin(
  prisma: PrismaClient,
  input: SpinInput,
): Promise<SpinResult> {
  const user = await prisma.user.findUnique({
    where: { telegramId: input.telegramId },
  });

  if (!user) {
    return { ok: false, error: 'UserNotFound', message: 'Користувача не знайдено' };
  }

  // ── Geolocation ────────────────────────────────────────────────────────────
  const bypassGeo = DEV_TELEGRAM_IDS.has(input.telegramId) || input.devMode === true;

  if (!bypassGeo) {
    if (input.userLat === undefined || input.userLng === undefined) {
      return {
        ok: false,
        error: 'NoLocation',
        message: 'Щоб крутнути колесо, потрібно надати доступ до геолокації.',
      };
    }

    const activeLocations = await prisma.location.findMany({
      where: { status: 'active', lat: { not: null }, long: { not: null } },
      select: { id: true, name: true, lat: true, long: true },
    });

    let nearest: { name: string; distance: number } | null = null;
    let isNearby = false;

    for (const loc of activeLocations) {
      if (loc.lat === null || loc.long === null) continue;
      const dist = haversineMeters(input.userLat, input.userLng, loc.lat, loc.long);
      if (!nearest || dist < nearest.distance) nearest = { name: loc.name, distance: dist };
      if (dist <= MAX_SPIN_DISTANCE_METERS) { isNearby = true; break; }
    }

    if (!isNearby) {
      return {
        ok: false,
        error: 'TooFar',
        message: "Бро, ти задалеко. Підходь ближче до кав'ярні, щоб крутнути колесо!",
        nearestLocation: nearest?.name,
        distance: nearest ? Math.round(nearest.distance) : null,
      };
    }
  }

  // ── Daily cooldown (Kyiv timezone) ─────────────────────────────────────────
  const now = new Date();
  const todayKyiv = getKyivDateString(now);

  if (hasSpunTodayKyiv(user.lastSpinDate)) {
    const nextMidnight = getNextKyivMidnight(now);
    const remainingMs = nextMidnight.getTime() - now.getTime();
    return {
      ok: false,
      error: 'Cooldown',
      message: 'Бро, ти вже сьогодні випробував удачу. Приходь завтра за новими бонусами!',
      remainingMs,
      nextSpinAt: nextMidnight.toISOString(),
    };
  }

  // ── Award spin ─────────────────────────────────────────────────────────────
  const reward = pickReward();

  const updatedUser = await prisma.user.update({
    where: { telegramId: input.telegramId },
    data: {
      points: { increment: reward },
      totalSpins: { increment: 1 },
      lastSpin: now,
      lastSpinDate: todayKyiv,
    },
    select: {
      id: true,
      telegramId: true,
      points: true,
      totalSpins: true,
      firstName: true,
    },
  });

  // ── Referral bonus (first spin by referred user → +10 to referrer) ─────────
  if (user.referredById && user.totalSpins === 0) {
    prisma.user
      .update({ where: { telegramId: user.referredById }, data: { points: { increment: 10 } } })
      .then(() => {
        const spinnerName = updatedUser.firstName ?? 'Твій друг';
        sendTelegramMessage(
          Number(user.referredById),
          `🎁 *+10 балів за реферала!*\n\n${spinnerName} щойно крутнув колесо вперше — ти отримав бонус за запрошення!`,
        );
      })
      .catch(() => {});
  }

  // ── Notify user ────────────────────────────────────────────────────────────
  const userName = updatedUser.firstName ?? 'Друже';
  sendTelegramMessage(
    Number(input.telegramId),
    `🎉 *${userName}, вітаємо!*\n\nТи виграв *${reward} балів* на Колесі Фортуни!\n\n💰 Твій баланс: *${updatedUser.points}* балів\n🎡 Всього обертань: *${updatedUser.totalSpins}*`,
  );

  return {
    ok: true,
    reward,
    newBalance: updatedUser.points,
    nextSpinAt: getNextKyivMidnight(now).toISOString(),
  };
}

/**
 * Redeem 100 points for a free-drink code (format: XX-00000, valid 15 min).
 */
export async function processRedeem(
  prisma: PrismaClient,
  input: RedeemInput,
): Promise<RedeemResult> {
  const user = await prisma.user.findUnique({
    where: { telegramId: input.telegramId },
  });

  if (!user) {
    return { ok: false, error: 'UserNotFound', message: 'Користувача не знайдено' };
  }

  if (user.points < REDEEM_POINTS_REQUIRED) {
    const pointsNeeded = REDEEM_POINTS_REQUIRED - user.points;
    return {
      ok: false,
      error: 'InsufficientPoints',
      message: `Недостатньо балів. Потрібно ще ${pointsNeeded} балів.`,
      currentPoints: user.points,
      pointsNeeded,
    };
  }

  // Generate unique code: XX-00000 (e.g. "CO-77341")
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const letters = CHARS[Math.floor(Math.random() * CHARS.length)] + CHARS[Math.floor(Math.random() * CHARS.length)];
  const digits = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
  const code = `${letters}-${digits}`;
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { telegramId: input.telegramId },
      data: { points: { decrement: REDEEM_POINTS_REQUIRED } },
      select: { id: true, telegramId: true, points: true, firstName: true },
    }),
    prisma.redemptionCode.create({
      data: { code, userId: user.id, expiresAt },
    }),
  ]);

  const userName = updatedUser.firstName ?? 'Друже';
  sendTelegramMessage(
    Number(input.telegramId),
    `🎁 *${userName}, вітаємо!*\n\nТи обміняв 100 балів на безкоштовний напій!\n\n🎟 *Твій код: ${code}*\n\nПокажи цей код баристі, щоб отримати будь-який напій до 100 грн.\n\n⏰ Код дійсний 15 хвилин.\n\n💰 Залишок балів: *${updatedUser.points}*`,
  );

  return {
    ok: true,
    code,
    newBalance: updatedUser.points,
    expiresAt: expiresAt.toISOString(),
  };
}
