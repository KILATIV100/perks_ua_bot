/**
 * Loyalty Service — Wheel of Fortune & Points Redemption (v2.0)
 *
 * Key changes from v1:
 * - Redis locks for spin race condition protection
 * - Idempotency keys for double-click protection
 * - SpinHistory records for audit trail
 * - Weighted random prizes (40%/30%/10%/20%)
 * - 4-digit redemption codes
 * - Active code check before new redemption
 */

import type { PrismaClient } from '@prisma/client';
import { redis } from '../../shared/redis.js';
import {
  getKyivDateString,
  getNextKyivMidnight,
  hasSpunTodayKyiv,
} from '../../shared/utils/timezone.js';
import { sendTelegramMessage } from '../../shared/utils/telegram.js';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_SPIN_DISTANCE_METERS = Number(process.env.GEO_RADIUS_METERS) || 100;
const REDEEM_POINTS_REQUIRED = 100;
const CODE_EXPIRY_MINUTES = 15;
const DEV_TELEGRAM_IDS = new Set(['7363233852']);

// Weighted prizes per TZ spec
const PRIZES = [
  { value: 5,  weight: 40, label: '5 балів' },
  { value: 10, weight: 30, label: '10 балів' },
  { value: 15, weight: 10, label: '15 балів' },
  { value: 0,  weight: 20, label: 'Спробуй завтра' },
] as const;

// ── Types ────────────────────────────────────────────────────────────────────

export interface SpinInput {
  userId: string;
  telegramId: string;
  latitude?: number;
  longitude?: number;
  idempotencyKey?: string;
}

export type SpinResult =
  | { ok: true; prize: { value: number; label: string }; newBalance: number; nextSpinAvailable: string }
  | { ok: false; error: string; message: string; [key: string]: unknown };

export interface RedeemInput {
  userId: string;
  telegramId: string;
}

export type RedeemResult =
  | { ok: true; code: string; expiresAt: string; newBalance: number }
  | { ok: false; error: string; message: string; [key: string]: unknown };

// ── Helpers ──────────────────────────────────────────────────────────────────

function toRadians(deg: number): number {
  return deg * (Math.PI / 180);
}

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
 * Pick a prize using weighted random selection.
 */
function weightedRandom(): typeof PRIZES[number] {
  const totalWeight = PRIZES.reduce((sum, p) => sum + p.weight, 0);
  let random = Math.random() * totalWeight;

  for (const prize of PRIZES) {
    random -= prize.weight;
    if (random <= 0) return prize;
  }
  return PRIZES[PRIZES.length - 1];
}

// ── Core Operations ──────────────────────────────────────────────────────────

/**
 * Process a Wheel-of-Fortune spin request.
 *
 * Full pipeline per TZ:
 * 1. Idempotency check
 * 2. Acquire Redis lock
 * 3. Check daily limit (Kyiv midnight reset)
 * 4. Geo-validate (Haversine, 100m radius)
 * 5. Weighted random prize
 * 6. Database transaction (update user + create SpinHistory + referral bonus)
 * 7. Cache result + respond
 */
export async function processSpin(
  prisma: PrismaClient,
  input: SpinInput,
): Promise<SpinResult> {
  const { userId, telegramId, idempotencyKey } = input;

  // ═══ STEP 1: IDEMPOTENCY CHECK ═══
  if (idempotencyKey) {
    const cached = await redis.get(`idempotency:${userId}:${idempotencyKey}`);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  // ═══ STEP 2: ACQUIRE LOCK ═══
  const lockKey = `spin:lock:${userId}`;
  const lockAcquired = await redis.set(lockKey, '1', 'EX', 10, 'NX');

  if (!lockAcquired) {
    return { ok: false, error: 'SPIN_IN_PROGRESS', message: 'Зачекай, спін обробляється...' };
  }

  try {
    // ═══ STEP 3: CHECK DAILY LIMIT ═══
    const now = new Date();
    const todayKyiv = getKyivDateString(now);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        points: true,
        lastSpinDate: true,
        totalSpins: true,
        referredById: true,
        referralBonusPaid: true,
        firstName: true,
      },
    });

    if (!user) {
      return { ok: false, error: 'USER_NOT_FOUND', message: 'Користувача не знайдено' };
    }

    if (hasSpunTodayKyiv(user.lastSpinDate)) {
      const nextMidnight = getNextKyivMidnight(now);
      return {
        ok: false,
        error: 'ALREADY_SPUN_TODAY',
        message: 'Бро, ти вже сьогодні випробував удачу. Приходь завтра за новими бонусами!',
        remainingMs: nextMidnight.getTime() - now.getTime(),
        nextSpinAvailable: nextMidnight.toISOString(),
      };
    }

    // ═══ STEP 4: GEO-VALIDATION ═══
    const bypassGeo = DEV_TELEGRAM_IDS.has(telegramId);

    if (!bypassGeo) {
      if (input.latitude === undefined || input.longitude === undefined) {
        return {
          ok: false,
          error: 'NO_LOCATION',
          message: 'Щоб крутнути колесо, потрібно надати доступ до геолокації.',
        };
      }

      const locations = await prisma.location.findMany({
        where: { isActive: true, latitude: { not: null }, longitude: { not: null } },
        select: { name: true, latitude: true, longitude: true },
      });

      const distances = locations
        .filter((l): l is typeof l & { latitude: number; longitude: number } =>
          l.latitude !== null && l.longitude !== null)
        .map(loc => ({
          name: loc.name,
          distance: haversineMeters(input.latitude!, input.longitude!, loc.latitude, loc.longitude),
        }));

      const nearest = distances.reduce<{ name: string; distance: number } | null>(
        (best, curr) => (!best || curr.distance < best.distance ? curr : best),
        null,
      );

      const minDistance = nearest?.distance ?? Infinity;

      if (minDistance > MAX_SPIN_DISTANCE_METERS) {
        return {
          ok: false,
          error: 'OUT_OF_RANGE',
          message: "Бро, ти задалеко. Підходь ближче до кав'ярні, щоб крутнути колесо!",
          distance: nearest ? Math.round(nearest.distance) : null,
          nearestLocation: nearest?.name,
        };
      }
    }

    // ═══ STEP 5: WEIGHTED RANDOM PRIZE ═══
    const prize = weightedRandom();

    // ═══ STEP 6: DATABASE TRANSACTION ═══
    const result = await prisma.$transaction(async (tx) => {
      // Update user
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          points: { increment: prize.value },
          totalSpins: { increment: 1 },
          lastSpinDate: todayKyiv,
        },
        select: { points: true },
      });

      // Create spin history
      await tx.spinHistory.create({
        data: {
          userId,
          prize: prize.value,
          prizeLabel: prize.label,
          latitude: input.latitude,
          longitude: input.longitude,
        },
      });

      // Referral bonus: first winning spin by referred user → +10 to referrer
      if (prize.value > 0 && user.referredById && !user.referralBonusPaid) {
        // referredById is the internal user ID
        const referrer = await tx.user.findUnique({
          where: { id: user.referredById },
          select: { id: true, telegramId: true },
        });

        if (referrer) {
          await tx.user.update({
            where: { id: referrer.id },
            data: { points: { increment: 10 } },
          });

          // Notify referrer
          const spinnerName = user.firstName ?? 'Твій друг';
          sendTelegramMessage(
            Number(referrer.telegramId),
            `🎁 *+10 балів за реферала!*\n\n${spinnerName} щойно крутнув колесо вперше — ти отримав бонус за запрошення!`,
          ).catch(() => {});
        }

        await tx.user.update({
          where: { id: userId },
          data: { referralBonusPaid: true },
        });
      }

      return { newBalance: updatedUser.points };
    });

    // ═══ STEP 7: CACHE & RESPOND ═══
    const nextMidnight = getNextKyivMidnight(now);

    const response: SpinResult = {
      ok: true,
      prize: { value: prize.value, label: prize.label },
      newBalance: result.newBalance,
      nextSpinAvailable: nextMidnight.toISOString(),
    };

    // Cache for idempotency (24h)
    if (idempotencyKey) {
      await redis.set(
        `idempotency:${userId}:${idempotencyKey}`,
        JSON.stringify(response),
        'EX', 86400,
      );
    }

    // Notify user
    if (prize.value > 0) {
      const userName = user.firstName ?? 'Друже';
      sendTelegramMessage(
        Number(telegramId),
        `🎉 *${userName}, вітаємо!*\n\nТи виграв *${prize.value} балів* на Колесі Фортуни!\n\n💰 Твій баланс: *${result.newBalance}* балів`,
      ).catch(() => {});
    }

    return response;

  } finally {
    // ═══ ALWAYS RELEASE LOCK ═══
    await redis.del(lockKey);
  }
}

/**
 * Redeem 100 points for a free-drink code.
 * Code format: 4 digits (1000-9999), valid 15 minutes.
 */
export async function processRedeem(
  prisma: PrismaClient,
  input: RedeemInput,
): Promise<RedeemResult> {
  const { userId, telegramId } = input;

  // 1. Check balance
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { points: true, firstName: true },
  });

  if (!user) {
    return { ok: false, error: 'USER_NOT_FOUND', message: 'Користувача не знайдено' };
  }

  if (user.points < REDEEM_POINTS_REQUIRED) {
    return {
      ok: false,
      error: 'INSUFFICIENT_POINTS',
      message: `Недостатньо балів. Потрібно ще ${REDEEM_POINTS_REQUIRED - user.points} балів.`,
      required: REDEEM_POINTS_REQUIRED,
      current: user.points,
    };
  }

  // 2. Check for existing active code
  const activeCode = await prisma.redemptionCode.findFirst({
    where: {
      userId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (activeCode) {
    return {
      ok: false,
      error: 'ACTIVE_CODE_EXISTS',
      message: 'У тебе вже є активний код. Використай його перед створенням нового.',
      code: activeCode.code,
      expiresAt: activeCode.expiresAt.toISOString(),
    };
  }

  // 3. Generate unique 4-digit code
  let code: string;
  let attempts = 0;

  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
    const exists = await redis.exists(`redeem:${code}`);
    if (!exists) break;
    attempts++;
  } while (attempts < 10);

  if (attempts >= 10) {
    return { ok: false, error: 'CODE_GENERATION_FAILED', message: 'Не вдалося згенерувати код. Спробуй пізніше.' };
  }

  // 4. Transaction: deduct points + create code
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { points: { decrement: REDEEM_POINTS_REQUIRED } },
    });

    await tx.redemptionCode.create({
      data: {
        code,
        userId,
        pointsSpent: REDEEM_POINTS_REQUIRED,
        expiresAt,
      },
    });
  });

  // 5. Store in Redis for fast lookup
  await redis.set(`redeem:${code}`, userId, 'EX', CODE_EXPIRY_MINUTES * 60);

  const newBalance = user.points - REDEEM_POINTS_REQUIRED;

  // Notify user
  const userName = user.firstName ?? 'Друже';
  sendTelegramMessage(
    Number(telegramId),
    `🎁 *${userName}, вітаємо!*\n\nТи обміняв 100 балів на безкоштовний напій!\n\n🎟 *Твій код: ${code}*\n\nПокажи цей код баристі.\n\n⏰ Код дійсний 15 хвилин.\n\n💰 Залишок: *${newBalance}* балів`,
  ).catch(() => {});

  return {
    ok: true,
    code,
    expiresAt: expiresAt.toISOString(),
    newBalance,
  };
}
