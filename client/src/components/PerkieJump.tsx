import { useEffect, useRef, useCallback, useState } from 'react';

const CANVAS_W = 390;
const CANVAS_H = 650;
const GRAVITY = 0.38;
const BASE_JUMP_VY = -12.8;
const PLAYER_W = 52;
const PLAYER_H = 52;
const PLAYER_MOVE_SPEED = 5.2;
const CLIENT_SALT = import.meta.env.VITE_GAME_SALT ?? 'perkie-default-salt-change-me';

type PlatformType = 'normal' | 'moving' | 'fragile';
type GameMode = 'classic' | 'timed' | 'survival' | 'racing';

type Difficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'extreme';

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
  paused: boolean;
  startTime: number;
  modeStartedAt: number;
}

interface PerkieJumpProps {
  telegramId?: string;
  apiUrl?: string;
  onScoreSubmit?: (score: number, pointsAwarded: number) => void;
  mascotSrc?: string;
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

const PLAYER_HITBOX = { offsetX: 6, offsetY: 5, width: PLAYER_W - 12, height: PLAYER_H - 10 };

const LEVELS: LevelConfig[] = [
  { level: 1, minScore: 0, maxScore: 999, platformWidth: 110, gapMin: 72, gapMax: 102, movingChance: 0.0, fragileChance: 0.0, movingSpeed: 0, difficulty: 'easy' },
  { level: 2, minScore: 1000, maxScore: 2499, platformWidth: 92, gapMin: 86, gapMax: 128, movingChance: 0.35, fragileChance: 0.0, movingSpeed: 1.5, difficulty: 'medium' },
  { level: 3, minScore: 2500, maxScore: 4999, platformWidth: 78, gapMin: 98, gapMax: 146, movingChance: 0.42, fragileChance: 0.3, movingSpeed: 1.95, difficulty: 'hard' },
  { level: 4, minScore: 5000, maxScore: Number.MAX_SAFE_INTEGER, platformWidth: 66, gapMin: 112, gapMax: 170, movingChance: 0.62, fragileChance: 0.25, movingSpeed: 2.7, difficulty: 'extreme' },
];

function getLevelConfig(score: number): LevelConfig {
  return LEVELS.find((l) => score >= l.minScore && score <= l.maxScore) ?? LEVELS[LEVELS.length - 1];
}

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

function createPlatform(y: number, score: number, multiplier: number): Platform {
  const cfg = getLevelConfig(score);
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
    dx: type === 'moving' ? cfg.movingSpeed * multiplier * (Math.random() > 0.5 ? 1 : -1) : 0,
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

function drawPlatform(ctx: CanvasRenderingContext2D, p: Platform, cameraY: number): void {
  if (p.broken) return;
  const sy = p.y - cameraY;

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

function drawPlayer(ctx: CanvasRenderingContext2D, player: Player, cameraY: number, mascot: HTMLImageElement | null): void {
  const sx = player.x;
  const sy = player.y - cameraY;

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

async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function PerkieJump({ telegramId, apiUrl, onScoreSubmit, mascotSrc = '/perkie.png', loyaltyMultiplier = 1 }: PerkieJumpProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mascotRef = useRef<HTMLImageElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const stateRef = useRef<GameState | null>(null);
  const inputRef = useRef({ left: false, right: false, accelX: 0 });
  const fragileTouchRef = useRef<WeakSet<Platform>>(new WeakSet());

  const [phase, setPhase] = useState<'menu' | 'playing' | 'gameover'>('menu');
  const [selectedMode, setSelectedMode] = useState<GameMode>('classic');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [heightMeters, setHeightMeters] = useState(0);
  const [coinsCollected, setCoinsCollected] = useState(0);
  const [xp, setXp] = useState(0);
  const [chainDays] = useState(() => calcChainDays());
  const [finalScore, setFinalScore] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pointsAwarded, setPointsAwarded] = useState(0);
  const [loyaltyBonus, setLoyaltyBonus] = useState(0);

  const chainMultiplier = getChainMultiplier(chainDays);

  const submitScore = useCallback(async (finalValue: number, durationMs: number, bonusPoints: number) => {
    if (!telegramId || !apiUrl) return;
    setSubmitting(true);
    try {
      const timestamp = Date.now();
      const hash = await sha256(`${finalValue}${CLIENT_SALT}${timestamp}`);
      const res = await fetch(`${apiUrl}/api/games/submit-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId,
          score: finalValue,
          timestamp,
          hash,
          gameDurationMs: durationMs,
          mode: selectedMode,
          heightMeters,
          coinsCollected,
          chainDays,
          chainMultiplier,
          loyaltyBonus: bonusPoints,
        }),
      });

      if (res.ok) {
        const data = await res.json() as { pointsAwarded?: number };
        const serverPoints = data.pointsAwarded ?? 0;
        setPointsAwarded(serverPoints);
        setLoyaltyBonus(bonusPoints);

        // Integration hook with host loyalty system: award server points + bonus method.
        onScoreSubmit?.(finalValue, serverPoints + bonusPoints);
        setSubmitted(true);
      }
    } catch {
      // no-op
    } finally {
      setSubmitting(false);
    }
  }, [telegramId, apiUrl, selectedMode, heightMeters, coinsCollected, chainDays, chainMultiplier, onScoreSubmit]);

  const startGame = useCallback(() => {
    const first: Platform = { x: CANVAS_W / 2 - 55, y: CANVAS_H - 90, width: 110, height: 14, type: 'normal', dx: 0, broken: false };
    const platforms: Platform[] = [first];

    let y = first.y - 85;
    while (y > -CANVAS_H) {
      platforms.push(createPlatform(y, 0, 1));
      y -= 80 + Math.random() * 25;
    }

    stateRef.current = {
      player: { x: CANVAS_W / 2 - PLAYER_W / 2, y: first.y - PLAYER_H, vy: BASE_JUMP_VY, facing: 'right' },
      platforms,
      cameraY: 0,
      maxHeight: 0,
      gameOver: false,
      paused: false,
      startTime: Date.now(),
      modeStartedAt: Date.now(),
    };

    setScore(0);
    setLevel(1);
    setDifficulty('easy');
    setHeightMeters(0);
    setCoinsCollected(0);
    setXp(0);
    setSubmitted(false);
    setPointsAwarded(0);
    setLoyaltyBonus(0);
    setPhase('playing');
  }, []);

  const handleGameOver = useCallback((endScore: number, endHeight: number, endCoins: number) => {
    const gs = stateRef.current;
    if (!gs) return;
    gs.gameOver = true;

    setFinalScore(endScore);
    setPhase('gameover');

    const durationMs = Date.now() - gs.startTime;
    const earnedXp = Math.floor(endHeight / 10) + Math.floor(endCoins / 5);
    setXp(earnedXp);

    // Additional loyalty earning method based on gameplay coins + chain + tier multiplier.
    const bonusPoints = Math.floor((endCoins / 25) * chainMultiplier * loyaltyMultiplier);
    submitScore(endScore, durationMs, bonusPoints);
  }, [submitScore, chainMultiplier, loyaltyMultiplier]);

  useEffect(() => {
    const img = new Image();
    img.src = mascotSrc;
    img.onload = () => { mascotRef.current = img; };
    img.onerror = () => { mascotRef.current = null; };
    return () => { img.onload = null; img.onerror = null; };
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

    document.addEventListener('contextmenu', preventContext);
    document.addEventListener('selectstart', preventSelect);
    document.addEventListener('touchend', preventDoubleTap, { passive: false });
    document.addEventListener('touchmove', preventPinch, { passive: false });

    return () => {
      document.removeEventListener('contextmenu', preventContext);
      document.removeEventListener('selectstart', preventSelect);
      document.removeEventListener('touchend', preventDoubleTap);
      document.removeEventListener('touchmove', preventPinch);
      if (prev) meta?.setAttribute('content', prev);
    };
  }, []);

  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const gs = stateRef.current;
    if (!canvas || !ctx || !gs || gs.gameOver || gs.paused) return;

    const elapsed = Date.now() - gs.modeStartedAt;
    const inp = inputRef.current;

    let dx = 0;
    const accelInput = Math.abs(inp.accelX) > 2 ? inp.accelX / 9.8 : 0;
    if (inp.left || accelInput < -0.15) { dx = -PLAYER_MOVE_SPEED; gs.player.facing = 'left'; }
    if (inp.right || accelInput > 0.15) { dx = PLAYER_MOVE_SPEED; gs.player.facing = 'right'; }

    gs.player.x += dx;
    if (gs.player.x + PLAYER_W < 0) gs.player.x = CANVAS_W;
    if (gs.player.x > CANVAS_W) gs.player.x = -PLAYER_W;

    const modeGravityBoost = selectedMode === 'survival' ? 0.06 : selectedMode === 'timed' && elapsed > 30000 ? 0.08 : 0;
    gs.player.vy += GRAVITY + modeGravityBoost;
    gs.player.y += gs.player.vy;

    const baseScore = Math.floor(gs.maxHeight * 2.2);
    const difficultyMultiplier = Math.min(1 + baseScore / 4000, 2.25);

    for (const p of gs.platforms) {
      if (p.type === 'moving' && !p.broken) {
        const racingBoost = selectedMode === 'racing' ? 1.2 : 1;
        p.x += p.dx * racingBoost;
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
        if (prevFeetY <= p.y && feetY >= p.y && right > p.x + 4 && left < p.x + p.width - 4) {
          gs.player.y = p.y - PLAYER_HITBOX.height - PLAYER_HITBOX.offsetY;
          gs.player.vy = BASE_JUMP_VY;

          if (p.type === 'fragile' && !fragileTouchRef.current.has(p)) {
            fragileTouchRef.current.add(p);
            window.setTimeout(() => { p.broken = true; }, 2000);
          }
          break;
        }
      }
    }

    const targetScreenY = CANVAS_H * 0.62;
    const screenY = gs.player.y - gs.cameraY;
    if (screenY < targetScreenY) {
      const desired = gs.player.y - targetScreenY;
      gs.cameraY += (desired - gs.cameraY) * 0.18;
    }

    gs.maxHeight = Math.max(gs.maxHeight, -gs.cameraY);

    const newScore = Math.floor(gs.maxHeight * 2.2);
    const newLevelCfg = getLevelConfig(newScore);
    const newHeight = Math.floor(gs.maxHeight / 10);

    const modeCoinBoost = selectedMode === 'timed' ? 1.3 : selectedMode === 'survival' ? 1.15 : 1;
    const newCoins = Math.floor((newHeight / 8) * modeCoinBoost * chainMultiplier * loyaltyMultiplier);

    if (newScore !== score) setScore(newScore);
    if (newLevelCfg.level !== level) setLevel(newLevelCfg.level);
    if (newLevelCfg.difficulty !== difficulty) setDifficulty(newLevelCfg.difficulty);
    if (newHeight !== heightMeters) setHeightMeters(newHeight);
    if (newCoins !== coinsCollected) setCoinsCollected(newCoins);

    const minY = Math.min(...gs.platforms.map((p) => p.y));
    if (minY > gs.cameraY - CANVAS_H) {
      const modeGapFactor = selectedMode === 'timed' ? 1.1 : selectedMode === 'survival' ? 1.12 : 1;
      const gap = (newLevelCfg.gapMin + Math.random() * (newLevelCfg.gapMax - newLevelCfg.gapMin)) * modeGapFactor * (0.95 + difficultyMultiplier * 0.08);
      gs.platforms.push(createPlatform(minY - gap, newScore, difficultyMultiplier));
    }

    gs.platforms = gs.platforms.filter((p) => !p.broken && p.y < gs.cameraY + CANVAS_H + 240);

    if (selectedMode === 'timed' && elapsed >= 60000) {
      handleGameOver(newScore, newHeight, newCoins);
      return;
    }

    if (gs.player.y - gs.cameraY > CANVAS_H + 120) {
      handleGameOver(newScore, newHeight, newCoins);
      return;
    }

    drawBackground(ctx);
    for (const p of gs.platforms) {
      const sy = p.y - gs.cameraY;
      if (sy > -30 && sy < CANVAS_H + 30) drawPlatform(ctx, p, gs.cameraY);
    }
    drawPlayer(ctx, gs.player, gs.cameraY, mascotRef.current);

    animFrameRef.current = requestAnimationFrame(gameLoop);
  }, [selectedMode, chainMultiplier, loyaltyMultiplier, score, level, difficulty, heightMeters, coinsCollected, handleGameOver]);

  useEffect(() => {
    if (phase === 'playing') animFrameRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [phase, gameLoop]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') inputRef.current.left = true;
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') inputRef.current.right = true;
      if (e.key === 'ArrowUp' || e.key === ' ') {
        const gs = stateRef.current;
        if (gs && gs.player.vy > -6) gs.player.vy = BASE_JUMP_VY * 0.9;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') inputRef.current.left = false;
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') inputRef.current.right = false;
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const accel = e.accelerationIncludingGravity;
      if (accel?.x !== null && accel?.x !== undefined) inputRef.current.accelX = accel.x;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('devicemotion', onMotion);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('devicemotion', onMotion);
    };
  }, []);

  const touchControl = useCallback((dir: 'left' | 'right' | 'jump', active: boolean) => {
    if (dir === 'left') inputRef.current.left = active;
    if (dir === 'right') inputRef.current.right = active;
    if (dir === 'jump' && active) {
      const gs = stateRef.current;
      if (gs && gs.player.vy > -6) gs.player.vy = BASE_JUMP_VY * 0.9;
    }
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

    if (phase === 'menu') {
      drawBackground(ctx);
      ctx.fillStyle = '#d4a373';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Perky Jump', CANVAS_W / 2, CANVAS_H / 2 - 50);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '16px sans-serif';
      ctx.fillText('Обери режим та запускай гру', CANVAS_W / 2, CANVAS_H / 2 - 18);
    }
  }, [phase]);

  return (
    <div className="flex flex-col items-center gap-3" style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}>
      <div className="relative w-full max-w-[390px]" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="rounded-2xl w-full" style={{ maxHeight: '70vh', objectFit: 'contain', touchAction: 'none' }} />

        {phase === 'playing' && (
          <>
            <div className="absolute top-3 left-3 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: 'rgba(15,13,24,0.82)', color: '#d4a373' }}>
              Score: {score} | Lvl {level}
            </div>
            <div className="absolute top-3 right-3 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: 'rgba(15,13,24,0.82)', color: '#d4a373' }}>
              {heightMeters}м • {selectedMode}
            </div>
            <div className="absolute bottom-24 left-3 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: 'rgba(15,13,24,0.82)', color: '#d4a373' }}>
              💰 {coinsCollected} • x{chainMultiplier.toFixed(1)}
            </div>

            {/* Visible control buttons */}
            <div className="absolute bottom-3 left-0 right-0 px-3 flex items-center justify-between pointer-events-none">
              <button
                className="w-16 h-14 rounded-xl text-2xl font-bold text-white pointer-events-auto"
                style={{ background: 'rgba(0,0,0,0.45)' }}
                onTouchStart={(e) => { e.preventDefault(); touchControl('left', true); }}
                onTouchEnd={(e) => { e.preventDefault(); touchControl('left', false); }}
                onMouseDown={() => touchControl('left', true)}
                onMouseUp={() => touchControl('left', false)}
                onMouseLeave={() => touchControl('left', false)}
              >
                ◀
              </button>

              <button
                className="w-16 h-14 rounded-xl text-2xl font-bold text-white pointer-events-auto"
                style={{ background: 'rgba(0,0,0,0.55)' }}
                onTouchStart={(e) => { e.preventDefault(); touchControl('jump', true); }}
                onMouseDown={() => touchControl('jump', true)}
              >
                ⤒
              </button>

              <button
                className="w-16 h-14 rounded-xl text-2xl font-bold text-white pointer-events-auto"
                style={{ background: 'rgba(0,0,0,0.45)' }}
                onTouchStart={(e) => { e.preventDefault(); touchControl('right', true); }}
                onTouchEnd={(e) => { e.preventDefault(); touchControl('right', false); }}
                onMouseDown={() => touchControl('right', true)}
                onMouseUp={() => touchControl('right', false)}
                onMouseLeave={() => touchControl('right', false)}
              >
                ▶
              </button>
            </div>
          </>
        )}

        {phase === 'gameover' && (
          <div className="absolute inset-0 bg-black/65 rounded-2xl flex flex-col items-center justify-center text-center px-4">
            <h3 className="text-2xl font-extrabold" style={{ color: '#d4a373' }}>Game Over</h3>
            <p className="text-white mt-2">Score: <b>{finalScore}</b> • Height: <b>{heightMeters}м</b></p>
            <p className="text-white/85 text-sm mt-1">Difficulty: {difficulty} • XP: {xp}</p>
            <p className="text-white/70 text-xs mt-1">Coins: {coinsCollected} • Chain day {chainDays}</p>
            {submitting && <p className="text-white/70 mt-2 text-sm">Синхронізація з лояльністю...</p>}
            {!submitting && submitted && (
              <p className="text-green-300 mt-2 text-sm">
                +{pointsAwarded} серверних балів • +{loyaltyBonus} bonus
              </p>
            )}
          </div>
        )}
      </div>

      {phase === 'menu' && (
        <div className="w-full max-w-[390px] space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'classic', label: 'Класичний' },
              { id: 'timed', label: 'На час (60с)' },
              { id: 'survival', label: 'Виживання' },
              { id: 'racing', label: 'Гонка' },
            ] as Array<{ id: GameMode; label: string }>).map((mode) => (
              <button
                key={mode.id}
                className="px-3 py-3 rounded-xl text-sm font-bold"
                style={{
                  background: selectedMode === mode.id ? 'linear-gradient(135deg, #6f3b16, #d4a373)' : 'rgba(31,41,55,0.9)',
                  color: '#fff',
                }}
                onClick={() => setSelectedMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <button
            className="w-full px-8 py-3 rounded-2xl font-bold text-white text-lg"
            style={{ background: 'linear-gradient(135deg, #6f3b16, #d4a373)' }}
            onClick={startGame}
          >
            ☕ Почати гру
          </button>

      {phase === 'gameover' && (
        <button
          className="px-6 py-3 rounded-2xl font-bold text-white"
          style={{ background: 'linear-gradient(135deg, #6f3b16, #d4a373)' }}
          onClick={() => setPhase('menu')}
        >
          ↺ Меню режимів
        </button>
      )}
    </div>
  );
}
