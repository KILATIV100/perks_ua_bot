import { useMemo } from 'react';

type LocationStatus = 'active' | 'coming_soon';

interface Location {
  id: string;
  name: string;
  lat: number | null;
  long: number | null;
  address: string | null;
  status: LocationStatus;
}

interface LocationSelectorProps {
  locations: Location[];
  selectedLocation: Location | null;
  onSelect: (location: Location) => void;
}

interface TelegramTheme {
  bgColor: string;
  textColor: string;
  hintColor: string;
  buttonColor: string;
  buttonTextColor: string;
  secondaryBgColor: string;
}

function useTelegramTheme(): TelegramTheme {
  return useMemo(() => {
    const tg = window.Telegram?.WebApp;
    const params = tg?.themeParams;

    return {
      bgColor: params?.bg_color || '#ffffff',
      textColor: params?.text_color || '#000000',
      hintColor: params?.hint_color || '#999999',
      buttonColor: params?.button_color || '#8B5A2B',
      buttonTextColor: params?.button_text_color || '#ffffff',
      secondaryBgColor: params?.secondary_bg_color || '#f5f5f5',
    };
  }, []);
}

function LocationSelector({ locations, selectedLocation, onSelect }: LocationSelectorProps) {
  const theme = useTelegramTheme();

  const hasCoordinates = (location: Location): boolean => {
    return location.lat !== null && location.long !== null;
  };

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h2
          className="text-lg font-semibold mb-1"
          style={{ color: theme.textColor }}
        >
          Оберіть локацію
        </h2>
        <p
          className="text-sm"
          style={{ color: theme.hintColor }}
        >
          Виберіть кав'ярню, де бажаєте зробити замовлення
        </p>
      </div>

      <div className="space-y-3">
        {locations.map((location) => {
          const isSelected = selectedLocation?.id === location.id;
          const isComingSoon = location.status === 'coming_soon';
          const hasCoords = hasCoordinates(location);

          return (
            <div
              key={location.id}
              onClick={() => onSelect(location)}
              className={`rounded-2xl p-4 cursor-pointer transition-all duration-200 ${
                isComingSoon ? 'opacity-75' : ''
              }`}
              style={{
                backgroundColor: theme.bgColor,
                boxShadow: isSelected
                  ? `0 0 0 2px ${theme.buttonColor}, 0 4px 6px -1px rgba(0, 0, 0, 0.1)`
                  : '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              }}
            >
              <div className="flex items-start gap-3">
                {/* Location icon */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{
                    backgroundColor: isComingSoon
                      ? theme.secondaryBgColor
                      : isSelected
                      ? theme.buttonColor
                      : `${theme.buttonColor}20`,
                    color: isComingSoon
                      ? theme.hintColor
                      : isSelected
                      ? theme.buttonTextColor
                      : theme.buttonColor,
                  }}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
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

                <div className="flex-1 min-w-0">
                  <h3
                    className="font-medium truncate"
                    style={{ color: theme.textColor }}
                  >
                    {location.name}
                  </h3>

                  {/* Address or "Адреса уточнюється" */}
                  {hasCoords && location.address ? (
                    <p
                      className="text-sm mt-0.5 truncate"
                      style={{ color: theme.hintColor }}
                    >
                      {location.address}
                    </p>
                  ) : (
                    <p
                      className="text-sm mt-0.5 flex items-center gap-1"
                      style={{ color: theme.hintColor }}
                    >
                      <span>⏳</span>
                      <span>Адреса уточнюється</span>
                    </p>
                  )}

                  {/* Coming soon badge */}
                  {isComingSoon && (
                    <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                      Скоро відкриття
                    </span>
                  )}

                  {/* Order button - disabled for coming_soon */}
                  <div className="mt-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isComingSoon) {
                          onSelect(location);
                        }
                      }}
                      disabled={isComingSoon}
                      className="w-full py-2 px-4 rounded-lg text-sm font-medium transition-all"
                      style={{
                        backgroundColor: isComingSoon
                          ? theme.secondaryBgColor
                          : isSelected
                          ? theme.buttonColor
                          : `${theme.buttonColor}15`,
                        color: isComingSoon
                          ? theme.hintColor
                          : isSelected
                          ? theme.buttonTextColor
                          : theme.buttonColor,
                        cursor: isComingSoon ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isComingSoon ? 'Скоро відкриття' : 'Замовити'}
                    </button>
                  </div>
                </div>

                {/* Selection indicator */}
                <div
                  className="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{
                    borderColor: isComingSoon
                      ? theme.hintColor
                      : isSelected
                      ? theme.buttonColor
                      : theme.hintColor,
                    backgroundColor: isSelected && !isComingSoon
                      ? theme.buttonColor
                      : theme.bgColor,
                  }}
                >
                  {isSelected && !isComingSoon && (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke={theme.buttonTextColor}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {locations.length === 0 && (
        <div className="text-center py-8">
          <p style={{ color: theme.hintColor }}>Локації не знайдено</p>
        </div>
      )}
    </div>
  );
}

export default LocationSelector;
