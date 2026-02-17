/**
 * JWT Utilities
 *
 * - Access tokens: 15 minutes
 * - Refresh tokens: 30 days (stored in Redis)
 */

import jwt from 'jsonwebtoken';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from './redis.js';

const JWT_SECRET = process.env.JWT_SECRET || 'perkup-dev-jwt-secret-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'perkup-dev-refresh-secret-change-in-production';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '30d';
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface JwtPayload {
  userId: string;
  role: string;
}

export interface RefreshPayload {
  userId: string;
}

/**
 * Generate access + refresh token pair.
 */
export function generateTokens(userId: string, role: string): { accessToken: string; refreshToken: string } {
  const accessToken = jwt.sign(
    { userId, role } satisfies JwtPayload,
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  );

  const refreshToken = jwt.sign(
    { userId } satisfies RefreshPayload,
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY },
  );

  return { accessToken, refreshToken };
}

/**
 * Store refresh token in Redis.
 */
export async function storeRefreshToken(userId: string, refreshToken: string): Promise<void> {
  await redis.set(`refresh:${userId}`, refreshToken, 'EX', REFRESH_TOKEN_TTL_SECONDS);
}

/**
 * Validate and decode an access token.
 */
export function verifyAccessToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Validate and decode a refresh token.
 */
export function verifyRefreshToken(token: string): RefreshPayload | null {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as RefreshPayload;
  } catch {
    return null;
  }
}

/**
 * Check if a refresh token matches the one stored in Redis.
 */
export async function isRefreshTokenValid(userId: string, token: string): Promise<boolean> {
  const stored = await redis.get(`refresh:${userId}`);
  return stored === token;
}

/**
 * Invalidate refresh token (logout).
 */
export async function revokeRefreshToken(userId: string): Promise<void> {
  await redis.del(`refresh:${userId}`);
}

/**
 * Fastify preHandler: require valid JWT access token.
 * Attaches `request.user` with { userId, role }.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    // Fallback: check Telegram-Init-Data header for backward compatibility
    const initData = request.headers['telegram-init-data'] as string | undefined;
    if (initData) {
      // Will be handled by the legacy middleware — let it through
      return;
    }
    reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyAccessToken(token);

  if (!payload) {
    reply.status(401).send({ error: 'TOKEN_EXPIRED', message: 'Access token is invalid or expired' });
    return;
  }

  // Attach user info to request
  (request as FastifyRequest & { user: JwtPayload }).user = payload;
}

/**
 * Fastify preHandler: require ADMIN or OWNER role.
 * Must be used after requireAuth.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = (request as FastifyRequest & { user?: JwtPayload }).user;

  if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
    reply.status(403).send({ error: 'FORBIDDEN', message: 'Admin access required' });
    return;
  }
}

/**
 * Fastify preHandler: require OWNER role.
 * Must be used after requireAuth.
 */
export async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = (request as FastifyRequest & { user?: JwtPayload }).user;

  if (!user || user.role !== 'OWNER') {
    reply.status(403).send({ error: 'FORBIDDEN', message: 'Owner access required' });
    return;
  }
}
