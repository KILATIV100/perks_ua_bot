/**
 * Auth Module — Telegram initData validation + JWT tokens
 *
 * POST /api/auth/telegram  — Validate initData, create/update user, return JWT
 * POST /api/auth/refresh   — Refresh access token
 * GET  /api/auth/me         — Current user profile
 * POST /api/auth/logout     — Revoke refresh token
 */

import { createHmac } from 'crypto';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  generateTokens,
  storeRefreshToken,
  verifyRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
  requireAuth,
  type JwtPayload,
} from '../../shared/jwt.js';

const BOT_TOKEN = process.env.BOT_TOKEN ?? '';

/**
 * Derive the HMAC secret key once.
 */
const SECRET_KEY: Buffer = (() => {
  if (!BOT_TOKEN) return Buffer.alloc(32);
  return createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
})();

// ── Schemas ──────────────────────────────────────────────────────────────────

const telegramAuthSchema = z.object({
  initData: z.string().min(1),
  startParam: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

function validateTelegramInitData(initData: string): TelegramUser | null {
  if (!BOT_TOKEN) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    // Build data-check-string
    const entries: string[] = [];
    for (const [key, value] of params.entries()) {
      if (key !== 'hash') entries.push(`${key}=${value}`);
    }
    entries.sort();
    const dataCheckString = entries.join('\n');

    // Verify HMAC
    const calculatedHash = createHmac('sha256', SECRET_KEY)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) return null;

    // Check auth_date (max 24 hours)
    const authDate = parseInt(params.get('auth_date') ?? '0', 10);
    if (Date.now() / 1000 - authDate > 86400) return null;

    // Parse user
    const userJson = params.get('user');
    if (!userJson) return null;
    return JSON.parse(userJson) as TelegramUser;
  } catch {
    return null;
  }
}

function extractReferrerId(startParam: string): string | null {
  // Format: ref_<ID> or ref<ID>
  const match = startParam.match(/^ref_?(\d+)$/);
  return match ? match[1] : null;
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function authRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {

  // POST /api/auth/telegram — Main auth endpoint
  app.post('telegram', async (request, reply) => {
    try {
      const body = telegramAuthSchema.parse(request.body);

      // Validate Telegram initData
      const telegramUser = validateTelegramInitData(body.initData);

      if (!telegramUser) {
        // In development, allow bypass
        if (process.env.NODE_ENV === 'development' && request.headers['x-dev-bypass'] === 'true') {
          // Parse telegramId from initData for dev mode
          const devBody = request.body as { telegramId?: string };
          if (!devBody.telegramId) {
            return reply.status(401).send({ error: 'INVALID_INIT_DATA' });
          }
        } else {
          return reply.status(401).send({ error: 'INVALID_INIT_DATA' });
        }
      }

      const telegramId = String(telegramUser?.id || (request.body as Record<string, unknown>).telegramId);
      const referrerId = body.startParam ? extractReferrerId(body.startParam) : null;

      // Check if user exists
      const existingUser = await app.prisma.user.findUnique({
        where: { telegramId },
        select: { id: true },
      });

      const isNewUser = !existingUser;

      // Validate referrer — referredById stores the internal user ID
      let validReferrerUserId: string | null = null;
      if (isNewUser && referrerId && referrerId !== telegramId) {
        const referrer = await app.prisma.user.findUnique({
          where: { telegramId: referrerId },
          select: { id: true },
        });
        if (referrer) validReferrerUserId = referrer.id;
      }

      const OWNER_TELEGRAM_ID = '7363233852';
      const isOwner = telegramId === OWNER_TELEGRAM_ID;

      // Upsert user
      const user = await app.prisma.user.upsert({
        where: { telegramId },
        create: {
          telegramId,
          firstName: telegramUser?.first_name,
          lastName: telegramUser?.last_name,
          username: telegramUser?.username,
          languageCode: telegramUser?.language_code ?? 'uk',
          referredById: validReferrerUserId,
          points: validReferrerUserId ? 5 : 0, // +5 bonus for referral
          role: isOwner ? 'OWNER' : 'USER',
        },
        update: {
          firstName: telegramUser?.first_name,
          lastName: telegramUser?.last_name,
          username: telegramUser?.username,
          lastActiveAt: new Date(),
          ...(isOwner ? { role: 'OWNER' } : {}),
        },
        select: {
          id: true,
          telegramId: true,
          firstName: true,
          lastName: true,
          username: true,
          role: true,
          points: true,
          totalSpins: true,
          lastSpinDate: true,
          referralCode: true,
          referredById: true,
          referralBonusPaid: true,
          createdAt: true,
        },
      });

      // Generate tokens
      const { accessToken, refreshToken } = generateTokens(user.id, user.role);
      await storeRefreshToken(user.id, refreshToken);

      return reply.send({
        user,
        accessToken,
        refreshToken,
        isNewUser,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Auth error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'INVALID_REQUEST', details: error.errors });
      }
      return reply.status(500).send({ error: 'AUTH_FAILED' });
    }
  });

  // POST /api/auth/refresh — Refresh access token
  app.post('refresh', async (request, reply) => {
    try {
      const body = refreshSchema.parse(request.body);
      const payload = verifyRefreshToken(body.refreshToken);

      if (!payload) {
        return reply.status(401).send({ error: 'INVALID_REFRESH_TOKEN' });
      }

      // Check if refresh token is still valid in Redis
      const isValid = await isRefreshTokenValid(payload.userId, body.refreshToken);
      if (!isValid) {
        return reply.status(401).send({ error: 'REFRESH_TOKEN_REVOKED' });
      }

      // Get current user (role may have changed)
      const user = await app.prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, role: true },
      });

      if (!user) {
        return reply.status(401).send({ error: 'USER_NOT_FOUND' });
      }

      // Generate new tokens
      const { accessToken, refreshToken } = generateTokens(user.id, user.role);
      await storeRefreshToken(user.id, refreshToken);

      return reply.send({ accessToken, refreshToken });
    } catch (error) {
      app.log.error({ err: error }, 'Token refresh error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'INVALID_REQUEST', details: error.errors });
      }
      return reply.status(500).send({ error: 'REFRESH_FAILED' });
    }
  });

  // GET /api/auth/me — Current user profile
  app.get('me', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { userId } = (request as FastifyRequest & { user: JwtPayload }).user;

      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          telegramId: true,
          firstName: true,
          lastName: true,
          username: true,
          role: true,
          points: true,
          totalSpins: true,
          lastSpinDate: true,
          referralCode: true,
          referredById: true,
          referralBonusPaid: true,
          createdAt: true,
          lastActiveAt: true,
        },
      });

      if (!user) {
        return reply.status(404).send({ error: 'USER_NOT_FOUND' });
      }

      return reply.send({ user });
    } catch (error) {
      app.log.error({ err: error }, 'Get me error');
      return reply.status(500).send({ error: 'FAILED_TO_GET_USER' });
    }
  });

  // POST /api/auth/logout — Revoke refresh token
  app.post('logout', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { userId } = (request as FastifyRequest & { user: JwtPayload }).user;
      await revokeRefreshToken(userId);
      return reply.send({ success: true });
    } catch (error) {
      app.log.error({ err: error }, 'Logout error');
      return reply.status(500).send({ error: 'LOGOUT_FAILED' });
    }
  });
}
