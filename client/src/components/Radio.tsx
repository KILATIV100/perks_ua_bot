import { useState, useRef, useEffect } from 'react';

interface RadioProps {
  theme: {
    bgColor: string;
    textColor: string;
    hintColor: string;
    buttonColor: string;
    buttonTextColor: string;
    secondaryBgColor: string;
  };
}

const RADIO_STREAM_URL = 'https://icecast.skyrock.net/s/natio_mp3_128k';

export function Radio({ theme }: RadioProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.7);

  useEffect(() => {
    const audio = new Audio(RADIO_STREAM_URL);
    audio.volume = volume;
    audioRef.current = audio;

    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));
    audio.addEventListener('error', () => setIsPlaying(false));

    return () => {
      audio.pause();
      audio.src = '';
      audio.removeEventListener('play', () => setIsPlaying(true));
      audio.removeEventListener('pause', () => setIsPlaying(false));
      audio.removeEventListener('error', () => setIsPlaying(false));
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {
        setIsPlaying(false);
      });
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  return (
    <div className="p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
      <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ color: theme.textColor }}>
        <span>📻</span> PerkUp Radio
      </h3>

      <div className="flex items-center gap-4 mb-4">
        {/* Play/Pause Button */}
        <button
          onClick={togglePlay}
          className="w-14 h-14 rounded-full flex items-center justify-center text-2xl transition-all active:scale-90"
          style={{
            backgroundColor: isPlaying ? '#EF4444' : theme.buttonColor,
            color: '#ffffff',
          }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <div className="flex-1">
          <p className="text-sm font-medium" style={{ color: theme.textColor }}>
            {isPlaying ? 'Зараз грає' : 'Радіо вимкнено'}
          </p>
          <p className="text-xs" style={{ color: theme.hintColor }}>
            Skyrock Radio Stream
          </p>

          {/* Animated equalizer */}
          {isPlaying && (
            <div className="flex items-end gap-0.5 mt-2 h-4">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full animate-pulse"
                  style={{
                    backgroundColor: theme.buttonColor,
                    height: `${Math.random() * 100}%`,
                    animationDelay: `${i * 0.1}s`,
                    animationDuration: `${0.4 + Math.random() * 0.4}s`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Volume Control */}
      <div className="flex items-center gap-3">
        <span className="text-sm" style={{ color: theme.hintColor }}>🔈</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={handleVolumeChange}
          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${theme.buttonColor} ${volume * 100}%, ${theme.hintColor}30 ${volume * 100}%)`,
          }}
        />
        <span className="text-sm" style={{ color: theme.hintColor }}>🔊</span>
      </div>
    </div>
  );
}
