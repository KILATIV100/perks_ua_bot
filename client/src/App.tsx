import { useEffect, useState, useMemo, useCallback } from 'react';
import axios from 'axios';
import WebApp from '@twa-dev/sdk';
import { WheelOfFortune } from './components/WheelOfFortune';
import { Menu, CartItem } from './components/Menu';
import { Radio } from './components/Radio';
import { TicTacToe } from './components/TicTacToe';
import { Checkout } from './components/Checkout';

type TabType = 'locations' | 'menu' | 'shop' | 'games' | 'bonuses';

const resolveApiUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const paramUrl = params.get('api');
  const windowUrl = (window as unknown as { __PERKUP_API_URL?: string }).__PERKUP_API_URL;
  const rawUrl = paramUrl || windowUrl || import.meta.env.VITE_API_URL || 'https://backend-production-5ee9.up.railway.app';
  return rawUrl.replace(/\/+$/, '');
};

const API_URL = resolveApiUrl();
const BOT_USERNAME = 'perkup_ua_bot';
const KYIV_TIME_ZONE = 'Europe/Kyiv';

const api = axios.create({ baseURL: API_URL });

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('locations');
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [appUser, setAppUser] = useState<any>(null);
  const [canSpin, setCanSpin] = useState(true);
  const [nextSpinAt, setNextSpinAt] = useState<string | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [gameMode, setGameMode] = useState<'online' | 'offline'>('online');
  const [funZoneGame, setFunZoneGame] = useState<'tic-tac-toe' | 'perkie-catch' | 'barista-rush' | 'memory-coffee' | 'perkie-jump' | 'radio'>('tic-tac-toe');
  const [referralCopied, setReferralCopied] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  const theme = useMemo(() => {
    const params = WebApp.themeParams;
    return {
      bgColor: params.bg_color || '#ffffff',
      textColor: params.text_color || '#000000',
      hintColor: params.hint_color || '#999999',
      buttonColor: params.button_color || '#8B5A2B',
      buttonTextColor: params.button_text_color || '#ffffff',
      secondaryBgColor: params.secondary_bg_color || '#f5f5f5',
    };
  }, []);

  const telegramUser = useMemo(() => {
    const user = WebApp.initDataUnsafe?.user;
    if (user) return { id: user.id, firstName: user.first_name, username: user.username };
    const params = new URLSearchParams(window.location.search);
    const id = params.get('telegramId');
    if (id) {
      return {
        id: Number(id),
        firstName: params.get('firstName') || 'Guest',
        username: params.get('username') || undefined,
      };
    }
    return null;
  }, []);

  const startParam = useMemo(() => WebApp.initDataUnsafe?.start_param, []);
  const referralId = useMemo(() => {
    if (startParam?.startsWith('ref_')) {
      return startParam.replace('ref_', '');
    }
    return null;
  }, [startParam]);
  const gameIdFromUrl = useMemo(() => {
    if (startParam?.startsWith('game_')) {
      return startParam.replace('game_', '');
    }
    return null;
  }, [startParam]);

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    if (!telegramUser) {
      setLoading(false);
    }
    syncUser();
    fetchLocations();
  }, [telegramUser]);

  const syncUser = async () => {
    if (!telegramUser) return;
    try {
      const { data } = await api.post('/api/user/sync', {
        telegramId: String(telegramUser.id),
        username: telegramUser.username,
        firstName: telegramUser.firstName,
        referrerId: referralId || undefined,
      });
      setAppUser(data.user);
      checkSpinAvailability(data.user.lastSpinDate);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getKyivDateString = (date = new Date()) =>
    date.toLocaleDateString('en-CA', { timeZone: KYIV_TIME_ZONE });

  const getNextKyivMidnight = () => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: KYIV_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const year = Number(parts.find(part => part.type === 'year')?.value);
    const month = Number(parts.find(part => part.type === 'month')?.value);
    const day = Number(parts.find(part => part.type === 'day')?.value);
    const offsetFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: KYIV_TIME_ZONE,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
    });
    const nextDayAnchor = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
    const offsetValue = offsetFormatter.formatToParts(nextDayAnchor).find(part => part.type === 'timeZoneName')?.value || 'GMT+0';
    const match = offsetValue.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
    const offsetHours = match ? Number(match[1]) : 0;
    const offsetMinutes = match && match[2] ? Number(match[2]) : 0;
    const totalOffsetMinutes = offsetHours * 60 + Math.sign(offsetHours) * offsetMinutes;
    const utcMillis = Date.UTC(year, month - 1, day + 1, 0, 0, 0) - totalOffsetMinutes * 60 * 1000;
    return new Date(utcMillis);
  };

  const checkSpinAvailability = (lastSpinDate: string | null) => {
    const today = getKyivDateString();
    if (lastSpinDate === today) {
      setCanSpin(false);
      setNextSpinAt(getNextKyivMidnight().toISOString());
    } else {
      setCanSpin(true);
    }
  };

  const fetchLocations = async () => {
    const { data } = await api.get('/api/locations');
    setLocations(data.locations);
  };

  const handleSpin = useCallback(async (lat?: number, lng?: number) => {
    if (!telegramUser) return null;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const devMode = urlParams.get('dev') === 'true' || urlParams.get('admin') === 'true';
      const { data } = await api.post('/api/user/spin', {
        telegramId: String(telegramUser.id),
        userLat: lat,
        userLng: lng,
        devMode,
      });

      setAppUser((prev: any) => ({ ...prev, points: data.newBalance, totalSpins: (prev?.totalSpins || 0) + 1 }));
      setCanSpin(false);
      setNextSpinAt(data.nextSpinAt || null);

      return { reward: data.reward, newBalance: data.newBalance };
    } catch (err: any) {
      const message = err?.response?.data?.message || 'Не вдалося крутнути колесо';
      return { error: err?.response?.data?.error || 'SpinError', message };
    }
  }, [telegramUser]);

  const referralLink = useMemo(() => {
    if (!telegramUser) return '';
    return `https://t.me/${BOT_USERNAME}?start=ref_${telegramUser.id}`;
  }, [telegramUser]);

  const copyReferralLink = useCallback(() => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      setReferralCopied(true);
      setTimeout(() => setReferralCopied(false), 2000);
    }).catch(() => {});
  }, [referralLink]);

  if (loading) return <div className="p-20 text-center">Завантаження...</div>;

  return (
    <div className="min-h-screen pb-20" style={{ backgroundColor: theme.secondaryBgColor, color: theme.textColor }}>
      <header className="p-4 sticky top-0 z-10 shadow-sm" style={{ backgroundColor: theme.bgColor }}>
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-bold">PerkUp</h1>
          <div className="text-right">
            <p className="text-xs" style={{ color: theme.hintColor }}>Мій баланс</p>
            <p className="font-bold text-[#FFB300]">{appUser?.points || 0} балів</p>
          </div>
        </div>
      </header>

      <main className="p-4">
        {activeTab === 'locations' && (
          <div className="grid gap-4">
            {locations.map(loc => (
              <div key={loc.id} className="p-4 rounded-2xl shadow-sm" style={{ backgroundColor: theme.bgColor }} onClick={() => { setSelectedLocation(loc); setActiveTab('menu'); }}>
                <h3 className="font-bold">{loc.name}</h3>
                <p className="text-sm" style={{ color: theme.hintColor }}>{loc.address}</p>
              </div>
            ))}
          </div>
        )}

        {(activeTab === 'menu' || activeTab === 'shop') && (
          <>
            {(() => {
              const orderLocation = activeTab === 'menu' ? selectedLocation : (selectedLocation || locations[0]);
              const totalAmount = cart.reduce((sum, item) => sum + parseFloat(item.product.price) * item.quantity, 0);
              return (
                <>
            <Menu
              apiUrl={API_URL}
              cart={cart}
              onCartChange={setCart}
              theme={theme}
              canPreorder={activeTab === 'menu' ? selectedLocation?.canPreorder : true}
              locationName={selectedLocation?.name}
              mode={activeTab === 'menu' ? 'menu' : 'shop'}
            />

            {cart.length > 0 && orderLocation && telegramUser && (
              <div className="fixed bottom-20 left-0 right-0 z-20 px-4">
                <button
                  onClick={() => setShowCheckout(true)}
                  className="w-full py-4 rounded-2xl font-bold text-base shadow-lg transition-all active:scale-[0.98]"
                  style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
                >
                  Оформити замовлення — {totalAmount} грн
                </button>
              </div>
            )}

            {showCheckout && orderLocation && telegramUser && (
              <Checkout
                apiUrl={API_URL}
                cart={cart}
                telegramId={telegramUser.id}
                locationId={orderLocation.id}
                locationName={orderLocation.name}
                theme={theme}
                onClose={() => setShowCheckout(false)}
                onSuccess={() => {
                  setShowCheckout(false);
                  setCart([]);
                }}
              />
            )}
                </>
              );
            })()}
          </>
        )}

        {activeTab === 'games' && (
          <div className="space-y-6">
            <div className="p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
              <h2 className="text-xl font-bold mb-2">🎮 Fun Zone</h2>
              <p className="text-sm" style={{ color: theme.hintColor }}>
                Обирай гру або вмикай PerkUp Radio.
              </p>
              <div className="grid grid-cols-2 gap-2 mt-4">
                {[
                  { id: 'tic-tac-toe', label: 'Хрестики-нулики', icon: '❌⭕' },
                  { id: 'perkie-catch', label: 'Perkie Catch', icon: '☕' },
                  { id: 'barista-rush', label: 'Barista Rush', icon: '⚡' },
                  { id: 'memory-coffee', label: 'Memory Coffee', icon: '🧠' },
                  { id: 'perkie-jump', label: 'Perkie Jump', icon: '🪂' },
                  { id: 'radio', label: 'PerkUp Radio', icon: '📻' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setFunZoneGame(item.id as typeof funZoneGame)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all"
                    style={{
                      backgroundColor: funZoneGame === item.id ? theme.buttonColor : theme.secondaryBgColor,
                      color: funZoneGame === item.id ? theme.buttonTextColor : theme.textColor,
                    }}
                  >
                    <span>{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {funZoneGame === 'tic-tac-toe' && (
              telegramUser ? (
                <TicTacToe
                  apiUrl={API_URL}
                  telegramId={telegramUser.id}
                  firstName={telegramUser.firstName}
                  botUsername={BOT_USERNAME}
                  gameIdFromUrl={gameIdFromUrl}
                  theme={theme}
                  mode={gameMode}
                />
              ) : (
                <div className="p-4 rounded-2xl text-center" style={{ backgroundColor: theme.bgColor }}>
                  <p className="text-sm" style={{ color: theme.hintColor }}>
                    Потрібен Telegram акаунт, щоб запускати онлайн-ігри.
                  </p>
                </div>
              )
            )}

            {funZoneGame === 'radio' && <Radio theme={theme} />}

            {['perkie-catch', 'barista-rush', 'memory-coffee', 'perkie-jump'].includes(funZoneGame) && (
              <div className="p-4 rounded-2xl text-center" style={{ backgroundColor: theme.bgColor }}>
                <p className="text-sm" style={{ color: theme.hintColor }}>
                  Ця гра ще готується. Скоро додамо! 🚀
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'bonuses' && (
          <div className="space-y-6">
            <WheelOfFortune onSpin={handleSpin} canSpin={canSpin} nextSpinAt={nextSpinAt} theme={theme} />
            <div className="p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
              <h3 className="font-semibold mb-2">🤝 Рефералка</h3>
              <p className="text-sm mb-3" style={{ color: theme.hintColor }}>
                Запроси друга й отримай +10 балів після його першого спіну. Новий користувач отримає +5 балів.
              </p>
              <div className="text-xs break-all p-3 rounded-xl mb-3" style={{ backgroundColor: theme.secondaryBgColor, color: theme.hintColor }}>
                {referralLink || 'Посилання недоступне'}
              </div>
              <button
                onClick={copyReferralLink}
                className="w-full py-2 rounded-xl text-sm font-medium"
                style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
                disabled={!referralLink}
              >
                {referralCopied ? '✅ Скопійовано' : '📋 Копіювати посилання'}
              </button>
            </div>
            <div className="text-center">
              <button onClick={() => setShowTerms(true)} className="text-sm underline" style={{ color: theme.hintColor }}>Умови використання</button>
            </div>
          </div>
        )}
      </main>

      {showTerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md rounded-2xl p-6" style={{ backgroundColor: theme.bgColor }}>
            <h2 className="text-lg font-bold mb-4">📜 Умови використання</h2>
            <div className="space-y-3 text-sm">
              <p>1. Акція діє в усіх кав'ярнях PerkUp.</p>
              <p>2. 100 накопичених балів можна обміняти на будь-який напій.</p>
              <p>3. Код на отримання напою дійсний протягом 15 хвилин після активації.</p>
              <p>4. Бали не підлягають обміну на грошовий еквівалент.</p>
            </div>
            <button onClick={() => setShowTerms(false)} className="mt-6 w-full py-3 rounded-xl text-white" style={{ backgroundColor: theme.buttonColor }}>Зрозуміло</button>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 border-t flex justify-around p-2 z-20" style={{ backgroundColor: theme.bgColor }}>
        {[
          { id: 'locations', icon: '📍', label: 'Точки' },
          { id: 'menu', icon: '☕', label: 'Меню' },
          { id: 'shop', icon: '🛒', label: 'Shop' },
          { id: 'games', icon: '🎮', label: 'Fun Zone' },
          { id: 'bonuses', icon: '🎁', label: 'Бонуси' }
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as TabType)} className="flex flex-col items-center p-1">
            <span className="text-xl">{t.icon}</span>
            <span className="text-[10px]" style={{ color: activeTab === t.id ? theme.buttonColor : theme.hintColor }}>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
