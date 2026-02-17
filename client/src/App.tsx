import { useEffect, useState, useMemo, useCallback } from 'react';
import axios from 'axios';
import WebApp from '@twa-dev/sdk';
import { WheelOfFortune } from './components/WheelOfFortune';
import { Menu, CartItem } from './components/Menu';
import { Radio } from './components/Radio';
import { TicTacToe } from './components/TicTacToe';
import { PerkyJump } from './components/PerkyJump';
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

// ── Token management ──────────────────────────────────────────────────────
let accessToken: string | null = null;
let refreshToken: string | null = null;

const api = axios.create({ baseURL: API_URL });

// Attach Authorization header when token is available
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && refreshToken && !original._retry) {
      original._retry = true;
      try {
        const { data } = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
        accessToken = data.accessToken;
        refreshToken = data.refreshToken;
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch {
        accessToken = null;
        refreshToken = null;
      }
    }
    return Promise.reject(error);
  },
);

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
  const [gameMode] = useState<'online' | 'offline'>('offline');
  const [funZoneGame, setFunZoneGame] = useState<'tic_tac_toe' | 'perky_jump'>('tic_tac_toe');
  const [isGameFullscreen, setIsGameFullscreen] = useState(false);
  const [referralCopied, setReferralCopied] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [redeemState, setRedeemState] = useState<{
    loading: boolean;
    code: string | null;
    expiresAt: string | null;
    error: string | null;
  }>({ loading: false, code: null, expiresAt: null, error: null });

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
      // Try JWT auth via Telegram initData first
      const initData = WebApp.initData;
      if (initData) {
        try {
          const { data } = await axios.post(`${API_URL}/api/auth/telegram`, {
            initData,
            startParam: startParam || undefined,
          });
          accessToken = data.accessToken;
          refreshToken = data.refreshToken;
          setAppUser(data.user);
          checkSpinAvailability(data.user.lastSpinDate);
          return;
        } catch (authErr) {
          console.warn('JWT auth failed, falling back to legacy sync:', authErr);
        }
      }

      // Fallback: legacy sync for dev/testing (no Telegram context)
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
      const { data } = await api.post('/api/loyalty/spin', {
        telegramId: String(telegramUser.id),
        userLat: lat,
        userLng: lng,
        devMode,
      });

      setAppUser((prev: any) => ({ ...prev, points: data.newBalance, totalSpins: (prev?.totalSpins || 0) + 1 }));
      setCanSpin(false);
      setNextSpinAt(data.nextSpinAvailable || null);

      return { reward: data.prize?.value ?? 0, newBalance: data.newBalance };
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

  const handleRedeem = useCallback(async () => {
    if (!telegramUser) return;
    setRedeemState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const { data } = await api.post('/api/loyalty/redeem', {
        telegramId: String(telegramUser.id),
      });
      if (data.ok) {
        setRedeemState({ loading: false, code: data.code, expiresAt: data.expiresAt, error: null });
        setAppUser((prev: any) => prev ? { ...prev, points: data.newBalance } : prev);
      } else {
        // ACTIVE_CODE_EXISTS returns the existing code
        if (data.error === 'ACTIVE_CODE_EXISTS' && data.code) {
          setRedeemState({ loading: false, code: data.code, expiresAt: data.expiresAt, error: null });
        } else {
          setRedeemState({ loading: false, code: null, expiresAt: null, error: data.message || 'Помилка' });
        }
      }
    } catch (err: any) {
      const resp = err?.response?.data;
      if (resp?.error === 'ACTIVE_CODE_EXISTS' && resp.code) {
        setRedeemState({ loading: false, code: resp.code, expiresAt: resp.expiresAt, error: null });
      } else {
        setRedeemState({ loading: false, code: null, expiresAt: null, error: resp?.message || 'Не вдалося створити код' });
      }
    }
  }, [telegramUser]);

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
              canPreorder={activeTab === 'menu' ? selectedLocation?.hasOrdering : true}
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
                  { id: 'tic_tac_toe', label: 'Хрестики-нулики', icon: '❌⭕' },
                  { id: 'perky_jump', label: 'Perky Jump', icon: '🪂' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setFunZoneGame(item.id as typeof funZoneGame);
                      setIsGameFullscreen(true);
                    }}
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

            <Radio theme={theme} />

            {isGameFullscreen && (
              <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: theme.bgColor }}>
                <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: `${theme.hintColor}30` }}>
                  <h3 className="font-semibold" style={{ color: theme.textColor }}>
                    {funZoneGame === 'tic_tac_toe' ? 'Хрестики-нулики' : 'Perky Jump'}
                  </h3>
                  <button
                    onClick={() => setIsGameFullscreen(false)}
                    className="px-3 py-1 rounded-lg text-sm font-medium"
                    style={{ backgroundColor: theme.secondaryBgColor, color: theme.textColor }}
                  >
                    Закрити
                  </button>
                </div>
                <div className="flex-1 overflow-hidden p-4" style={{ overscrollBehavior: 'none' }}>
                  {funZoneGame === 'tic_tac_toe' && (
                    telegramUser ? (
                      <TicTacToe
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
                  {funZoneGame === 'perky_jump' && (
                    <PerkyJump
                      apiUrl={API_URL}
                      telegramId={telegramUser ? String(telegramUser.id) : undefined}
                      onPointsEarned={(pts) => setAppUser((prev: any) => prev ? { ...prev, points: (prev.points || 0) + pts } : prev)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'bonuses' && (
          <div className="space-y-6">
            <WheelOfFortune onSpin={handleSpin} canSpin={canSpin} nextSpinAt={nextSpinAt} theme={theme} />

            {/* Redeem points section */}
            <div className="p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
              <h3 className="font-semibold mb-2">🎁 Обмін балів</h3>
              <p className="text-sm mb-3" style={{ color: theme.hintColor }}>
                100 балів = безкоштовний напій. Код дійсний 15 хвилин.
              </p>

              {redeemState.code && redeemState.expiresAt ? (
                <div className="text-center space-y-3">
                  <div className="py-4 px-6 rounded-xl" style={{ backgroundColor: '#FFF8E1' }}>
                    <p className="text-xs mb-1" style={{ color: '#92400e' }}>Твій код:</p>
                    <p className="text-4xl font-bold tracking-widest" style={{ color: '#8B5A2B' }}>
                      {redeemState.code}
                    </p>
                    <p className="text-xs mt-2" style={{ color: '#92400e' }}>
                      Дійсний до {new Date(redeemState.expiresAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <p className="text-xs" style={{ color: theme.hintColor }}>Покажи цей код баристі</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3 p-3 rounded-xl" style={{ backgroundColor: theme.secondaryBgColor }}>
                    <span className="text-sm" style={{ color: theme.hintColor }}>Твій баланс:</span>
                    <span className="font-bold text-[#FFB300]">{appUser?.points || 0} балів</span>
                  </div>
                  {redeemState.error && (
                    <div className="mb-3 p-3 rounded-xl text-center" style={{ backgroundColor: '#FEE2E2' }}>
                      <p className="text-sm text-red-700">{redeemState.error}</p>
                    </div>
                  )}
                  <button
                    onClick={handleRedeem}
                    disabled={redeemState.loading || (appUser?.points || 0) < 100}
                    className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
                    style={{
                      backgroundColor: (appUser?.points || 0) >= 100 ? '#FFB300' : theme.hintColor,
                      color: (appUser?.points || 0) >= 100 ? '#fff' : theme.buttonTextColor,
                    }}
                  >
                    {redeemState.loading ? 'Створюємо код...' : (appUser?.points || 0) >= 100 ? '🎟 Обміняти 100 балів' : `Потрібно ще ${100 - (appUser?.points || 0)} балів`}
                  </button>
                </>
              )}
            </div>

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
