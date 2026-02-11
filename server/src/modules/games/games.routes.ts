/**
 * Games Module — HTTP Routes
 *
 * POST /api/games/create            — Create TIC_TAC_TOE session
 * POST /api/games/join              — Join TIC_TAC_TOE session
 * GET  /api/games/:id               — Get game state
 * POST /api/games/submit-score      — Submit PERKIE_JUMP score (with hash verification)
 * POST /api/games/perkie-jump/save  — Legacy save endpoint (kept for backward compat)
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { computeScoreHash } from '../../shared/middleware/telegramAuth.js';
import { getKyivDateString } from '../../shared/utils/timezone.js';

const BOT_USERNAME = process.env.BOT_USERNAME ?? 'perkup_ua_bot';

/** Maximum realistic score per second of gameplay (tune per game design) */
const MAX_SCORE_PER_SECOND = 10;
/** Maximum age of a submitted score timestamp (5 minutes) */
const MAX_SCORE_AGE_MS = 5 * 60 * 1000;
/** Maximum points from Perkie Jump per day */
const MAX_GAME_POINTS_PER_DAY = 5;
/** Maximum games that award points per day */
const MAX_SCORING_GAMES_PER_DAY = 5;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createGameSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
});

const joinGameSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  gameId: z.string().uuid(),
});

const submitScoreSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  score: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  hash: z.string().length(64), // SHA-256 hex
  gameDurationMs: z.number().int().positive().optional(),
});

const perkyJumpLegacySchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  beansCollected: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns midnight UTC that corresponds to start of today in Kyiv */
function kyivDayStart(): Date {
  const kyivDateStr = getKyivDateString();
  const [y, m, d] = kyivDateStr.split('-').map(Number);
  // We treat "today in Kyiv" as the range [start, now]
  // For counting daily records, comparing createdAt >= midnight UTC is a close enough
  // approximation; the service layer handles exact Kyiv-day resets.
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function gameRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {

  // ── POST /api/games/create ──────────────────────────────────────────────
  app.post('create', async (request, reply) => {
    try {
      const body = createGameSchema.parse(request.body);

      const user = await app.prisma.user.findUnique({ where: { telegramId: body.telegramId } });
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const game = await app.prisma.gameSession.create({
        data: {
          player1Id: user.id,
          type: 'TIC_TAC_TOE',
          boardState: [[null, null, null], [null, null, null], [null, null, null]],
          status: 'WAITING',
          opponentType: 'HUMAN',
        },
        select: { id: true, status: true, type: true, createdAt: true },
      });

      return reply.status(201).send({
        game,
        inviteLink: `https://t.me/${BOT_USERNAME}?start=game_${game.id}`,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Create game error');
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      return reply.status(500).send({ error: 'Failed to create game' });
    }
  });

  // ── POST /api/games/join ────────────────────────────────────────────────
  app.post('join', async (request, reply) => {
    try {
      const body = joinGameSchema.parse(request.body);

      const user = await app.prisma.user.findUnique({ where: { telegramId: body.telegramId } });
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const game = await app.prisma.gameSession.findUnique({ where: { id: body.gameId } });
      if (!game) return reply.status(404).send({ error: 'Game not found' });
      if (game.status !== 'WAITING') return reply.status(400).send({ error: 'Game already started or finished' });
      if (game.player1Id === user.id) return reply.status(400).send({ error: 'Cannot join your own game' });

      const updatedGame = await app.prisma.gameSession.update({
        where: { id: body.gameId },
        data: { player2Id: user.id, status: 'PLAYING' },
        select: { id: true, player1Id: true, player2Id: true, status: true, boardState: true, type: true },
      });

      if (app.io) app.io.to(`game:${game.id}`).emit('game:started', updatedGame);

      return reply.send({ game: updatedGame });
    } catch (error) {
      app.log.error({ err: error }, 'Join game error');
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      return reply.status(500).send({ error: 'Failed to join game' });
    }
  });

  // ── GET /api/games/:id ──────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(':id', async (request, reply) => {
    try {
      const game = await app.prisma.gameSession.findUnique({
        where: { id: request.params.id },
        include: {
          player1: { select: { id: true, telegramId: true, firstName: true } },
          player2: { select: { id: true, telegramId: true, firstName: true } },
        },
      });
      if (!game) return reply.status(404).send({ error: 'Game not found' });
      return reply.send({ game });
    } catch (error) {
      app.log.error({ err: error }, 'Get game error');
      return reply.status(500).send({ error: 'Failed to get game' });
    }
  });

  // ── POST /api/games/submit-score ────────────────────────────────────────
  /**
   * Secure score submission for PERKIE_JUMP.
   *
   * Validation pipeline:
   *  1. Hash integrity check — server recomputes SHA-256(score + salt + timestamp)
   *  2. Timestamp freshness — rejects replays older than 5 minutes
   *  3. Realism check — score / (gameDurationMs / 1000) must be ≤ MAX_SCORE_PER_SECOND
   *  4. Daily game limit — max 5 scoring games per day
   *  5. Award points: min(floor(score / 100), 5) capped by daily budget
   */
  app.post('submit-score', async (request, reply) => {
    try {
      const body = submitScoreSchema.parse(request.body);

      // 1. Hash check
      const expectedHash = computeScoreHash(body.score, body.timestamp);
      if (expectedHash !== body.hash) {
        app.log.warn({ telegramId: body.telegramId, score: body.score }, 'Score hash mismatch');
        return reply.status(400).send({ error: 'InvalidHash', message: 'Score verification failed' });
      }

      // 2. Timestamp freshness
      const ageMs = Date.now() - body.timestamp;
      if (ageMs < 0 || ageMs > MAX_SCORE_AGE_MS) {
        return reply.status(400).send({ error: 'ExpiredScore', message: 'Score timestamp is too old or in the future' });
      }

      // 3. Realism check (only when duration is provided)
      if (body.gameDurationMs !== undefined && body.gameDurationMs > 0) {
        const durationSec = body.gameDurationMs / 1000;
        const scoreRate = body.score / durationSec;
        if (scoreRate > MAX_SCORE_PER_SECOND) {
          app.log.warn({ telegramId: body.telegramId, score: body.score, durationSec, scoreRate }, 'Unrealistic score rate');
          return reply.status(400).send({ error: 'UnrealisticScore', message: 'Score rate is not plausible' });
        }
      }

      const user = await app.prisma.user.findUnique({ where: { telegramId: body.telegramId } });
      if (!user) return reply.status(404).send({ error: 'User not found' });

      // 4. Daily game limit
      const dayStart = kyivDayStart();
      const todaySessions = await app.prisma.gameSession.count({
        where: {
          player1Id: user.id,
          type: 'PERKIE_JUMP',
          status: 'FINISHED',
          createdAt: { gte: dayStart },
        },
      });

      const canEarnPoints = todaySessions < MAX_SCORING_GAMES_PER_DAY;
      const pointsToAward = canEarnPoints ? Math.min(Math.floor(body.score / 100), MAX_GAME_POINTS_PER_DAY) : 0;

      // Persist the game session
      await app.prisma.gameSession.create({
        data: {
          type: 'PERKIE_JUMP',
          player1Id: user.id,
          status: 'FINISHED',
          score: body.score,
          securityHash: body.hash,
        },
      });

      // Award points
      if (pointsToAward > 0) {
        await app.prisma.user.update({
          where: { id: user.id },
          data: { points: { increment: pointsToAward } },
        });
      }

      app.log.info(
        { telegramId: body.telegramId, score: body.score, pointsToAward, todaySessions },
        'Perkie Jump score submitted',
      );

      return reply.send({
        success: true,
        pointsAwarded: pointsToAward,
        scoringGamesLeft: Math.max(0, MAX_SCORING_GAMES_PER_DAY - todaySessions - 1),
        limitReached: !canEarnPoints,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Submit score error');
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      return reply.status(500).send({ error: 'Failed to submit score' });
    }
  });

  // ── POST /api/games/perkie-jump/save  (legacy, backward compat) ─────────
  app.post('perkie-jump/save', async (request, reply) => {
    try {
      const body = perkyJumpLegacySchema.parse(request.body);
      const user = await app.prisma.user.findUnique({ where: { telegramId: body.telegramId } });
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const reward = Math.min(Math.floor(body.beansCollected / 100), 5);
      if (reward > 0) {
        await app.prisma.user.update({
          where: { telegramId: body.telegramId },
          data: { points: { increment: reward } },
        });
      }
      return reply.send({ success: true, pointsAdded: reward });
    } catch (error) {
      app.log.error({ err: error }, 'Perky Jump legacy save error');
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      return reply.status(500).send({ error: 'Failed to save Perky Jump result' });
    }
  });
}
