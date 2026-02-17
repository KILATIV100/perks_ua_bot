import { useEffect, useRef, useCallback, useState } from 'react';

const CANVAS_W = 390;
const CANVAS_H = 650;

const GRAVITY = 0.38;
const JUMP_VY = -12.8;
const PLAYER_W = 52;
const PLAYER_H = 52;
const PLAYER_MOVE_SPEED = 5.2;

// Hitbox is slightly inset from sprite bounds to match mascot body silhouette.
const PLAYER_HITBOX = {
  offsetX: 6,
  offsetY: 5,
  width: PLAYER_W - 12,
  height: PLAYER_H - 10,
};

const CLIENT_SALT = import.meta.env.VITE_GAME_SALT ?? 'perkie-default-salt-change-me';

type PlatformType = 'normal' | 'moving' | 'fragile';

interface Platform {
  x: number;
  y: number;
  width: number;
  height: number;
  type: PlatformType;
  dx: number;
  broken: boolean;
}

interface Player {
  x: number;
  y: number;
  vy: number;
  facing: 'left' | 'right';
}

interface GameState {
  player: Player;
  platforms: Platform[];
  cameraY: number;
  maxHeight: number;
  gameOver: boolean;
  startTime: number;
}

interface PerkieJumpProps {
  telegramId?: string;
  apiUrl?: string;
  onScoreSubmit?: (score: number, pointsAwarded: number) => void;
  mascotSrc?: string;
}

interface LevelConfig {
  level: number;
  minScore: number;
  maxScore: number;
  platformWidth: number;
  gapMin: number;
  gapMax: number;
  movingChance: number;
  fragileChance: number;
  movingSpeed: number;
}

const LEVELS: LevelConfig[] = [
  { level: 1, minScore: 0, maxScore: 999, platformWidth: 110, gapMin: 72, gapMax: 102, movingChance: 0.0, fragileChance: 0.0, movingSpeed: 0 },
  { level: 2, minScore: 1000, maxScore: 2499, platformWidth: 92, gapMin: 86, gapMax: 128, movingChance: 0.35, fragileChance: 0.0, movingSpeed: 1.5 },
  { level: 3, minScore: 2500, maxScore: 4999, platformWidth: 78, gapMin: 98, gapMax: 146, movingChance: 0.4, fragileChance: 0.3, movingSpeed: 1.9 },
  { level: 4, minScore: 5000, maxScore: Number.MAX_SAFE_INTEGER, platformWidth: 66, gapMin: 112, gapMax: 170, movingChance: 0.62, fragileChance: 0.25, movingSpeed: 2.6 },
];

async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getLevelConfig(score: number): LevelConfig {
  return LEVELS.find((l) => score >= l.minScore && score <= l.maxScore) ?? LEVELS[LEVELS.length - 1];
}

function createPlatform(y: number, score: number, difficultyMultiplier: number): Platform {
  const cfg = getLevelConfig(score);

  // Level progression algorithm:
  // 1) Pick current level by score range.
  // 2) Use level probabilities (movingChance/fragileChance).
  // 3) Scale moving speed by difficultyMultiplier to make high-score runs faster.
  const r = Math.random();
  let type: PlatformType = 'normal';
  if (r < cfg.fragileChance) type = 'fragile';
  else if (r < cfg.fragileChance + cfg.movingChance) type = 'moving';

  const width = cfg.platformWidth;
  const speed = cfg.movingSpeed * difficultyMultiplier;

  return {
    x: Math.random() * (CANVAS_W - width),
    y,
    width,
    height: 14,
    type,
    dx: type === 'moving' ? speed * (Math.random() > 0.5 ? 1 : -1) : 0,
    broken: false,
  };
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, '#1b1726');
  grad.addColorStop(1, '#0f0d18');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawPlatform(ctx: CanvasRenderingContext2D, p: Platform, camY: number): void {
  const sy = p.y - camY;
  if (p.broken) return;

  if (p.type === 'fragile') {
    ctx.fillStyle = '#5b3a29';
    ctx.strokeStyle = '#3a2418';
  } else if (p.type === 'moving') {
    ctx.fillStyle = '#e8d3b4';
    ctx.strokeStyle = '#b98c5e';
  } else {
    // Level 1 visual style: milk-foam clouds
    ctx.fillStyle = '#f6eadc';
    ctx.strokeStyle = '#e2c7a0';
  }

  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(p.x, sy, p.width, p.height, 8);
  ctx.fill();
  ctx.stroke();
}

function drawPlayer(ctx: CanvasRenderingContext2D, player: Player, camY: number, mascot: HTMLImageElement | null): void {
  const sx = player.x;
  const sy = player.y - camY;

  if (!mascot) {
    ctx.fillStyle = '#d4a373';
    ctx.fillRect(sx, sy, PLAYER_W, PLAYER_H);
    return;
  }

  ctx.save();
  if (player.facing === 'left') {
    // Horizontal flip so Perkie faces movement direction.
    ctx.translate(sx + PLAYER_W, sy);
    ctx.scale(-1, 1);
    ctx.drawImage(mascot, 0, 0, PLAYER_W, PLAYER_H);
  } else {
    ctx.drawImage(mascot, sx, sy, PLAYER_W, PLAYER_H);
  }
  ctx.restore();
}

function drawControls(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.roundRect(8, CANVAS_H - 80, 72, 64, 12);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(CANVAS_W - 80, CANVAS_H - 80, 72, 64, 12);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('◀', 44, CANVAS_H - 38);
  ctx.fillText('▶', CANVAS_W - 44, CANVAS_H - 38);
}

export function PerkieJump({ telegramId, apiUrl, onScoreSubmit, mascotSrc = '/perkie.png' }: PerkieJumpProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const inputRef = useRef({ left: false, right: false, accelX: 0 });
  const animFrameRef = useRef<number>(0);
  const mascotRef = useRef<HTMLImageElement | null>(null);

  const [gamePhase, setGamePhase] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [isGameOver, setIsGameOver] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pointsEarned, setPointsEarned] = useState(0);

  const submitScore = useCallback(async (value: number, durationMs: number) => {
    if (!telegramId || !apiUrl) return;
    setSubmitting(true);
    try {
      const timestamp = Date.now();
      const hash = await sha256(`${value}${CLIENT_SALT}${timestamp}`);
      const res = await fetch(`${apiUrl}/api/games/submit-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId, score: value, timestamp, hash, gameDurationMs: durationMs }),
      });
      if (res.ok) {
        const data = await res.json() as { pointsAwarded?: number };
        const pts = data.pointsAwarded ?? 0;
        setPointsEarned(pts);
        setSubmitted(true);
        onScoreSubmit?.(value, pts);
      }
    } catch {
      // silent
    } finally {
      setSubmitting(false);
    }
  }, [telegramId, apiUrl, onScoreSubmit]);

  const handleGameOver = useCallback((value: number) => {
    const gs = stateRef.current;
    if (!gs) return;
    const durationMs = Date.now() - gs.startTime;
    setFinalScore(value);
    setIsGameOver(true);
    setGamePhase('gameover');
    submitScore(value, durationMs);
  }, [submitScore]);

  useEffect(() => {
    // Safe image loading lifecycle:
    // - create Image once in effect
    // - assign onload/onerror handlers
    // - store it in ref only after successful load
    // - cleanup handlers on unmount to avoid stale updates
    const img = new Image();
    img.src = mascotSrc;
    img.onload = () => { mascotRef.current = img; };
    img.onerror = () => { mascotRef.current = null; };

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [mascotSrc]);

  const startGame = useCallback(() => {
    const initialPlatforms: Platform[] = [];
    const first: Platform = { x: CANVAS_W / 2 - 55, y: CANVAS_H - 90, width: 110, height: 14, type: 'normal', dx: 0, broken: false };
    initialPlatforms.push(first);

    let y = first.y - 85;
    while (y > -CANVAS_H) {
      initialPlatforms.push(createPlatform(y, 0, 1));
      y -= 80 + Math.random() * 25;
    }

    stateRef.current = {
      player: { x: CANVAS_W / 2 - PLAYER_W / 2, y: first.y - PLAYER_H, vy: JUMP_VY, facing: 'right' },
      platforms: initialPlatforms,
      cameraY: 0,
      maxHeight: 0,
      gameOver: false,
      startTime: Date.now(),
    };

    setScore(0);
    setLevel(1);
    setIsGameOver(false);
    setSubmitted(false);
    setPointsEarned(0);
    setGamePhase('playing');
  }, []);

  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const gs = stateRef.current;
    if (!canvas || !ctx || !gs || gs.gameOver) return;

    const inp = inputRef.current;
    const accelInput = Math.abs(inp.accelX) > 2 ? inp.accelX / 9.8 : 0;
    let dx = 0;
    if (inp.left || accelInput < -0.15) { dx = -PLAYER_MOVE_SPEED; gs.player.facing = 'left'; }
    if (inp.right || accelInput > 0.15) { dx = PLAYER_MOVE_SPEED; gs.player.facing = 'right'; }

    gs.player.x += dx;
    if (gs.player.x + PLAYER_W < 0) gs.player.x = CANVAS_W;
    if (gs.player.x > CANVAS_W) gs.player.x = -PLAYER_W;

    gs.player.vy += GRAVITY;
    gs.player.y += gs.player.vy;

    const currentScore = Math.floor(gs.maxHeight * 2.2);
    const difficultyMultiplier = Math.min(1 + currentScore / 4000, 2.2);

    for (const p of gs.platforms) {
      if (p.type === 'moving' && !p.broken) {
        p.x += p.dx;
        if (p.x <= 0 || p.x + p.width >= CANVAS_W) p.dx *= -1;
      }
    }

    if (gs.player.vy > 0) {
      const feetY = gs.player.y + PLAYER_HITBOX.offsetY + PLAYER_HITBOX.height;
      const prevFeetY = feetY - gs.player.vy;
      const left = gs.player.x + PLAYER_HITBOX.offsetX;
      const right = left + PLAYER_HITBOX.width;

      for (const p of gs.platforms) {
        if (p.broken) continue;
        const top = p.y;

        if (prevFeetY <= top && feetY >= top && right > p.x + 4 && left < p.x + p.width - 4) {
          gs.player.y = p.y - PLAYER_HITBOX.height - PLAYER_HITBOX.offsetY;
          gs.player.vy = JUMP_VY;
          if (p.type === 'fragile') p.broken = true;
          break;
        }
      }
    }

    const targetPlayerScreenY = CANVAS_H * 0.62;
    const playerScreenY = gs.player.y - gs.cameraY;
    if (playerScreenY < targetPlayerScreenY) {
      const desiredCameraY = gs.player.y - targetPlayerScreenY;
      gs.cameraY += (desiredCameraY - gs.cameraY) * 0.18;
    }

    gs.maxHeight = Math.max(gs.maxHeight, -gs.cameraY);
    const newScore = Math.floor(gs.maxHeight * 2.2);
    const newLevel = getLevelConfig(newScore).level;
    if (newScore !== score) setScore(newScore);
    if (newLevel !== level) setLevel(newLevel);

    const minY = Math.min(...gs.platforms.map((p) => p.y));
    const cfg = getLevelConfig(newScore);

    if (minY > gs.cameraY - CANVAS_H) {
      const gap = (cfg.gapMin + Math.random() * (cfg.gapMax - cfg.gapMin)) * (0.95 + difficultyMultiplier * 0.08);
      gs.platforms.push(createPlatform(minY - gap, newScore, difficultyMultiplier));
    }

    gs.platforms = gs.platforms.filter((p) => !p.broken && p.y < gs.cameraY + CANVAS_H + 220);

    if (gs.player.y - gs.cameraY > CANVAS_H + 120) {
      gs.gameOver = true;
      handleGameOver(newScore);
      return;
    }

    drawBackground(ctx);
    for (const p of gs.platforms) {
      const sy = p.y - gs.cameraY;
      if (sy > -30 && sy < CANVAS_H + 30) drawPlatform(ctx, p, gs.cameraY);
    }
    drawPlayer(ctx, gs.player, gs.cameraY, mascotRef.current);
    drawControls(ctx);

    animFrameRef.current = requestAnimationFrame(gameLoop);
  }, [score, level, handleGameOver]);

  useEffect(() => {
    if (gamePhase === 'playing') animFrameRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [gamePhase, gameLoop]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') inputRef.current.left = true;
      if (e.key === 'ArrowRight') inputRef.current.right = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') inputRef.current.left = false;
      if (e.key === 'ArrowRight') inputRef.current.right = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    const onMotion = (e: DeviceMotionEvent) => {
      const accel = e.accelerationIncludingGravity;
      if (accel?.x !== null && accel?.x !== undefined) inputRef.current.accelX = accel.x;
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, []);

  const handleCanvasTouch = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;

    let leftPressed = false;
    let rightPressed = false;

    for (let i = 0; i < e.touches.length; i++) {
      const tx = (e.touches[i].clientX - rect.left) * scaleX;
      const ty = (e.touches[i].clientY - rect.top) * scaleY;
      if (tx >= 8 && tx <= 80 && ty >= CANVAS_H - 80 && ty <= CANVAS_H - 16) leftPressed = true;
      if (tx >= CANVAS_W - 80 && tx <= CANVAS_W - 8 && ty >= CANVAS_H - 80 && ty <= CANVAS_H - 16) rightPressed = true;
    }

    inputRef.current.left = leftPressed;
    inputRef.current.right = rightPressed;
  }, []);

  const handleCanvasTouchEnd = useCallback(() => {
    inputRef.current.left = false;
    inputRef.current.right = false;
  }, []);

  useEffect(() => {
    if (gamePhase !== 'idle') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    drawBackground(ctx);
    ctx.fillStyle = '#d4a373';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Perkie Jump', CANVAS_W / 2, CANVAS_H / 2 - 70);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '16px sans-serif';
    ctx.fillText('Стрибай вище та відкривай нові рівні!', CANVAS_W / 2, CANVAS_H / 2 - 30);
  }, [gamePhase]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-full max-w-[390px]">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="rounded-2xl w-full touch-none"
          style={{ maxHeight: '70vh', objectFit: 'contain' }}
          onTouchStart={handleCanvasTouch}
          onTouchMove={handleCanvasTouch}
          onTouchEnd={handleCanvasTouchEnd}
          onTouchCancel={handleCanvasTouchEnd}
        />

        {gamePhase === 'playing' && (
          <>
            <div
              className="absolute top-3 left-3 px-3 py-2 rounded-xl text-sm font-bold"
              style={{ background: 'rgba(15, 13, 24, 0.78)', color: '#d4a373' }}
            >
              Score: {score}
            </div>
            <div
              className="absolute top-3 right-3 px-3 py-2 rounded-xl text-sm font-bold"
              style={{ background: 'rgba(15, 13, 24, 0.78)', color: '#d4a373' }}
            >
              Level {level}
            </div>
          </>
        )}

        {isGameOver && (
          <div className="absolute inset-0 bg-black/60 rounded-2xl flex flex-col items-center justify-center text-center px-4">
            <h3 className="text-2xl font-extrabold" style={{ color: '#d4a373' }}>Гра закінчена!</h3>
            <p className="text-white mt-2">Рахунок: <b>{finalScore}</b></p>
            {submitting && <p className="text-white/70 mt-2 text-sm">Зберігаємо результат...</p>}
            {!submitting && submitted && <p className="text-green-300 mt-2 text-sm">+{pointsEarned} балів</p>}
          </div>
        )}
      </div>

      {gamePhase === 'idle' && (
        <button
          className="px-8 py-3 rounded-2xl font-bold text-white text-lg"
          style={{ background: 'linear-gradient(135deg, #6f3b16, #d4a373)' }}
          onClick={startGame}
        >
          ☕ Почати гру
        </button>
      )}

      {gamePhase === 'gameover' && (
        <button
          className="px-6 py-3 rounded-2xl font-bold text-white"
          style={{ background: 'linear-gradient(135deg, #6f3b16, #d4a373)' }}
          onClick={startGame}
        >
          ↺ Ще раз
        </button>
      )}
    </div>
  );
}
