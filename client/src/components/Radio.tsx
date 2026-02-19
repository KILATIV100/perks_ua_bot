import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface RadioProps {
  theme: {
    bgColor: string;
    textColor: string;
    hintColor: string;
    buttonColor: string;
    buttonTextColor: string;
    secondaryBgColor: string;
  };
  apiUrl?: string;
  telegramId?: number;
  userRole?: string | null;
}

interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;
  coverUrl?: string | null;
  isFavorite: boolean;
  favoriteCount: number;
}

type Tab = 'all' | 'favorites';

export function Radio({ theme, apiUrl, telegramId, userRole }: RadioProps) {
  const endpointBase = useMemo(() => (apiUrl || '').replace(/\/+$/, ''), [apiUrl]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [showPlaylist, setShowPlaylist] = useState(false);

  const isAdmin = userRole === 'ADMIN' || userRole === 'OWNER';

  const endpoint = useCallback(
    (path: string) => {
      const base = endpointBase ? `${endpointBase}/api/radio` : '/api/radio';
      const sep = path.includes('?') ? '&' : '?';
      const auth = telegramId ? `${sep}telegramId=${telegramId}` : '';
      return `${base}${path}${auth}`;
    },
    [endpointBase, telegramId],
  );

  const loadTracks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint('/tracks'));
      if (!response.ok) throw new Error('Failed to fetch tracks');
      const data = (await response.json()) as { tracks?: Track[] };
      setTracks(data.tracks || []);
    } catch (err) {
      console.error('[Radio] Tracks fetch error:', err);
      setError('Не вдалося завантажити плейлист');
    } finally {
      setIsLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  // Derived lists
  const displayTracks = useMemo(
    () => (activeTab === 'favorites' ? tracks.filter((t) => t.isFavorite) : tracks),
    [tracks, activeTab],
  );

  const currentTrack = displayTracks[currentTrackIndex] || null;

  // Audio source sync
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    if (audio.src !== currentTrack.url) {
      audio.src = currentTrack.url;
      if (isPlaying) {
        audio.play().catch(() => setIsPlaying(false));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  const playTrack = async (index: number) => {
    const audio = audioRef.current;
    if (!audio || displayTracks.length === 0) return;

    setCurrentTrackIndex(index);
    const track = displayTracks[index];
    audio.src = track.url;
    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  const playPause = async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      if (!audio.src || audio.src === window.location.href) {
        audio.src = currentTrack.url;
      }
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  const nextTrack = () => {
    if (displayTracks.length === 0) return;
    const next = (currentTrackIndex + 1) % displayTracks.length;
    playTrack(next);
  };

  const prevTrack = () => {
    if (displayTracks.length === 0) return;
    const prev = (currentTrackIndex - 1 + displayTracks.length) % displayTracks.length;
    playTrack(prev);
  };

  const toggleFavorite = async (trackId: string) => {
    if (!telegramId) return;
    try {
      const res = await fetch(endpoint('/favorite'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, telegramId: String(telegramId) }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { isFavorite: boolean };
      setTracks((prev) =>
        prev.map((t) => (t.id === trackId ? { ...t, isFavorite: data.isFavorite } : t)),
      );
    } catch (err) {
      console.error('[Radio] Favorite toggle error:', err);
    }
  };

  const deleteTrack = async (trackId: string) => {
    if (!telegramId) return;
    try {
      const res = await fetch(endpoint(`/tracks/${trackId}`), {
        method: 'DELETE',
      });
      if (!res.ok) return;
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
      if (currentTrack?.id === trackId) {
        setCurrentTrackIndex(0);
        setIsPlaying(false);
        if (audioRef.current) audioRef.current.pause();
      }
    } catch (err) {
      console.error('[Radio] Delete error:', err);
    }
  };

  // ── Styles ───────────────────────────────────────────────────────────
  const cardBg = theme.secondaryBgColor || '#1a1a2e';
  const accent = '#FFB300';
  const textPrimary = theme.textColor || '#fff';
  const textSecondary = theme.hintColor || '#aaa';

  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: cardBg, border: `1px solid ${theme.hintColor}20` }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <h3 className="font-bold" style={{ color: accent }}>
          PerkUp Radio
        </h3>
        {tracks.length > 0 && (
          <button
            onClick={() => setShowPlaylist(!showPlaylist)}
            className="text-xs px-2 py-1 rounded-lg"
            style={{ backgroundColor: `${accent}20`, color: accent }}
          >
            {showPlaylist ? 'Сховати' : `Плейлист (${tracks.length})`}
          </button>
        )}
      </div>

      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={nextTrack}
        preload="none"
      />

      {isLoading && (
        <div className="px-4 pb-4">
          <p className="text-sm" style={{ color: textSecondary }}>Завантаження...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="px-4 pb-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {!isLoading && !error && tracks.length === 0 && (
        <div className="px-4 pb-4">
          <p className="text-sm" style={{ color: textSecondary }}>
            Плейлист порожній. Додайте треки через бота.
          </p>
        </div>
      )}

      {!isLoading && !error && tracks.length > 0 && (
        <>
          {/* Now Playing */}
          {currentTrack && (
            <div className="px-4 pb-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${isPlaying ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: `${accent}15` }}
                >
                  {currentTrack.coverUrl ? (
                    <img src={currentTrack.coverUrl} alt="" className="w-14 h-14 rounded-xl object-cover" />
                  ) : (
                    <span>{isPlaying ? '🎵' : '☕'}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate" style={{ color: textPrimary }}>
                    {currentTrack.title}
                  </p>
                  <p className="text-xs truncate" style={{ color: textSecondary }}>
                    {currentTrack.artist}
                  </p>
                </div>

                {telegramId && (
                  <button
                    onClick={() => toggleFavorite(currentTrack.id)}
                    className="text-xl flex-shrink-0 p-1"
                    title={currentTrack.isFavorite ? 'Прибрати з улюблених' : 'Додати в улюблені'}
                  >
                    {currentTrack.isFavorite ? '❤️' : '🤍'}
                  </button>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-3 mt-3">
                <button
                  onClick={prevTrack}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                  style={{ backgroundColor: `${accent}20`, color: accent }}
                >
                  ⏮
                </button>
                <button
                  onClick={playPause}
                  className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold"
                  style={{ backgroundColor: accent, color: '#1a1a2e' }}
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <button
                  onClick={nextTrack}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                  style={{ backgroundColor: `${accent}20`, color: accent }}
                >
                  ⏭
                </button>
              </div>
            </div>
          )}

          {/* Playlist */}
          {showPlaylist && (
            <div style={{ borderTop: `1px solid ${theme.hintColor}20` }}>
              {/* Tabs */}
              <div className="flex px-4 pt-3 gap-2">
                <button
                  onClick={() => { setActiveTab('all'); setCurrentTrackIndex(0); }}
                  className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
                  style={{
                    backgroundColor: activeTab === 'all' ? accent : `${accent}15`,
                    color: activeTab === 'all' ? '#1a1a2e' : accent,
                  }}
                >
                  Всі ({tracks.length})
                </button>
                <button
                  onClick={() => { setActiveTab('favorites'); setCurrentTrackIndex(0); }}
                  className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
                  style={{
                    backgroundColor: activeTab === 'favorites' ? accent : `${accent}15`,
                    color: activeTab === 'favorites' ? '#1a1a2e' : accent,
                  }}
                >
                  Улюблені ({tracks.filter((t) => t.isFavorite).length})
                </button>
              </div>

              {/* Track List */}
              <div className="px-4 py-3 space-y-1 max-h-64 overflow-y-auto">
                {displayTracks.length === 0 && (
                  <p className="text-xs text-center py-4" style={{ color: textSecondary }}>
                    {activeTab === 'favorites'
                      ? 'Немає улюблених треків. Натисни 🤍 щоб додати.'
                      : 'Плейлист порожній.'}
                  </p>
                )}

                {displayTracks.map((track, index) => {
                  const isActive = currentTrack?.id === track.id;
                  return (
                    <div
                      key={track.id}
                      className="flex items-center gap-2 py-2 px-2 rounded-lg cursor-pointer transition-colors"
                      style={{
                        backgroundColor: isActive ? `${accent}15` : 'transparent',
                      }}
                      onClick={() => playTrack(index)}
                    >
                      {/* Track number or playing indicator */}
                      <span
                        className="w-6 text-center text-xs flex-shrink-0"
                        style={{ color: isActive ? accent : textSecondary }}
                      >
                        {isActive && isPlaying ? '🔊' : index + 1}
                      </span>

                      {/* Track info */}
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm truncate"
                          style={{ color: isActive ? accent : textPrimary }}
                        >
                          {track.title}
                        </p>
                        <p className="text-xs truncate" style={{ color: textSecondary }}>
                          {track.artist}
                        </p>
                      </div>

                      {/* Favorite button */}
                      {telegramId && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(track.id);
                          }}
                          className="text-sm flex-shrink-0 p-1"
                        >
                          {track.isFavorite ? '❤️' : '🤍'}
                        </button>
                      )}

                      {/* Admin delete button */}
                      {isAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Видалити "${track.title}"?`)) {
                              deleteTrack(track.id);
                            }
                          }}
                          className="text-sm flex-shrink-0 p-1 opacity-50 hover:opacity-100"
                          title="Видалити трек"
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
