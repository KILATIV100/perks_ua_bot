/**
 * Games Module — Socket.IO Event Handlers (v2.0)
 *
 * Handles real-time TIC_TAC_TOE gameplay:
 *  - game:join   — subscribe to a game room
 *  - game:move   — make a move (also aliased as make_move)
 *
 * Security: JWT authentication on connection.
 * Points: +2 per win, tracked via DailyGameLimit (max 10 pts/day from TTT wins).
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import { verifyAccessToken } from '../../shared/jwt.js';
import { getKyivDateString } from '../../shared/utils/timezone.js';

type CellValue = 'X' | 'O' | null;

const TTT_WIN_POINTS = 2;
const TTT_MAX_DAILY_POINTS = 10;
const DISCONNECT_TIMEOUT_MS = 30_000; // 30 seconds to reconnect

// Track socket → game mapping for disconnect handling
const socketGameMap = new Map<string, { gameId: string; playerId: string }>();
const disconnectTimers = new Map<string, NodeJS.Timeout>();

// ── Win-condition helpers ────────────────────────────────────────────────

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

// ── Setup ────────────────────────────────────────────────────────────────

export function setupGameSockets(io: SocketIOServer, prisma: PrismaClient): void {
  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      // Allow unauthenticated connections for backward compatibility,
      // but they won't be able to make moves without a valid playerId check
      return next();
    }

    const payload = verifyAccessToken(token);
    if (payload) {
      socket.data.userId = payload.userId;
      socket.data.role = payload.role;
    }
    next();
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id} (userId: ${socket.data.userId ?? 'anonymous'})`);

    socket.on('game:join', (gameId: string) => {
      socket.join(`game:${gameId}`);
      console.log(`[Socket.IO] ${socket.id} joined room game:${gameId}`);

      // Cancel any pending disconnect timer for this player's game
      const timerKey = `${gameId}:${socket.data.userId}`;
      const existingTimer = disconnectTimers.get(timerKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        disconnectTimers.delete(timerKey);
        // Notify room that player reconnected
        io.to(`game:${gameId}`).emit('game:player_reconnected', {
          playerId: socket.data.userId,
        });
      }
    });

    const handleMove = async (data: {
      gameId: string;
      playerId: string;
      row: number;
      col: number;
    }) => {
      try {
        // Verify that the socket user matches the claimed playerId
        if (socket.data.userId && socket.data.userId !== data.playerId) {
          socket.emit('game:error', { message: 'Player ID mismatch' });
          return;
        }

        const game = await prisma.gameSession.findUnique({ where: { id: data.gameId } });

        if (!game || game.status !== 'PLAYING') {
          socket.emit('game:error', { message: 'Game not active' });
          return;
        }

        const board = game.boardState as CellValue[][];

        if (data.row < 0 || data.row > 2 || data.col < 0 || data.col > 2) {
          socket.emit('game:error', { message: 'Invalid position' });
          return;
        }
        if (board[data.row][data.col] !== null) {
          socket.emit('game:error', { message: 'Cell already taken' });
          return;
        }

        const isPlayer1 = data.playerId === game.player1Id;
        const isPlayer2 = data.playerId === game.player2Id;
        if (!isPlayer1 && !isPlayer2) {
          socket.emit('game:error', { message: 'Not a player in this game' });
          return;
        }

        // Turn validation using currentTurn field
        if (game.currentTurn && game.currentTurn !== data.playerId) {
          socket.emit('game:error', { message: 'Not your turn' });
          return;
        }

        // Fallback turn validation by move count
        if (!game.currentTurn) {
          const moveCount = board.flat().filter(c => c !== null).length;
          const isXTurn = moveCount % 2 === 0;
          if ((isPlayer1 && !isXTurn) || (isPlayer2 && isXTurn)) {
            socket.emit('game:error', { message: 'Not your turn' });
            return;
          }
        }

        const symbol: CellValue = isPlayer1 ? 'X' : 'O';
        board[data.row][data.col] = symbol;

        const winner = checkWinner(board);
        const full = isBoardFull(board);
        const status: 'PLAYING' | 'FINISHED' = (winner || full) ? 'FINISHED' : 'PLAYING';
        const winnerId: string | null = winner
          ? (winner === 'X' ? game.player1Id : game.player2Id ?? null)
          : null;

        const nextTurn = isPlayer1 ? game.player2Id : game.player1Id;

        // Track socket → game mapping for disconnect handling
        socketGameMap.set(socket.id, { gameId: data.gameId, playerId: data.playerId });

        const updatedGame = await prisma.gameSession.update({
          where: { id: data.gameId },
          data: {
            boardState: board,
            status,
            winnerId,
            currentTurn: status === 'FINISHED' ? null : nextTurn,
          },
          include: {
            player1: { select: { id: true, firstName: true, telegramId: true } },
            player2: { select: { id: true, firstName: true, telegramId: true } },
          },
        });

        // Award points via DailyGameLimit
        if (status === 'FINISHED' && winnerId) {
          const todayKyiv = getKyivDateString();

          const limit = await prisma.dailyGameLimit.upsert({
            where: { userId_gameType_date: { userId: winnerId, gameType: 'TIC_TAC_TOE', date: todayKyiv } },
            update: {},
            create: { userId: winnerId, gameType: 'TIC_TAC_TOE', date: todayKyiv, pointsEarned: 0 },
          });

          const remaining = Math.max(0, TTT_MAX_DAILY_POINTS - limit.pointsEarned);
          const pointsToAward = Math.min(TTT_WIN_POINTS, remaining);

          if (pointsToAward > 0) {
            await prisma.dailyGameLimit.update({
              where: { id: limit.id },
              data: { pointsEarned: { increment: pointsToAward } },
            });
            await prisma.user.update({
              where: { id: winnerId },
              data: { points: { increment: pointsToAward } },
            });
            console.log(`[Game] +${pointsToAward} pts → winner ${winnerId} (${limit.pointsEarned + pointsToAward}/${TTT_MAX_DAILY_POINTS} today)`);
          }

          // Record GameScore
          await prisma.gameScore.create({
            data: {
              userId: winnerId,
              gameType: 'TIC_TAC_TOE',
              score: 1, // 1 = win
              pointsEarned: pointsToAward,
              sessionId: data.gameId,
            },
          });
        }

        io.to(`game:${data.gameId}`).emit('game:update', {
          board,
          status,
          winnerId,
          currentTurn: updatedGame.currentTurn,
          lastMove: { row: data.row, col: data.col, symbol },
          player1: updatedGame.player1,
          player2: updatedGame.player2,
        });

        if (status === 'FINISHED') {
          io.to(`game:${data.gameId}`).emit('game_over', {
            board,
            winnerId,
            player1: updatedGame.player1,
            player2: updatedGame.player2,
          });
        }
      } catch (err) {
        console.error('[Socket.IO] Move error:', err);
        socket.emit('game:error', { message: 'Server error processing move' });
      }
    };

    socket.on('game:move', handleMove);
    socket.on('make_move', handleMove); // backward-compat alias

    socket.on('disconnect', async () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);

      const mapping = socketGameMap.get(socket.id);
      if (!mapping) return;

      const { gameId, playerId } = mapping;
      socketGameMap.delete(socket.id);

      // Check if game is still active
      try {
        const game = await prisma.gameSession.findUnique({
          where: { id: gameId },
          select: { status: true, player1Id: true, player2Id: true },
        });

        if (!game || game.status !== 'PLAYING') return;

        // Notify the other player
        io.to(`game:${gameId}`).emit('game:opponent_disconnected', {
          playerId,
          timeoutMs: DISCONNECT_TIMEOUT_MS,
        });

        // Set a timer — if the player doesn't reconnect, abandon the game
        const timerKey = `${gameId}:${playerId}`;
        const timer = setTimeout(async () => {
          disconnectTimers.delete(timerKey);

          try {
            const currentGame = await prisma.gameSession.findUnique({
              where: { id: gameId },
              select: { status: true, player1Id: true, player2Id: true },
            });

            if (!currentGame || currentGame.status !== 'PLAYING') return;

            // Award win to the remaining player
            const remainingPlayerId = playerId === currentGame.player1Id
              ? currentGame.player2Id
              : currentGame.player1Id;

            await prisma.gameSession.update({
              where: { id: gameId },
              data: {
                status: 'ABANDONED',
                winnerId: remainingPlayerId,
              },
            });

            io.to(`game:${gameId}`).emit('game:abandoned', {
              disconnectedPlayerId: playerId,
              winnerId: remainingPlayerId,
            });

            console.log(`[Game] Game ${gameId} abandoned. Player ${playerId} disconnected. Winner: ${remainingPlayerId}`);
          } catch (err) {
            console.error('[Socket.IO] Disconnect timeout error:', err);
          }
        }, DISCONNECT_TIMEOUT_MS);

        disconnectTimers.set(timerKey, timer);
      } catch (err) {
        console.error('[Socket.IO] Disconnect handler error:', err);
      }
    });
  });
}
