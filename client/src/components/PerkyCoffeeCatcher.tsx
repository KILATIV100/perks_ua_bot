import { useEffect, useMemo, useRef, useState } from 'react';

interface PerkyCoffeeCatcherProps {
  theme: {
    bgColor: string;
    textColor: string;
    hintColor: string;
    buttonColor: string;
    buttonTextColor: string;
    secondaryBgColor: string;
  };
}

type ItemType = 'bean' | 'golden' | 'trash' | 'empty';

interface FallingItem {
  id: number;
  type: ItemType;
  x: number;
  y: number;
  speed: number;
}

const GAME_DURATION = 60;
const SPAWN_INTERVAL_MS = 800;
const TICK_INTERVAL_MS = 40;

const ITEM_CONFIG: Record<ItemType, { emoji: string; points: number; good: boolean }> = {
  bean: { emoji: '🫘', points: 10, good: true },
  golden: { emoji: '✨', points: 25, good: true },
  trash: { emoji: '🗑️', points: -15, good: false },
  empty: { emoji: '📦', points: -10, good: false },
};

export function PerkyCoffeeCatcher({ theme }: PerkyCoffeeCatcherProps) {
  const [status, setStatus] = useState<'idle' | 'playing' | 'over'>('idle');
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [maxCombo, setMaxCombo] = useState(1);
  const [beansCollected, setBeansCollected] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [cupX, setCupX] = useState(50);
  const [items, setItems] = useState<FallingItem[]>([]);
  const comboRef = useRef(1);
  const scoreRef = useRef(0);
  const maxComboRef = useRef(1);
  const beansRef = useRef(0);
  const cupXRef = useRef(50);
  const nextItemId = useRef(1);
  const playAreaRef = useRef<HTMLDivElement | null>(null);
  const tickRef = useRef<number | null>(null);
  const spawnRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const scoreboard = useMemo(
    () => [
      { label: 'ОЧКИ', value: score },
      { label: 'ЧАС', value: timeLeft },
      { label: 'COMBO', value: `x${combo}` },
    ],
    [score, timeLeft, combo]
  );

  const resetState = () => {
    comboRef.current = 1;
    scoreRef.current = 0;
    maxComboRef.current = 1;
    beansRef.current = 0;
    setScore(0);
    setCombo(1);
    setMaxCombo(1);
    setBeansCollected(0);
    setTimeLeft(GAME_DURATION);
    setCupX(50);
    setItems([]);
  };

  const stopLoops = () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    if (spawnRef.current) window.clearInterval(spawnRef.current);
    if (timerRef.current) window.clearInterval(timerRef.current);
    tickRef.current = null;
    spawnRef.current = null;
    timerRef.current = null;
  };

  useEffect(() => () => stopLoops(), []);

  const randomItemType = (): ItemType => {
    const roll = Math.random();
    if (roll < 0.5) return 'bean';
    if (roll < 0.65) return 'golden';
    if (roll < 0.85) return 'trash';
    return 'empty';
  };

  const startGame = () => {
    resetState();
    setStatus('playing');

    tickRef.current = window.setInterval(() => {
      setItems(prevItems => {
        const next: FallingItem[] = [];
        prevItems.forEach(item => {
          const nextItem = { ...item, y: item.y + item.speed };
          const nearCup = nextItem.y > 82 && nextItem.y < 92 && Math.abs(nextItem.x - cupXRef.current) < 10;
          if (nearCup) {
            const config = ITEM_CONFIG[nextItem.type];
            if (config.good) {
              const nextCombo = comboRef.current + 1;
              comboRef.current = nextCombo;
              maxComboRef.current = Math.max(maxComboRef.current, nextCombo);
              scoreRef.current += config.points * nextCombo;
              beansRef.current += 1;
              setCombo(comboRef.current);
              setMaxCombo(maxComboRef.current);
              setScore(scoreRef.current);
              setBeansCollected(beansRef.current);
            } else {
              comboRef.current = 1;
              scoreRef.current += config.points;
              setCombo(1);
              setScore(scoreRef.current);
            }
            return;
          }
          if (nextItem.y <= 105) {
            next.push(nextItem);
          }
        });
        return next;
      });
    }, TICK_INTERVAL_MS);

    spawnRef.current = window.setInterval(() => {
      setItems(prev => [
        ...prev,
        {
          id: nextItemId.current++,
          type: randomItemType(),
          x: Math.random() * 90 + 5,
          y: -5,
          speed: 1 + Math.random() * 1.6,
        },
      ]);
    }, SPAWN_INTERVAL_MS);

    timerRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          stopLoops();
          setStatus('over');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const restartGame = () => {
    stopLoops();
    startGame();
  };

  const endGame = () => {
    stopLoops();
    setStatus('over');
  };

  useEffect(() => {
    if (status !== 'playing') return;
    cupXRef.current = cupX;
  }, [cupX, status]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!playAreaRef.current) return;
    const rect = playAreaRef.current.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(8, Math.min(92, relativeX));
    cupXRef.current = clamped;
    setCupX(clamped);
  };

  return (
    <div className="space-y-4">
      {status === 'idle' && (
        <div className="p-6 rounded-3xl text-center" style={{ backgroundColor: theme.bgColor }}>
          <div className="text-5xl mb-4">☕</div>
          <h2 className="text-2xl font-bold mb-3" style={{ color: theme.textColor }}>
            Perky Coffee Catcher
          </h2>
          <p className="text-sm mb-6" style={{ color: theme.hintColor }}>
            Лови зерна арабіки та уникай сміття. Більше комбо — більше балів!
          </p>
          <div className="grid grid-cols-2 gap-3 text-xs mb-6" style={{ color: theme.hintColor }}>
            <div className="p-3 rounded-xl" style={{ backgroundColor: theme.secondaryBgColor }}>
              🫘 Зерно +10
            </div>
            <div className="p-3 rounded-xl" style={{ backgroundColor: theme.secondaryBgColor }}>
              ✨ Золоте +25
            </div>
            <div className="p-3 rounded-xl" style={{ backgroundColor: theme.secondaryBgColor }}>
              🗑️ Сміття -15
            </div>
            <div className="p-3 rounded-xl" style={{ backgroundColor: theme.secondaryBgColor }}>
              📦 Порожній -10
            </div>
          </div>
          <button
            onClick={startGame}
            className="w-full py-3 rounded-2xl font-bold text-base transition-all active:scale-[0.98]"
            style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
          >
            🎮 Почати гру
          </button>
        </div>
      )}

      {status !== 'idle' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {scoreboard.map(stat => (
              <div key={stat.label} className="p-3 rounded-2xl text-center" style={{ backgroundColor: theme.bgColor }}>
                <p className="text-xs font-semibold" style={{ color: theme.hintColor }}>{stat.label}</p>
                <p className="text-lg font-bold" style={{ color: theme.textColor }}>{stat.value}</p>
              </div>
            ))}
          </div>

          <div
            ref={playAreaRef}
            className="relative overflow-hidden rounded-3xl h-[420px]"
            style={{ background: 'linear-gradient(180deg, #1a0a05 0%, #2d1810 50%, #3d2218 100%)' }}
            onPointerMove={handlePointerMove}
          >
            {items.map(item => (
              <div
                key={item.id}
                className="absolute text-2xl"
                style={{
                  left: `${item.x}%`,
                  top: `${item.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {ITEM_CONFIG[item.type].emoji}
              </div>
            ))}

            <div
              className="absolute bottom-3 text-5xl"
              style={{
                left: `${cupX}%`,
                transform: 'translateX(-50%)',
              }}
            >
              ☕
            </div>
          </div>

          {status === 'playing' && (
            <button
              onClick={endGame}
              className="w-full py-3 rounded-2xl font-bold text-base transition-all active:scale-[0.98]"
              style={{ backgroundColor: theme.secondaryBgColor, color: theme.textColor }}
            >
              Завершити гру
            </button>
          )}
        </div>
      )}

      {status === 'over' && (
        <div className="p-6 rounded-3xl text-center" style={{ backgroundColor: theme.bgColor }}>
          <h3 className="text-2xl font-bold mb-2" style={{ color: theme.textColor }}>Гра завершена!</h3>
          <p className="text-sm mb-4" style={{ color: theme.hintColor }}>
            Твій результат: {score} очок
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm mb-6" style={{ color: theme.textColor }}>
            <div className="p-3 rounded-xl" style={{ backgroundColor: theme.secondaryBgColor }}>
              Зібрано зерен: {beansCollected}
            </div>
            <div className="p-3 rounded-xl" style={{ backgroundColor: theme.secondaryBgColor }}>
              Макс. combo: x{maxCombo}
            </div>
          </div>
          <button
            onClick={restartGame}
            className="w-full py-3 rounded-2xl font-bold text-base transition-all active:scale-[0.98]"
            style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
          >
            🔄 Грати знову
          </button>
        </div>
      )}
    </div>
  );
}
