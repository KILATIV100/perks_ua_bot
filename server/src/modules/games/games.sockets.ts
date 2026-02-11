import { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { getKyivMidnightToday } from '../../shared/kyiv-time.js';

function checkWinner(board: (string | null)[][]): string | null {
  const lines = [
    [[0, 0], [0, 1], [0, 2]],
    [[1, 0], [1, 1], [1, 2]],
    [[2, 0], [2, 1], [2, 2]],
    [[0, 0], [1, 0], [2, 0]],
    [[0, 1], [1, 1], [2, 1]],
    [[0, 2], [1, 2], [2, 2]],
    [[0, 0], [1, 1], [2, 2]],
    [[0, 2], [1, 1], [2, 0]],
  ];

  for (const line of lines) {
    const [a, b, c] = line;
    const valA = board[a[0]][a[1]];
    if (valA && valA === board[b[0]][b[1]] && valA === board[c[0]][c[1]]) {
      return valA;
    }
  }
  return null;
}

function isBoardFull(board: (string | null)[][]): boolean {
  return board.every(row => row.every(cell => cell !== null));
}

export function setupGameSockets(io: SocketIOServer, prisma: PrismaClient): void {
  io.on('connection', (socket) => {
    socket.on('game:join', (gameId: string) => {
      socket.join(`game:${gameId}`);
    });

    socket.on('game:move', async (data: { gameId: string; playerId: string; row: number; col: number }) => {
      try {
        const game = await prisma.gameSession.findUnique({ where: { id: data.gameId } });

        if (!game || game.status !== 'PLAYING') {
          socket.emit('game:error', { message: 'Game not active' });
          return;
        }

        const board = game.boardState as (string | null)[][];

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

        const moveCount = board.flat().filter(c => c !== null).length;
        const isXTurn = moveCount % 2 === 0;
        if ((isPlayer1 && !isXTurn) || (isPlayer2 && isXTurn)) {
          socket.emit('game:error', { message: 'Not your turn' });
          return;
        }

        const symbol = isPlayer1 ? 'X' : 'O';
        board[data.row][data.col] = symbol;

        const winner = checkWinner(board);
        const full = isBoardFull(board);

        let status = 'PLAYING';
        let winnerId: string | null = null;

        if (winner) {
          status = 'FINISHED';
          winnerId = winner === 'X' ? game.player1Id : game.player2Id!;
        } else if (full) {
          status = 'FINISHED';
          winnerId = null;
        }

        const updatedGame = await prisma.gameSession.update({
          where: { id: data.gameId },
          data: { boardState: board, status, winnerId },
          include: {
            player1: { select: { id: true, firstName: true, telegramId: true } },
            player2: { select: { id: true, firstName: true, telegramId: true } },
          },
        });

        // Award points to winner
        if (status === 'FINISHED' && winnerId) {
          try {
            const kyivMidnight = getKyivMidnightToday();
            const todayWins = await prisma.gameSession.count({
              where: {
                winnerId,
                status: 'FINISHED',
                pointsAwarded: { gt: 0 },
                updatedAt: { gte: kyivMidnight },
                id: { not: data.gameId },
              },
            });

            if (todayWins < 5) {
              const pointsToAward = Math.min(2, (5 - todayWins) * 2);
              await prisma.user.update({
                where: { id: winnerId },
                data: { points: { increment: pointsToAward } },
              });
              await prisma.gameSession.update({
                where: { id: data.gameId },
                data: { pointsAwarded: pointsToAward },
              });
            }
          } catch (err) {
            console.error('[Game] Failed to award points:', err);
          }
        }

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

    socket.on('disconnect', () => {});
  });
}
