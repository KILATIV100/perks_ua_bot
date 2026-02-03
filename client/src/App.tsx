import { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import LocationSelector from './components/LocationSelector';

declare global {
  interface Window {
    Telegram: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
          enable: () => void;
          disable: () => void;
          showProgress: (leaveActive: boolean) => void;
          hideProgress: () => void;
          isVisible: boolean;
          isActive: boolean;
        };
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
          };
        };
        themeParams: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          link_color?: string;
          button_color?: string;
          button_text_color?: string;
          secondary_bg_color?: string;
        };
        colorScheme: 'light' | 'dark';
      };
    };
  }
}

type LocationStatus = 'active' | 'coming_soon';

interface Location {
  id: string;
  name: string;
  lat: number | null;
  long: number | null;
  address: string | null;
  status: LocationStatus;
}

interface TelegramTheme {
  bgColor: string;
  textColor: string;
  hintColor: string;
  buttonColor: string;
  buttonTextColor: string;
  secondaryBgColor: string;
  isDark: boolean;
}

// API base URL
const API_URL = import.meta.env.VITE_API_URL || 'https://api.perkup.com.ua';

// Axios instance
const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

function useTelegramTheme(): TelegramTheme {
  return useMemo(() => {
    const tg = window.Telegram?.WebApp;
    const params = tg?.themeParams;
    const isDark = tg?.colorScheme === 'dark';

    return {
      bgColor: params?.bg_color || (isDark ? '#1c1c1e' : '#ffffff'),
      textColor: params?.text_color || (isDark ? '#ffffff' : '#000000'),
      hintColor: params?.hint_color || (isDark ? '#8e8e93' : '#999999'),
      buttonColor: params?.button_color || '#8B5A2B',
      buttonTextColor: params?.button_text_color || '#ffffff',
      secondaryBgColor: params?.secondary_bg_color || (isDark ? '#2c2c2e' : '#f5f5f5'),
      isDark,
    };
  }, []);
}

function App() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tg = window.Telegram?.WebApp;
  const theme = useTelegramTheme();

  useEffect(() => {
    // Initialize Telegram WebApp
    if (tg) {
      tg.ready();
      tg.expand();

      // Set native colors
      tg.setHeaderColor(theme.bgColor);
      tg.setBackgroundColor(theme.secondaryBgColor);
    }

    // Fetch locations
    fetchLocations();
  }, []);

  useEffect(() => {
    if (!tg) return;

    // Only show button if selected location is active
    if (selectedLocation && selectedLocation.status === 'active') {
      tg.MainButton.text = 'Замовити';
      tg.MainButton.color = theme.buttonColor;
      tg.MainButton.textColor = theme.buttonTextColor;
      tg.MainButton.show();
      tg.MainButton.enable();
    } else {
      tg.MainButton.hide();
    }

    const handleMainButtonClick = () => {
      if (selectedLocation && selectedLocation.status === 'active') {
        // Navigate to menu or next screen
        console.log('Selected location:', selectedLocation);
        alert(`Обрано: ${selectedLocation.name}\nПереходимо до меню...`);
      }
    };

    tg.MainButton.onClick(handleMainButtonClick);

    return () => {
      tg.MainButton.offClick(handleMainButtonClick);
    };
  }, [selectedLocation, tg, theme]);

  const fetchLocations = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.get<{ locations: Location[] }>('/api/locations');
      setLocations(response.data.locations);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error || 'Не вдалося завантажити локації');
      } else {
        setError('Не вдалося завантажити локації');
      }
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLocation = (location: Location) => {
    // Toggle selection
    if (selectedLocation?.id === location.id) {
      setSelectedLocation(null);
    } else {
      setSelectedLocation(location);
    }
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: theme.secondaryBgColor }}
      >
        <div className="text-center">
          <div
            className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-4"
            style={{ borderColor: theme.buttonColor, borderTopColor: 'transparent' }}
          />
          <p style={{ color: theme.hintColor }}>Завантаження...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ backgroundColor: theme.secondaryBgColor }}
      >
        <div className="text-center">
          <p className="mb-4" style={{ color: '#ef4444' }}>{error}</p>
          <button
            onClick={fetchLocations}
            className="py-3 px-6 rounded-xl font-medium transition-all"
            style={{
              backgroundColor: theme.buttonColor,
              color: theme.buttonTextColor,
            }}
          >
            Спробувати знову
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: theme.secondaryBgColor }}
    >
      <header
        className="sticky top-0 z-10 border-b"
        style={{
          backgroundColor: theme.bgColor,
          borderColor: theme.isDark ? '#3c3c3e' : '#e5e5e5',
        }}
      >
        <div className="px-4 py-4">
          <h1
            className="text-xl font-bold flex items-center gap-2"
            style={{ color: theme.textColor }}
          >
            <span>☕</span>
            PerkUp
          </h1>
        </div>
      </header>

      <main className="p-4 pb-24">
        <LocationSelector
          locations={locations}
          selectedLocation={selectedLocation}
          onSelect={handleSelectLocation}
        />
      </main>
    </div>
  );
}

export default App;
