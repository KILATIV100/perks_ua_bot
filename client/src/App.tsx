import { useEffect, useState } from 'react';
import axios from 'axios';
import LocationSelector from './components/LocationSelector';

declare global {
  interface Window {
    Telegram: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        MainButton: {
          text: string;
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

function App() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tg = window.Telegram?.WebApp;

  useEffect(() => {
    // Initialize Telegram WebApp
    if (tg) {
      tg.ready();
      tg.expand();
    }

    // Fetch locations
    fetchLocations();
  }, []);

  useEffect(() => {
    if (!tg) return;

    // Only show button if selected location is active
    if (selectedLocation && selectedLocation.status === 'active') {
      tg.MainButton.text = 'Замовити';
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
  }, [selectedLocation, tg]);

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-coffee border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Завантаження...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button onClick={fetchLocations} className="btn-primary">
            Спробувати знову
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="px-4 py-4">
          <h1 className="text-xl font-bold text-coffee-dark flex items-center gap-2">
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
