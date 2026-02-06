import { useEffect, useState, useMemo, useCallback } from 'react';
import axios from 'axios';
import WebApp from '@twa-dev/sdk';
import { WheelOfFortune } from './components/WheelOfFortune';

// Types
type LocationStatus = 'active' | 'coming_soon';
type TabType = 'locations' | 'bonuses';

interface Location {
  id: string;
  name: string;
  lat: number | null;
  long: number | null;
  address: string | null;
  status: LocationStatus;
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
  lastSpin: string | null;
}

interface TelegramTheme {
  bgColor: string;
  textColor: string;
  hintColor: string;
  buttonColor: string;
  buttonTextColor: string;
  secondaryBgColor: string;
}

// API base URL - MUST be set for cross-origin requests
// Fallback to production URL if VITE_API_URL is not set
const API_URL = import.meta.env.VITE_API_URL || 'https://backend-production-5ee9.up.railway.app';

// Bot username for referral links
const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || '';
console.log('[PerkUp] Environment:', import.meta.env.MODE);
console.log('[PerkUp] API_URL:', API_URL);

// Axios instance
const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Get Telegram theme colors
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

// Get Telegram user data (simple synchronous version - original working pattern)
function useTelegramUser(): TelegramUser | null {
  return useMemo(() => {
    console.log('[PerkUp] Getting Telegram user...');
    console.log('[PerkUp] WebApp.initData:', WebApp.initData);
    console.log('[PerkUp] WebApp.initDataUnsafe:', JSON.stringify(WebApp.initDataUnsafe));

    const user = WebApp.initDataUnsafe?.user;
    if (!user) {
      console.warn('[PerkUp] No user data from Telegram WebApp');
      return null;
    }

    console.log('[PerkUp] Telegram user found:', user);
    return {
      id: user.id,
      firstName: user.first_name || 'Гість',
      lastName: user.last_name,
      username: user.username,
    };
  }, []);
}

// Points required for redemption
const REDEEM_POINTS = 100;

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('locations');
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [canSpin, setCanSpin] = useState(true);
  const [nextSpinAt, setNextSpinAt] = useState<string | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  const [redeemCode, setRedeemCode] = useState<string | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const theme = useTelegramTheme();
  const telegramUser = useTelegramUser();

  // Initialize Telegram WebApp
  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    WebApp.setHeaderColor(theme.bgColor);
    WebApp.setBackgroundColor(theme.secondaryBgColor);
  }, [theme]);

  // Sync user with backend
  useEffect(() => {
    if (telegramUser) {
      console.log('[PerkUp] Syncing user with backend...');
      syncUser();
    }
  }, [telegramUser]);

  // Fetch locations
  useEffect(() => {
    fetchLocations();
  }, []);

  // Handle Main Button for locations tab
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
      console.log('[PerkUp] Syncing user:', telegramUser.id);
      const response = await api.post<{ user: AppUser }>('/api/user/sync', {
        telegramId: String(telegramUser.id),
        username: telegramUser.username,
        firstName: telegramUser.firstName,
      });

      console.log('[PerkUp] Sync response:', response.data);

      const user = response.data.user;
      if (!user) {
        console.error('[PerkUp] Sync response has no user object');
        return;
      }

      setAppUser(user);

      // Check if can spin
      if (user.lastSpin) {
        const lastSpin = new Date(user.lastSpin);
        const nextSpin = new Date(lastSpin.getTime() + 24 * 60 * 60 * 1000);
        const now = new Date();

        if (now < nextSpin) {
          setCanSpin(false);
          setNextSpinAt(nextSpin.toISOString());
        } else {
          setCanSpin(true);
          setNextSpinAt(null);
        }
      }

      console.log('[PerkUp] User synced successfully:', user);
    } catch (err) {
      console.error('[PerkUp] Sync error:', err);
      if (axios.isAxiosError(err)) {
        console.error('[PerkUp] Sync error response:', err.response?.data);
        console.error('[PerkUp] Sync error status:', err.response?.status);
      }
    }
  };

  const fetchLocations = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<{ locations: Location[] }>('/api/locations');
      setLocations(response.data.locations);
    } catch (err) {
      console.error('Fetch error:', err);
      setError(axios.isAxiosError(err)
        ? err.response?.data?.error || 'Не вдалося завантажити локації'
        : 'Не вдалося завантажити локації');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLocation = useCallback((location: Location) => {
    setSelectedLocation(prev => prev?.id === location.id ? null : location);
  }, []);

  const handleOrder = useCallback((location: Location) => {
    const userName = telegramUser?.firstName || 'Гість';
    WebApp.showAlert(`${userName}, ви обрали: ${location.name}\n\nЗамовлення буде доступне незабаром!`);
  }, [telegramUser]);

  const handleSpin = async (userLat?: number, userLng?: number): Promise<{ reward: number; newBalance: number } | { error: string; message: string } | null> => {
    if (!telegramUser) return null;

    // Check for dev/admin mode in URL
    const urlParams = new URLSearchParams(window.location.search);
    const devMode = urlParams.get('dev') === 'true' || urlParams.get('admin') === 'true';

    try {
      const response = await api.post<{ reward: number; newBalance: number; nextSpinAt: string }>('/api/user/spin', {
        telegramId: String(telegramUser.id),
        userLat,
        userLng,
        devMode,
      });

      setAppUser(prev => prev ? { ...prev, points: response.data.newBalance } : null);
      setCanSpin(false);
      setNextSpinAt(response.data.nextSpinAt);

      return { reward: response.data.reward, newBalance: response.data.newBalance };
    } catch (err) {
      console.error('[PerkUp] Spin error:', err);
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 429) {
          setCanSpin(false);
          setNextSpinAt(err.response.data.nextSpinAt);
        }
        if (err.response?.status === 403) {
          // Too far from location
          return { error: err.response.data.error, message: err.response.data.message };
        }
      }
      return null;
    }
  };

  const handleInvite = useCallback(() => {
    if (!telegramUser || !BOT_USERNAME) return;

    const referralLink = `https://t.me/${BOT_USERNAME}?start=ref_${telegramUser.id}`;
    const shareText = 'Приєднуйся до PerkUp — крути Колесо Фортуни та отримуй безкоштовну каву! ☕🎡 Тримай +5 бонусних балів на старт!';
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`;

    WebApp.openTelegramLink(shareUrl);
  }, [telegramUser]);

  const handleRedeem = async () => {
    if (!telegramUser || isRedeeming) return;
    if (!appUser || appUser.points < REDEEM_POINTS) return;

    setIsRedeeming(true);
    try {
      const response = await api.post<{ code: string; newBalance: number }>('/api/user/redeem', {
        telegramId: String(telegramUser.id),
      });

      setAppUser(prev => prev ? { ...prev, points: response.data.newBalance } : null);
      setRedeemCode(response.data.code);
      setShowConfetti(true);

      // Hide confetti after 5 seconds
      setTimeout(() => setShowConfetti(false), 5000);
    } catch (err) {
      console.error('[PerkUp] Redeem error:', err);
      if (axios.isAxiosError(err) && err.response?.data?.message) {
        WebApp.showAlert(err.response.data.message);
      } else {
        WebApp.showAlert('Не вдалося обміняти бали. Спробуйте пізніше.');
      }
    } finally {
      setIsRedeeming(false);
    }
  };

  // Loading state
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

  // Error state
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
            {/* Balance with Progress */}
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full" style={{ backgroundColor: '#FFF8E1' }}>
                <span className="text-lg">🪙</span>
                <span className="font-bold text-lg" style={{ color: '#FFB300' }}>
                  {appUser ? appUser.points : '...'}
                </span>
              </div>
              {/* Progress bar */}
              {appUser && (
                <div className="mt-1 w-full px-1">
                  <div className="flex items-center gap-1">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: theme.hintColor + '30' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min((appUser.points / REDEEM_POINTS) * 100, 100)}%`,
                          backgroundColor: appUser.points >= REDEEM_POINTS ? '#22c55e' : '#FFB300',
                        }}
                      />
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
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setActiveTab('locations')}
              className="flex-1 py-2 px-4 rounded-xl font-medium transition-all"
              style={{
                backgroundColor: activeTab === 'locations' ? theme.buttonColor : theme.secondaryBgColor,
                color: activeTab === 'locations' ? theme.buttonTextColor : theme.textColor,
              }}>
              Локації
            </button>
            <button
              onClick={() => setActiveTab('bonuses')}
              className="flex-1 py-2 px-4 rounded-xl font-medium transition-all"
              style={{
                backgroundColor: activeTab === 'bonuses' ? theme.buttonColor : theme.secondaryBgColor,
                color: activeTab === 'bonuses' ? theme.buttonTextColor : theme.textColor,
              }}>
              Бонуси
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="p-4 pb-24">
        {activeTab === 'locations' ? (
          <>
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-1" style={{ color: theme.textColor }}>Оберіть локацію</h2>
              <p className="text-sm" style={{ color: theme.hintColor }}>Виберіть кав'ярню для замовлення</p>
            </div>

            {/* Locations list */}
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
              <div className="text-center py-12">
                <p style={{ color: theme.hintColor }}>Локації не знайдено</p>
              </div>
            )}
          </>
        ) : (
          /* Bonuses Tab */
          <div>
            {/* Rewards Section */}
            <div className="mb-6 p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
              <h3 className="font-semibold mb-3 flex items-center gap-2" style={{ color: theme.textColor }}>
                <span>🎁</span> Твої нагороди
              </h3>

              {/* Redeem Code Display */}
              {redeemCode && (
                <div className="mb-4 p-4 rounded-xl text-center" style={{ backgroundColor: '#ECFDF5' }}>
                  <p className="text-sm mb-2" style={{ color: '#065f46' }}>Твій код:</p>
                  <p className="text-2xl font-bold mb-2" style={{ color: '#059669' }}>{redeemCode}</p>
                  <p className="text-xs" style={{ color: '#065f46' }}>
                    Покажи цей код баристі, щоб отримати будь-який напій до 100 грн!
                  </p>
                  <p className="text-xs mt-2" style={{ color: '#6b7280' }}>
                    Код дійсний 15 хвилин
                  </p>
                </div>
              )}

              {/* Redeem Button */}
              {appUser && (
                <button
                  onClick={handleRedeem}
                  disabled={appUser.points < REDEEM_POINTS || isRedeeming}
                  className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: appUser.points >= REDEEM_POINTS ? '#059669' : theme.hintColor + '30',
                    color: appUser.points >= REDEEM_POINTS ? '#ffffff' : theme.hintColor,
                  }}
                >
                  {isRedeeming ? (
                    'Обробка...'
                  ) : appUser.points >= REDEEM_POINTS ? (
                    '☕ Обміняти 100 балів на напій'
                  ) : (
                    `Збери ще ${REDEEM_POINTS - appUser.points} балів`
                  )}
                </button>
              )}

              {/* Progress indicator */}
              {appUser && appUser.points < REDEEM_POINTS && (
                <div className="mt-3">
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: theme.hintColor + '20' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${(appUser.points / REDEEM_POINTS) * 100}%`,
                        backgroundColor: '#FFB300',
                      }}
                    />
                  </div>
                  <p className="text-xs text-center mt-1" style={{ color: theme.hintColor }}>
                    {appUser.points} / {REDEEM_POINTS} балів до безкоштовної кави
                  </p>
                </div>
              )}
            </div>

            {/* Invite Friend Section */}
            {BOT_USERNAME && telegramUser && (
              <div className="mb-6 p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
                <h3 className="font-semibold mb-2 flex items-center gap-2" style={{ color: theme.textColor }}>
                  <span>👥</span> Запроси друга
                </h3>
                <p className="text-sm mb-3" style={{ color: theme.hintColor }}>
                  Запроси друга та отримай <b style={{ color: theme.textColor }}>+10 балів</b> після його першого обертання колеса. Друг отримає <b style={{ color: theme.textColor }}>+5 балів</b> на старт!
                </p>
                <button
                  onClick={handleInvite}
                  className="w-full py-3 px-4 rounded-xl font-medium transition-all active:scale-[0.98]"
                  style={{
                    backgroundColor: '#2196F3',
                    color: '#ffffff',
                  }}
                >
                  📨 Запросити друга
                </button>
              </div>
            )}

            {/* Wheel Section */}
            <div className="mb-6 text-center">
              <h2 className="text-lg font-semibold mb-1" style={{ color: theme.textColor }}>Колесо Фортуни</h2>
              <p className="text-sm" style={{ color: theme.hintColor }}>Крутіть колесо та отримуйте бали!</p>
            </div>
            <WheelOfFortune onSpin={handleSpin} canSpin={canSpin} nextSpinAt={nextSpinAt} theme={theme} />

            {/* Terms Link */}
            <div className="mt-8 text-center">
              <button
                onClick={() => setShowTerms(true)}
                className="text-sm underline"
                style={{ color: theme.hintColor }}
              >
                Умови використання
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Terms Modal */}
      {showTerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md rounded-2xl p-6 max-h-[80vh] overflow-y-auto" style={{ backgroundColor: theme.bgColor }}>
            <h2 className="text-lg font-bold mb-4" style={{ color: theme.textColor }}>
              📜 Умови використання
            </h2>
            <div className="space-y-3 text-sm" style={{ color: theme.textColor }}>
              <p>1. Акція діє в усіх кав'ярнях PerkUp.</p>
              <p>2. 100 накопичених балів можна обміняти на один будь-який напій вартістю до 100 грн.</p>
              <p>3. Якщо вартість напою перевищує 100 грн, користувач може доплатити різницю.</p>
              <p>4. Код на отримання напою дійсний протягом 15 хвилин після активації.</p>
              <p>5. Бали не підлягають обміну на грошовий еквівалент.</p>
            </div>
            <button
              onClick={() => setShowTerms(false)}
              className="mt-6 w-full py-3 rounded-xl font-medium transition-all active:scale-[0.98]"
              style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
            >
              Зрозуміло
            </button>
          </div>
        </div>
      )}

      {/* Confetti Effect */}
      {showConfetti && (
        <div className="fixed inset-0 z-40 pointer-events-none overflow-hidden">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute animate-confetti"
              style={{
                left: `${Math.random() * 100}%`,
                top: '-10px',
                width: '10px',
                height: '10px',
                backgroundColor: ['#FFD700', '#FF6347', '#4CAF50', '#2196F3', '#9C27B0'][Math.floor(Math.random() * 5)],
                borderRadius: Math.random() > 0.5 ? '50%' : '0',
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${2 + Math.random() * 2}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
