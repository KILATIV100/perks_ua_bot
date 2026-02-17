/**
 * Tic-Tac-Toe Component
 *
 * Modes:
 *  - PvP (Local): two players on the same device
 *  - PvE (vs Перкі): player vs unbeatable minimax AI
 *
 * Game logic runs entirely on the client.
 * After a PvE match the result is submitted to /api/games/submit-score
 * (conceptually; actual TicTacToe scoring uses the Socket.IO multiplayer path).
 */

import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type CellValue = 'X' | 'O' | null;
type GameMode = 'pvp' | 'pve';
type GameResult = 'X' | 'O' | 'draw' | null;

interface Scores {
  player1: number;
  player2: number;
  draws: number;
}

interface Theme {
  bgColor: string;
  textColor: string;
  hintColor: string;
  buttonColor: string;
  buttonTextColor: string;
  secondaryBgColor: string;
}

interface TicTacToeProps {
  mode?: 'online' | 'offline';
  theme: Theme;
}

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],             // diagonals
] as const;

// ---------------------------------------------------------------------------
// Pure game logic (no React deps)
// ---------------------------------------------------------------------------

function checkWinner(board: CellValue[]): CellValue {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
}

function getWinningLine(board: CellValue[]): readonly [number, number, number] | null {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return line;
  }
  return null;
}

function isBoardFull(board: CellValue[]): boolean {
  return board.every((c) => c !== null);
}

/**
 * Minimax with alpha-beta pruning.
 * AI plays as 'O', human plays as 'X'.
 * Returns a score: positive = AI advantage, negative = human advantage.
 */
function minimax(
  board: CellValue[],
  depth: number,
  isMaximizing: boolean,
  alpha: number,
  beta: number,
): number {
  const winner = checkWinner(board);
  if (winner === 'O') return 10 - depth;  // AI wins (prefer faster wins)
  if (winner === 'X') return depth - 10;  // Human wins
  if (isBoardFull(board)) return 0;       // Draw

  if (isMaximizing) {
    let best = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] === null) {
        board[i] = 'O';
        best = Math.max(best, minimax(board, depth + 1, false, alpha, beta));
        board[i] = null;
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break; // β cut-off
      }
    }
    return best;
  } else {
    let best = Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] === null) {
        board[i] = 'X';
        best = Math.min(best, minimax(board, depth + 1, true, alpha, beta));
        board[i] = null;
        beta = Math.min(beta, best);
        if (beta <= alpha) break; // α cut-off
      }
    }
    return best;
  }
}

/**
 * Return the best move index for the AI ('O').
 * Unbeatable — will always win or draw.
 */
function getBestAiMove(board: CellValue[]): number {
  let bestScore = -Infinity;
  let bestMove = -1;
  for (let i = 0; i < 9; i++) {
    if (board[i] === null) {
      board[i] = 'O';
      const score = minimax(board, 0, false, -Infinity, Infinity);
      board[i] = null;
      if (score > bestScore) {
        bestScore = score;
        bestMove = i;
      }
    }
  }
  return bestMove;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TicTacToe({ theme, mode = 'online' }: TicTacToeProps) {
  const [gameMode, setGameMode] = useState<GameMode>('pve');
  const [board, setBoard] = useState<CellValue[]>(Array(9).fill(null));
  const [turn, setTurn] = useState<'X' | 'O'>('X');
  const [result, setResult] = useState<GameResult>(null);
  const [scores, setScores] = useState<Scores>({ player1: 0, player2: 0, draws: 0 });
  const [aiThinking, setAiThinking] = useState(false);
  const [winLine, setWinLine] = useState<readonly [number, number, number] | null>(null);

  // Sync with external mode prop
  useEffect(() => { setGameMode('pve'); }, [mode]);

  const resetGame = useCallback(() => {
    setBoard(Array(9).fill(null));
    setTurn('X');
    setResult(null);
    setWinLine(null);
    setAiThinking(false);
  }, []);

  // AI makes its move after a short "thinking" delay
  const doAiMove = useCallback((currentBoard: CellValue[]) => {
    setAiThinking(true);
    setTimeout(() => {
      const aiIdx = getBestAiMove(currentBoard);
      if (aiIdx === -1) { setAiThinking(false); return; }

      const next = [...currentBoard];
      next[aiIdx] = 'O';

      const winner = checkWinner(next);
      const line = getWinningLine(next);
      const full = isBoardFull(next);

      setBoard(next);
      setWinLine(line);

      if (winner) {
        setResult(winner);
        setScores((prev) => ({
          ...prev,
          player1: winner === 'X' ? prev.player1 + 1 : prev.player1,
          player2: winner === 'O' ? prev.player2 + 1 : prev.player2,
        }));
      } else if (full) {
        setResult('draw');
        setScores((prev) => ({ ...prev, draws: prev.draws + 1 }));
      } else {
        setTurn('X');
      }
      setAiThinking(false);
    }, 450); // brief "thinking" pause for UX
  }, []);

  const handleCellClick = useCallback(
    (index: number) => {
      if (result || board[index] !== null) return;
      if (gameMode === 'pve' && aiThinking) return;
      if (gameMode === 'pve' && turn === 'O') return; // AI's turn

      const next = [...board];
      next[index] = turn;

      const winner = checkWinner(next);
      const line = getWinningLine(next);
      const full = isBoardFull(next);

      setBoard(next);
      setWinLine(line);

      if (winner) {
        setResult(winner);
        setScores((prev) => ({
          ...prev,
          player1: winner === 'X' ? prev.player1 + 1 : prev.player1,
          player2: winner === 'O' ? prev.player2 + 1 : prev.player2,
        }));
      } else if (full) {
        setResult('draw');
        setScores((prev) => ({ ...prev, draws: prev.draws + 1 }));
      } else {
        const nextTurn: 'X' | 'O' = turn === 'X' ? 'O' : 'X';
        setTurn(nextTurn);
        if (gameMode === 'pve' && nextTurn === 'O') {
          doAiMove(next);
        }
      }
    },
    [board, turn, result, gameMode, aiThinking, doAiMove],
  );

  // Status line
  const statusText = (): string => {
    if (result === 'draw') return 'Нічия! 🤝';
    if (result) {
      if (gameMode === 'pve') {
        return result === 'X' ? 'Ти переміг! 🎉' : 'Перкі переміг! 🤖☕';
      }
      return `${result === 'X' ? 'Гравець 1' : 'Гравець 2'} переміг! 🎉`;
    }
    if (gameMode === 'pve') {
      if (aiThinking) return 'Перкі думає...☕';
      return 'Твій хід (X)';
    }
    return `${turn === 'X' ? 'Гравець 1' : 'Гравець 2'} (${turn}) ходить`;
  };

  const cellColor = (cell: CellValue) => {
    if (cell === 'X') return '#667eea';
    if (cell === 'O') return '#f59e0b';
    return theme.textColor;
  };

  const isCellHighlighted = (index: number) =>
    winLine !== null && winLine.includes(index as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8);

  const p2Label = gameMode === 'pve' ? 'Перкі' : 'Гравець 2';

  return (
    <div className="space-y-5">
      <header className="text-center">
        <h1 className="text-2xl font-bold mb-1" style={{ color: theme.textColor }}>
          Хрестики-Нулики
        </h1>
        <p className="text-sm" style={{ color: theme.hintColor }}>
          Виберіть режим гри
        </p>
      </header>

      {/* Mode selector */}
      <div className="flex gap-3 justify-center">
        {([
          { id: 'pve', label: '🤖 vs Перкі' },
          { id: 'pvp', label: '🎮 2 гравці' },
        ] as const).map((m) => (
          <button
            key={m.id}
            onClick={() => { setGameMode(m.id); resetGame(); }}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{
              backgroundColor: gameMode === m.id ? theme.buttonColor : theme.secondaryBgColor,
              color: gameMode === m.id ? theme.buttonTextColor : theme.textColor,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Score bar */}
      <div
        className="rounded-2xl p-4"
        style={{ backgroundColor: theme.secondaryBgColor }}
      >
        <div className="flex justify-center gap-10 mb-4">
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: theme.hintColor }}>
              {gameMode === 'pve' ? 'Ти' : 'Гравець 1'}
            </div>
            <div className="text-2xl font-bold" style={{ color: '#667eea' }}>
              {scores.player1}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: theme.hintColor }}>Нічиї</div>
            <div className="text-2xl font-bold" style={{ color: theme.textColor }}>
              {scores.draws}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: theme.hintColor }}>
              {p2Label}
            </div>
            <div className="text-2xl font-bold" style={{ color: '#f59e0b' }}>
              {scores.player2}
            </div>
          </div>
        </div>

        {/* Status */}
        <p
          className="text-center text-sm font-medium mb-4"
          style={{ color: result ? theme.buttonColor : theme.textColor }}
        >
          {statusText()}
        </p>

        {/* Board */}
        <div className="grid grid-cols-3 gap-2 w-full max-w-[288px] mx-auto">
          {board.map((cell, i) => (
            <button
              key={i}
              className="aspect-square w-full rounded-xl text-3xl font-bold flex items-center justify-center transition-all active:scale-95 disabled:cursor-default"
              onClick={() => handleCellClick(i)}
              disabled={!!result || cell !== null || aiThinking || (gameMode === 'pve' && turn === 'O')}
              style={{
                backgroundColor: isCellHighlighted(i)
                  ? `${theme.buttonColor}40`
                  : theme.bgColor,
                color: cellColor(cell),
                border: isCellHighlighted(i)
                  ? `2px solid ${theme.buttonColor}`
                  : `2px solid ${theme.hintColor}25`,
                transform: isCellHighlighted(i) ? 'scale(1.05)' : undefined,
              }}
            >
              {cell ?? ''}
            </button>
          ))}
        </div>

        {/* New game button */}
        <button
          className="mt-5 w-full py-3 rounded-xl font-medium transition-all active:scale-[0.98]"
          style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
          onClick={resetGame}
        >
          Нова гра
        </button>
      </div>

      {/* PvE hint */}
      {gameMode === 'pve' && (
        <p className="text-center text-xs" style={{ color: theme.hintColor }}>
          ☕ Перкі використовує мінімакс — перемогти неможливо!
        </p>
      )}
    </div>
  );
}
