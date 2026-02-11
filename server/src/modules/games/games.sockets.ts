/**
 * Games Module — Socket.IO Event Handlers
 *
 * Handles real-time TIC_TAC_TOE gameplay:
 *  - game:join   — subscribe to a game room
 *  - game:move   — make a move (also aliased as make_move)
 *
 * Points are awarded to the winner (+2 per win, max 5 pts/day from game wins).
 * The daily budget uses Kyiv-timezone day start for consistency.
 */

import type { Server as SocketIOServer } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import { getKyivDateString } from '../../shared/utils/timezone.js';

type CellValue = 'X' | 'O' | null;

// ---------------------------------------------------------------------------
// Win-condition helpers
// ---------------------------------------------------------------------------

function checkWinner(board: CellValue[][]): CellValue {
  const lines: [number, number][][] = [
    // rows
    [[0,0],[0,1],[0,2]],
    [[1,0],[1,1],[1,2]],
    [[2,0],[2,1],[2,2]],
    // cols
    [[0,0],[1,0],[2,0]],
    [[0,1],[1,1],[2,1]],
    [[0,2],[1,2],[2,2]],
    // diagonals
    [[0,0],[1,1],[2,2]],
    [[0,2],[1,1],[2,0]],
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setupGameSockets(io: SocketIOServer, prisma: PrismaClient): void {
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    socket.on('game:join', (gameId: string) => {
      socket.join(`game:${gameId}`);
      console.log(`[Socket.IO] ${socket.id} joined room game:${gameId}`);
    });

    const handleMove = async (data: {
      gameId: string;
      playerId: string;
      row: number;
      col: number;
    }) => {
      try {
        const game = await prisma.gameSession.findUnique({ where: { id: data.gameId } });

        if (!game || game.status !== 'PLAYING') {
          socket.emit('game:error', { message: 'Game not active' });
          return;
        }

        const board = game.boardState as CellValue[][];

        // Validate bounds
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

        // Turn validation: player1 = X (goes first), player2 = O
        const moveCount = board.flat().filter(c => c !== null).length;
        const isXTurn = moveCount % 2 === 0;
        if ((isPlayer1 && !isXTurn) || (isPlayer2 && isXTurn)) {
          socket.emit('game:error', { message: 'Not your turn' });
          return;
        }

        const symbol: CellValue = isPlayer1 ? 'X' : 'O';
        board[data.row][data.col] = symbol;

        const winner = checkWinner(board);
        const full = isBoardFull(board);

        const status: 'PLAYING' | 'FINISHED' = (winner || full) ? 'FINISHED' : 'PLAYING';
        const winnerId: string | null = winner
          ? (winner === 'X' ? game.player1Id : game.player2Id ?? null)
          : null;

        const updatedGame = await prisma.gameSession.update({
          where: { id: data.gameId },
          data: { boardState: board, status, winnerId },
          include: {
            player1: { select: { id: true, firstName: true, telegramId: true } },
            player2: { select: { id: true, firstName: true, telegramId: true } },
          },
        });

        // Award points to winner (max 5 pts/day from game wins)
        if (status === 'FINISHED' && winnerId) {
          const kyivDateStr = getKyivDateString();
          const [y, m, d] = kyivDateStr.split('-').map(Number);
          const dayStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));

          const todayWins = await prisma.gameSession.count({
            where: {
              winnerId,
              type: 'TIC_TAC_TOE',
              status: 'FINISHED',
              updatedAt: { gte: dayStart },
              id: { not: data.gameId },
            },
          });

          const pointsEarnedToday = todayWins * 2;
          if (pointsEarnedToday < 5) {
            const pointsToAward = Math.min(2, 5 - pointsEarnedToday);
            await prisma.user.update({
              where: { id: winnerId },
              data: { points: { increment: pointsToAward } },
            });
            console.log(`[Game] +${pointsToAward} pts → winner ${winnerId} (${pointsEarnedToday + pointsToAward}/5 today)`);
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

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });
}
