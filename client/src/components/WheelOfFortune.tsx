import { useState, useCallback } from 'react';

interface WheelOfFortuneProps {
  onSpin: () => Promise<{ reward: number; newBalance: number } | null>;
  canSpin: boolean;
  nextSpinAt: string | null;
  theme: {
    bgColor: string;
    textColor: string;
    hintColor: string;
    buttonColor: string;
    buttonTextColor: string;
    secondaryBgColor: string;
  };
}

// Wheel segments with colors
const SEGMENTS = [
  { value: 5, color: '#FFD700', label: '5' },
  { value: 10, color: '#FFA500', label: '10' },
  { value: 15, color: '#FF6347', label: '15' },
  { value: 5, color: '#FFD700', label: '5' },
  { value: 10, color: '#FFA500', label: '10' },
  { value: 15, color: '#FF6347', label: '15' },
  { value: 5, color: '#FFD700', label: '5' },
  { value: 10, color: '#FFA500', label: '10' },
];

export function WheelOfFortune({ onSpin, canSpin, nextSpinAt, theme }: WheelOfFortuneProps) {
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);

  const formatTimeRemaining = useCallback(() => {
    if (!nextSpinAt) return null;
    const next = new Date(nextSpinAt);
    const now = new Date();
    const diffMs = next.getTime() - now.getTime();

    if (diffMs <= 0) return null;

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    return `${hours}г ${minutes}хв`;
  }, [nextSpinAt]);

  const handleSpin = async () => {
    if (isSpinning || !canSpin) return;

    setIsSpinning(true);
    setShowResult(false);
    setResult(null);

    // Start spinning animation
    const spinDegrees = 360 * 5 + Math.random() * 360; // 5 full rotations + random
    setRotation(prev => prev + spinDegrees);

    // Call API
    const spinResult = await onSpin();

    // Wait for animation to complete
    setTimeout(() => {
      setIsSpinning(false);
      if (spinResult) {
        setResult(spinResult.reward);
        setShowResult(true);
      }
    }, 4000);
  };

  const timeRemaining = formatTimeRemaining();

  return (
    <div className="flex flex-col items-center py-6">
      {/* Wheel container */}
      <div className="relative w-72 h-72 mb-8">
        {/* Pointer */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 z-10"
          style={{
            width: 0,
            height: 0,
            borderLeft: '15px solid transparent',
            borderRight: '15px solid transparent',
            borderTop: `25px solid ${theme.buttonColor}`,
          }}
        />

        {/* Wheel */}
        <div
          className="w-full h-full rounded-full relative overflow-hidden shadow-2xl"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: isSpinning ? 'transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)' : 'none',
            border: `4px solid ${theme.buttonColor}`,
          }}
        >
          {SEGMENTS.map((segment, index) => {
            const angle = (360 / SEGMENTS.length) * index;
            const skewAngle = 90 - (360 / SEGMENTS.length);

            return (
              <div
                key={index}
                className="absolute w-1/2 h-1/2 origin-bottom-right"
                style={{
                  transform: `rotate(${angle}deg) skewY(${skewAngle}deg)`,
                  backgroundColor: segment.color,
                  left: 0,
                  top: 0,
                }}
              >
                <span
                  className="absolute text-white font-bold text-lg"
                  style={{
                    transform: `skewY(-${skewAngle}deg) rotate(${360 / SEGMENTS.length / 2}deg)`,
                    left: '60%',
                    top: '20%',
                    textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
                  }}
                >
                  {segment.label}
                </span>
              </div>
            );
          })}

          {/* Center circle */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full flex items-center justify-center shadow-lg z-10"
            style={{ backgroundColor: theme.buttonColor }}
          >
            <span className="text-2xl">🎰</span>
          </div>
        </div>
      </div>

      {/* Result popup */}
      {showResult && result !== null && (
        <div
          className="mb-6 p-4 rounded-2xl text-center animate-bounce"
          style={{ backgroundColor: '#FFD700' }}
        >
          <p className="text-2xl font-bold text-amber-900">
            +{result} балів!
          </p>
        </div>
      )}

      {/* Spin button */}
      <button
        onClick={handleSpin}
        disabled={isSpinning || !canSpin}
        className="py-4 px-12 rounded-2xl font-bold text-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: canSpin ? theme.buttonColor : theme.hintColor,
          color: theme.buttonTextColor,
          boxShadow: canSpin ? '0 4px 15px rgba(139, 90, 43, 0.4)' : 'none',
        }}
      >
        {isSpinning ? 'Крутиться...' : canSpin ? 'Крутити!' : 'Очікуйте'}
      </button>

      {/* Cooldown message */}
      {!canSpin && timeRemaining && (
        <p className="mt-4 text-center" style={{ color: theme.hintColor }}>
          Наступне обертання через: <span className="font-semibold">{timeRemaining}</span>
        </p>
      )}

      {/* Rules */}
      <div
        className="mt-8 p-4 rounded-xl w-full max-w-sm"
        style={{ backgroundColor: theme.bgColor }}
      >
        <h3 className="font-semibold mb-2" style={{ color: theme.textColor }}>
          Правила гри:
        </h3>
        <ul className="text-sm space-y-1" style={{ color: theme.hintColor }}>
          <li>- Крутіть колесо раз на 24 години</li>
          <li>- Виграйте 5, 10 або 15 балів</li>
          <li>- Бали можна обміняти на знижки</li>
        </ul>
      </div>
    </div>
  );
}
