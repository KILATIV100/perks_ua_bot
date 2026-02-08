import { useEffect, useState, useMemo, useCallback } from 'react';
import axios from 'axios';
import WebApp from '@twa-dev/sdk';
import { WheelOfFortune } from './components/WheelOfFortune';
import { Menu, CartItem } from './components/Menu';
import { Checkout } from './components/Checkout';

type TabType = 'locations' | 'menu' | 'shop' | 'games' | 'bonuses';

const API_URL = import.meta.env.VITE_API_URL || 'https://backend-production-5ee9.up.railway.app';
const BOT_USERNAME = 'perkup_ua_bot';

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
    return null;
  }, []);

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    syncUser();
    fetchLocations();
  }, []);

  const syncUser = async () => {
    if (!telegramUser) return;
    try {
      const { data } = await api.post('/api/user/sync', {
        telegramId: String(telegramUser.id),
        username: telegramUser.username,
        firstName: telegramUser.firstName,
      });
      setAppUser(data.user);
      checkSpinAvailability(data.user.lastSpinDate);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const checkSpinAvailability = (lastSpinDate: string | null) => {
    const today = new Date().toISOString().split('T')[0];
    if (lastSpinDate === today) {
      setCanSpin(false);
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      setNextSpinAt(tomorrow.toISOString());
    } else {
      setCanSpin(true);
    }
  };

  const fetchLocations = async () => {
    const { data } = await api.get('/api/locations');
    setLocations(data.locations);
  };

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
          <Menu 
            apiUrl={API_URL} 
            cart={cart} 
            onCartChange={setCart} 
            theme={theme} 
            canPreorder={activeTab === 'menu' ? selectedLocation?.canPreorder : true}
            filterType={activeTab === 'menu' ? 'MENU' : 'SHOP'} 
          />
        )}

        {activeTab === 'games' && (
          <div className="text-center p-10">
            <h2 className="text-xl font-bold mb-4">Fun Zone</h2>
            <div className="bg-white p-6 rounded-2xl shadow-md mb-4">
              <p>🕹 Ігри з Перкі (Tic-Tac-Toe)</p>
              <button className="mt-4 px-6 py-2 rounded-xl text-white" style={{ backgroundColor: theme.buttonColor }}>Грати з другом</button>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-md">
              <p>📻 PerkUp Radio</p>
              <audio controls className="w-full mt-4">
                <source src="https://icecast.skyrock.net/s/natio_mp3_128k" type="audio/mpeg" />
              </audio>
            </div>
          </div>
        )}

        {activeTab === 'bonuses' && (
          <div className="space-y-6">
            <WheelOfFortune onSpin={() => syncUser()} canSpin={canSpin} nextSpinAt={nextSpinAt} theme={theme} />
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
              <p>2. 100 накопичених балів можна обміняти на будь-який напій до 100 грн.</p>
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
          { id: 'games', icon: '🎮', label: 'Ігри' },
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
