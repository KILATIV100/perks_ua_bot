import { useState, useEffect } from 'react';

interface TicTacToeProps {
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
type Mode = 'local' | 'ai';

const scoreLabelStyle = (color: string) => ({
  color,
});

export function TicTacToe({ theme, mode = 'online' }: TicTacToeProps) {
  const [selectedMode, setSelectedMode] = useState<Mode>('local');
  const [localBoard, setLocalBoard] = useState<CellValue[]>(Array(9).fill(null));
  const [localTurn, setLocalTurn] = useState<'X' | 'O'>('X');
  const [localWinner, setLocalWinner] = useState<'X' | 'O' | 'draw' | null>(null);
  const [localScores, setLocalScores] = useState({ player1: 0, player2: 0, draws: 0 });
  const [aiBoard, setAiBoard] = useState<CellValue[]>(Array(9).fill(null));
  const [aiWinner, setAiWinner] = useState<'X' | 'O' | 'draw' | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiScores, setAiScores] = useState({ player: 0, ai: 0, draws: 0 });

  useEffect(() => {
    setSelectedMode('local');
  }, [mode]);

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

            <div className="grid grid-cols-3 gap-3 w-full max-w-[300px] mx-auto">
              {localBoard.map((cell, index) => (
                <button
                  key={`local-${index}`}
                  className="aspect-square w-full rounded-xl text-3xl font-bold flex items-center justify-center transition-all active:scale-95 disabled:cursor-default"
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
            <div className="grid grid-cols-3 gap-3 w-full max-w-[300px] mx-auto">
              {aiBoard.map((cell, index) => (
                <button
                  key={`ai-${index}`}
                  className="aspect-square w-full rounded-xl text-3xl font-bold flex items-center justify-center transition-all active:scale-95 disabled:cursor-default"
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

      </main>
    </div>
  );
}
