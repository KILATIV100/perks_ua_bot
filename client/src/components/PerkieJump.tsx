/**
 * Perkie Coffee Jump — Doodle-Jump clone on HTML5 Canvas
 *
 * Gameplay:
 *  - Перкі (coffee mascot) jumps automatically when landing on a platform
 *  - Control left/right via device accelerometer (devicemotion) or on-screen tap buttons
 *  - Platforms: Normal (white foam), Moving (drifting left-right), Spring (high jump)
 *  - Camera scrolls upward; game over when Перкі falls below the screen
 *  - Score = platforms cleared / height gained
 *
 * Security:
 *  - Score and timestamp are combined with a client-side salt and SHA-256'd
 *  - hash = SHA-256(`${score}${SALT}${timestamp}`)
 *  - Server re-computes the hash to reject tampered scores
 *  - The salt is also on the server as GAME_SCORE_SECRET_SALT env var
 */

import { useEffect, useRef, useCallback, useState } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANVAS_W = 390;
const CANVAS_H = 650;

const GRAVITY = 0.35;
const JUMP_VY = -13;           // Normal jump velocity (upward = negative)
const SPRING_VY = -20;         // Spring platform boost
const PLAYER_W = 44;
const PLAYER_H = 44;
const PLAYER_MOVE_SPEED = 5;   // px per frame horizontal speed

const PLATFORM_W = 72;
const PLATFORM_H = 14;
const PLATFORM_GAP_MIN = 70;   // min vertical gap between platforms
const PLATFORM_GAP_MAX = 110;  // max vertical gap (increases with height/score)
const MOVING_PLATFORM_SPEED = 1.5;

// Client-side salt — must match GAME_SCORE_SECRET_SALT on the server
const CLIENT_SALT = import.meta.env.VITE_GAME_SALT ?? 'perkie-default-salt-change-me';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlatformType = 'normal' | 'moving' | 'spring';

interface Platform {
  x: number;
  y: number;
  type: PlatformType;
  dx: number; // velocity for moving platforms
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
  score: number;
  cameraY: number;   // top of the visible world (world-space Y)
  gameOver: boolean;
  startTime: number;
}

interface PerkieJumpProps {
  telegramId?: string;
  apiUrl?: string;
  onScoreSubmit?: (score: number, pointsAwarded: number) => void;
}

// ---------------------------------------------------------------------------
// SHA-256 via Web Crypto API (async)
// ---------------------------------------------------------------------------

async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Platform generation
// ---------------------------------------------------------------------------

function makePlatform(y: number, score: number): Platform {
  // Higher score → more moving/spring platforms
  const rand = Math.random();
  const movingChance = Math.min(0.1 + score * 0.0005, 0.4);
  const springChance = Math.min(0.03 + score * 0.0001, 0.12);

  let type: PlatformType = 'normal';
  if (rand < springChance) type = 'spring';
  else if (rand < springChance + movingChance) type = 'moving';

  return {
    x: Math.random() * (CANVAS_W - PLATFORM_W),
    y,
    type,
    dx: type === 'moving' ? MOVING_PLATFORM_SPEED * (Math.random() < 0.5 ? 1 : -1) : 0,
  };
}

function generateInitialPlatforms(): Platform[] {
  const platforms: Platform[] = [];
  // First platform under the player (guaranteed landing)
  platforms.push({ x: CANVAS_W / 2 - PLATFORM_W / 2, y: CANVAS_H - 80, type: 'normal', dx: 0 });

  let y = CANVAS_H - 80 - PLATFORM_GAP_MIN;
  while (y > -CANVAS_H) {
    platforms.push(makePlatform(y, 0));
    y -= PLATFORM_GAP_MIN + Math.random() * (PLATFORM_GAP_MAX - PLATFORM_GAP_MIN);
  }
  return platforms;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawPlatform(ctx: CanvasRenderingContext2D, p: Platform, camY: number): void {
  const screenY = p.y - camY;

  if (p.type === 'spring') {
    // Green platform with spring indicator
    ctx.fillStyle = '#4ade80';
    ctx.shadowColor = '#16a34a';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.roundRect(p.x, screenY, PLATFORM_W, PLATFORM_H, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Spring coil symbol
    ctx.fillStyle = '#166534';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('⚡', p.x + PLATFORM_W / 2 - 6, screenY + 11);
  } else if (p.type === 'moving') {
    // Blue moving platform
    ctx.fillStyle = '#60a5fa';
    ctx.shadowColor = '#2563eb';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.roundRect(p.x, screenY, PLATFORM_W, PLATFORM_H, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    // Normal: milk foam look (white/cream)
    const grad = ctx.createLinearGradient(p.x, screenY, p.x, screenY + PLATFORM_H);
    grad.addColorStop(0, '#fefce8');
    grad.addColorStop(1, '#d4b896');
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.roundRect(p.x, screenY, PLATFORM_W, PLATFORM_H, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Foam bubble dots
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(p.x + 10 + i * 16, screenY + 5, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, player: Player, camY: number): void {
  const sx = player.x;
  const sy = player.y - camY;

  ctx.save();
  if (player.facing === 'left') {
    ctx.translate(sx + PLAYER_W, sy);
    ctx.scale(-1, 1);
    ctx.translate(-sx, -sy);
  }

  // Body — coffee cup
  ctx.fillStyle = '#92400e';
  ctx.beginPath();
  ctx.roundRect(sx + 8, sy + 16, PLAYER_W - 16, PLAYER_H - 16, 6);
  ctx.fill();

  // Cup sleeve
  ctx.fillStyle = '#78350f';
  ctx.fillRect(sx + 8, sy + 24, PLAYER_W - 16, 8);

  // Handle
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(sx + PLAYER_W - 4, sy + 28, 6, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();

  // Foam top
  ctx.fillStyle = '#fef3c7';
  ctx.beginPath();
  ctx.ellipse(sx + PLAYER_W / 2, sy + 16, (PLAYER_W - 16) / 2, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#1c1917';
  ctx.beginPath();
  ctx.arc(sx + PLAYER_W / 2 - 5, sy + 8, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + PLAYER_W / 2 + 5, sy + 8, 3, 0, Math.PI * 2);
  ctx.fill();

  // Smile
  ctx.strokeStyle = '#1c1917';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx + PLAYER_W / 2, sy + 11, 4, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, '#1e1b4b');
  grad.addColorStop(0.5, '#312e81');
  grad.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawScore(ctx: CanvasRenderingContext2D, score: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`☕ ${score}`, 16, 38);
}

function drawControls(ctx: CanvasRenderingContext2D): void {
  // Left arrow button
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.roundRect(8, CANVAS_H - 80, 72, 64, 12);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('◀', 44, CANVAS_H - 38);

  // Right arrow button
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.roundRect(CANVAS_W - 80, CANVAS_H - 80, 72, 64, 12);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('▶', CANVAS_W - 44, CANVAS_H - 38);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PerkieJump({ telegramId, apiUrl, onScoreSubmit }: PerkieJumpProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const animFrameRef = useRef<number>(0);
  const inputRef = useRef({ left: false, right: false, accelX: 0 });
  const [gamePhase, setGamePhase] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [finalScore, setFinalScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pointsEarned, setPointsEarned] = useState(0);

  // ── Initialize / restart game ───────────────────────────────────────────
  const startGame = useCallback(() => {
    const platforms = generateInitialPlatforms();
    stateRef.current = {
      player: {
        x: CANVAS_W / 2 - PLAYER_W / 2,
        y: CANVAS_H - 80 - PLAYER_H, // just above first platform
        vy: JUMP_VY,
        facing: 'right',
      },
      platforms,
      score: 0,
      cameraY: 0,
      gameOver: false,
      startTime: Date.now(),
    };
    setGamePhase('playing');
    setSubmitted(false);
    setPointsEarned(0);
  }, []);

  // ── Score submission ────────────────────────────────────────────────────
  const submitScore = useCallback(
    async (score: number, durationMs: number) => {
      if (!telegramId || !apiUrl) return;
      setSubmitting(true);
      try {
        const timestamp = Date.now();
        const hash = await sha256(`${score}${CLIENT_SALT}${timestamp}`);
        const res = await fetch(`${apiUrl}/api/games/submit-score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegramId, score, timestamp, hash, gameDurationMs: durationMs }),
        });
        if (res.ok) {
          const data = await res.json() as { pointsAwarded?: number };
          const pts = data.pointsAwarded ?? 0;
          setPointsEarned(pts);
          onScoreSubmit?.(score, pts);
          setSubmitted(true);
        }
      } catch {
        // silent — offline or server error
      } finally {
        setSubmitting(false);
      }
    },
    [telegramId, apiUrl, onScoreSubmit],
  );

  // ── Main game loop ──────────────────────────────────────────────────────
  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const gs = stateRef.current;
    if (!canvas || !ctx || !gs || gs.gameOver) return;

    const inp = inputRef.current;

    // ── Horizontal movement ──────────────────────────────────────────────
    const accelInput = Math.abs(inp.accelX) > 2 ? inp.accelX / 9.8 : 0; // normalize ~1g
    let dx = 0;
    if (inp.left || accelInput < -0.15) { dx = -PLAYER_MOVE_SPEED; gs.player.facing = 'left'; }
    if (inp.right || accelInput > 0.15) { dx = PLAYER_MOVE_SPEED; gs.player.facing = 'right'; }

    gs.player.x += dx;
    // Wrap horizontally
    if (gs.player.x + PLAYER_W < 0) gs.player.x = CANVAS_W;
    if (gs.player.x > CANVAS_W) gs.player.x = -PLAYER_W;

    // ── Vertical physics ─────────────────────────────────────────────────
    gs.player.vy += GRAVITY;
    gs.player.y += gs.player.vy;

    // ── Platform collision (only when falling down) ──────────────────────
    if (gs.player.vy > 0) {
      const pFeet = gs.player.y + PLAYER_H;
      const pLeft = gs.player.x;
      const pRight = gs.player.x + PLAYER_W;

      for (const plat of gs.platforms) {
        const prevFeet = pFeet - gs.player.vy;
        const platTop = plat.y;
        const platRight = plat.x + PLATFORM_W;

        if (
          prevFeet <= platTop &&
          pFeet >= platTop &&
          pRight > plat.x + 4 &&
          pLeft < platRight - 4
        ) {
          gs.player.y = plat.y - PLAYER_H;
          gs.player.vy = plat.type === 'spring' ? SPRING_VY : JUMP_VY;
          break;
        }
      }
    }

    // ── Camera scroll ────────────────────────────────────────────────────
    // Scroll up when player reaches upper 40% of screen
    const playerScreenY = gs.player.y - gs.cameraY;
    if (playerScreenY < CANVAS_H * 0.4) {
      const scrollAmount = CANVAS_H * 0.4 - playerScreenY;
      gs.cameraY -= scrollAmount;
      gs.score = Math.max(gs.score, Math.floor(-gs.cameraY / 100));
    }

    // ── Update moving platforms ──────────────────────────────────────────
    for (const plat of gs.platforms) {
      if (plat.type === 'moving') {
        plat.x += plat.dx;
        if (plat.x <= 0 || plat.x + PLATFORM_W >= CANVAS_W) plat.dx *= -1;
      }
    }

    // ── Generate new platforms at top ────────────────────────────────────
    const topPlatY = Math.min(...gs.platforms.map((p) => p.y));
    if (topPlatY > gs.cameraY - CANVAS_H) {
      const gapMultiplier = Math.min(1 + gs.score * 0.001, 1.5);
      const gap = PLATFORM_GAP_MIN + Math.random() * (PLATFORM_GAP_MAX - PLATFORM_GAP_MIN) * gapMultiplier;
      gs.platforms.push(makePlatform(topPlatY - gap, gs.score));
    }

    // ── Cull platforms that are way off the bottom ───────────────────────
    gs.platforms = gs.platforms.filter((p) => p.y < gs.cameraY + CANVAS_H + 200);

    // ── Game over: player fell below screen ──────────────────────────────
    if (gs.player.y - gs.cameraY > CANVAS_H + 100) {
      gs.gameOver = true;
      const duration = Date.now() - gs.startTime;
      setFinalScore(gs.score);
      setGamePhase('gameover');
      submitScore(gs.score, duration);
      return;
    }

    // ── Draw ─────────────────────────────────────────────────────────────
    drawBackground(ctx);
    for (const plat of gs.platforms) {
      const screenY = plat.y - gs.cameraY;
      if (screenY > -PLATFORM_H && screenY < CANVAS_H + PLATFORM_H) {
        drawPlatform(ctx, plat, gs.cameraY);
      }
    }
    drawPlayer(ctx, gs.player, gs.cameraY);
    drawScore(ctx, gs.score);
    drawControls(ctx);

    animFrameRef.current = requestAnimationFrame(gameLoop);
  }, [submitScore]);

  // ── Start/stop loop when phase changes ─────────────────────────────────
  useEffect(() => {
    if (gamePhase === 'playing') {
      animFrameRef.current = requestAnimationFrame(gameLoop);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [gamePhase, gameLoop]);

  // ── Input: keyboard (desktop) ───────────────────────────────────────────
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

  // ── Input: device accelerometer ─────────────────────────────────────────
  useEffect(() => {
    const onMotion = (e: DeviceMotionEvent) => {
      const accel = e.accelerationIncludingGravity;
      if (accel?.x !== null && accel?.x !== undefined) {
        inputRef.current.accelX = accel.x;
      }
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, []);

  // ── Input: touch buttons on canvas ─────────────────────────────────────
  const handleCanvasTouch = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;

    let leftPressed = false;
    let rightPressed = false;

    for (let i = 0; i < e.touches.length; i++) {
      const tx = (e.touches[i].clientX - rect.left) * scaleX;
      const ty = (e.touches[i].clientY - rect.top) * (CANVAS_H / rect.height);
      // Left button zone: x 8–80, y CANVAS_H-80 to CANVAS_H-16
      if (tx >= 8 && tx <= 80 && ty >= CANVAS_H - 80 && ty <= CANVAS_H - 16) leftPressed = true;
      // Right button zone: x CANVAS_W-80 to CANVAS_W-8
      if (tx >= CANVAS_W - 80 && tx <= CANVAS_W - 8 && ty >= CANVAS_H - 80 && ty <= CANVAS_H - 16) rightPressed = true;
    }

    inputRef.current.left = leftPressed;
    inputRef.current.right = rightPressed;
  }, []);

  const handleCanvasTouchEnd = useCallback(() => {
    inputRef.current.left = false;
    inputRef.current.right = false;
  }, []);

  // ── Idle screen drawing ─────────────────────────────────────────────────
  useEffect(() => {
    if (gamePhase !== 'idle') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    drawBackground(ctx);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Perkie Coffee Jump', CANVAS_W / 2, CANVAS_H / 2 - 60);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Стрибай по молочній пінці!', CANVAS_W / 2, CANVAS_H / 2 - 20);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '15px sans-serif';
    ctx.fillText('Нахили телефон або тапай кнопки', CANVAS_W / 2, CANVAS_H / 2 + 20);
  }, [gamePhase]);

  // ── Game-over screen drawing ────────────────────────────────────────────
  useEffect(() => {
    if (gamePhase !== 'gameover') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Dark overlay
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('Гра закінчена! ☕', CANVAS_W / 2, CANVAS_H / 2 - 70);

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(`Рахунок: ${finalScore}`, CANVAS_W / 2, CANVAS_H / 2 - 20);

    if (submitting) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '16px sans-serif';
      ctx.fillText('Зберігаємо результат...', CANVAS_W / 2, CANVAS_H / 2 + 20);
    } else if (submitted) {
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(`+${pointsEarned} балів! 🎉`, CANVAS_W / 2, CANVAS_H / 2 + 20);
    }
  }, [gamePhase, finalScore, submitting, submitted, pointsEarned]);

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="rounded-2xl w-full max-w-[390px] touch-none"
        style={{ imageRendering: 'pixelated', maxHeight: '70vh', objectFit: 'contain' }}
        onTouchStart={handleCanvasTouch}
        onTouchMove={handleCanvasTouch}
        onTouchEnd={handleCanvasTouchEnd}
        onTouchCancel={handleCanvasTouchEnd}
      />

      {gamePhase === 'idle' && (
        <button
          className="px-8 py-3 rounded-2xl font-bold text-white text-lg"
          style={{ background: 'linear-gradient(135deg, #92400e, #d97706)' }}
          onClick={startGame}
        >
          ☕ Почати гру
        </button>
      )}

      {gamePhase === 'gameover' && (
        <div className="flex gap-3">
          <button
            className="px-6 py-3 rounded-2xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #92400e, #d97706)' }}
            onClick={startGame}
          >
            ↺ Ще раз
          </button>
        </div>
      )}

      {gamePhase === 'playing' && (
        <p className="text-xs opacity-50 text-center">
          Нахили телефон або тапай ◀ ▶
        </p>
      )}
    </div>
  );
}
