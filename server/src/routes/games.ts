import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';

const BOT_USERNAME = process.env.BOT_USERNAME || 'perkup_ua_bot';

const createGameSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
});

const joinGameSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  gameId: z.string().uuid(),
});

export async function gameRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // POST /api/games/create - Create a new game session
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
        },
        select: {
          id: true,
          status: true,
          gameType: true,
          createdAt: true,
        },
      });

      const inviteLink = `https://t.me/${BOT_USERNAME}?start=game_${game.id}`;

      return reply.status(201).send({
        game,
        inviteLink,
      });
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
        data: {
          player2Id: user.id,
          status: 'PLAYING',
        },
        select: {
          id: true,
          player1Id: true,
          player2Id: true,
          status: true,
          boardState: true,
          gameType: true,
        },
      });

      // Notify via Socket.IO that game has started
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
}

// Check for win condition in tic-tac-toe
function checkWinner(board: (string | null)[][]): string | null {
  const lines = [
    // Rows
    [[0, 0], [0, 1], [0, 2]],
    [[1, 0], [1, 1], [1, 2]],
    [[2, 0], [2, 1], [2, 2]],
    // Columns
    [[0, 0], [1, 0], [2, 0]],
    [[0, 1], [1, 1], [2, 1]],
    [[0, 2], [1, 2], [2, 2]],
    // Diagonals
    [[0, 0], [1, 1], [2, 2]],
    [[0, 2], [1, 1], [2, 0]],
  ];

  for (const line of lines) {
    const [a, b, c] = line;
    const valA = board[a[0]][a[1]];
    if (valA && valA === board[b[0]][b[1]] && valA === board[c[0]][c[1]]) {
      return valA; // 'X' or 'O'
    }
  }

  return null;
}

function isBoardFull(board: (string | null)[][]): boolean {
  return board.every(row => row.every(cell => cell !== null));
}

// Setup Socket.IO game event handlers
export function setupGameSockets(io: SocketIOServer, prisma: PrismaClient): void {
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    // Join a game room
    socket.on('game:join', (gameId: string) => {
      socket.join(`game:${gameId}`);
      console.log(`[Socket.IO] ${socket.id} joined game:${gameId}`);
    });

    // Handle a move
    socket.on('game:move', async (data: { gameId: string; playerId: string; row: number; col: number }) => {
      try {
        const game = await prisma.gameSession.findUnique({
          where: { id: data.gameId },
        });

        if (!game || game.status !== 'PLAYING') {
          socket.emit('game:error', { message: 'Game not active' });
          return;
        }

        const board = game.boardState as (string | null)[][];

        // Validate move
        if (data.row < 0 || data.row > 2 || data.col < 0 || data.col > 2) {
          socket.emit('game:error', { message: 'Invalid position' });
          return;
        }

        if (board[data.row][data.col] !== null) {
          socket.emit('game:error', { message: 'Cell already taken' });
          return;
        }

        // Determine player symbol
        const isPlayer1 = data.playerId === game.player1Id;
        const isPlayer2 = data.playerId === game.player2Id;

        if (!isPlayer1 && !isPlayer2) {
          socket.emit('game:error', { message: 'Not a player in this game' });
          return;
        }

        // Check if it's this player's turn
        const moveCount = board.flat().filter(c => c !== null).length;
        const isXTurn = moveCount % 2 === 0; // X goes first (player1)
        if ((isPlayer1 && !isXTurn) || (isPlayer2 && isXTurn)) {
          socket.emit('game:error', { message: 'Not your turn' });
          return;
        }

        const symbol = isPlayer1 ? 'X' : 'O';
        board[data.row][data.col] = symbol;

        // Check for winner
        const winner = checkWinner(board);
        const full = isBoardFull(board);

        let status: 'PLAYING' | 'FINISHED' = 'PLAYING';
        let winnerId: string | null = null;

        if (winner) {
          status = 'FINISHED';
          winnerId = winner === 'X' ? game.player1Id : game.player2Id!;
        } else if (full) {
          status = 'FINISHED';
          winnerId = null; // Draw
        }

        const updatedGame = await prisma.gameSession.update({
          where: { id: data.gameId },
          data: {
            boardState: board,
            status,
            winnerId,
          },
          include: {
            player1: { select: { id: true, firstName: true, telegramId: true } },
            player2: { select: { id: true, firstName: true, telegramId: true } },
          },
        });

        io.to(`game:${data.gameId}`).emit('game:update', {
          board,
          status,
          winnerId,
          lastMove: { row: data.row, col: data.col, symbol },
          player1: updatedGame.player1,
          player2: updatedGame.player2,
        });
      } catch (error) {
        console.error('[Socket.IO] Move error:', error);
        socket.emit('game:error', { message: 'Server error processing move' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });
}
