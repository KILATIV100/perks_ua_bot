import { useRef, useEffect, useState, useCallback } from 'react';

// ── roundRect polyfill for older WebViews (Telegram Android) ─────────────
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (
    x: number, y: number, w: number, h: number, radii?: number | number[],
  ) {
    const r = typeof radii === 'number' ? radii : Array.isArray(radii) ? radii[0] ?? 0 : 0;
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

interface PerkyJumpProps {
  apiUrl: string;
  telegramId?: string;
  onPointsEarned?: (points: number) => void;
}

const GAME_SALT = import.meta.env.VITE_GAME_SALT || 'perkie-default-salt-change-me';

// ── Game constants ────────────────────────────────────────────────────────
const CANVAS_W = 360;
const CANVAS_H = 600;
const GRAVITY = 0.35;
const JUMP_FORCE = -10;
const SPRING_FORCE = -14;
const MOVE_SPEED = 5;
const PLATFORM_W = 70;
const PLATFORM_H = 14;
const PLAYER_W = 36;
const PLAYER_H = 36;
const PLATFORM_GAP = 85;
const PLATFORM_COUNT = Math.ceil(CANVAS_H / PLATFORM_GAP) + 2;

type PlatformType = 'normal' | 'moving' | 'spring' | 'breaking';

interface Platform {
  x: number;
  y: number;
  type: PlatformType;
  dx: number; // horizontal velocity for moving platforms
  broken: boolean;
}

// ── SHA-256 hash (WebCrypto) ─────────────────────────────────────────────
async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Component ────────────────────────────────────────────────────────────
export function PerkyJump({ apiUrl, telegramId, onPointsEarned }: PerkyJumpProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'over'>('menu');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    try { return Number(localStorage.getItem('perky_high') || 0); } catch { return 0; }
  });
  const [lastResult, setLastResult] = useState<{ points: number; gamesLeft: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Game state refs (mutable during rAF loop)
  const gameRef = useRef({
    playerX: CANVAS_W / 2 - PLAYER_W / 2,
    playerY: CANVAS_H - 100,
    vy: JUMP_FORCE,
    platforms: [] as Platform[],
    score: 0,
    maxHeight: 0,
    running: false,
    startTime: 0,
    keysDown: new Set<string>(),
    tiltX: 0,
  });

  // ── Platform generation ───────────────────────────────────────────────
  const makePlatform = useCallback((y: number): Platform => {
    const rand = Math.random();
    let type: PlatformType = 'normal';
    if (rand < 0.12) type = 'spring';
    else if (rand < 0.3) type = 'moving';
    else if (rand < 0.38) type = 'breaking';
    return {
      x: Math.random() * (CANVAS_W - PLATFORM_W),
      y,
      type,
      dx: type === 'moving' ? (Math.random() < 0.5 ? 1.5 : -1.5) : 0,
      broken: false,
    };
  }, []);

  const initPlatforms = useCallback(() => {
    const platforms: Platform[] = [];
    // Solid ground platform
    platforms.push({ x: CANVAS_W / 2 - PLATFORM_W / 2, y: CANVAS_H - 40, type: 'normal', dx: 0, broken: false });
    for (let i = 1; i < PLATFORM_COUNT; i++) {
      platforms.push(makePlatform(CANVAS_H - 40 - i * PLATFORM_GAP));
    }
    return platforms;
  }, [makePlatform]);

  // ── Submit score ──────────────────────────────────────────────────────
  const submitScore = useCallback(async (finalScore: number, durationMs: number) => {
    if (!telegramId || finalScore <= 0) return;
    setSubmitting(true);
    try {
      const timestamp = Date.now();
      const hash = await sha256(`${finalScore}${GAME_SALT}${timestamp}`);
      const res = await fetch(`${apiUrl}/api/games/submit-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId, score: finalScore, timestamp, hash, gameDurationMs: durationMs }),
      });
      if (res.ok) {
        const data = await res.json();
        setLastResult({ points: data.pointsAwarded || 0, gamesLeft: data.scoringGamesLeft ?? 0 });
        if (data.pointsAwarded > 0) onPointsEarned?.(data.pointsAwarded);
      }
    } catch (e) {
      console.error('Score submit failed:', e);
    } finally {
      setSubmitting(false);
    }
  }, [apiUrl, telegramId, onPointsEarned]);

  // ── Start game ────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    const g = gameRef.current;
    g.playerX = CANVAS_W / 2 - PLAYER_W / 2;
    g.playerY = CANVAS_H - 100;
    g.vy = JUMP_FORCE;
    g.platforms = initPlatforms();
    g.score = 0;
    g.maxHeight = 0;
    g.running = true;
    g.startTime = Date.now();
    g.keysDown.clear();
    g.tiltX = 0;
    setScore(0);
    setLastResult(null);
    setGameState('playing');
  }, [initPlatforms]);

  // ── Game loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let animId = 0;

    // Input handlers
    const onKeyDown = (e: KeyboardEvent) => { gameRef.current.keysDown.add(e.key); };
    const onKeyUp = (e: KeyboardEvent) => { gameRef.current.keysDown.delete(e.key); };
    const onDeviceMotion = (e: DeviceMotionEvent) => {
      if (e.accelerationIncludingGravity?.x != null) {
        gameRef.current.tiltX = e.accelerationIncludingGravity.x;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('devicemotion', onDeviceMotion);

    const draw = () => {
      const g = gameRef.current;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      // Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      bgGrad.addColorStop(0, '#0f0c29');
      bgGrad.addColorStop(0.5, '#302b63');
      bgGrad.addColorStop(1, '#24243e');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      if (!g.running) {
        // Menu / Game Over screen
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        if (gameState === 'over') {
          ctx.fillText('Гру закінчено!', CANVAS_W / 2, CANVAS_H / 2 - 40);
          ctx.font = '20px sans-serif';
          ctx.fillText(`Рахунок: ${g.score}`, CANVAS_W / 2, CANVAS_H / 2);
        } else {
          ctx.fillText('Perky Jump ☕', CANVAS_W / 2, CANVAS_H / 2 - 40);
          ctx.font = '16px sans-serif';
          ctx.fillStyle = '#ccc';
          ctx.fillText('Натисніть "Грати"', CANVAS_W / 2, CANVAS_H / 2 + 10);
        }
        animId = requestAnimationFrame(draw);
        return;
      }

      // ── Physics ─────────────────────────────────────────────────────
      // Horizontal movement
      let dx = 0;
      if (g.keysDown.has('ArrowLeft') || g.keysDown.has('a')) dx -= MOVE_SPEED;
      if (g.keysDown.has('ArrowRight') || g.keysDown.has('d')) dx += MOVE_SPEED;
      // Tilt for mobile
      if (Math.abs(g.tiltX) > 1) dx += g.tiltX * 0.7;

      g.playerX += dx;
      // Wrap around screen edges
      if (g.playerX + PLAYER_W < 0) g.playerX = CANVAS_W;
      if (g.playerX > CANVAS_W) g.playerX = -PLAYER_W;

      // Vertical
      g.vy += GRAVITY;
      g.playerY += g.vy;

      // Camera scroll when player goes above midpoint
      const scrollThreshold = CANVAS_H * 0.4;
      if (g.playerY < scrollThreshold) {
        const shift = scrollThreshold - g.playerY;
        g.playerY = scrollThreshold;
        g.maxHeight += shift;
        g.score = Math.floor(g.maxHeight / 10);
        setScore(g.score);

        // Move platforms down
        for (const p of g.platforms) {
          p.y += shift;
        }

        // Remove off-screen platforms, add new ones on top
        g.platforms = g.platforms.filter(p => p.y < CANVAS_H + 50);
        while (g.platforms.length < PLATFORM_COUNT) {
          const topY = Math.min(...g.platforms.map(p => p.y));
          g.platforms.push(makePlatform(topY - PLATFORM_GAP));
        }
      }

      // Collision with platforms (only when falling)
      if (g.vy > 0) {
        for (const p of g.platforms) {
          if (p.broken) continue;
          const playerBottom = g.playerY + PLAYER_H;
          const prevBottom = playerBottom - g.vy;
          if (
            prevBottom <= p.y &&
            playerBottom >= p.y &&
            g.playerX + PLAYER_W > p.x + 5 &&
            g.playerX < p.x + PLATFORM_W - 5
          ) {
            if (p.type === 'breaking') {
              p.broken = true;
              continue;
            }
            g.vy = p.type === 'spring' ? SPRING_FORCE : JUMP_FORCE;
            g.playerY = p.y - PLAYER_H;
            break;
          }
        }
      }

      // Moving platforms
      for (const p of g.platforms) {
        if (p.type === 'moving' && !p.broken) {
          p.x += p.dx;
          if (p.x <= 0 || p.x + PLATFORM_W >= CANVAS_W) p.dx *= -1;
        }
      }

      // Game over — fell below screen
      if (g.playerY > CANVAS_H + 50) {
        g.running = false;
        setGameState('over');
        const duration = Date.now() - g.startTime;
        // Save high score
        if (g.score > highScore) {
          setHighScore(g.score);
          try { localStorage.setItem('perky_high', String(g.score)); } catch {}
        }
        submitScore(g.score, duration);
        animId = requestAnimationFrame(draw);
        return;
      }

      // ── Draw platforms ──────────────────────────────────────────────
      for (const p of g.platforms) {
        if (p.broken) {
          // Breaking platform fragments
          ctx.fillStyle = '#555';
          ctx.fillRect(p.x, p.y + 4, PLATFORM_W * 0.3, 4);
          ctx.fillRect(p.x + PLATFORM_W * 0.5, p.y + 8, PLATFORM_W * 0.3, 4);
          continue;
        }

        ctx.save();
        const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + PLATFORM_H);
        if (p.type === 'spring') {
          grad.addColorStop(0, '#00e676');
          grad.addColorStop(1, '#00c853');
        } else if (p.type === 'moving') {
          grad.addColorStop(0, '#42a5f5');
          grad.addColorStop(1, '#1e88e5');
        } else if (p.type === 'breaking') {
          grad.addColorStop(0, '#ef5350');
          grad.addColorStop(1, '#c62828');
        } else {
          grad.addColorStop(0, '#ffe0b2');
          grad.addColorStop(1, '#ffcc80');
        }

        ctx.fillStyle = grad;
        ctx.beginPath();
        const r = 6;
        ctx.roundRect(p.x, p.y, PLATFORM_W, PLATFORM_H, r);
        ctx.fill();

        // Spring indicator
        if (p.type === 'spring') {
          ctx.fillStyle = '#fff';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('↑↑', p.x + PLATFORM_W / 2, p.y + 11);
        }
        ctx.restore();
      }

      // ── Draw player (coffee cup) ───────────────────────────────────
      const px = g.playerX;
      const py = g.playerY;
      // Cup body
      ctx.fillStyle = '#8B5A2B';
      ctx.beginPath();
      ctx.roundRect(px + 4, py + 6, PLAYER_W - 8, PLAYER_H - 8, 4);
      ctx.fill();
      // Cup foam
      ctx.fillStyle = '#FFE0B2';
      ctx.beginPath();
      ctx.ellipse(px + PLAYER_W / 2, py + 8, (PLAYER_W - 8) / 2, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px + 12, py + 18, 4, 0, Math.PI * 2);
      ctx.arc(px + 24, py + 18, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(px + 12, py + 18, 2, 0, Math.PI * 2);
      ctx.arc(px + 24, py + 18, 2, 0, Math.PI * 2);
      ctx.fill();
      // Smile
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px + PLAYER_W / 2, py + 22, 5, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();

      // ── HUD ─────────────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.roundRect(8, 8, 100, 30, 8);
      ctx.fill();
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`☕ ${g.score}`, 18, 29);

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('devicemotion', onDeviceMotion);
    };
  }, [gameState, makePlatform, submitScore, highScore]);

  // ── Touch controls ─────────────────────────────────────────────────────
  const handleTouchStart = useCallback((side: 'left' | 'right') => {
    const key = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    gameRef.current.keysDown.add(key);
  }, []);
  const handleTouchEnd = useCallback((side: 'left' | 'right') => {
    const key = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    gameRef.current.keysDown.delete(key);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="rounded-2xl border border-white/10"
        style={{ maxWidth: '100%', touchAction: 'none' }}
      />

      {/* Touch controls (visible on mobile) */}
      {gameState === 'playing' && (
        <div className="flex gap-4 w-full max-w-[360px]">
          <button
            className="flex-1 py-4 rounded-xl text-2xl font-bold bg-white/10 text-white active:bg-white/20 select-none"
            onTouchStart={() => handleTouchStart('left')}
            onTouchEnd={() => handleTouchEnd('left')}
            onMouseDown={() => handleTouchStart('left')}
            onMouseUp={() => handleTouchEnd('left')}
          >
            ◀
          </button>
          <button
            className="flex-1 py-4 rounded-xl text-2xl font-bold bg-white/10 text-white active:bg-white/20 select-none"
            onTouchStart={() => handleTouchStart('right')}
            onTouchEnd={() => handleTouchEnd('right')}
            onMouseDown={() => handleTouchStart('right')}
            onMouseUp={() => handleTouchEnd('right')}
          >
            ▶
          </button>
        </div>
      )}

      {/* Score & controls */}
      <div className="text-center space-y-2">
        {gameState !== 'playing' && (
          <>
            <div className="text-sm opacity-70">
              Рекорд: {highScore} | Рахунок: {score}
            </div>
            {lastResult && (
              <div className="text-sm">
                {lastResult.points > 0
                  ? `+${lastResult.points} балів! (залишилось ігор: ${lastResult.gamesLeft})`
                  : lastResult.gamesLeft === 0
                    ? 'Ліміт ігор на сьогодні вичерпано'
                    : 'Набери 100+ щоб отримати бали'}
              </div>
            )}
            {submitting && <div className="text-xs opacity-50">Зберігаємо результат...</div>}
            <button
              onClick={startGame}
              disabled={submitting}
              className="px-8 py-3 rounded-xl font-bold text-white transition-all active:scale-95"
              style={{ backgroundColor: '#8B5A2B' }}
            >
              {gameState === 'over' ? 'Грати знову' : 'Грати'}
            </button>
          </>
        )}
        <div className="text-xs opacity-50">
          100 очок = 1 бал | Макс 5 балів/день
        </div>
      </div>
    </div>
  );
}
