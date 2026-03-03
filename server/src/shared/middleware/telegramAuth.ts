import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

interface TelegramTWAUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  allows_write_to_pm?: boolean;
  photo_url?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    twaUser?: TelegramTWAUser;
  }
}

function getInitDataFromRequest(request: FastifyRequest): string | null {
  const headerInitData = request.headers['x-telegram-init-data'];
  if (typeof headerInitData === 'string' && headerInitData.trim().length > 0) {
    return headerInitData.trim();
  }

  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.toLowerCase().startsWith('tma ')) {
    const value = authorization.slice(4).trim();
    return value.length > 0 ? value : null;
  }

  return null;
}

function getTelegramSecretKey(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

function validateHash(initData: string, botToken: string): URLSearchParams | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    return null;
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const computedHash = createHmac('sha256', getTelegramSecretKey(botToken))
    .update(dataCheckString)
    .digest('hex');

  const receivedHashBuffer = Buffer.from(hash, 'hex');
  const computedHashBuffer = Buffer.from(computedHash, 'hex');

  if (receivedHashBuffer.length !== computedHashBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(receivedHashBuffer, computedHashBuffer)) {
    return null;
  }

  return params;
}

export async function validateTWAInitData(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const initData = getInitDataFromRequest(request);
  if (!initData) {
    reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing Telegram initData' });
    return;
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    request.log.error('[TWA] BOT_TOKEN is not configured');
    reply.status(500).send({ error: 'SERVER_MISCONFIGURED', message: 'BOT_TOKEN is required' });
    return;
  }

  const params = validateHash(initData, botToken);
  if (!params) {
    reply.status(403).send({ error: 'FORBIDDEN', message: 'Invalid Telegram initData signature' });
    return;
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    reply.status(403).send({ error: 'FORBIDDEN', message: 'Telegram user payload is missing' });
    return;
  }

  try {
    const parsed = JSON.parse(userRaw) as Partial<TelegramTWAUser>;
    if (!parsed || typeof parsed.id !== 'number' || typeof parsed.first_name !== 'string') {
      reply.status(403).send({ error: 'FORBIDDEN', message: 'Invalid Telegram user payload' });
      return;
    }

    request.twaUser = parsed as TelegramTWAUser;
  } catch {
    reply.status(403).send({ error: 'FORBIDDEN', message: 'Invalid Telegram user payload' });
  }
}

export const verifyTelegramInitData = validateTWAInitData;

export function computeScoreHash(score: number, timestamp: number): string {
  const salt = process.env.GAME_SCORE_SECRET_SALT ?? 'perkie-default-salt-change-me';
  return createHash('sha256')
    .update(`${score}${salt}${timestamp}`)
    .digest('hex');
}
