import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';

const BOT_TOKEN = process.env.BOT_TOKEN;

/**
 * Verify Telegram WebApp initData to authenticate requests.
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Usage: Add as a preHandler to protected routes.
 * In dev/staging, skips validation if BOT_TOKEN is not set.
 */
export async function verifyTelegramInitData(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip validation if no BOT_TOKEN (development mode)
  if (!BOT_TOKEN) return;

  const initData = request.headers['x-telegram-init-data'] as string | undefined;

  if (!initData) {
    // Allow requests without initData for backwards compatibility
    // (e.g., bot-to-server calls, admin panels)
    return;
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
      reply.status(401).send({ error: 'Invalid initData: missing hash' });
      return;
    }

    params.delete('hash');

    // Sort params alphabetically
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // HMAC-SHA256 with secret key derived from bot token
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (computedHash !== hash) {
      reply.status(401).send({ error: 'Invalid initData: hash mismatch' });
      return;
    }

    // Optionally check auth_date is not too old (5 minutes)
    const authDate = params.get('auth_date');
    if (authDate) {
      const authTimestamp = parseInt(authDate);
      const now = Math.floor(Date.now() / 1000);
      if (now - authTimestamp > 300) {
        // Allow stale initData but log it — the app might cache initData
        request.log.warn(`initData auth_date is ${now - authTimestamp}s old`);
      }
    }
  } catch (err) {
    request.log.error({ err }, 'initData verification failed');
    reply.status(401).send({ error: 'Invalid initData' });
  }
}

/**
 * Game score hash secret — used for Perkie Jump anti-cheat.
 * In production, set GAME_SCORE_SECRET env var.
 */
export const GAME_SCORE_SECRET = process.env.GAME_SCORE_SECRET || 'perkup-game-salt-2024';
