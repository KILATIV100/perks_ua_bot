/**
 * Games Module — HTTP Routes (v2.0)
 *
 * POST /api/games/create             — Create TIC_TAC_TOE session (online or vs AI)
 * POST /api/games/join               — Join TIC_TAC_TOE session
 * GET  /api/games/:id                — Get game state
 * POST /api/games/ai-move            — Request AI move (minimax)
 * POST /api/games/submit-score       — Submit PERKY_JUMP score (with anti-cheat)
 * POST /api/games/perkie-jump/save   — Legacy save endpoint (backward compat)
 * GET  /api/games/daily-limits       — Get daily game limits for user
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { computeScoreHash } from '../../shared/middleware/telegramAuth.js';
import { getKyivDateString } from '../../shared/utils/timezone.js';
import type { JwtPayload } from '../../shared/jwt.js';

const BOT_USERNAME = process.env.BOT_USERNAME ?? 'perkup_ua_bot';

/** Maximum realistic score per second of gameplay */
const MAX_SCORE_PER_SECOND = 10;
/** Maximum age of a submitted score timestamp (5 minutes) */
const MAX_SCORE_AGE_MS = 5 * 60 * 1000;
/** Maximum points from Perky Jump per day */
const MAX_GAME_POINTS_PER_DAY = 5;
/** Maximum scoring games per day */
const MAX_SCORING_GAMES_PER_DAY = 5;
/** Points per TIC_TAC_TOE win */
const TTT_WIN_POINTS = 2;
/** Max TTT win points per day */
const TTT_MAX_DAILY_POINTS = 10;

// ── Schemas ────────────────────────────────────────────────────────────────

const createGameSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String).optional(),
  mode: z.enum(['online', 'ai']).default('online'),
});

const joinGameSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String).optional(),
  gameId: z.string().uuid(),
});

const aiMoveSchema = z.object({
  gameId: z.string().uuid(),
});

const submitScoreSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String).optional(),
  score: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  hash: z.string().length(64),
  gameDurationMs: z.number().int().positive().optional(),
});

const perkyJumpLegacySchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  beansCollected: z.number().int().nonnegative(),
});

// ── Helpers ────────────────────────────────────────────────────────────────

type CellValue = 'X' | 'O' | null;

/** Resolve userId from JWT or telegramId */
async function resolveUser(request: FastifyRequest, prisma: FastifyInstance['prisma']) {
  const jwtUser = (request as FastifyRequest & { user?: JwtPayload }).user;
  if (jwtUser) {
    return prisma.user.findUnique({ where: { id: jwtUser.userId } });
  }

  const telegramId = (request.body as Record<string, unknown>)?.telegramId;
  if (telegramId) {
    return prisma.user.findUnique({ where: { telegramId: String(telegramId) } });
  }

  return null;
}

function checkWinner(board: CellValue[][]): CellValue {
  const lines: [number, number][][] = [
    [[0,0],[0,1],[0,2]], [[1,0],[1,1],[1,2]], [[2,0],[2,1],[2,2]],
    [[0,0],[1,0],[2,0]], [[0,1],[1,1],[2,1]], [[0,2],[1,2],[2,2]],
    [[0,0],[1,1],[2,2]], [[0,2],[1,1],[2,0]],
  ];
  for (const [[r1,c1],[r2,c2],[r3,c3]] of lines) {
    const a = board[r1][c1];
    if (a && a === board[r2][c2] && a === board[r3][c3]) return a;
  }
  return null;
}

function isBoardFull(board: CellValue[][]): boolean {
  return board.every(row => row.every(cell => cell !== null));
}

// ── Minimax AI ─────────────────────────────────────────────────────────────

function minimax(
  board: CellValue[][],
  depth: number,
  isMaximizing: boolean,
  aiSymbol: CellValue,
  playerSymbol: CellValue,
): number {
  const winner = checkWinner(board);
  if (winner === aiSymbol) return 10 - depth;
  if (winner === playerSymbol) return depth - 10;
  if (isBoardFull(board)) return 0;

  if (isMaximizing) {
    let best = -Infinity;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (board[r][c] === null) {
          board[r][c] = aiSymbol;
          best = Math.max(best, minimax(board, depth + 1, false, aiSymbol, playerSymbol));
          board[r][c] = null;
        }
      }
    }
    return best;
  } else {
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (board[r][c] === null) {
          board[r][c] = playerSymbol;
          best = Math.min(best, minimax(board, depth + 1, true, aiSymbol, playerSymbol));
          board[r][c] = null;
        }
      }
    }
    return best;
  }
}

function findBestMove(board: CellValue[][], aiSymbol: CellValue, playerSymbol: CellValue): { row: number; col: number } | null {
  let bestScore = -Infinity;
  let bestMove: { row: number; col: number } | null = null;

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (board[r][c] === null) {
        board[r][c] = aiSymbol;
        const score = minimax(board, 0, false, aiSymbol, playerSymbol);
        board[r][c] = null;
        if (score > bestScore) {
          bestScore = score;
          bestMove = { row: r, col: c };
        }
      }
    }
  }

  return bestMove;
}

/** Get Kyiv day start as UTC Date */
function kyivDayStart(): Date {
  const kyivDateStr = getKyivDateString();
  const [y, m, d] = kyivDateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

/** Update DailyGameLimit and return remaining points budget */
async function updateDailyLimit(
  prisma: FastifyInstance['prisma'],
  userId: string,
  gameType: 'TIC_TAC_TOE' | 'PERKY_JUMP',
  pointsToAdd: number,
): Promise<{ pointsAwarded: number; pointsEarnedToday: number }> {
  const todayKyiv = getKyivDateString();
  const maxDaily = gameType === 'TIC_TAC_TOE' ? TTT_MAX_DAILY_POINTS : MAX_GAME_POINTS_PER_DAY;

  const limit = await prisma.dailyGameLimit.upsert({
    where: { userId_gameType_date: { userId, gameType, date: todayKyiv } },
    update: {},
    create: { userId, gameType, date: todayKyiv, pointsEarned: 0 },
  });

  const remaining = Math.max(0, maxDaily - limit.pointsEarned);
  const actualPoints = Math.min(pointsToAdd, remaining);

  if (actualPoints > 0) {
    await prisma.dailyGameLimit.update({
      where: { id: limit.id },
      data: { pointsEarned: { increment: actualPoints } },
    });
  }

  return { pointsAwarded: actualPoints, pointsEarnedToday: limit.pointsEarned + actualPoints };
}

// ── Route Plugin ───────────────────────────────────────────────────────────

export async function gameRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {

  // ── POST /api/games/create ──────────────────────────────────────────────
  app.post('create', async (request, reply) => {
    try {
      const body = createGameSchema.parse(request.body);
      const user = await resolveUser(request, app.prisma);
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const isAI = body.mode === 'ai';

      const game = await app.prisma.gameSession.create({
        data: {
          player1Id: user.id,
          type: 'TIC_TAC_TOE',
          boardState: [[null, null, null], [null, null, null], [null, null, null]],
          currentTurn: user.id,
          status: isAI ? 'PLAYING' : 'WAITING',
          // AI games: player2 is null, but status is PLAYING
        },
        select: { id: true, status: true, type: true, currentTurn: true, createdAt: true },
      });

      const response: Record<string, unknown> = { game };
      if (!isAI) {
        response.inviteLink = `https://t.me/${BOT_USERNAME}?start=game_${game.id}`;
      }

      return reply.status(201).send(response);
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
      const user = await resolveUser(request, app.prisma);
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const game = await app.prisma.gameSession.findUnique({ where: { id: body.gameId } });
      if (!game) return reply.status(404).send({ error: 'Game not found' });
      if (game.status !== 'WAITING') return reply.status(400).send({ error: 'Game already started or finished' });
      if (game.player1Id === user.id) return reply.status(400).send({ error: 'Cannot join your own game' });

      const updatedGame = await app.prisma.gameSession.update({
        where: { id: body.gameId },
        data: { player2Id: user.id, status: 'PLAYING' },
        select: { id: true, player1Id: true, player2Id: true, status: true, boardState: true, currentTurn: true, type: true },
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

  // ── POST /api/games/ai-move — Minimax AI move for TIC_TAC_TOE ──────────
  app.post('ai-move', async (request, reply) => {
    try {
      const body = aiMoveSchema.parse(request.body);
      const game = await app.prisma.gameSession.findUnique({ where: { id: body.gameId } });

      if (!game || game.status !== 'PLAYING') {
        return reply.status(400).send({ error: 'Game not active' });
      }

      const board = game.boardState as CellValue[][];

      // AI is always 'O' (player2)
      const aiSymbol: CellValue = 'O';
      const playerSymbol: CellValue = 'X';

      const move = findBestMove(board, aiSymbol, playerSymbol);
      if (!move) return reply.status(400).send({ error: 'No valid moves available' });

      board[move.row][move.col] = aiSymbol;

      const winner = checkWinner(board);
      const full = isBoardFull(board);
      const status: 'PLAYING' | 'FINISHED' = (winner || full) ? 'FINISHED' : 'PLAYING';

      const winnerId = winner === 'X' ? game.player1Id : winner === 'O' ? 'AI' : null;

      const updatedGame = await app.prisma.gameSession.update({
        where: { id: body.gameId },
        data: {
          boardState: board,
          status,
          currentTurn: game.player1Id,
          ...(status === 'FINISHED' && winner === 'X' ? { winnerId: game.player1Id } : {}),
        },
      });

      // Award points if player won vs AI
      if (status === 'FINISHED' && winner === 'X') {
        const { pointsAwarded } = await updateDailyLimit(
          app.prisma, game.player1Id, 'TIC_TAC_TOE', TTT_WIN_POINTS,
        );
        if (pointsAwarded > 0) {
          await app.prisma.user.update({
            where: { id: game.player1Id },
            data: { points: { increment: pointsAwarded } },
          });
        }
      }

      return reply.send({
        move,
        board,
        status,
        winnerId,
        isFinished: status === 'FINISHED',
      });
    } catch (error) {
      app.log.error({ err: error }, 'AI move error');
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      return reply.status(500).send({ error: 'Failed to process AI move' });
    }
  });

  // ── POST /api/games/submit-score — PERKY_JUMP with anti-cheat ──────────
  app.post('submit-score', async (request, reply) => {
    try {
      const body = submitScoreSchema.parse(request.body);
      const user = await resolveUser(request, app.prisma);
      if (!user) return reply.status(404).send({ error: 'User not found' });

      // 1. Hash check
      const expectedHash = computeScoreHash(body.score, body.timestamp);
      if (expectedHash !== body.hash) {
        app.log.warn({ userId: user.id, score: body.score }, 'Score hash mismatch');
        return reply.status(400).send({ error: 'InvalidHash', message: 'Score verification failed' });
      }

      // 2. Timestamp freshness
      const ageMs = Date.now() - body.timestamp;
      if (ageMs < 0 || ageMs > MAX_SCORE_AGE_MS) {
        return reply.status(400).send({ error: 'ExpiredScore', message: 'Score timestamp is too old or in the future' });
      }

      // 3. Realism check
      if (body.gameDurationMs !== undefined && body.gameDurationMs > 0) {
        const durationSec = body.gameDurationMs / 1000;
        const scoreRate = body.score / durationSec;
        if (scoreRate > MAX_SCORE_PER_SECOND) {
          app.log.warn({ userId: user.id, score: body.score, durationSec, scoreRate }, 'Unrealistic score rate');
          return reply.status(400).send({ error: 'UnrealisticScore', message: 'Score rate is not plausible' });
        }
      }

      // 4. Daily game limit check
      const todayKyiv = getKyivDateString();
      const dayStart = kyivDayStart();

      const todaySessions = await app.prisma.gameSession.count({
        where: {
          player1Id: user.id,
          type: 'PERKY_JUMP',
          status: 'FINISHED',
          createdAt: { gte: dayStart },
        },
      });

      const canEarnPoints = todaySessions < MAX_SCORING_GAMES_PER_DAY;
      const rawPoints = Math.min(Math.floor(body.score / 100), MAX_GAME_POINTS_PER_DAY);

      // 5. Persist game session
      const session = await app.prisma.gameSession.create({
        data: {
          type: 'PERKY_JUMP',
          player1Id: user.id,
          status: 'FINISHED',
          score: body.score,
          securityHash: body.hash,
        },
      });

      // 6. Record GameScore
      let pointsAwarded = 0;
      if (canEarnPoints && rawPoints > 0) {
        const result = await updateDailyLimit(app.prisma, user.id, 'PERKY_JUMP', rawPoints);
        pointsAwarded = result.pointsAwarded;
      }

      await app.prisma.gameScore.create({
        data: {
          userId: user.id,
          gameType: 'PERKY_JUMP',
          score: body.score,
          pointsEarned: pointsAwarded,
          duration: body.gameDurationMs ? Math.floor(body.gameDurationMs / 1000) : null,
          sessionId: session.id,
        },
      });

      // 7. Award points
      if (pointsAwarded > 0) {
        await app.prisma.user.update({
          where: { id: user.id },
          data: { points: { increment: pointsAwarded } },
        });
      }

      app.log.info(
        { userId: user.id, score: body.score, pointsAwarded, todaySessions },
        'Perky Jump score submitted',
      );

      return reply.send({
        success: true,
        pointsAwarded,
        scoringGamesLeft: Math.max(0, MAX_SCORING_GAMES_PER_DAY - todaySessions - 1),
        limitReached: !canEarnPoints,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Submit score error');
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      return reply.status(500).send({ error: 'Failed to submit score' });
    }
  });

  // ── POST /api/games/perkie-jump/save (legacy, backward compat) ──────────
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

  // ── GET /api/games/daily-limits — User's daily game limits ──────────────
  app.get('daily-limits', async (request, reply) => {
    try {
      const user = await resolveUser(request, app.prisma);
      if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

      const todayKyiv = getKyivDateString();
      const limits = await app.prisma.dailyGameLimit.findMany({
        where: { userId: user.id, date: todayKyiv },
      });

      const result: Record<string, { pointsEarned: number; maxPoints: number }> = {
        TIC_TAC_TOE: { pointsEarned: 0, maxPoints: TTT_MAX_DAILY_POINTS },
        PERKY_JUMP: { pointsEarned: 0, maxPoints: MAX_GAME_POINTS_PER_DAY },
      };

      for (const limit of limits) {
        if (result[limit.gameType]) {
          result[limit.gameType].pointsEarned = limit.pointsEarned;
        }
      }

      return reply.send({ date: todayKyiv, limits: result });
    } catch (error) {
      app.log.error({ err: error }, 'Daily limits error');
      return reply.status(500).send({ error: 'Failed to get daily limits' });
    }
  });
}
