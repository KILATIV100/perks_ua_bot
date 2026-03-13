import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
// Import the game HTML as raw text to avoid Vite SPA routing intercepting the request
import gameHtml from '../../public/games/perky-jump-3d.html?raw';

const CLIENT_SALT = import.meta.env.VITE_GAME_SALT ?? 'perkie-default-salt-change-me';

async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface PerkyJump3DProps {
  telegramId?: string;
  apiUrl?: string;
  onPointsEarned?: (points: number) => void;
  onClose?: () => void;
}

interface GameOverMessage {
  type: 'PERKY_JUMP_3D_GAMEOVER';
  score: number;
  height: number;
  beans: number;
  mode: string;
  isNewRecord: boolean;
  gameDurationMs: number;
}

export function PerkyJump3D({ telegramId, apiUrl, onPointsEarned, onClose }: PerkyJump3DProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ pointsAwarded: number; limitReached: boolean } | null>(null);

  // Create a blob URL from the raw HTML so Vite's SPA fallback never intercepts it
  const blobUrl = useMemo(() => {
    const blob = new Blob([gameHtml], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, []);

  useEffect(() => {
    return () => URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  const submitScore = useCallback(async (payload: GameOverMessage) => {
    if (!telegramId || !apiUrl) return;
    setSubmitting(true);
    try {
      const timestamp = Date.now();
      const hash = await sha256(`${payload.score}${CLIENT_SALT}${timestamp}`);
      const res = await fetch(`${apiUrl}/api/games/submit-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId,
          score: payload.score,
          timestamp,
          hash,
          gameDurationMs: payload.gameDurationMs,
          mode: payload.mode,
          heightMeters: payload.height,
          coinsCollected: payload.beans,
        }),
      });

      if (res.ok) {
        const data = await res.json() as { pointsAwarded?: number; limitReached?: boolean };
        const result = {
          pointsAwarded: data.pointsAwarded ?? 0,
          limitReached: data.limitReached ?? false,
        };
        setLastResult(result);

        // Notify the game iframe about points result
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'PERKY_JUMP_3D_POINTS', ...result },
          '*',
        );

        if (result.pointsAwarded > 0) {
          onPointsEarned?.(result.pointsAwarded);
        }
      }
    } catch {
      // silently ignore network errors
    } finally {
      setSubmitting(false);
    }
  }, [telegramId, apiUrl, onPointsEarned]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'PERKY_JUMP_3D_GAMEOVER') {
        submitScore(event.data as GameOverMessage);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [submitScore]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ background: 'rgba(26,26,46,0.95)', borderBottom: '1px solid rgba(212,165,116,0.2)' }}
      >
        <span className="font-bold text-sm" style={{ color: '#D4A574' }}>☕ Perky Jump 3D</span>
        <div className="flex items-center gap-3">
          {submitting && (
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Синхронізація...
            </span>
          )}
          {lastResult && !submitting && lastResult.pointsAwarded > 0 && (
            <span className="text-xs font-bold" style={{ color: '#D4A574' }}>
              +{lastResult.pointsAwarded} балів
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg text-sm font-medium"
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}
          >
            Закрити
          </button>
        </div>
      </div>

      {/* Game iframe loaded via blob URL — bypasses Vite SPA routing */}
      <iframe
        ref={iframeRef}
        src={blobUrl}
        className="flex-1 w-full border-0"
        title="Perky Coffee Jump 3D"
        allow="accelerometer; gyroscope; vibrate"
        sandbox="allow-scripts"
      />
    </div>
  );
}
