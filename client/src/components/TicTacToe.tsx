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

const fancyGameStyles = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&display=swap');
.tictactoe-container { font-family: 'Poppins', sans-serif; }
.tictactoe-gradient { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
.tictactoe-cell {
  width: 100px;
  height: 100px;
  background: white;
  border: none;
  border-radius: 12px;
  font-size: 32px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}
.tictactoe-cell:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
}
.tictactoe-cell.x { color: #667eea; }
.tictactoe-cell.o { color: #764ba2; }
.tictactoe-cell:disabled { cursor: not-allowed; }
.tictactoe-status {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 20px;
  margin: 20px auto;
  max-width: 360px;
  color: white;
  text-align: center;
  font-weight: 600;
  font-size: 18px;
}
.tictactoe-mode-btn {
  padding: 12px 24px;
  border: 2px solid white;
  background: transparent;
  color: white;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
}
.tictactoe-mode-btn.active {
  background: white;
  color: #667eea;
}
.tictactoe-mode-btn:hover { transform: scale(1.05); }
.tictactoe-online-box {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 20px;
  margin: 20px auto;
  max-width: 360px;
  color: white;
}
.tictactoe-input {
  width: 100%;
  padding: 12px;
  margin: 8px 0;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  font-weight: 600;
}
.tictactoe-input::placeholder { color: rgba(255, 255, 255, 0.6); }
.tictactoe-primary {
  width: 100%;
  padding: 12px;
  margin-top: 12px;
  background: white;
  color: #667eea;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s ease;
}
.tictactoe-primary:hover {
  transform: scale(1.02);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
}
.tictactoe-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.tictactoe-reset {
  display: block;
  margin: 20px auto;
  padding: 12px 32px;
  background: white;
  color: #667eea;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s ease;
}
.tictactoe-reset:hover { transform: scale(1.05); }
.tictactoe-scoreboard {
  display: flex;
  justify-content: center;
  gap: 40px;
  color: white;
  font-weight: 600;
  margin: 20px 0;
}
.tictactoe-score-number {
  font-size: 32px;
  font-weight: 800;
}
.tictactoe-loading {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top: 3px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;

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
    <div className="tictactoe-container tictactoe-gradient min-h-[720px] w-full overflow-auto flex flex-col rounded-3xl">
      <style>{fancyGameStyles}</style>
      <header className="text-center pt-8 px-4">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">Хрестики-Нулики</h1>
        <p className="text-white text-opacity-80 text-lg">Виберіть режим гри</p>
      </header>

      <main className="flex-1 w-full px-4 pb-8">
        <div className="flex gap-3 justify-center flex-wrap mt-6">
          {([
            { id: 'local', label: '🎮 Локально (2 гравців)' },
            { id: 'ai', label: '🤖 проти AI' },
            { id: 'online', label: '🌐 Онлайн' },
          ] as const).map((entry) => (
            <button
              key={entry.id}
              onClick={() => setSelectedMode(entry.id)}
              className={`tictactoe-mode-btn ${selectedMode === entry.id ? 'active' : ''}`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {selectedMode === 'local' && (
          <div className="block">
            <div className="tictactoe-status" id="status">
              {getLocalStatus()}
            </div>

            <div className="tictactoe-scoreboard">
              <div className="text-center">
                <div>Гравець 1</div>
                <div className="tictactoe-score-number">{localScores.player1}</div>
              </div>
              <div className="text-center">
                <div>Нічиї</div>
                <div className="tictactoe-score-number">{localScores.draws}</div>
              </div>
              <div className="text-center">
                <div>Гравець 2</div>
                <div className="tictactoe-score-number">{localScores.player2}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mx-auto max-w-[320px] mt-10">
              {localBoard.map((cell, index) => (
                <button
                  key={`local-${index}`}
                  className={`tictactoe-cell ${cell === 'X' ? 'x' : ''} ${cell === 'O' ? 'o' : ''}`}
                  onClick={() => handleLocalMove(index)}
                  disabled={!!localWinner || cell !== null}
                >
                  {renderCellValue(cell)}
                </button>
              ))}
            </div>

            <button className="tictactoe-reset" onClick={resetLocalGame}>
              Нова гра
            </button>
          </div>
        )}

        {selectedMode === 'ai' && (
          <div className="block">
            <div className="tictactoe-status">{getAiStatus()}</div>
            <div className="tictactoe-scoreboard">
              <div className="text-center">
                <div>Ти</div>
                <div className="tictactoe-score-number">{aiScores.player}</div>
              </div>
              <div className="text-center">
                <div>Нічиї</div>
                <div className="tictactoe-score-number">{aiScores.draws}</div>
              </div>
              <div className="text-center">
                <div>AI</div>
                <div className="tictactoe-score-number">{aiScores.ai}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mx-auto max-w-[320px] mt-10">
              {aiBoard.map((cell, index) => (
                <button
                  key={`ai-${index}`}
                  className={`tictactoe-cell ${cell === 'X' ? 'x' : ''} ${cell === 'O' ? 'o' : ''}`}
                  onClick={() => handleAiMove(index)}
                  disabled={aiThinking || !!aiWinner || cell !== null}
                >
                  {renderCellValue(cell)}
                </button>
              ))}
            </div>
            <button className="tictactoe-reset" onClick={resetAiGame}>
              Нова гра
            </button>
          </div>
        )}

        {selectedMode === 'online' && (
          <div className="tictactoe-online-box">
            <h2 className="text-xl font-bold mb-4">🌐 Грати онлайн</h2>
            {!game && (
              <div>
                <p className="mb-4 text-sm opacity-80">
                  Введіть свій Telegram ID та створіть/приєднайтесь до кімнати
                </p>
                <input
                  className="tictactoe-input"
                  placeholder="Ваш Telegram ID"
                  value={String(telegramId)}
                  readOnly
                />
                <input
                  className="tictactoe-input"
                  placeholder="ID кімнати (залиште порожнім для нової)"
                  value={roomIdInput}
                  onChange={(event) => setRoomIdInput(event.target.value)}
                />
                <button className="tictactoe-primary" onClick={handleJoinRoom} disabled={loading}>
                  {loading ? <span className="tictactoe-loading" /> : 'Створити/Приєднатись'}
                </button>
                {error && <p className="mt-3 text-sm text-red-200">{error}</p>}
              </div>
            )}

            {game && (
              <div>
                <div className="bg-white/10 p-3 rounded-lg mb-4 text-center">
                  <p className="text-sm opacity-80">ID кімнати:</p>
                  <p className="font-mono text-lg">{game.gameId}</p>
                </div>
                <div className="text-center mb-4 text-sm opacity-80">
                  {onlineStatusText()}
                </div>
                <div className="grid grid-cols-3 gap-3 mx-auto max-w-[320px]">
                  {flattenedOnlineBoard.map((cell, index) => (
                    <button
                      key={`online-${index}`}
                      className={`tictactoe-cell ${cell === 'X' ? 'x' : ''} ${cell === 'O' ? 'o' : ''}`}
                      onClick={() => handleOnlineCellClick(index)}
                      disabled={game.status !== 'playing' || !game.isMyTurn || cell !== null}
                    >
                      {renderCellValue(cell)}
                    </button>
                  ))}
                </div>
                <button className="tictactoe-reset" onClick={resetGame}>
                  Покинути кімнату
                </button>
                <button className="tictactoe-primary" onClick={copyInviteLink}>
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
