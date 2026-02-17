import { useEffect, useMemo, useRef, useState } from 'react';

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
}

interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;
  coverUrl?: string | null;
  createdAt: string;
}

export function Radio({ apiUrl }: RadioProps) {
  const endpointBase = useMemo(() => (apiUrl || '').replace(/\/+$/, ''), [apiUrl]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTracks = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const endpoint = endpointBase ? `${endpointBase}/api/radio/tracks` : '/api/radio/tracks';
        const response = await fetch(endpoint);
        if (!response.ok) {
          throw new Error('Failed to fetch tracks');
        }

        const data = (await response.json()) as { tracks?: Track[] };
        setTracks(data.tracks || []);
      } catch (err) {
        console.error('[Radio] Tracks fetch error:', err);
        setError('Не вдалося завантажити плейлист');
      } finally {
        setIsLoading(false);
      }
    };

    loadTracks();
  }, [endpointBase]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || tracks.length === 0) return;

    audio.src = tracks[currentTrackIndex].url;

    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false));
    }
  }, [tracks, currentTrackIndex, isPlaying]);

  const playPause = async () => {
    const audio = audioRef.current;
    if (!audio || tracks.length === 0) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      if (!audio.src) {
        audio.src = tracks[currentTrackIndex].url;
      }
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  const nextTrack = () => {
    if (tracks.length === 0) return;
    setCurrentTrackIndex((prev) => (prev + 1) % tracks.length);
  };

  const prevTrack = () => {
    if (tracks.length === 0) return;
    setCurrentTrackIndex((prev) => (prev - 1 + tracks.length) % tracks.length);
  };

  const currentTrack = tracks[currentTrackIndex];

  return (
    <div className="rounded-2xl p-4 bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700">
      <h3 className="font-bold text-yellow-500 mb-3">📻 PerkUp Radio</h3>

      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={nextTrack}
      />

      {isLoading && <p className="text-sm text-gray-300">Loading...</p>}

      {!isLoading && error && (
        <p className="text-sm text-red-300">{error}</p>
      )}

      {!isLoading && !error && tracks.length === 0 && (
        <p className="text-sm text-gray-300">Плейлист порожній</p>
      )}

      {!isLoading && !error && currentTrack && (
        <>
          <div className="flex items-center gap-3 mb-4">
            {currentTrack.coverUrl ? (
              <img src={currentTrack.coverUrl} alt={currentTrack.title} className="w-16 h-16 rounded-xl object-cover" />
            ) : (
              <div className={`w-16 h-16 rounded-xl bg-gray-700 flex items-center justify-center text-2xl ${isPlaying ? 'animate-pulse' : ''}`}>
                ☕
              </div>
            )}

            <div>
              <p className="font-semibold text-white">{currentTrack.title}</p>
              <p className="text-sm text-gray-300">{currentTrack.artist}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={prevTrack} className="px-3 py-2 rounded-lg bg-yellow-500 text-gray-900 font-bold">Prev</button>
            <button onClick={playPause} className="px-4 py-2 rounded-lg bg-yellow-500 text-gray-900 font-bold">
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button onClick={nextTrack} className="px-3 py-2 rounded-lg bg-yellow-500 text-gray-900 font-bold">Next</button>
          </div>
        </>
      )}
    </div>
  );
}
