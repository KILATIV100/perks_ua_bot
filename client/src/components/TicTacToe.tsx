import { useState, useEffect, useCallback, useMemo } from 'react';
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
type Mode = 'local' | 'ai' | 'online';

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

const scoreLabelStyle = (color: string) => ({
  color,
});

export function TicTacToe({ apiUrl, telegramId, firstName, botUsername: _botUsername, gameIdFromUrl, theme, mode = 'online' }: TicTacToeProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<Mode>(mode === 'offline' ? 'local' : 'online');
  const [localBoard, setLocalBoard] = useState<CellValue[]>(Array(9).fill(null));
  const [localTurn, setLocalTurn] = useState<'X' | 'O'>('X');
  const [localWinner, setLocalWinner] = useState<'X' | 'O' | 'draw' | null>(null);
  const [localScores, setLocalScores] = useState({ player1: 0, player2: 0, draws: 0 });
  const [aiBoard, setAiBoard] = useState<CellValue[]>(Array(9).fill(null));
  const [aiWinner, setAiWinner] = useState<'X' | 'O' | 'draw' | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiScores, setAiScores] = useState({ player: 0, ai: 0, draws: 0 });
  const [roomIdInput, setRoomIdInput] = useState('');

  useEffect(() => {
    setSelectedMode(mode === 'offline' ? 'local' : 'online');
  }, [mode]);

  const flattenedOnlineBoard = useMemo(() => {
    if (!game) return Array(9).fill(null) as CellValue[];
    return game.board.flat();
  }, [game]);

  const checkWinner = (board: CellValue[]): 'X' | 'O' | null => {
    const lines = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ];

    for (const line of lines) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }

    return null;
  };

  const isBoardFull = (board: CellValue[]) => board.every(cell => cell !== null);

  const resetLocalGame = () => {
    setLocalBoard(Array(9).fill(null));
    setLocalTurn('X');
    setLocalWinner(null);
  };

  const resetAiGame = () => {
    setAiBoard(Array(9).fill(null));
    setAiWinner(null);
    setAiThinking(false);
  };

  // Connect to Socket.IO (online mode only)
  useEffect(() => {
    if (selectedMode !== 'online') return;
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
  }, [apiUrl, selectedMode, telegramId]);

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

  const handleLocalMove = (index: number) => {
    if (localWinner || localBoard[index]) return;
    const nextBoard = [...localBoard];
    nextBoard[index] = localTurn;
    const winner = checkWinner(nextBoard);
    if (winner) {
      setLocalWinner(winner);
      setLocalScores(prev => ({
        ...prev,
        player1: winner === 'X' ? prev.player1 + 1 : prev.player1,
        player2: winner === 'O' ? prev.player2 + 1 : prev.player2,
      }));
    } else if (isBoardFull(nextBoard)) {
      setLocalWinner('draw');
      setLocalScores(prev => ({ ...prev, draws: prev.draws + 1 }));
    } else {
      setLocalTurn(prev => (prev === 'X' ? 'O' : 'X'));
    }
    setLocalBoard(nextBoard);
  };

  const evaluateMove = (board: CellValue[], index: number) => {
    const testBoard = [...board];
    testBoard[index] = 'O';
    if (checkWinner(testBoard) === 'O') return 100;
    testBoard[index] = 'X';
    if (checkWinner(testBoard) === 'X') return 90;
    testBoard[index] = 'O';
    return 10;
  };

  const getAiMove = (board: CellValue[]) => {
    const emptyCells = board.map((cell, index) => (cell === null ? index : null)).filter((val): val is number => val !== null);
    if (!emptyCells.length) return null;
    if (Math.random() < 0.7) {
      const scored = emptyCells.map(index => ({ index, score: evaluateMove(board, index) }));
      scored.sort((a, b) => b.score - a.score);
      return scored[0].index;
    }
    return emptyCells[Math.floor(Math.random() * emptyCells.length)];
  };

  const handleAiMove = (index: number) => {
    if (aiWinner || aiThinking || aiBoard[index]) return;
    const nextBoard = [...aiBoard];
    nextBoard[index] = 'X';
    const winner = checkWinner(nextBoard);
    if (winner) {
      setAiWinner('X');
      setAiScores(prev => ({ ...prev, player: prev.player + 1 }));
      setAiBoard(nextBoard);
      return;
    }
    if (isBoardFull(nextBoard)) {
      setAiWinner('draw');
      setAiScores(prev => ({ ...prev, draws: prev.draws + 1 }));
      setAiBoard(nextBoard);
      return;
    }

    setAiThinking(true);
    setAiBoard(nextBoard);
    setTimeout(() => {
      const aiMove = getAiMove(nextBoard);
      if (aiMove === null) {
        setAiThinking(false);
        return;
      }
      const boardAfterAi = [...nextBoard];
      boardAfterAi[aiMove] = 'O';
      const aiWinnerResult = checkWinner(boardAfterAi);
      if (aiWinnerResult) {
        setAiWinner('O');
        setAiScores(prev => ({ ...prev, ai: prev.ai + 1 }));
      } else if (isBoardFull(boardAfterAi)) {
        setAiWinner('draw');
        setAiScores(prev => ({ ...prev, draws: prev.draws + 1 }));
      }
      setAiBoard(boardAfterAi);
      setAiThinking(false);
    }, 600);
  };

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
    setRoomIdInput('');
  }, []);

  const copyInviteLink = useCallback(() => {
    if (!game?.inviteLink) return;
    navigator.clipboard.writeText(game.inviteLink).catch(() => {});
  }, [game]);

  const renderCellValue = (value: CellValue) => value ?? '';

  const getLocalStatus = () => {
    if (localWinner) {
      if (localWinner === 'draw') return 'Нічия! 🤝';
      return `${localWinner === 'X' ? 'Гравець 1' : 'Гравець 2'} перемагає! 🎉`;
    }
    return `${localTurn === 'X' ? 'Гравець 1' : 'Гравець 2'} (${localTurn}) ходить`;
  };

  const getAiStatus = () => {
    if (aiWinner) {
      if (aiWinner === 'draw') return 'Нічия! 🤝';
      return aiWinner === 'X' ? 'Ти перемагаєш! 🎉' : 'AI перемагає! 🤖';
    }
    if (aiThinking) return 'AI думає...';
    return 'Твій хід (X)';
  };

  const onlineStatusText = () => {
    if (!game) return 'Введіть свій Telegram ID та створіть/приєднайтесь до кімнати';
    if (game.status === 'waiting') return 'Чекаємо на суперника...';
    if (game.status === 'finished') return game.winnerId ? 'Гра закінчена! Є переможець.' : 'Гра закінчена! Нічия!';
    return game.isMyTurn ? 'Твій хід!' : 'Хід суперника...';
  };

  const handleOnlineCellClick = (index: number) => {
    if (!game || game.status !== 'playing') return;
    if (!game.isMyTurn) return;
    const row = Math.floor(index / 3);
    const col = index % 3;
    makeMove(row, col);
  };

  const handleJoinRoom = async () => {
    if (!roomIdInput.trim()) {
      await createGame();
      return;
    }
    await joinGame(roomIdInput.trim());
  };

  return (
    <div className="space-y-6">
      <header className="text-center">
        <h1 className="text-2xl font-bold mb-2" style={{ color: theme.textColor }}>Хрестики-Нулики</h1>
        <p className="text-sm" style={{ color: theme.hintColor }}>Виберіть режим гри</p>
      </header>

      <main className="space-y-6">
        <div className="flex gap-3 justify-center flex-wrap">
          {([
            { id: 'local', label: '🎮 Локально (2 гравців)' },
            { id: 'ai', label: '🤖 проти AI' },
            { id: 'online', label: '🌐 Онлайн' },
          ] as const).map((entry) => (
            <button
              key={entry.id}
              onClick={() => setSelectedMode(entry.id)}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
              style={{
                backgroundColor: selectedMode === entry.id ? theme.buttonColor : theme.secondaryBgColor,
                color: selectedMode === entry.id ? theme.buttonTextColor : theme.textColor,
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {selectedMode === 'local' && (
          <div className="p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
            <div className="text-center mb-4 text-sm font-medium" style={{ color: theme.textColor }}>
              {getLocalStatus()}
            </div>

            <div className="flex justify-center gap-8 mb-6">
              <div className="text-center">
                <div style={scoreLabelStyle(theme.hintColor)}>Гравець 1</div>
                <div className="text-2xl font-bold" style={{ color: theme.textColor }}>{localScores.player1}</div>
              </div>
              <div className="text-center">
                <div style={scoreLabelStyle(theme.hintColor)}>Нічиї</div>
                <div className="text-2xl font-bold" style={{ color: theme.textColor }}>{localScores.draws}</div>
              </div>
              <div className="text-center">
                <div style={scoreLabelStyle(theme.hintColor)}>Гравець 2</div>
                <div className="text-2xl font-bold" style={{ color: theme.textColor }}>{localScores.player2}</div>
              </div>
            </div>

            <div className="inline-grid grid-cols-3 gap-3 mx-auto">
              {localBoard.map((cell, index) => (
                <button
                  key={`local-${index}`}
                  className="w-20 h-20 rounded-xl text-3xl font-bold flex items-center justify-center transition-all active:scale-95 disabled:cursor-default"
                  onClick={() => handleLocalMove(index)}
                  disabled={!!localWinner || cell !== null}
                  style={{
                    backgroundColor: theme.secondaryBgColor,
                    color: cell === 'X' ? '#667eea' : cell === 'O' ? '#764ba2' : theme.textColor,
                    border: `2px solid ${theme.hintColor}20`,
                  }}
                >
                  {renderCellValue(cell)}
                </button>
              ))}
            </div>

            <button
              className="mt-6 w-full py-3 rounded-xl font-medium transition-all active:scale-[0.98]"
              style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
              onClick={resetLocalGame}
            >
              Нова гра
            </button>
          </div>
        )}

        {selectedMode === 'ai' && (
          <div className="p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
            <div className="text-center mb-4 text-sm font-medium" style={{ color: theme.textColor }}>
              {getAiStatus()}
            </div>
            <div className="flex justify-center gap-8 mb-6">
              <div className="text-center">
                <div style={scoreLabelStyle(theme.hintColor)}>Ти</div>
                <div className="text-2xl font-bold" style={{ color: theme.textColor }}>{aiScores.player}</div>
              </div>
              <div className="text-center">
                <div style={scoreLabelStyle(theme.hintColor)}>Нічиї</div>
                <div className="text-2xl font-bold" style={{ color: theme.textColor }}>{aiScores.draws}</div>
              </div>
              <div className="text-center">
                <div style={scoreLabelStyle(theme.hintColor)}>AI</div>
                <div className="text-2xl font-bold" style={{ color: theme.textColor }}>{aiScores.ai}</div>
              </div>
            </div>
            <div className="inline-grid grid-cols-3 gap-3 mx-auto">
              {aiBoard.map((cell, index) => (
                <button
                  key={`ai-${index}`}
                  className="w-20 h-20 rounded-xl text-3xl font-bold flex items-center justify-center transition-all active:scale-95 disabled:cursor-default"
                  onClick={() => handleAiMove(index)}
                  disabled={aiThinking || !!aiWinner || cell !== null}
                  style={{
                    backgroundColor: theme.secondaryBgColor,
                    color: cell === 'X' ? '#667eea' : cell === 'O' ? '#764ba2' : theme.textColor,
                    border: `2px solid ${theme.hintColor}20`,
                  }}
                >
                  {renderCellValue(cell)}
                </button>
              ))}
            </div>
            <button
              className="mt-6 w-full py-3 rounded-xl font-medium transition-all active:scale-[0.98]"
              style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
              onClick={resetAiGame}
            >
              Нова гра
            </button>
          </div>
        )}

        {selectedMode === 'online' && (
          <div className="p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
            <h2 className="text-lg font-bold mb-4" style={{ color: theme.textColor }}>🌐 Грати онлайн</h2>
            {!game && (
              <div>
                <p className="mb-4 text-sm" style={{ color: theme.hintColor }}>
                  Введіть свій Telegram ID та створіть/приєднайтесь до кімнати
                </p>
                <input
                  className="w-full rounded-xl px-3 py-2 text-sm mb-2"
                  placeholder="Ваш Telegram ID"
                  value={String(telegramId)}
                  readOnly
                  style={{ backgroundColor: theme.secondaryBgColor, color: theme.textColor }}
                />
                <input
                  className="w-full rounded-xl px-3 py-2 text-sm"
                  placeholder="ID кімнати (залиште порожнім для нової)"
                  value={roomIdInput}
                  onChange={(event) => setRoomIdInput(event.target.value)}
                  style={{ backgroundColor: theme.secondaryBgColor, color: theme.textColor }}
                />
                <button
                  className="mt-3 w-full py-3 rounded-xl font-medium transition-all active:scale-[0.98]"
                  style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
                  onClick={handleJoinRoom}
                  disabled={loading}
                >
                  {loading ? 'Підключаємо...' : 'Створити/Приєднатись'}
                </button>
                {error && <p className="mt-3 text-sm text-red-200">{error}</p>}
              </div>
            )}

            {game && (
              <div>
                <div className="p-3 rounded-lg mb-4 text-center" style={{ backgroundColor: theme.secondaryBgColor }}>
                  <p className="text-sm" style={{ color: theme.hintColor }}>ID кімнати:</p>
                  <p className="font-mono text-lg" style={{ color: theme.textColor }}>{game.gameId}</p>
                </div>
                <div className="text-center mb-4 text-sm" style={{ color: theme.hintColor }}>
                  {onlineStatusText()}
                </div>
                <div className="inline-grid grid-cols-3 gap-3 mx-auto">
                  {flattenedOnlineBoard.map((cell, index) => (
                    <button
                      key={`online-${index}`}
                      className="w-20 h-20 rounded-xl text-3xl font-bold flex items-center justify-center transition-all active:scale-95 disabled:cursor-default"
                      onClick={() => handleOnlineCellClick(index)}
                      disabled={game.status !== 'playing' || !game.isMyTurn || cell !== null}
                      style={{
                        backgroundColor: theme.secondaryBgColor,
                        color: cell === 'X' ? '#667eea' : cell === 'O' ? '#764ba2' : theme.textColor,
                        border: `2px solid ${theme.hintColor}20`,
                      }}
                    >
                      {renderCellValue(cell)}
                    </button>
                  ))}
                </div>
                <button
                  className="mt-6 w-full py-3 rounded-xl font-medium transition-all active:scale-[0.98]"
                  style={{ backgroundColor: theme.secondaryBgColor, color: theme.textColor }}
                  onClick={resetGame}
                >
                  Покинути кімнату
                </button>
                <button
                  className="mt-3 w-full py-3 rounded-xl font-medium transition-all active:scale-[0.98]"
                  style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
                  onClick={copyInviteLink}
                >
                  📋 Копіювати посилання
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
