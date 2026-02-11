import { useEffect, useState, useMemo, useCallback } from 'react';
import axios from 'axios';
import WebApp from '@twa-dev/sdk';
import { WheelOfFortune } from './components/WheelOfFortune';
import { Menu, CartItem } from './components/Menu';
import { Checkout } from './components/Checkout';
import { TicTacToe } from './components/TicTacToe';
import { PerkieJump } from './components/PerkieJump';
import { Radio } from './components/Radio';

// Types
type LocationStatus = 'active' | 'coming_soon';
type TabType = 'locations' | 'menu' | 'shop' | 'bonuses' | 'funzone';

interface Location {
  id: string;
  name: string;
  lat: number | null;
  long: number | null;
  address: string | null;
  status: LocationStatus;
  canPreorder: boolean;
}

interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
}

interface AppUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  points: number;
  lastSpinDate: string | null;
}

interface TelegramTheme {
  bgColor: string;
  textColor: string;
  hintColor: string;
  buttonColor: string;
  buttonTextColor: string;
  secondaryBgColor: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'https://backend-production-5ee9.up.railway.app';
const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'perkup_ua_bot';

const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

function useTelegramTheme(): TelegramTheme {
  return useMemo(() => {
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
}

function useTelegramUser(): TelegramUser | null {
  return useMemo(() => {
    const user = WebApp.initDataUnsafe?.user;
    if (user) {
      try { localStorage.setItem('perkup_user', JSON.stringify(user)); } catch { /* ignore */ }
      return {
        id: user.id,
        firstName: user.first_name || 'Гість',
        lastName: user.last_name,
        username: user.username,
      };
    }
    try {
      const saved = localStorage.getItem('perkup_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { id: parsed.id, firstName: parsed.first_name || 'Гість', lastName: parsed.last_name, username: parsed.username };
      }
    } catch { /* ignore */ }
    const urlParams = new URLSearchParams(window.location.search);
    const devId = urlParams.get('telegramId') || urlParams.get('user_id');
    if (devId) return { id: Number(devId), firstName: 'Dev User' };
    return null;
  }, []);
}

const REDEEM_POINTS = 100;

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('locations');
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [canSpin, setCanSpin] = useState(true);
  const [showTerms, setShowTerms] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCheckout, setShowCheckout] = useState(false);
  const [funZoneTab, setFunZoneTab] = useState<'games' | 'radio'>('games');
  const [selectedGame, setSelectedGame] = useState<'tictactoe' | 'perkiejump' | null>(null);

  const gameIdFromUrl = useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('game_id') || null;
  }, []);

  const cartItemCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  const theme = useTelegramTheme();
  const telegramUser = useTelegramUser();

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    WebApp.setHeaderColor(theme.bgColor);
    WebApp.setBackgroundColor(theme.secondaryBgColor);
  }, [theme]);

  useEffect(() => {
    if (gameIdFromUrl) {
      setActiveTab('funzone');
      setFunZoneTab('games');
    }
  }, [gameIdFromUrl]);

  useEffect(() => {
    if (telegramUser) syncUser();
  }, [telegramUser]);

  useEffect(() => { fetchLocations(); }, []);

  useEffect(() => {
    if (activeTab === 'locations' && selectedLocation?.status === 'active') {
      WebApp.MainButton.text = 'Замовити';
      WebApp.MainButton.color = theme.buttonColor;
      WebApp.MainButton.textColor = theme.buttonTextColor;
      WebApp.MainButton.show();
      const handleClick = () => handleOrder(selectedLocation);
      WebApp.MainButton.onClick(handleClick);
      return () => WebApp.MainButton.offClick(handleClick);
    } else {
      WebApp.MainButton.hide();
    }
  }, [activeTab, selectedLocation, theme]);

  const syncUser = async () => {
    if (!telegramUser) return;
    try {
      const response = await api.post<{ user: AppUser }>('/api/user/sync', {
        telegramId: String(telegramUser.id),
        username: telegramUser.username,
        firstName: telegramUser.firstName,
      });
      const user = response.data.user;
      if (!user) return;
      setAppUser(user);

      // Check if can spin (Kyiv midnight reset) — lastSpinDate is YYYY-MM-DD string
      if (user.lastSpinDate) {
        const kyivToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });
        if (user.lastSpinDate === kyivToday) {
          setCanSpin(false);
        } else {
          setCanSpin(true);
        }
      }
    } catch (err) {
      console.error('[PerkUp] Sync error:', err);
    }
  };

  const fetchLocations = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<{ locations: Location[] }>('/api/locations');
      setLocations(response.data.locations);
    } catch (err) {
      console.error('[PerkUp] Locations error:', err);
      setError('Не вдалося завантажити локації');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLocation = useCallback((location: Location) => {
    setSelectedLocation(prev => prev?.id === location.id ? null : location);
  }, []);

  const handleOrder = useCallback((location: Location) => {
    setSelectedLocation(location);
    setActiveTab('menu');
  }, []);

  const handleSpin = async (userLat?: number, userLng?: number): Promise<{ reward: number; newBalance: number } | { error: string; message: string } | null> => {
    if (!telegramUser) return null;
    const urlParams = new URLSearchParams(window.location.search);
    const devMode = urlParams.get('dev') === 'true' || urlParams.get('admin') === 'true';

    try {
      const response = await api.post<{ reward: number; newBalance: number }>('/api/user/spin', {
        telegramId: String(telegramUser.id),
        userLat,
        userLng,
        devMode,
      });
      setAppUser(prev => prev ? { ...prev, points: response.data.newBalance } : null);
      setCanSpin(false);
      return { reward: response.data.reward, newBalance: response.data.newBalance };
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 429) setCanSpin(false);
        if (err.response?.status === 403) {
          return { error: err.response.data.error, message: err.response.data.message };
        }
      }
      return null;
    }
  };

  const handleInvite = useCallback(() => {
    if (!telegramUser || !BOT_USERNAME) return;
    const referralLink = `https://t.me/${BOT_USERNAME}?start=ref${telegramUser.id}`;
    const shareText = 'Приєднуйся до PerkUp — крути Колесо Фортуни та отримуй безкоштовну каву! ☕🎡';
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`;
    WebApp.openTelegramLink(shareUrl);
  }, [telegramUser]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: theme.secondaryBgColor }}>
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-4"
            style={{ borderColor: theme.buttonColor, borderTopColor: 'transparent' }} />
          <p style={{ color: theme.hintColor }}>Завантаження...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: theme.secondaryBgColor }}>
        <div className="text-center">
          <p className="mb-4" style={{ color: '#ef4444' }}>{error}</p>
          <button onClick={fetchLocations}
            className="py-3 px-6 rounded-xl font-medium transition-all active:scale-95"
            style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}>
            Спробувати знову
          </button>
        </div>
      </div>
    );
  }

  const tabLabels: Record<TabType, string> = {
    locations: 'Локації',
    menu: 'Меню',
    shop: 'Магазин',
    bonuses: 'Бонуси',
    funzone: 'Fun Zone',
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: theme.secondaryBgColor }}>
      {/* Header */}
      <header className="sticky top-0 z-10 border-b" style={{ backgroundColor: theme.bgColor, borderColor: theme.hintColor + '30' }}>
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: theme.textColor }}>
                <span>☕</span> PerkUp
              </h1>
              <p className="text-sm mt-1" style={{ color: theme.hintColor }}>
                Привіт, {telegramUser?.firstName || appUser?.firstName || 'Гість'}!
              </p>
            </div>
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full" style={{ backgroundColor: '#FFF8E1' }}>
                <span className="text-lg">🪙</span>
                <span className="font-bold text-lg" style={{ color: '#FFB300' }}>
                  {appUser ? appUser.points : '...'}
                </span>
              </div>
              {appUser && (
                <div className="mt-1 w-full px-1">
                  <div className="flex items-center gap-1">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: theme.hintColor + '30' }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min((appUser.points / REDEEM_POINTS) * 100, 100)}%`,
                          backgroundColor: appUser.points >= REDEEM_POINTS ? '#22c55e' : '#FFB300',
                        }} />
                    </div>
                    <span className="text-xs" style={{ color: theme.hintColor }}>
                      {appUser.points >= REDEEM_POINTS ? '100' : appUser.points}/{REDEEM_POINTS}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 overflow-x-auto scrollbar-hide">
            {(['locations', 'menu', 'shop', 'bonuses', 'funzone'] as TabType[]).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className="flex-shrink-0 py-2 px-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap"
                style={{
                  backgroundColor: activeTab === tab ? theme.buttonColor : theme.secondaryBgColor,
                  color: activeTab === tab ? theme.buttonTextColor : theme.textColor,
                }}>
                {tabLabels[tab]}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="p-4 pb-24">
        {activeTab === 'menu' ? (
          <div>
            {selectedLocation ? (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold" style={{ color: theme.textColor }}>Меню</h2>
                    <p className="text-xs" style={{ color: theme.hintColor }}>📍 {selectedLocation.name}</p>
                  </div>
                  <button onClick={() => { setSelectedLocation(null); setActiveTab('locations'); }}
                    className="text-xs px-3 py-1.5 rounded-lg"
                    style={{ backgroundColor: theme.hintColor + '20', color: theme.hintColor }}>
                    Змінити
                  </button>
                </div>
                <Menu apiUrl={API_URL} cart={cart} onCartChange={setCart} theme={theme}
                  canPreorder={selectedLocation.canPreorder} locationName={selectedLocation.name} mode="menu" />
              </>
            ) : (
              <div className="text-center py-12">
                <p className="text-4xl mb-4">📍</p>
                <p className="font-medium mb-2" style={{ color: theme.textColor }}>Оберіть локацію</p>
                <p className="text-sm mb-4" style={{ color: theme.hintColor }}>Спочатку оберіть кав'ярню, щоб побачити меню</p>
                <button onClick={() => setActiveTab('locations')}
                  className="py-2.5 px-6 rounded-xl text-sm font-medium transition-all active:scale-95"
                  style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}>
                  Обрати локацію
                </button>
              </div>
            )}
          </div>
        ) : activeTab === 'shop' ? (
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold" style={{ color: theme.textColor }}>Магазин</h2>
              <p className="text-xs" style={{ color: theme.hintColor }}>Мерч та кава для дому</p>
            </div>
            <Menu apiUrl={API_URL} cart={cart} onCartChange={setCart} theme={theme}
              canPreorder={true} mode="shop" />
          </div>
        ) : activeTab === 'locations' ? (
          <>
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-1" style={{ color: theme.textColor }}>Оберіть локацію</h2>
              <p className="text-sm" style={{ color: theme.hintColor }}>Виберіть кав'ярню для замовлення</p>
            </div>
            <div className="space-y-3">
              {locations.map((location) => {
                const isSelected = selectedLocation?.id === location.id;
                const isComingSoon = location.status === 'coming_soon';
                return (
                  <div key={location.id}
                    onClick={() => !isComingSoon && handleSelectLocation(location)}
                    className={`rounded-2xl p-4 transition-all duration-200 ${isComingSoon ? 'opacity-60' : 'cursor-pointer active:scale-[0.98]'}`}
                    style={{
                      backgroundColor: theme.bgColor,
                      boxShadow: isSelected ? `0 0 0 2px ${theme.buttonColor}, 0 4px 6px -1px rgba(0,0,0,0.1)` : '0 1px 3px 0 rgba(0,0,0,0.1)',
                    }}>
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: isComingSoon ? theme.secondaryBgColor : isSelected ? theme.buttonColor : theme.buttonColor + '20',
                          color: isComingSoon ? theme.hintColor : isSelected ? theme.buttonTextColor : theme.buttonColor,
                        }}>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate" style={{ color: theme.textColor }}>{location.name}</h3>
                          {isComingSoon && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                              Незабаром
                            </span>
                          )}
                        </div>
                        <p className="text-sm mt-1 truncate" style={{ color: theme.hintColor }}>
                          {location.address || '⏳ Адреса уточнюється'}
                        </p>
                        {!isComingSoon && (
                          <button onClick={(e) => { e.stopPropagation(); handleSelectLocation(location); if (isSelected) handleOrder(location); }}
                            className="mt-3 w-full py-2.5 px-4 rounded-xl text-sm font-medium transition-all active:scale-[0.98]"
                            style={{
                              backgroundColor: isSelected ? theme.buttonColor : theme.buttonColor + '15',
                              color: isSelected ? theme.buttonTextColor : theme.buttonColor,
                            }}>
                            {isSelected ? 'Замовити' : 'Обрати'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {locations.length === 0 && (
              <div className="text-center py-12"><p style={{ color: theme.hintColor }}>Локації не знайдено</p></div>
            )}
          </>
        ) : activeTab === 'funzone' ? (
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold mb-1" style={{ color: theme.textColor }}>Fun Zone</h2>
              <p className="text-sm" style={{ color: theme.hintColor }}>Ігри та розваги</p>
            </div>
            <div className="flex gap-2 mb-6">
              <button onClick={() => setFunZoneTab('games')}
                className="flex-1 py-2 px-4 rounded-xl text-sm font-medium transition-all"
                style={{
                  backgroundColor: funZoneTab === 'games' ? theme.buttonColor : theme.bgColor,
                  color: funZoneTab === 'games' ? theme.buttonTextColor : theme.textColor,
                }}>
                🎮 Ігри
              </button>
              <button onClick={() => setFunZoneTab('radio')}
                className="flex-1 py-2 px-4 rounded-xl text-sm font-medium transition-all"
                style={{
                  backgroundColor: funZoneTab === 'radio' ? theme.buttonColor : theme.bgColor,
                  color: funZoneTab === 'radio' ? theme.buttonTextColor : theme.textColor,
                }}>
                📻 Радіо
              </button>
            </div>
            {funZoneTab === 'games' ? (
              <div className="p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
                {telegramUser ? (
                  selectedGame === 'tictactoe' || gameIdFromUrl ? (
                    <div>
                      {!gameIdFromUrl && (
                        <button onClick={() => setSelectedGame(null)} className="text-sm mb-4 flex items-center gap-1"
                          style={{ color: theme.hintColor }}>
                          &larr; Назад до ігор
                        </button>
                      )}
                      <TicTacToe apiUrl={API_URL} telegramId={telegramUser.id} firstName={telegramUser.firstName}
                        botUsername={BOT_USERNAME} gameIdFromUrl={gameIdFromUrl} theme={theme} />
                    </div>
                  ) : selectedGame === 'perkiejump' ? (
                    <div>
                      <button onClick={() => setSelectedGame(null)} className="text-sm mb-4 flex items-center gap-1"
                        style={{ color: theme.hintColor }}>
                        &larr; Назад до ігор
                      </button>
                      <PerkieJump apiUrl={API_URL} telegramId={telegramUser.id} theme={theme}
                        onPointsUpdate={(newBalance) => setAppUser(prev => prev ? { ...prev, points: newBalance } : null)} />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <button onClick={() => setSelectedGame('tictactoe')}
                        className="w-full p-4 rounded-xl text-left flex items-center gap-3 transition-all active:scale-[0.98]"
                        style={{ backgroundColor: theme.secondaryBgColor }}>
                        <span className="text-3xl">❌⭕</span>
                        <div>
                          <p className="font-semibold" style={{ color: theme.textColor }}>Хрестики-нулики</p>
                          <p className="text-xs" style={{ color: theme.hintColor }}>PvE з AI, PvP локально або онлайн</p>
                        </div>
                      </button>
                      <button onClick={() => setSelectedGame('perkiejump')}
                        className="w-full p-4 rounded-xl text-left flex items-center gap-3 transition-all active:scale-[0.98]"
                        style={{ backgroundColor: theme.secondaryBgColor }}>
                        <span className="text-3xl">☕</span>
                        <div>
                          <p className="font-semibold" style={{ color: theme.textColor }}>Perkie Jump</p>
                          <p className="text-xs" style={{ color: theme.hintColor }}>Стрибай вгору та збирай бали!</p>
                        </div>
                      </button>
                    </div>
                  )
                ) : (
                  <div className="text-center py-8"><p style={{ color: theme.hintColor }}>Увійдіть через Telegram, щоб грати</p></div>
                )}
              </div>
            ) : (
              <Radio theme={theme} />
            )}
          </div>
        ) : (
          /* Bonuses Tab */
          <div>
            {/* Invite Friend */}
            {BOT_USERNAME && telegramUser && (
              <div className="mb-6 p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
                <h3 className="font-semibold mb-2 flex items-center gap-2" style={{ color: theme.textColor }}>
                  <span>👥</span> Запроси друга
                </h3>
                <p className="text-sm mb-3" style={{ color: theme.hintColor }}>
                  Друг отримає <b style={{ color: theme.textColor }}>+5 балів</b> одразу, а ти — <b style={{ color: theme.textColor }}>+10 балів</b> після його першого обертання колеса!
                </p>
                <button onClick={handleInvite}
                  className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98]"
                  style={{ backgroundColor: '#2196F3', color: '#ffffff' }}>
                  📨 Запросити друга
                </button>
              </div>
            )}

            {/* Wheel */}
            <div className="mb-6 text-center">
              <h2 className="text-lg font-semibold mb-1" style={{ color: theme.textColor }}>Колесо Фортуни</h2>
              <p className="text-sm" style={{ color: theme.hintColor }}>Крутіть колесо та отримуйте бали!</p>
            </div>
            <WheelOfFortune onSpin={handleSpin} canSpin={canSpin} theme={theme} />

            {/* Terms */}
            <div className="mt-8 text-center">
              <button onClick={() => setShowTerms(true)} className="text-sm underline" style={{ color: theme.hintColor }}>
                Умови використання
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Floating Cart Button */}
      {(activeTab === 'menu' || activeTab === 'shop') && cartItemCount > 0 && (
        <div className="fixed bottom-6 left-4 right-4 z-30">
          <button
            onClick={() => {
              if (!selectedLocation) {
                WebApp.showAlert('Спочатку оберіть локацію для отримання замовлення.');
                setActiveTab('locations');
                return;
              }
              setShowCheckout(true);
            }}
            className="w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
            style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor, boxShadow: '0 4px 20px rgba(0,0,0,0.25)' }}>
            <span>🛒 Кошик ({cartItemCount})</span>
            <span>·</span>
            <span>{cart.reduce((s, i) => s + parseFloat(i.product.price) * i.quantity, 0)} грн</span>
          </button>
        </div>
      )}

      {/* Checkout Modal */}
      {showCheckout && selectedLocation && telegramUser && (
        <Checkout apiUrl={API_URL} cart={cart} telegramId={telegramUser.id}
          locationId={selectedLocation.id} locationName={selectedLocation.name} theme={theme}
          onClose={() => setShowCheckout(false)}
          onSuccess={() => { setShowCheckout(false); setCart([]); WebApp.showAlert('Замовлення прийнято!'); }} />
      )}

      {/* Terms Modal */}
      {showTerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md rounded-2xl p-6 max-h-[80vh] overflow-y-auto" style={{ backgroundColor: theme.bgColor }}>
            <h2 className="text-lg font-bold mb-4" style={{ color: theme.textColor }}>📜 Умови використання</h2>
            <div className="space-y-3 text-sm" style={{ color: theme.textColor }}>
              <p>1. Акція діє в усіх кав'ярнях PerkUp.</p>
              <p>2. 100 накопичених балів можна обміняти на один будь-який напій вартістю до 100 грн.</p>
              <p>3. Код на отримання напою дійсний протягом 15 хвилин після активації.</p>
              <p>4. Бали не підлягають обміну на грошовий еквівалент.</p>
            </div>
            <button onClick={() => setShowTerms(false)}
              className="mt-6 w-full py-3 rounded-xl font-medium transition-all active:scale-[0.98]"
              style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}>
              Зрозуміло
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
