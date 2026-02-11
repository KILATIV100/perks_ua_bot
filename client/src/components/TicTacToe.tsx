import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';

interface TicTacToeProps {
  apiUrl: string;
  telegramId: number;
  firstName: string;
  botUsername: string;
  gameIdFromUrl?: string | null;
  theme: {
    bgColor: string;
    textColor: string;
    hintColor: string;
    buttonColor: string;
    buttonTextColor: string;
    secondaryBgColor: string;
  };
}

type CellValue = 'X' | 'O' | null;
type Board = CellValue[][];
type GameMode = 'idle' | 'pvp-online' | 'pvp-local' | 'pve';
type GameStatus = 'idle' | 'waiting' | 'playing' | 'finished';

interface GameState {
  gameId: string;
  board: Board;
  status: GameStatus;
  playerId: string;
  isPlayerX: boolean;
  isMyTurn: boolean;
  winnerId: string | null;
  player1Name: string;
  player2Name: string;
  inviteLink: string;
}

// Local game state (PvE & PvP Local)
interface LocalGameState {
  board: Board;
  currentPlayer: 'X' | 'O';
  winner: CellValue | 'draw' | null;
  isFinished: boolean;
}

const emptyBoard: Board = [
  [null, null, null],
  [null, null, null],
  [null, null, null],
];

const cellAnimationStyle = `
@keyframes cellAppear {
  0% { transform: scale(0) rotate(-180deg); opacity: 0; }
  60% { transform: scale(1.2) rotate(10deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
@keyframes cellPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}
@keyframes winGlow {
  0%, 100% { box-shadow: 0 0 5px rgba(255,215,0,0.3); }
  50% { box-shadow: 0 0 20px rgba(255,215,0,0.8); }
}
.cell-appear { animation: cellAppear 0.4s ease-out forwards; }
.cell-my-turn { animation: cellPulse 1.5s ease-in-out infinite; }
.cell-win { animation: winGlow 1s ease-in-out infinite; }
`;

// ---- Minimax AI ----
function checkWinner(board: Board): CellValue | 'draw' | null {
  const lines = [
    [[0,0],[0,1],[0,2]], [[1,0],[1,1],[1,2]], [[2,0],[2,1],[2,2]],
    [[0,0],[1,0],[2,0]], [[0,1],[1,1],[2,1]], [[0,2],[1,2],[2,2]],
    [[0,0],[1,1],[2,2]], [[0,2],[1,1],[2,0]],
  ];
  for (const line of lines) {
    const [a, b, c] = line;
    const v = board[a[0]][a[1]];
    if (v && v === board[b[0]][b[1]] && v === board[c[0]][c[1]]) return v;
  }
  if (board.every(row => row.every(cell => cell !== null))) return 'draw';
  return null;
}

function minimax(board: Board, isMaximizing: boolean, depth: number): number {
  const result = checkWinner(board);
  if (result === 'O') return 10 - depth; // AI wins (O)
  if (result === 'X') return depth - 10; // Human wins (X)
  if (result === 'draw') return 0;

  if (isMaximizing) {
    let best = -Infinity;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (board[r][c] === null) {
          board[r][c] = 'O';
          best = Math.max(best, minimax(board, false, depth + 1));
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
          board[r][c] = 'X';
          best = Math.min(best, minimax(board, true, depth + 1));
          board[r][c] = null;
        }
      }
    }
    return best;
  }
}

function getAIMove(board: Board): { row: number; col: number } | null {
  let bestScore = -Infinity;
  let bestMove: { row: number; col: number } | null = null;

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (board[r][c] === null) {
        board[r][c] = 'O';
        const score = minimax(board, false, 0);
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
// ---- End Minimax ----

function deepCopyBoard(board: Board): Board {
  return board.map(row => [...row]);
}

export function TicTacToe({ apiUrl, telegramId, firstName, botUsername: _botUsername, gameIdFromUrl, theme }: TicTacToeProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [mode, setMode] = useState<GameMode>('idle');
  const [localGame, setLocalGame] = useState<LocalGameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Socket.IO for online PvP
  useEffect(() => {
    const s = io(apiUrl, { transports: ['websocket', 'polling'] });
    s.on('connect', () => {});

    s.on('game:started', () => {
      if (game) setGame(prev => prev ? { ...prev, status: 'playing' } : null);
    });

    s.on('game:update', (data: {
      board: Board; status: string; winnerId: string | null;
      player1?: { id: string; firstName: string; telegramId: string };
      player2?: { id: string; firstName: string; telegramId: string };
    }) => {
      setGame(prev => {
        if (!prev) return null;
        const moveCount = data.board.flat().filter(c => c !== null).length;
        const isXTurn = moveCount % 2 === 0;
        return {
          ...prev,
          board: data.board,
          status: data.status === 'FINISHED' ? 'finished' : 'playing',
          winnerId: data.winnerId,
          isMyTurn: data.status === 'FINISHED' ? false : (prev.isPlayerX ? isXTurn : !isXTurn),
          player1Name: data.player1?.firstName || prev.player1Name,
          player2Name: data.player2?.firstName || prev.player2Name,
        };
      });
    });

    s.on('game:error', (data: { message: string }) => {
      setError(data.message);
      setTimeout(() => setError(null), 3000);
    });

    setSocket(s);
    return () => { s.disconnect(); };
  }, [apiUrl]);

  // Auto-join from URL
  useEffect(() => {
    if (gameIdFromUrl && socket) {
      setMode('pvp-online');
      joinOnlineGame(gameIdFromUrl);
    }
  }, [gameIdFromUrl, socket]);

  // PvE: Start game vs AI
  const startPvE = useCallback(() => {
    setMode('pve');
    setLocalGame({
      board: deepCopyBoard(emptyBoard),
      currentPlayer: 'X',
      winner: null,
      isFinished: false,
    });
  }, []);

  // PvP Local
  const startPvPLocal = useCallback(() => {
    setMode('pvp-local');
    setLocalGame({
      board: deepCopyBoard(emptyBoard),
      currentPlayer: 'X',
      winner: null,
      isFinished: false,
    });
  }, []);

  // Local move handler
  const makeLocalMove = useCallback((row: number, col: number) => {
    setLocalGame(prev => {
      if (!prev || prev.isFinished) return prev;
      if (prev.board[row][col] !== null) return prev;
      if (mode === 'pve' && prev.currentPlayer !== 'X') return prev;

      const newBoard = deepCopyBoard(prev.board);
      newBoard[row][col] = prev.currentPlayer;

      const winner = checkWinner(newBoard);
      if (winner) {
        return { board: newBoard, currentPlayer: prev.currentPlayer, winner, isFinished: true };
      }

      const nextPlayer = prev.currentPlayer === 'X' ? 'O' : 'X';

      // If PvE and it's now AI's turn
      if (mode === 'pve' && nextPlayer === 'O') {
        const aiMove = getAIMove(newBoard);
        if (aiMove) {
          newBoard[aiMove.row][aiMove.col] = 'O';
          const aiWinner = checkWinner(newBoard);
          if (aiWinner) {
            return { board: newBoard, currentPlayer: 'O', winner: aiWinner, isFinished: true };
          }
          return { board: newBoard, currentPlayer: 'X', winner: null, isFinished: false };
        }
      }

      return { board: newBoard, currentPlayer: nextPlayer, winner: null, isFinished: false };
    });
  }, [mode]);

  // Online game create
  const createOnlineGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMode('pvp-online');
    try {
      const response = await axios.post(`${apiUrl}/api/games/create`, { telegramId: String(telegramId) });
      const { game: createdGame, inviteLink } = response.data;
      const fullGame = await axios.get(`${apiUrl}/api/games/${createdGame.id}`);
      const gameData = fullGame.data.game;

      setGame({
        gameId: createdGame.id,
        board: deepCopyBoard(emptyBoard),
        status: 'waiting',
        playerId: gameData.player1.id,
        isPlayerX: true,
        isMyTurn: true,
        winnerId: null,
        player1Name: firstName,
        player2Name: '',
        inviteLink,
      });
      socket?.emit('game:join', createdGame.id);
    } catch (err) {
      setError('Не вдалося створити гру');
      setMode('idle');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, telegramId, firstName, socket]);

  // Online game join
  const joinOnlineGame = useCallback(async (gameId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.post(`${apiUrl}/api/games/join`, { telegramId: String(telegramId), gameId });
      const gameData = response.data.game;
      const fullGame = await axios.get(`${apiUrl}/api/games/${gameId}`);
      const full = fullGame.data.game;

      setGame({
        gameId,
        board: gameData.boardState as Board,
        status: 'playing',
        playerId: full.player2?.id || '',
        isPlayerX: false,
        isMyTurn: false,
        winnerId: null,
        player1Name: full.player1?.firstName || 'Гравець 1',
        player2Name: firstName,
        inviteLink: '',
      });
      socket?.emit('game:join', gameId);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Не вдалося приєднатися');
      setMode('idle');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, telegramId, firstName, socket]);

  const makeOnlineMove = useCallback((row: number, col: number) => {
    if (!game || !socket) return;
    if (!game.isMyTurn || game.status !== 'playing') return;
    if (game.board[row][col] !== null) return;
    socket.emit('game:move', { gameId: game.gameId, playerId: game.playerId, row, col });
  }, [game, socket]);

  const resetAll = useCallback(() => {
    setMode('idle');
    setGame(null);
    setLocalGame(null);
    setError(null);
  }, []);

  const copyInviteLink = useCallback(() => {
    if (!game?.inviteLink) return;
    navigator.clipboard.writeText(game.inviteLink).catch(() => {});
  }, [game]);

  // ---- RENDER ----

  // Idle: mode selection
  if (mode === 'idle') {
    return (
      <div className="text-center">
        <style>{cellAnimationStyle}</style>
        <div className="text-4xl mb-4">🎮</div>
        <h3 className="text-lg font-semibold mb-2" style={{ color: theme.textColor }}>
          Хрестики-нулики
        </h3>
        <p className="text-sm mb-6" style={{ color: theme.hintColor }}>
          Обери режим гри
        </p>

        <button onClick={startPvE}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98] mb-3"
          style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}>
          🤖 Грати з Перкі (AI)
        </button>

        <button onClick={startPvPLocal}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98] mb-3"
          style={{ backgroundColor: theme.secondaryBgColor, color: theme.textColor, border: `1px solid ${theme.hintColor}30` }}>
          👥 Удвох на одному телефоні
        </button>

        <button onClick={createOnlineGame} disabled={loading}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-60"
          style={{ backgroundColor: '#2196F3', color: '#ffffff' }}>
          {loading ? 'Створення...' : '🌐 Гра онлайн (запросити друга)'}
        </button>

        {error && <p className="text-sm mt-2" style={{ color: '#ef4444' }}>{error}</p>}
      </div>
    );
  }

  // PvE or PvP Local board
  if ((mode === 'pve' || mode === 'pvp-local') && localGame) {
    const getLocalStatus = () => {
      if (localGame.winner === 'draw') return '🤝 Нічия!';
      if (localGame.winner === 'X') {
        return mode === 'pve' ? '🎉 Ти переміг!' : '🎉 X переміг!';
      }
      if (localGame.winner === 'O') {
        return mode === 'pve' ? '🤖 Перкі переміг!' : '🎉 O переміг!';
      }
      if (mode === 'pve') {
        return localGame.currentPlayer === 'X' ? '🟢 Твій хід (X)' : '🤖 Хід Перкі...';
      }
      return `🟢 Хід ${localGame.currentPlayer}`;
    };

    return (
      <div className="text-center">
        <style>{cellAnimationStyle}</style>
        <div className="flex justify-between items-center mb-4">
          <div className="text-sm" style={{ color: theme.textColor }}>
            <span className="font-bold">{mode === 'pve' ? firstName : 'Гравець 1'}</span>
            <span className="ml-1" style={{ color: theme.hintColor }}>(X)</span>
          </div>
          <span style={{ color: theme.hintColor }}>vs</span>
          <div className="text-sm" style={{ color: theme.textColor }}>
            <span className="font-bold">{mode === 'pve' ? '🤖 Перкі' : 'Гравець 2'}</span>
            <span className="ml-1" style={{ color: theme.hintColor }}>(O)</span>
          </div>
        </div>

        <p className="text-sm font-medium mb-4" style={{ color: theme.textColor }}>
          {getLocalStatus()}
        </p>

        <div className="inline-grid grid-cols-3 gap-2 mb-4">
          {localGame.board.map((row, ri) =>
            row.map((cell, ci) => (
              <button key={`${ri}-${ci}`} onClick={() => makeLocalMove(ri, ci)}
                disabled={!!cell || localGame.isFinished || (mode === 'pve' && localGame.currentPlayer !== 'X')}
                className={`w-20 h-20 rounded-xl text-3xl font-bold flex items-center justify-center transition-all active:scale-95 disabled:cursor-default ${cell ? 'cell-appear' : ''} ${!cell && !localGame.isFinished && (mode === 'pvp-local' || localGame.currentPlayer === 'X') ? 'cell-my-turn' : ''}`}
                style={{
                  backgroundColor: cell ? (cell === 'X' ? '#EF444415' : '#3B82F615') : theme.bgColor,
                  color: cell === 'X' ? '#EF4444' : cell === 'O' ? '#3B82F6' : theme.hintColor,
                  border: `2px solid ${theme.hintColor}20`,
                }}>
                {cell || ''}
              </button>
            ))
          )}
        </div>

        {localGame.isFinished && (
          <div className="space-y-2">
            <button onClick={mode === 'pve' ? startPvE : startPvPLocal}
              className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98]"
              style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}>
              Ще раз
            </button>
            <button onClick={resetAll} className="text-sm underline" style={{ color: theme.hintColor }}>
              Назад
            </button>
          </div>
        )}

        {!localGame.isFinished && (
          <button onClick={resetAll} className="text-sm underline mt-2" style={{ color: theme.hintColor }}>
            Вийти
          </button>
        )}
      </div>
    );
  }

  // Online PvP: Waiting
  if (mode === 'pvp-online' && game?.status === 'waiting') {
    return (
      <div className="text-center">
        <div className="text-4xl mb-4">⏳</div>
        <h3 className="text-lg font-semibold mb-2" style={{ color: theme.textColor }}>
          Очікування суперника...
        </h3>
        <p className="text-sm mb-4" style={{ color: theme.hintColor }}>
          Надішли посилання другу!
        </p>
        <div className="p-3 rounded-xl mb-4 text-xs break-all" style={{ backgroundColor: theme.secondaryBgColor, color: theme.hintColor }}>
          {game.inviteLink}
        </div>
        <button onClick={copyInviteLink}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98] mb-3"
          style={{ backgroundColor: '#2196F3', color: '#ffffff' }}>
          📋 Копіювати посилання
        </button>
        <button onClick={resetAll} className="text-sm underline" style={{ color: theme.hintColor }}>
          Скасувати
        </button>
      </div>
    );
  }

  // Online PvP: Playing/Finished
  if (mode === 'pvp-online' && game) {
    const getStatusText = () => {
      if (game.status === 'finished') {
        if (!game.winnerId) return '🤝 Нічия!';
        return game.winnerId === game.playerId ? '🎉 Ти переміг!' : '😔 Ти програв';
      }
      return game.isMyTurn ? '🟢 Твій хід' : '🔴 Хід суперника';
    };

    const mySymbol = game.isPlayerX ? 'X' : 'O';

    return (
      <div className="text-center">
        <style>{cellAnimationStyle}</style>
        <div className="flex justify-between items-center mb-4">
          <div className="text-sm" style={{ color: theme.textColor }}>
            <span className="font-bold">{game.player1Name || 'Гравець 1'}</span>
            <span className="ml-1" style={{ color: theme.hintColor }}>(X)</span>
          </div>
          <span style={{ color: theme.hintColor }}>vs</span>
          <div className="text-sm" style={{ color: theme.textColor }}>
            <span className="font-bold">{game.player2Name || 'Гравець 2'}</span>
            <span className="ml-1" style={{ color: theme.hintColor }}>(O)</span>
          </div>
        </div>

        <p className="text-sm font-medium mb-4" style={{ color: theme.textColor }}>
          {getStatusText()} {game.status === 'playing' && `(Ти — ${mySymbol})`}
        </p>

        <div className="inline-grid grid-cols-3 gap-2 mb-4">
          {game.board.map((row, ri) =>
            row.map((cell, ci) => (
              <button key={`${ri}-${ci}`} onClick={() => makeOnlineMove(ri, ci)}
                disabled={!!cell || !game.isMyTurn || game.status !== 'playing'}
                className={`w-20 h-20 rounded-xl text-3xl font-bold flex items-center justify-center transition-all active:scale-95 disabled:cursor-default ${cell ? 'cell-appear' : ''} ${!cell && game.isMyTurn && game.status === 'playing' ? 'cell-my-turn' : ''} ${game.status === 'finished' && game.winnerId === game.playerId ? 'cell-win' : ''}`}
                style={{
                  backgroundColor: cell ? (cell === 'X' ? '#EF444415' : '#3B82F615') : theme.bgColor,
                  color: cell === 'X' ? '#EF4444' : cell === 'O' ? '#3B82F6' : theme.hintColor,
                  border: `2px solid ${theme.hintColor}20`,
                }}>
                {cell || ''}
              </button>
            ))
          )}
        </div>

        {game.status === 'finished' && (
          <button onClick={resetAll}
            className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98]"
            style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}>
            Нова гра
          </button>
        )}

        {error && <p className="text-sm mt-2" style={{ color: '#ef4444' }}>{error}</p>}
      </div>
    );
  }

  // Fallback
  return (
    <div className="text-center">
      <button onClick={resetAll} className="py-2 px-4 rounded-xl" style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}>
        Назад
      </button>
    </div>
  );
}
