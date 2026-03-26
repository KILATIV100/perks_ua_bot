/**
 * LiveFeed — Real-time order activity stream
 * Shows anonymized orders happening across PerkUp locations
 */

import { useEffect, useState, useRef } from 'react';

interface FeedItem {
  id: string;
  location: string;
  items: Array<{ name: string; quantity: number }>;
  timeAgo: string;
}

interface LiveStats {
  hitOfDay: { name: string; count: number } | null;
  totalOrdersToday: number;
  activeUsersToday: number;
}

interface LiveFeedProps {
  apiUrl: string;
  theme: {
    bgColor: string;
    textColor: string;
    hintColor: string;
    buttonColor: string;
    secondaryBgColor: string;
  };
}

export function LiveFeed({ apiUrl, theme }: LiveFeedProps) {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [loading, setLoading] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [feedRes, statsRes] = await Promise.all([
        fetch(`${apiUrl}/api/live-feed/recent?limit=10`),
        fetch(`${apiUrl}/api/live-feed/stats`),
      ]);

      if (feedRes.ok) {
        const data = await feedRes.json();
        setFeed(data.feed || []);
      }
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      }
    } catch (err) {
      console.error('LiveFeed fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 rounded-2xl text-center" style={{ backgroundColor: theme.bgColor }}>
        <p style={{ color: theme.hintColor }}>Завантаження...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Live indicator */}
      <div className="p-4 rounded-2xl" style={{ backgroundColor: '#1a0a00', color: '#FFF8F0' }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-mono uppercase tracking-wider opacity-60">LIVE — PerkUP Network</span>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="flex gap-4 mb-4 text-xs">
            {stats.hitOfDay && (
              <div>
                <span className="opacity-40">Hit:</span>{' '}
                <span className="text-yellow-400">{stats.hitOfDay.name}</span>{' '}
                <span className="opacity-40">x{stats.hitOfDay.count}</span>
              </div>
            )}
            <div>
              <span className="opacity-40">Замовлень:</span>{' '}
              <span className="text-green-400">{stats.totalOrdersToday}</span>
            </div>
          </div>
        )}

        {/* Feed items */}
        <div ref={feedRef} className="space-y-2 max-h-64 overflow-y-auto">
          {feed.length === 0 ? (
            <p className="text-sm opacity-40 text-center py-4">Поки тихо... Замов першим!</p>
          ) : (
            feed.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0"
              >
                <span className="text-xs opacity-30 font-mono min-w-[60px]">{item.location}:</span>
                <div className="flex-1">
                  {item.items.map((product, i) => (
                    <span key={i} className="text-sm opacity-80">
                      {product.name}
                      {product.quantity > 1 && ` x${product.quantity}`}
                      {i < item.items.length - 1 && ', '}
                    </span>
                  ))}
                </div>
                <span className="text-xs text-cyan-400 opacity-60 whitespace-nowrap">{item.timeAgo}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
