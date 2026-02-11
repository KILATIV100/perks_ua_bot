import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { GAME_SCORE_SECRET } from '../../shared/middleware.js';
import { getKyivMidnightToday } from '../../shared/kyiv-time.js';

const BOT_USERNAME = process.env.BOT_USERNAME || 'perkup_ua_bot';

const createGameSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
});

const joinGameSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  gameId: z.string().uuid(),
});

const submitScoreSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  gameType: z.enum(['PERKIE_JUMP', 'TIC_TAC_TOE']),
  score: z.number().int().min(0),
  timestamp: z.number().int(),
  hash: z.string(),
  duration: z.number().int().min(0).optional(), // game duration in seconds
});

// Anti-cheat: max realistic score per second for Perkie Jump
const MAX_SCORE_PER_SECOND = 5;
// Max games per day that award points
const MAX_REWARDED_GAMES_PER_DAY = 5;
// Points per game win / score submission
const POINTS_PER_GAME = 2;

export async function gameRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // POST /api/games/create - Create a new TicTacToe game session
  app.post('create', async (request, reply) => {
    try {
      const body = createGameSchema.parse(request.body);

      const user = await app.prisma.user.findUnique({
        where: { telegramId: body.telegramId },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const game = await app.prisma.gameSession.create({
        data: {
          player1Id: user.id,
          gameType: 'TIC_TAC_TOE',
          boardState: [[null, null, null], [null, null, null], [null, null, null]],
          status: 'WAITING',
          opponentType: 'HUMAN',
        },
        select: { id: true, status: true, gameType: true, createdAt: true },
      });

      const inviteLink = `https://t.me/${BOT_USERNAME}?start=game_${game.id}`;

      return reply.status(201).send({ game, inviteLink });
    } catch (error) {
      app.log.error({ err: error }, 'Create game error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to create game' });
    }
  });

  // POST /api/games/join - Join an existing game session
  app.post('join', async (request, reply) => {
    try {
      const body = joinGameSchema.parse(request.body);

      const user = await app.prisma.user.findUnique({
        where: { telegramId: body.telegramId },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const game = await app.prisma.gameSession.findUnique({
        where: { id: body.gameId },
      });

      if (!game) {
        return reply.status(404).send({ error: 'Game not found' });
      }

      if (game.status !== 'WAITING') {
        return reply.status(400).send({ error: 'Game already started or finished' });
      }

      if (game.player1Id === user.id) {
        return reply.status(400).send({ error: 'Cannot join your own game' });
      }

      const updatedGame = await app.prisma.gameSession.update({
        where: { id: body.gameId },
        data: { player2Id: user.id, status: 'PLAYING' },
        select: { id: true, player1Id: true, player2Id: true, status: true, boardState: true, gameType: true },
      });

      if (app.io) {
        app.io.to(`game:${game.id}`).emit('game:started', updatedGame);
      }

      return reply.send({ game: updatedGame });
    } catch (error) {
      app.log.error({ err: error }, 'Join game error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to join game' });
    }
  });

  // GET /api/games/:id - Get game state
  app.get<{ Params: { id: string } }>(':id', async (request, reply) => {
    try {
      const game = await app.prisma.gameSession.findUnique({
        where: { id: request.params.id },
        include: {
          player1: { select: { id: true, telegramId: true, firstName: true } },
          player2: { select: { id: true, telegramId: true, firstName: true } },
        },
      });

      if (!game) {
        return reply.status(404).send({ error: 'Game not found' });
      }

      return reply.send({ game });
    } catch (error) {
      app.log.error({ err: error }, 'Get game error');
      return reply.status(500).send({ error: 'Failed to get game' });
    }
  });

  // POST /api/games/submit-score - Submit game score (Perkie Jump / TicTacToe result)
  app.post('submit-score', async (request, reply) => {
    try {
      const body = submitScoreSchema.parse(request.body);

      // 1. Verify hash: sha256(score + secret + timestamp)
      const expectedHash = crypto
        .createHash('sha256')
        .update(`${body.score}${GAME_SCORE_SECRET}${body.timestamp}`)
        .digest('hex');

      if (body.hash !== expectedHash) {
        app.log.warn(`[AntiCheat] Hash mismatch for telegramId: ${body.telegramId}, score: ${body.score}`);
        return reply.status(400).send({ error: 'InvalidHash', message: 'Score verification failed' });
      }

      // 2. Check timestamp is recent (within last 10 minutes)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - body.timestamp) > 600) {
        return reply.status(400).send({ error: 'ExpiredScore', message: 'Score timestamp is too old' });
      }

      // 3. Realism check for Perkie Jump
      if (body.gameType === 'PERKIE_JUMP' && body.duration) {
        const maxRealisticScore = body.duration * MAX_SCORE_PER_SECOND;
        if (body.score > maxRealisticScore) {
          app.log.warn(`[AntiCheat] Unrealistic score: ${body.score} in ${body.duration}s (max: ${maxRealisticScore})`);
          return reply.status(400).send({ error: 'UnrealisticScore', message: 'Score seems too high for game duration' });
        }
      }

      // Find user
      const user = await app.prisma.user.findUnique({
        where: { telegramId: body.telegramId },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // 4. Create game session record
      const gameSession = await app.prisma.gameSession.create({
        data: {
          player1Id: user.id,
          gameType: body.gameType,
          score: body.score,
          securityHash: body.hash,
          status: 'FINISHED',
          winnerId: user.id,
          opponentType: body.gameType === 'PERKIE_JUMP' ? 'NONE' : 'AI',
        },
      });

      // 5. Check daily reward limit (max 5 games per day that give points)
      const kyivMidnight = getKyivMidnightToday();
      const todayRewardedGames = await app.prisma.gameSession.count({
        where: {
          player1Id: user.id,
          status: 'FINISHED',
          pointsAwarded: { gt: 0 },
          updatedAt: { gte: kyivMidnight },
          id: { not: gameSession.id },
        },
      });

      let pointsAwarded = 0;
      if (todayRewardedGames < MAX_REWARDED_GAMES_PER_DAY) {
        pointsAwarded = Math.min(POINTS_PER_GAME, (MAX_REWARDED_GAMES_PER_DAY - todayRewardedGames) * POINTS_PER_GAME);

        await app.prisma.user.update({
          where: { id: user.id },
          data: { points: { increment: pointsAwarded } },
        });

        await app.prisma.gameSession.update({
          where: { id: gameSession.id },
          data: { pointsAwarded },
        });

        app.log.info(`[Game] +${pointsAwarded} to ${body.telegramId} (${todayRewardedGames + 1}/${MAX_REWARDED_GAMES_PER_DAY} today)`);
      }

      const updatedUser = await app.prisma.user.findUnique({
        where: { id: user.id },
        select: { points: true },
      });

      return reply.send({
        success: true,
        score: body.score,
        pointsAwarded,
        newBalance: updatedUser?.points || 0,
        gamesRemainingToday: Math.max(0, MAX_REWARDED_GAMES_PER_DAY - todayRewardedGames - (pointsAwarded > 0 ? 1 : 0)),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Submit score error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to submit score' });
    }
  });
}
