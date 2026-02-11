import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';

interface PerkieJumpProps {
  apiUrl: string;
  telegramId: number;
  theme: {
    bgColor: string;
    textColor: string;
    hintColor: string;
    buttonColor: string;
    buttonTextColor: string;
    secondaryBgColor: string;
  };
  onPointsUpdate?: (newBalance: number) => void;
}

// Game score hash — must match server's GAME_SCORE_SECRET
const GAME_SCORE_SECRET = 'perkup-game-salt-2024';

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Platform types
interface Platform {
  x: number;
  y: number;
  width: number;
  type: 'normal' | 'moving' | 'breaking';
  dx?: number; // for moving platforms
  broken?: boolean;
}

// Player state
interface Player {
  x: number;
  y: number;
  width: number;
  height: number;
  vy: number;
  vx: number;
  isJumping: boolean;
  facingRight: boolean;
}

const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 500;
const GRAVITY = 0.35;
const JUMP_FORCE = -10;
const MOVE_SPEED = 5;
const PLATFORM_HEIGHT = 10;
const PLAYER_WIDTH = 30;
const PLAYER_HEIGHT = 35;

export function PerkieJump({ apiUrl, telegramId, theme, onPointsUpdate }: PerkieJumpProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover'>('menu');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ pointsAwarded: number; gamesRemaining: number } | null>(null);
  const gameRef = useRef<{
    player: Player;
    platforms: Platform[];
    score: number;
    maxHeight: number;
    cameraY: number;
    startTime: number;
    animId: number;
    tiltX: number;
    touchStartX: number | null;
  } | null>(null);

  // Load high score
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`perkiejump_highscore_${telegramId}`);
      if (saved) setHighScore(parseInt(saved));
    } catch { /* ignore */ }
  }, [telegramId]);

  const generatePlatforms = useCallback((): Platform[] => {
    const platforms: Platform[] = [];
    // Base platform (safe landing)
    platforms.push({ x: CANVAS_WIDTH / 2 - 40, y: CANVAS_HEIGHT - 30, width: 80, type: 'normal' });

    let y = CANVAS_HEIGHT - 80;
    while (y > -CANVAS_HEIGHT * 2) {
      const x = Math.random() * (CANVAS_WIDTH - 70);
      const rand = Math.random();
      let type: Platform['type'] = 'normal';
      if (y < CANVAS_HEIGHT - 300) {
        if (rand < 0.15) type = 'moving';
        else if (rand < 0.25) type = 'breaking';
      }
      platforms.push({
        x,
        y,
        width: 65,
        type,
        dx: type === 'moving' ? (Math.random() > 0.5 ? 1.5 : -1.5) : undefined,
      });
      y -= 40 + Math.random() * 40;
    }
    return platforms;
  }, []);

  const startGame = useCallback(() => {
    const platforms = generatePlatforms();
    gameRef.current = {
      player: {
        x: CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2,
        y: CANVAS_HEIGHT - 70,
        width: PLAYER_WIDTH,
        height: PLAYER_HEIGHT,
        vy: JUMP_FORCE,
        vx: 0,
        isJumping: true,
        facingRight: true,
      },
      platforms,
      score: 0,
      maxHeight: 0,
      cameraY: 0,
      startTime: Date.now(),
      animId: 0,
      tiltX: 0,
      touchStartX: null,
    };
    setScore(0);
    setSubmitResult(null);
    setGameState('playing');
  }, [generatePlatforms]);

  // Device orientation (accelerometer)
  useEffect(() => {
    if (gameState !== 'playing') return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (gameRef.current && e.gamma !== null) {
        // gamma: left/right tilt [-90, 90]
        gameRef.current.tiltX = e.gamma / 15;
      }
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [gameState]);

  // Touch controls
  useEffect(() => {
    if (gameState !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (!gameRef.current) return;
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      gameRef.current.touchStartX = x;

      // Tap left/right half
      if (x < CANVAS_WIDTH / 2) {
        gameRef.current.player.vx = -MOVE_SPEED;
        gameRef.current.player.facingRight = false;
      } else {
        gameRef.current.player.vx = MOVE_SPEED;
        gameRef.current.player.facingRight = true;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (gameRef.current) {
        gameRef.current.player.vx = 0;
        gameRef.current.touchStartX = null;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!gameRef.current) return;
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      if (x < CANVAS_WIDTH / 2) {
        gameRef.current.player.vx = -MOVE_SPEED;
        gameRef.current.player.facingRight = false;
      } else {
        gameRef.current.player.vx = MOVE_SPEED;
        gameRef.current.player.facingRight = true;
      }
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchmove', handleTouchMove);
    };
  }, [gameState]);

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const gameLoop = () => {
      const game = gameRef.current;
      if (!game) return;

      const { player, platforms } = game;

      // Apply tilt/accelerometer
      if (Math.abs(game.tiltX) > 0.3) {
        player.vx = game.tiltX * MOVE_SPEED;
        player.facingRight = game.tiltX > 0;
      }

      // Physics
      player.vy += GRAVITY;
      player.y += player.vy;
      player.x += player.vx;

      // Wrap around screen
      if (player.x + player.width < 0) player.x = CANVAS_WIDTH;
      if (player.x > CANVAS_WIDTH) player.x = -player.width;

      // Platform collision (only when falling)
      if (player.vy > 0) {
        for (const platform of platforms) {
          if (platform.broken) continue;
          const playerBottom = player.y + player.height;
          const playerPrevBottom = playerBottom - player.vy;

          if (
            playerBottom >= platform.y &&
            playerPrevBottom <= platform.y + PLATFORM_HEIGHT &&
            player.x + player.width > platform.x + 5 &&
            player.x < platform.x + platform.width - 5
          ) {
            if (platform.type === 'breaking') {
              platform.broken = true;
            } else {
              player.vy = JUMP_FORCE;
              player.y = platform.y - player.height;
            }
          }
        }
      }

      // Move moving platforms
      for (const platform of platforms) {
        if (platform.type === 'moving' && platform.dx) {
          platform.x += platform.dx;
          if (platform.x <= 0 || platform.x + platform.width >= CANVAS_WIDTH) {
            platform.dx = -platform.dx;
          }
        }
      }

      // Camera follow
      const targetCameraY = player.y - CANVAS_HEIGHT / 3;
      if (targetCameraY < game.cameraY) {
        game.cameraY = targetCameraY;
      }

      // Score
      const height = Math.max(0, Math.floor((CANVAS_HEIGHT - player.y) / 10));
      if (height > game.maxHeight) {
        game.score += height - game.maxHeight;
        game.maxHeight = height;
      }
      setScore(game.score);

      // Generate more platforms above
      const highestPlatform = Math.min(...platforms.map(p => p.y));
      if (highestPlatform > game.cameraY - CANVAS_HEIGHT) {
        let y = highestPlatform - 50;
        while (y > game.cameraY - CANVAS_HEIGHT * 2) {
          const rand = Math.random();
          let type: Platform['type'] = 'normal';
          if (game.score > 30) {
            if (rand < 0.2) type = 'moving';
            else if (rand < 0.35) type = 'breaking';
          }
          platforms.push({
            x: Math.random() * (CANVAS_WIDTH - 65),
            y,
            width: 65,
            type,
            dx: type === 'moving' ? (Math.random() > 0.5 ? 1.5 : -1.5) : undefined,
          });
          y -= 40 + Math.random() * 40;
        }
      }

      // Remove platforms far below
      game.platforms = platforms.filter(p => p.y < game.cameraY + CANVAS_HEIGHT + 100);

      // Game over (fell below camera)
      if (player.y > game.cameraY + CANVAS_HEIGHT + 50) {
        setGameState('gameover');
        const finalScore = game.score;
        setScore(finalScore);
        if (finalScore > highScore) {
          setHighScore(finalScore);
          try { localStorage.setItem(`perkiejump_highscore_${telegramId}`, String(finalScore)); } catch { /* ignore */ }
        }
        submitScore(finalScore, game.startTime);
        return;
      }

      // Draw
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Background gradient (sky)
      const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      gradient.addColorStop(0, '#87CEEB');
      gradient.addColorStop(1, '#E0F7FA');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Draw platforms
      for (const platform of game.platforms) {
        if (platform.broken) continue;
        const screenY = platform.y - game.cameraY;
        if (screenY < -20 || screenY > CANVAS_HEIGHT + 20) continue;

        ctx.save();
        if (platform.type === 'normal') {
          // "Milk foam" platform
          ctx.fillStyle = '#F5F5DC';
          ctx.shadowColor = 'rgba(0,0,0,0.1)';
          ctx.shadowBlur = 4;
          ctx.shadowOffsetY = 2;
        } else if (platform.type === 'moving') {
          ctx.fillStyle = '#FFE0B2';
        } else if (platform.type === 'breaking') {
          ctx.fillStyle = '#FFCDD2';
        }

        ctx.beginPath();
        ctx.roundRect(platform.x, screenY, platform.width, PLATFORM_HEIGHT, 5);
        ctx.fill();
        ctx.restore();

        // Foam bubbles
        if (platform.type === 'normal') {
          ctx.fillStyle = '#FFFFFF80';
          ctx.beginPath();
          ctx.arc(platform.x + 10, screenY + 3, 3, 0, Math.PI * 2);
          ctx.arc(platform.x + platform.width - 15, screenY + 4, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw Perkie (mascot)
      const px = player.x;
      const py = player.y - game.cameraY;

      // Body (coffee cup shape)
      ctx.fillStyle = '#8B5A2B';
      ctx.beginPath();
      ctx.roundRect(px + 3, py + 8, player.width - 6, player.height - 8, 4);
      ctx.fill();

      // Cup rim
      ctx.fillStyle = '#D4A574';
      ctx.beginPath();
      ctx.roundRect(px, py + 5, player.width, 8, 3);
      ctx.fill();

      // Face
      const eyeX = player.facingRight ? 5 : -3;
      // Eyes
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(px + 10 + eyeX, py + 18, 4, 0, Math.PI * 2);
      ctx.arc(px + 22 + eyeX, py + 18, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(px + 11 + eyeX, py + 18, 2, 0, Math.PI * 2);
      ctx.arc(px + 23 + eyeX, py + 18, 2, 0, Math.PI * 2);
      ctx.fill();

      // Smile
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px + player.width / 2 + eyeX / 2, py + 22, 5, 0, Math.PI);
      ctx.stroke();

      // Steam
      if (player.vy < 0) {
        ctx.strokeStyle = '#FFFFFF80';
        ctx.lineWidth = 1;
        const time = Date.now() / 300;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          const sx = px + 8 + i * 7;
          ctx.moveTo(sx, py + 2);
          ctx.quadraticCurveTo(sx + Math.sin(time + i) * 4, py - 5, sx + Math.sin(time + i + 1) * 3, py - 10);
          ctx.stroke();
        }
      }

      // Score display
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`Score: ${game.score}`, 10, 25);

      animId = requestAnimationFrame(gameLoop);
      game.animId = animId;
    };

    animId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [gameState, highScore, telegramId]);

  const submitScore = async (finalScore: number, startTime: number) => {
    setSubmitting(true);
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const duration = Math.floor((Date.now() - startTime) / 1000);
      const hash = await sha256(`${finalScore}${GAME_SCORE_SECRET}${timestamp}`);

      const response = await axios.post(`${apiUrl}/api/games/submit-score`, {
        telegramId: String(telegramId),
        gameType: 'PERKIE_JUMP',
        score: finalScore,
        timestamp,
        hash,
        duration,
      });

      setSubmitResult({
        pointsAwarded: response.data.pointsAwarded,
        gamesRemaining: response.data.gamesRemainingToday,
      });

      if (response.data.newBalance && onPointsUpdate) {
        onPointsUpdate(response.data.newBalance);
      }
    } catch (err) {
      console.error('[PerkieJump] Submit error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Menu screen
  if (gameState === 'menu') {
    return (
      <div className="text-center">
        <div className="text-5xl mb-3">☕</div>
        <h3 className="text-lg font-semibold mb-1" style={{ color: theme.textColor }}>
          Perkie Jump
        </h3>
        <p className="text-sm mb-4" style={{ color: theme.hintColor }}>
          Стрибай якомога вище! Тапай ліво/право для керування.
        </p>
        {highScore > 0 && (
          <p className="text-sm mb-4 font-medium" style={{ color: theme.buttonColor }}>
            Рекорд: {highScore}
          </p>
        )}
        <button
          onClick={startGame}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98]"
          style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
        >
          Грати
        </button>
      </div>
    );
  }

  // Game over screen
  if (gameState === 'gameover') {
    return (
      <div className="text-center">
        <div className="text-4xl mb-3">{score >= highScore && score > 0 ? '🏆' : '💥'}</div>
        <h3 className="text-lg font-semibold mb-2" style={{ color: theme.textColor }}>
          Game Over!
        </h3>
        <p className="text-2xl font-bold mb-1" style={{ color: theme.buttonColor }}>
          {score}
        </p>
        <p className="text-sm mb-3" style={{ color: theme.hintColor }}>
          Рекорд: {highScore}
        </p>

        {submitting ? (
          <p className="text-sm mb-4" style={{ color: theme.hintColor }}>Зберігаємо результат...</p>
        ) : submitResult ? (
          <div className="mb-4 p-3 rounded-xl" style={{ backgroundColor: theme.secondaryBgColor }}>
            {submitResult.pointsAwarded > 0 ? (
              <p className="text-sm font-medium" style={{ color: '#22c55e' }}>
                +{submitResult.pointsAwarded} балів!
              </p>
            ) : (
              <p className="text-sm" style={{ color: theme.hintColor }}>
                Ліміт ігор на сьогодні вичерпано
              </p>
            )}
            <p className="text-xs mt-1" style={{ color: theme.hintColor }}>
              Залишилось ігор: {submitResult.gamesRemaining}
            </p>
          </div>
        ) : null}

        <button
          onClick={startGame}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98] mb-2"
          style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
        >
          Грати ще
        </button>
        <button
          onClick={() => setGameState('menu')}
          className="text-sm underline"
          style={{ color: theme.hintColor }}
        >
          Меню
        </button>
      </div>
    );
  }

  // Playing
  return (
    <div className="text-center">
      <div className="relative inline-block">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="rounded-2xl"
          style={{ touchAction: 'none', maxWidth: '100%' }}
        />
        <div className="absolute top-2 right-2 px-3 py-1 rounded-full text-sm font-bold"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: '#FFFFFF' }}>
          {score}
        </div>
      </div>
    </div>
  );
}
