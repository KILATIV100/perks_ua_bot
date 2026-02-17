import { useEffect, useRef, useCallback, useState } from 'react';

const CANVAS_W = 390;
const CANVAS_H = 650;

const GRAVITY = 0.38;
const JUMP_VY = -12.8;
const PLAYER_W = 52;
const PLAYER_H = 52;
const PLAYER_MOVE_SPEED = 5.2;

const PLAYER_HITBOX = {
  offsetX: 6,
  offsetY: 5,
  width: PLAYER_W - 12,
  height: PLAYER_H - 10,
};

const CLIENT_SALT = import.meta.env.VITE_GAME_SALT ?? 'perkie-default-salt-change-me';

type PlatformType = 'normal' | 'moving' | 'fragile';
type Difficulty = 'easy' | 'medium' | 'normal' | 'hard' | 'expert' | 'extreme';

type GameMode = 'classic' | 'timed' | 'survival' | 'racing';

interface Platform {
  x: number;
  y: number;
  width: number;
  height: number;
  type: PlatformType;
  dx: number;
  broken: boolean;
  ttlMs?: number;
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
  paused: boolean;
}

interface PerkieJumpProps {
  telegramId?: string;
  apiUrl?: string;
  onScoreSubmit?: (score: number, pointsAwarded: number) => void;
  mascotSrc?: string;
  gameMode?: GameMode;
  loyaltyMultiplier?: number;
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
  difficulty: Difficulty;
}

const LEVELS: LevelConfig[] = [
  { level: 1, minScore: 0, maxScore: 999, platformWidth: 110, gapMin: 72, gapMax: 102, movingChance: 0.0, fragileChance: 0.0, movingSpeed: 0, difficulty: 'easy' },
  { level: 2, minScore: 1000, maxScore: 2499, platformWidth: 92, gapMin: 86, gapMax: 128, movingChance: 0.35, fragileChance: 0.0, movingSpeed: 1.5, difficulty: 'medium' },
  { level: 3, minScore: 2500, maxScore: 4999, platformWidth: 78, gapMin: 98, gapMax: 146, movingChance: 0.42, fragileChance: 0.3, movingSpeed: 1.95, difficulty: 'hard' },
  { level: 4, minScore: 5000, maxScore: Number.MAX_SAFE_INTEGER, platformWidth: 66, gapMin: 112, gapMax: 170, movingChance: 0.62, fragileChance: 0.25, movingSpeed: 2.7, difficulty: 'extreme' },
];

function getChainMultiplier(day: number): number {
  if (day >= 30) return 4.0;
  if (day >= 14) return 2.5;
  if (day >= 7) return 1.8;
  if (day >= 3) return 1.3;
  return 1.0;
}

function calcChainDays(): number {
  const key = 'perkie_chain_meta';
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      localStorage.setItem(key, JSON.stringify({ date: today, days: 1 }));
      return 1;
    }

    const parsed = JSON.parse(raw) as { date: string; days: number };
    if (parsed.date === today) return parsed.days;

    const last = new Date(`${parsed.date}T00:00:00Z`).getTime();
    const now = new Date(`${today}T00:00:00Z`).getTime();
    const diffDays = Math.round((now - last) / (24 * 3600 * 1000));
    const next = diffDays === 1 ? parsed.days + 1 : 1;

    localStorage.setItem(key, JSON.stringify({ date: today, days: next }));
    return next;
  } catch {
    return 1;
  }
}

async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getLevelConfig(score: number): LevelConfig {
  return LEVELS.find((l) => score >= l.minScore && score <= l.maxScore) ?? LEVELS[LEVELS.length - 1];
}

function getBrowserInfo() {
  const ua = navigator.userAgent;
  return {
    isTelegramApp: /Telegram/i.test(ua),
    isIOS: /iPad|iPhone|iPod/.test(ua),
    isAndroid: /Android/.test(ua),
    isSafari: /Safari/.test(ua) && !/Chrome/.test(ua),
  };
}

function createPlatform(y: number, score: number, difficultyMultiplier: number): Platform {
  const cfg = getLevelConfig(score);

  // Level progression algorithm:
  // 1) Select active level config by score range.
  // 2) Use level-specific probabilities for moving/fragile platforms.
  // 3) Multiply moving speed by difficultyMultiplier for smoother scaling.
  const r = Math.random();
  let type: PlatformType = 'normal';
  if (r < cfg.fragileChance) type = 'fragile';
  else if (r < cfg.fragileChance + cfg.movingChance) type = 'moving';

  return {
    x: Math.random() * (CANVAS_W - cfg.platformWidth),
    y,
    width: cfg.platformWidth,
    height: 14,
    type,
    dx: type === 'moving' ? cfg.movingSpeed * difficultyMultiplier * (Math.random() > 0.5 ? 1 : -1) : 0,
    broken: false,
    ttlMs: type === 'fragile' ? 2000 : undefined,
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
  if (p.broken) return;
  const sy = p.y - camY;

  if (p.type === 'fragile') {
    ctx.fillStyle = '#5b3a29';
    ctx.strokeStyle = '#3a2418';
  } else if (p.type === 'moving') {
    ctx.fillStyle = '#e8d3b4';
    ctx.strokeStyle = '#b98c5e';
  } else {
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

export function PerkieJump({
  telegramId,
  apiUrl,
  onScoreSubmit,
  mascotSrc = '/perkie.png',
  gameMode = 'classic',
  loyaltyMultiplier = 1,
}: PerkieJumpProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const inputRef = useRef({ left: false, right: false, accelX: 0 });
  const animFrameRef = useRef<number>(0);
  const mascotRef = useRef<HTMLImageElement | null>(null);
  const fragileTouchedRef = useRef<WeakSet<Platform>>(new WeakSet());

  const [gamePhase, setGamePhase] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [heightMeters, setHeightMeters] = useState(0);
  const [coinsCollected, setCoinsCollected] = useState(0);
  const [xp, setXp] = useState(0);
  const [prestigeLevel, setPrestigeLevel] = useState(0);
  const [chainDays] = useState(() => calcChainDays());
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pointsEarned, setPointsEarned] = useState(0);

  const chainMultiplier = getChainMultiplier(chainDays);
  const premiumChainMultiplier = chainMultiplier * 1.5;

  const trackEvent = useCallback(async (eventName: string, data: Record<string, unknown>) => {
    if (!apiUrl || !telegramId) return;
    try {
      await fetch(`${apiUrl}/api/games/track-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId, eventName, data }),
      });
    } catch {
      // best effort analytics
    }
  }, [apiUrl, telegramId]);

  const submitScore = useCallback(async (value: number, durationMs: number, height: number, coins: number, earnedXp: number) => {
    if (!telegramId || !apiUrl) return;
    setSubmitting(true);
    try {
      const timestamp = Date.now();
      const hash = await sha256(`${value}${CLIENT_SALT}${timestamp}`);

      const res = await fetch(`${apiUrl}/api/games/submit-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId,
          score: value,
          timestamp,
          hash,
          gameDurationMs: durationMs,
          mode: gameMode,
          height,
          coins,
          xp: earnedXp,
          prestigeLevel,
          chainDays,
          chainMultiplier: premiumChainMultiplier,
        }),
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
  }, [telegramId, apiUrl, onScoreSubmit, gameMode, prestigeLevel, chainDays, premiumChainMultiplier]);

  const handleGameOver = useCallback((value: number, height: number, coins: number) => {
    const gs = stateRef.current;
    if (!gs) return;

    const durationMs = Date.now() - gs.startTime;
    const totalXp = Math.floor(height / 10) + Math.floor(coins / 5) + (value > finalScore ? 50 : 0);
    setXp(totalXp);

    setFinalScore(value);
    setIsGameOver(true);
    setGamePhase('gameover');

    trackEvent('game_ended', {
      mode: gameMode,
      height,
      score: value,
      coins,
      xp: totalXp,
      duration: durationMs,
      prestigeLevel,
      chainDays,
    });

    submitScore(value, durationMs, height, coins, totalXp);
  }, [submitScore, trackEvent, gameMode, prestigeLevel, chainDays, finalScore]);

  useEffect(() => {
    // Safe mascot image loading:
    // - Load image object once per source change.
    // - Draw only after `onload` confirms readiness.
    // - Cleanup handlers on effect teardown to avoid leaks.
    const img = new Image();
    img.src = mascotSrc;
    img.onload = () => { mascotRef.current = img; };
    img.onerror = () => { mascotRef.current = null; };

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [mascotSrc]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const prev = meta?.getAttribute('content');
    meta?.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');

    const preventContext = (e: Event) => e.preventDefault();
    const preventSelect = (e: Event) => e.preventDefault();

    let lastTouchEnd = 0;
    const preventDoubleTap = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    };

    const preventPinch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };

    const preventCtrlWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };

    document.addEventListener('contextmenu', preventContext);
    document.addEventListener('selectstart', preventSelect);
    document.addEventListener('touchend', preventDoubleTap, { passive: false });
    document.addEventListener('touchmove', preventPinch, { passive: false });
    document.addEventListener('wheel', preventCtrlWheel, { passive: false });

    return () => {
      document.removeEventListener('contextmenu', preventContext);
      document.removeEventListener('selectstart', preventSelect);
      document.removeEventListener('touchend', preventDoubleTap);
      document.removeEventListener('touchmove', preventPinch);
      document.removeEventListener('wheel', preventCtrlWheel);
      if (prev) meta?.setAttribute('content', prev);
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.hidden;
      setIsPaused(hidden);
      const gs = stateRef.current;
      if (gs) gs.paused = hidden;
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onVisibility);
    window.addEventListener('pageshow', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!screen.orientation?.lock) return;
    screen.orientation.lock('portrait-primary').catch(() => {
      // unsupported in some WebViews
    });
  }, []);

  const startGame = useCallback(() => {
    const initialPlatforms: Platform[] = [];
    const base: Platform = { x: CANVAS_W / 2 - 55, y: CANVAS_H - 90, width: 110, height: 14, type: 'normal', dx: 0, broken: false };
    initialPlatforms.push(base);

    let y = base.y - 85;
    while (y > -CANVAS_H) {
      initialPlatforms.push(createPlatform(y, 0, 1));
      y -= 80 + Math.random() * 25;
    }

    const prestigeBonus = 1 + prestigeLevel * 0.1;
    stateRef.current = {
      player: { x: CANVAS_W / 2 - PLAYER_W / 2, y: base.y - PLAYER_H, vy: JUMP_VY * prestigeBonus, facing: 'right' },
      platforms: initialPlatforms,
      cameraY: 0,
      maxHeight: 0,
      gameOver: false,
      paused: false,
      startTime: Date.now(),
    };

    setScore(0);
    setLevel(1);
    setDifficulty('easy');
    setHeightMeters(0);
    setCoinsCollected(0);
    setXp(0);
    setIsGameOver(false);
    setIsPaused(false);
    setSubmitted(false);
    setPointsEarned(0);
    setGamePhase('playing');

    trackEvent('game_started', { mode: gameMode, difficulty: 'easy', prestigeLevel, chainDays });
  }, [prestigeLevel, trackEvent, gameMode, chainDays]);

  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const gs = stateRef.current;
    if (!canvas || !ctx || !gs || gs.gameOver) return;

    if (gs.paused || isPaused) {
      animFrameRef.current = requestAnimationFrame(gameLoop);
      return;
    }

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
    const difficultyMultiplier = Math.min(1 + currentScore / 4000, 2.25);

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

          if (p.type === 'fragile' && !fragileTouchedRef.current.has(p)) {
            fragileTouchedRef.current.add(p);
            window.setTimeout(() => {
              p.broken = true;
            }, p.ttlMs ?? 2000);
          }

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
    const newHeightMeters = Math.floor(gs.maxHeight / 10);
    const newLevelCfg = getLevelConfig(newScore);
    const newCoins = Math.floor((newHeightMeters / 8) * loyaltyMultiplier * premiumChainMultiplier);

    if (newScore !== score) setScore(newScore);
    if (newLevelCfg.level !== level) setLevel(newLevelCfg.level);
    if (newLevelCfg.difficulty !== difficulty) setDifficulty(newLevelCfg.difficulty);
    if (newHeightMeters !== heightMeters) setHeightMeters(newHeightMeters);
    if (newCoins !== coinsCollected) setCoinsCollected(newCoins);

    const minY = Math.min(...gs.platforms.map((p) => p.y));
    if (minY > gs.cameraY - CANVAS_H) {
      const gap = (newLevelCfg.gapMin + Math.random() * (newLevelCfg.gapMax - newLevelCfg.gapMin)) * (0.95 + difficultyMultiplier * 0.08);
      gs.platforms.push(createPlatform(minY - gap, newScore, difficultyMultiplier));
    }

    gs.platforms = gs.platforms.filter((p) => !p.broken && p.y < gs.cameraY + CANVAS_H + 240);

    if (gs.player.y - gs.cameraY > CANVAS_H + 120) {
      gs.gameOver = true;
      handleGameOver(newScore, newHeightMeters, newCoins);
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
  }, [score, level, difficulty, heightMeters, coinsCollected, loyaltyMultiplier, premiumChainMultiplier, handleGameOver, isPaused]);

  useEffect(() => {
    if (gamePhase === 'playing') animFrameRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [gamePhase, gameLoop]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') inputRef.current.left = true;
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') inputRef.current.right = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') inputRef.current.left = false;
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') inputRef.current.right = false;
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
    e.preventDefault();

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

  const handleCanvasTouchEnd = useCallback((e?: React.TouchEvent<HTMLCanvasElement>) => {
    e?.preventDefault();
    inputRef.current.left = false;
    inputRef.current.right = false;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }, [gamePhase]);

  const triggerPrestige = useCallback(() => {
    if (heightMeters < 500) return;
    setPrestigeLevel((p) => p + 1);
    trackEvent('prestige_triggered', { newLevel: prestigeLevel + 1, bonusApplied: '+10% jump start' });
    startGame();
  }, [heightMeters, prestigeLevel, startGame, trackEvent]);

  const browser = getBrowserInfo();

  return (
    <div
      className="flex flex-col items-center gap-3"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div className="relative w-full max-w-[390px]" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="rounded-2xl w-full touch-none"
          style={{ maxHeight: '70vh', objectFit: 'contain', touchAction: 'none' }}
          onTouchStart={handleCanvasTouch}
          onTouchMove={handleCanvasTouch}
          onTouchEnd={handleCanvasTouchEnd}
          onTouchCancel={handleCanvasTouchEnd}
        />

        {gamePhase === 'playing' && (
          <>
            <div className="absolute top-3 left-3 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: 'rgba(15,13,24,0.82)', color: '#d4a373' }}>
              Score: {score} | Lvl {level}
            </div>
            <div className="absolute top-3 right-3 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: 'rgba(15,13,24,0.82)', color: '#d4a373' }}>
              {heightMeters}м • {difficulty}
            </div>
            <div className="absolute bottom-4 left-3 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: 'rgba(15,13,24,0.82)', color: '#d4a373' }}>
              💰 {coinsCollected} • XP {xp}
            </div>
          </>
        )}

        {isPaused && gamePhase === 'playing' && (
          <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center">
            <div className="text-center">
              <p className="text-xl font-bold" style={{ color: '#d4a373' }}>Пауза</p>
              <p className="text-white/80 text-sm mt-1">Повернись в гру, щоб продовжити</p>
            </div>
          </div>
        )}

        {isGameOver && (
          <div className="absolute inset-0 bg-black/65 rounded-2xl flex flex-col items-center justify-center text-center px-4">
            <h3 className="text-2xl font-extrabold" style={{ color: '#d4a373' }}>Game Over</h3>
            <p className="text-white mt-2">Score: <b>{finalScore}</b> • Height: <b>{heightMeters}м</b></p>
            <p className="text-white/85 text-sm mt-1">Coins: {coinsCollected} • XP: {xp}</p>
            <p className="text-white/70 text-xs mt-1">Chain day {chainDays} (x{premiumChainMultiplier.toFixed(2)})</p>
            {submitting && <p className="text-white/70 mt-2 text-sm">Зберігаємо результат...</p>}
            {!submitting && submitted && <p className="text-green-300 mt-2 text-sm">+{pointsEarned} балів</p>}
          </div>
        )}
      </div>

      <div className="text-[11px] opacity-70 text-center text-white/70 px-2">
        Mode: {gameMode} • Telegram: {browser.isTelegramApp ? 'yes' : 'no'} • {browser.isIOS ? 'iOS' : browser.isAndroid ? 'Android' : 'Desktop'}
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
        <div className="flex gap-2 flex-wrap justify-center">
          <button
            className="px-6 py-3 rounded-2xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #6f3b16, #d4a373)' }}
            onClick={startGame}
          >
            ↺ Ще раз
          </button>

          <button
            className="px-6 py-3 rounded-2xl font-bold text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #1f2937, #374151)' }}
            disabled={heightMeters < 500}
            onClick={triggerPrestige}
          >
            Prestige {prestigeLevel > 0 ? `(${prestigeLevel})` : ''}
          </button>
        </div>
      )}
    </div>
  );
}
