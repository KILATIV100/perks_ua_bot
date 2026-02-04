import { useEffect, useState, useMemo, useCallback } from 'react';
import axios from 'axios';
import WebApp from '@twa-dev/sdk';

// Types
type LocationStatus = 'active' | 'coming_soon';

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

interface TelegramTheme {
  bgColor: string;
  textColor: string;
  hintColor: string;
  buttonColor: string;
  buttonTextColor: string;
  secondaryBgColor: string;
}

// API base URL - set VITE_API_URL in Railway environment
const API_URL = import.meta.env.VITE_API_URL || '';

// Axios instance
const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
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

// Get Telegram user data
function useTelegramUser(): TelegramUser | null {
  return useMemo(() => {
    const user = WebApp.initDataUnsafe?.user;
    if (!user) return null;

    return {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
    };
  }, []);
}

function App() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const theme = useTelegramTheme();
  const user = useTelegramUser();

  // Initialize Telegram WebApp
  useEffect(() => {
    WebApp.ready();
    WebApp.expand();

    // Set theme colors
    WebApp.setHeaderColor(theme.bgColor);
    WebApp.setBackgroundColor(theme.secondaryBgColor);
  }, [theme]);

  // Fetch locations from API
  useEffect(() => {
    fetchLocations();
  }, []);

  // Handle Main Button
  useEffect(() => {
    if (selectedLocation && selectedLocation.status === 'active') {
      WebApp.MainButton.text = 'Замовити';
      WebApp.MainButton.color = theme.buttonColor;
      WebApp.MainButton.textColor = theme.buttonTextColor;
      WebApp.MainButton.show();

      const handleClick = () => {
        handleOrder(selectedLocation);
      };

      WebApp.MainButton.onClick(handleClick);
      return () => {
        WebApp.MainButton.offClick(handleClick);
      };
    } else {
      WebApp.MainButton.hide();
    }
  }, [selectedLocation, theme]);

  const fetchLocations = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.get<{ locations: Location[] }>('/api/locations');
      setLocations(response.data.locations);
    } catch (err) {
      console.error('Fetch error:', err);
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error || 'Не вдалося завантажити локації');
      } else {
        setError('Не вдалося завантажити локації');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLocation = useCallback((location: Location) => {
    if (selectedLocation?.id === location.id) {
      setSelectedLocation(null);
    } else {
      setSelectedLocation(location);
    }
  }, [selectedLocation]);

  const handleOrder = useCallback((location: Location) => {
    const userName = user?.firstName || 'Гість';
    WebApp.showAlert(`${userName}, ви обрали: ${location.name}\n\nЗамовлення буде доступне незабаром!`);
  }, [user]);

  // Loading state
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

  // Error state
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
            className="py-3 px-6 rounded-xl font-medium transition-all active:scale-95"
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
      {/* Header */}
      <header
        className="sticky top-0 z-10 border-b"
        style={{
          backgroundColor: theme.bgColor,
          borderColor: theme.hintColor + '30',
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
          {user && (
            <p className="text-sm mt-1" style={{ color: theme.hintColor }}>
              Привіт, {user.firstName}!
            </p>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="p-4 pb-24">
        <div className="mb-6">
          <h2
            className="text-lg font-semibold mb-1"
            style={{ color: theme.textColor }}
          >
            Оберіть локацію
          </h2>
          <p className="text-sm" style={{ color: theme.hintColor }}>
            Виберіть кав'ярню для замовлення
          </p>
        </div>

        {/* Locations list */}
        <div className="space-y-3">
          {locations.map((location) => {
            const isSelected = selectedLocation?.id === location.id;
            const isComingSoon = location.status === 'coming_soon';
            const hasCoords = location.lat !== null && location.long !== null;

            return (
              <div
                key={location.id}
                onClick={() => !isComingSoon && handleSelectLocation(location)}
                className={`rounded-2xl p-4 transition-all duration-200 ${
                  isComingSoon ? 'opacity-60' : 'cursor-pointer active:scale-[0.98]'
                }`}
                style={{
                  backgroundColor: theme.bgColor,
                  boxShadow: isSelected
                    ? `0 0 0 2px ${theme.buttonColor}, 0 4px 6px -1px rgba(0, 0, 0, 0.1)`
                    : '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      backgroundColor: isComingSoon
                        ? theme.secondaryBgColor
                        : isSelected
                        ? theme.buttonColor
                        : theme.buttonColor + '20',
                      color: isComingSoon
                        ? theme.hintColor
                        : isSelected
                        ? theme.buttonTextColor
                        : theme.buttonColor,
                    }}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3
                        className="font-semibold truncate"
                        style={{ color: theme.textColor }}
                      >
                        {location.name}
                      </h3>
                      {isComingSoon && (
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
                          style={{
                            backgroundColor: '#fef3c7',
                            color: '#92400e',
                          }}
                        >
                          Незабаром
                        </span>
                      )}
                    </div>

                    {hasCoords && location.address ? (
                      <p className="text-sm mt-1 truncate" style={{ color: theme.hintColor }}>
                        {location.address}
                      </p>
                    ) : (
                      <p className="text-sm mt-1 flex items-center gap-1" style={{ color: theme.hintColor }}>
                        <span>⏳</span>
                        <span>Адреса уточнюється</span>
                      </p>
                    )}

                    {/* Order button */}
                    {!isComingSoon && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectLocation(location);
                          if (isSelected) {
                            handleOrder(location);
                          }
                        }}
                        className="mt-3 w-full py-2.5 px-4 rounded-xl text-sm font-medium transition-all active:scale-[0.98]"
                        style={{
                          backgroundColor: isSelected ? theme.buttonColor : theme.buttonColor + '15',
                          color: isSelected ? theme.buttonTextColor : theme.buttonColor,
                        }}
                      >
                        {isSelected ? 'Замовити' : 'Обрати'}
                      </button>
                    )}
                  </div>

                  {/* Checkbox */}
                  {!isComingSoon && (
                    <div
                      className="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-1"
                      style={{
                        borderColor: isSelected ? theme.buttonColor : theme.hintColor,
                        backgroundColor: isSelected ? theme.buttonColor : 'transparent',
                      }}
                    >
                      {isSelected && (
                        <svg className="w-4 h-4" fill="none" stroke={theme.buttonTextColor} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  )}
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
      </main>
    </div>
  );
}

export default App;
