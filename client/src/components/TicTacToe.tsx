import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';

interface TicTacToeProps {
  apiUrl: string;
  telegramId: number;
  firstName: string;
  botUsername: string;
  gameIdFromUrl?: string | null;
  mode?: 'online' | 'offline';
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

export function TicTacToe({ apiUrl, telegramId, firstName, botUsername: _botUsername, gameIdFromUrl, theme, mode = 'online' }: TicTacToeProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [offlineBoard, setOfflineBoard] = useState<Board>(emptyBoard);
  const [offlineTurn, setOfflineTurn] = useState<'X' | 'O'>('X');
  const [offlineWinner, setOfflineWinner] = useState<'X' | 'O' | 'draw' | null>(null);

  const checkOfflineWinner = (board: Board): 'X' | 'O' | 'draw' | null => {
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

    const isFull = board.every(row => row.every(cell => cell !== null));
    return isFull ? 'draw' : null;
  };

  // Connect to Socket.IO (online mode only)
  useEffect(() => {
    if (mode !== 'online') return;
    const s = io(apiUrl, {
      transports: ['websocket'],
      query: { telegramId: String(telegramId) },
    });

    s.on('connect', () => {
      console.log('[TicTacToe] Socket connected');
    });

    s.on('game:started', () => {
      setGame(prev => prev ? { ...prev, status: 'playing' } : null);
    });

    s.on('game:update', (data: {
      board: Board;
      status: string;
      winnerId: string | null;
      player1?: { id: string; firstName: string; telegramId: string };
      player2?: { id: string; firstName: string; telegramId: string };
    }) => {
      setGame(prev => {
        if (!prev) return null;
        const moveCount = data.board.flat().filter(c => c !== null).length;
        const isXTurn = moveCount % 2 === 0;
        const isMyTurn = prev.isPlayerX ? isXTurn : !isXTurn;

        return {
          ...prev,
          board: data.board,
          status: data.status === 'FINISHED' ? 'finished' : 'playing',
          winnerId: data.winnerId,
          isMyTurn: data.status === 'FINISHED' ? false : isMyTurn,
          player1Name: data.player1?.firstName || prev.player1Name,
          player2Name: data.player2?.firstName || prev.player2Name,
        };
      });
    });

    s.on('game_over', (data: {
      board: Board;
      winnerId: string | null;
      player1?: { id: string; firstName: string; telegramId: string };
      player2?: { id: string; firstName: string; telegramId: string };
    }) => {
      setGame(prev => {
        if (!prev) return null;
        return {
          ...prev,
          board: data.board,
          status: 'finished',
          winnerId: data.winnerId,
          isMyTurn: false,
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

    return () => {
      s.disconnect();
    };
  }, [apiUrl, mode, telegramId]);

  // Auto-join game from URL param
  useEffect(() => {
    if (gameIdFromUrl && socket) {
      joinGame(gameIdFromUrl);
    }
  }, [gameIdFromUrl, socket]);

  const createGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.post(`${apiUrl}/api/games/create`, {
        telegramId: String(telegramId),
      });

      const { game: createdGame, inviteLink } = response.data;

      // Fetch full game data
      const fullGame = await axios.get(`${apiUrl}/api/games/${createdGame.id}`);
      const gameData = fullGame.data.game;

      const newGame: GameState = {
        gameId: createdGame.id,
        board: emptyBoard,
        status: 'waiting',
        playerId: gameData.player1.id,
        isPlayerX: true,
        isMyTurn: true,
        winnerId: null,
        player1Name: firstName,
        player2Name: '',
        inviteLink,
      };

      setGame(newGame);
      socket?.emit('game:join', createdGame.id);
    } catch (err) {
      console.error('[TicTacToe] Create error:', err);
      setError('Не вдалося створити гру');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, telegramId, firstName, socket]);

  const joinGame = useCallback(async (gameId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.post(`${apiUrl}/api/games/join`, {
        telegramId: String(telegramId),
        gameId,
      });

      const gameData = response.data.game;

      // Fetch full game
      const fullGame = await axios.get(`${apiUrl}/api/games/${gameId}`);
      const full = fullGame.data.game;

      const joinedGame: GameState = {
        gameId,
        board: gameData.boardState as Board,
        status: 'playing',
        playerId: full.player2?.id || '',
        isPlayerX: false,
        isMyTurn: false, // X goes first, player2 is O
        winnerId: null,
        player1Name: full.player1?.firstName || 'Гравець 1',
        player2Name: firstName,
        inviteLink: '',
      };

      setGame(joinedGame);
      socket?.emit('game:join', gameId);
    } catch (err: any) {
      console.error('[TicTacToe] Join error:', err);
      setError(err.response?.data?.error || 'Не вдалося приєднатися');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, telegramId, firstName, socket]);

  const makeMove = useCallback((row: number, col: number) => {
    if (!game || !socket) return;
    if (!game.isMyTurn || game.status !== 'playing') return;
    if (game.board[row][col] !== null) return;

    socket.emit('make_move', {
      gameId: game.gameId,
      playerId: game.playerId,
      row,
      col,
    });
  }, [game, socket]);

  const resetGame = useCallback(() => {
    setGame(null);
    setError(null);
  }, []);

  const copyInviteLink = useCallback(() => {
    if (!game?.inviteLink) return;
    navigator.clipboard.writeText(game.inviteLink).catch(() => {});
  }, [game]);

  const handleOfflineMove = (row: number, col: number) => {
    if (offlineWinner) return;
    if (offlineBoard[row][col] !== null) return;
    const nextBoard = offlineBoard.map(r => [...r]) as Board;
    nextBoard[row][col] = offlineTurn;
    const winner = checkOfflineWinner(nextBoard);
    setOfflineBoard(nextBoard);
    if (winner) {
      setOfflineWinner(winner);
    } else {
      setOfflineTurn(prev => (prev === 'X' ? 'O' : 'X'));
    }
  };

  const resetOffline = () => {
    setOfflineBoard(emptyBoard);
    setOfflineTurn('X');
    setOfflineWinner(null);
  };

  if (mode === 'offline') {
    const statusText = offlineWinner
      ? offlineWinner === 'draw'
        ? '🤝 Нічия!'
        : `Переміг ${offlineWinner}`
      : `Хід: ${offlineTurn}`;

    return (
      <div className="text-center">
        <style>{cellAnimationStyle}</style>
        <h3 className="text-lg font-semibold mb-2" style={{ color: theme.textColor }}>
          Хрестики-нулики (офлайн)
        </h3>
        <p className="text-sm mb-4" style={{ color: theme.hintColor }}>
          {statusText}
        </p>

        <div className="inline-grid grid-cols-3 gap-2 mb-4">
          {offlineBoard.map((row, ri) =>
            row.map((cell, ci) => (
              <button
                key={`offline-${ri}-${ci}`}
                onClick={() => handleOfflineMove(ri, ci)}
                disabled={!!cell || !!offlineWinner}
                className={`w-20 h-20 rounded-xl text-3xl font-bold flex items-center justify-center transition-all active:scale-95 disabled:cursor-default ${cell ? 'cell-appear' : ''}`}
                style={{
                  backgroundColor: cell ? (cell === 'X' ? '#EF444415' : '#3B82F615') : theme.bgColor,
                  color: cell === 'X' ? '#EF4444' : cell === 'O' ? '#3B82F6' : theme.hintColor,
                  border: `2px solid ${theme.hintColor}20`,
                }}
              >
                {cell || ''}
              </button>
            ))
          )}
        </div>

        <button
          onClick={resetOffline}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98]"
          style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
        >
          Нова гра
        </button>
      </div>
    );
  }

  // Idle state - show create/join buttons
  if (!game) {
    return (
      <div className="text-center">
        <div className="text-4xl mb-4">🎮</div>
        <h3 className="text-lg font-semibold mb-2" style={{ color: theme.textColor }}>
          Хрестики-нулики
        </h3>
        <p className="text-sm mb-6" style={{ color: theme.hintColor }}>
          Грай з друзями онлайн!
        </p>

        <button
          onClick={createGame}
          disabled={loading}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-60 mb-3"
          style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
        >
          {loading ? 'Створення...' : 'Створити гру'}
        </button>

        {error && (
          <p className="text-sm mt-2" style={{ color: '#ef4444' }}>{error}</p>
        )}
      </div>
    );
  }

  // Waiting for opponent
  if (game.status === 'waiting') {
    return (
      <div className="text-center">
        <div className="text-4xl mb-4">⏳</div>
        <h3 className="text-lg font-semibold mb-2" style={{ color: theme.textColor }}>
          Очікування суперника...
        </h3>
        <p className="text-sm mb-4" style={{ color: theme.hintColor }}>
          Надішли посилання другу, щоб він приєднався!
        </p>

        <div className="p-3 rounded-xl mb-4 text-xs break-all" style={{ backgroundColor: theme.secondaryBgColor, color: theme.hintColor }}>
          {game.inviteLink}
        </div>

        <button
          onClick={copyInviteLink}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98] mb-3"
          style={{ backgroundColor: '#2196F3', color: '#ffffff' }}
        >
          📋 Копіювати посилання
        </button>

        <button
          onClick={resetGame}
          className="text-sm underline"
          style={{ color: theme.hintColor }}
        >
          Скасувати
        </button>
      </div>
    );
  }

  // Game board
  const getStatusText = () => {
    if (game.status === 'finished') {
      if (!game.winnerId) return '🤝 Нічия!';
      const isWinner = game.winnerId === game.playerId;
      return isWinner ? '🎉 Ти переміг!' : '😔 Ти програв';
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

      {/* Board */}
      <div className="inline-grid grid-cols-3 gap-2 mb-4">
        {game.board.map((row, ri) =>
          row.map((cell, ci) => (
            <button
              key={`${ri}-${ci}`}
              onClick={() => makeMove(ri, ci)}
              disabled={!!cell || !game.isMyTurn || game.status !== 'playing'}
              className={`w-20 h-20 rounded-xl text-3xl font-bold flex items-center justify-center transition-all active:scale-95 disabled:cursor-default ${cell ? 'cell-appear' : ''} ${!cell && game.isMyTurn && game.status === 'playing' ? 'cell-my-turn' : ''} ${game.status === 'finished' && game.winnerId === game.playerId ? 'cell-win' : ''}`}
              style={{
                backgroundColor: cell ? (cell === 'X' ? '#EF444415' : '#3B82F615') : theme.bgColor,
                color: cell === 'X' ? '#EF4444' : cell === 'O' ? '#3B82F6' : theme.hintColor,
                border: `2px solid ${theme.hintColor}20`,
              }}
            >
              {cell || ''}
            </button>
          ))
        )}
      </div>

      {game.status === 'finished' && (
        <button
          onClick={resetGame}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98]"
          style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
        >
          Нова гра
        </button>
      )}

      {error && (
        <p className="text-sm mt-2" style={{ color: '#ef4444' }}>{error}</p>
      )}
    </div>
  );
}
