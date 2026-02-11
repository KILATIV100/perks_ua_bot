/**
 * Telegram WebApp initData Verification Middleware
 *
 * Protects API endpoints by verifying the HMAC-SHA256 signature
 * that Telegram appends to WebApp.initData.
 *
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Usage (Fastify route):
 *   app.post('/api/user/spin', { preHandler: verifyTelegramInitData }, handler)
 *
 * Or register as a hook on a plugin:
 *   app.addHook('preHandler', verifyTelegramInitData)
 */

import { createHmac, createHash } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

const BOT_TOKEN = process.env.BOT_TOKEN ?? '';

/**
 * Derive the secret key once at startup.
 * secret_key = HMAC-SHA256("WebAppData", bot_token)
 */
const SECRET_KEY: Buffer = (() => {
  if (!BOT_TOKEN) return Buffer.alloc(32);
  return createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
})();

/**
 * Parse and validate Telegram WebApp initData string.
 *
 * @param initData - The raw initData string from Telegram WebApp
 * @returns Parsed key-value object if valid, null if invalid/expired
 */
export function parseTelegramInitData(
  initData: string,
): Record<string, string> | null {
  if (!BOT_TOKEN) return null; // Cannot validate without token

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    // Build the data-check-string: sorted key=value pairs, separated by \n
    // (excluding 'hash' itself)
    const entries: string[] = [];
    for (const [key, value] of params.entries()) {
      if (key !== 'hash') entries.push(`${key}=${value}`);
    }
    entries.sort();
    const dataCheckString = entries.join('\n');

    // Compute expected HMAC
    const expectedHash = createHmac('sha256', SECRET_KEY)
      .update(dataCheckString)
      .digest('hex');

    if (expectedHash !== hash) return null;

    // Optional: reject data older than 1 hour to prevent replay attacks
    const authDateStr = params.get('auth_date');
    if (authDateStr) {
      const authDate = Number(authDateStr);
      const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
      if (ageSeconds > 3600) return null; // expired
    }

    // Return all fields as a plain object
    const result: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
      result[key] = value;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Fastify preHandler that validates the Telegram-Init-Data header.
 *
 * Returns 401 if missing or invalid.
 * On success, attaches parsed data to request.telegramInitData (see fastify.d.ts augmentation).
 */
export async function verifyTelegramInitData(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // In development / test environments, allow bypassing with a special header
  if (process.env.NODE_ENV === 'development' && request.headers['x-dev-bypass'] === 'true') {
    return;
  }

  const initDataHeader = request.headers['telegram-init-data'] as string | undefined;
  if (!initDataHeader) {
    reply.status(401).send({ error: 'Missing Telegram-Init-Data header' });
    return;
  }

  const parsed = parseTelegramInitData(initDataHeader);
  if (!parsed) {
    reply.status(401).send({ error: 'Invalid or expired Telegram initData' });
    return;
  }

  // Attach to request for downstream handlers
  (request as FastifyRequest & { telegramInitData: Record<string, string> }).telegramInitData = parsed;
}

/**
 * Generate a SHA-256 hash for game score integrity.
 * Used server-side to verify client-submitted scores.
 *
 * hash = SHA-256( score + secret_salt + timestamp )
 */
export function computeScoreHash(
  score: number,
  timestamp: number,
): string {
  const salt = process.env.GAME_SCORE_SECRET_SALT ?? 'perkie-default-salt-change-me';
  return createHash('sha256')
    .update(`${score}${salt}${timestamp}`)
    .digest('hex');
}
