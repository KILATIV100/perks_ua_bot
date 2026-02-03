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

function LocationSelector({ locations, selectedLocation, onSelect }: LocationSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Оберіть локацію
        </h2>
        <p className="text-sm text-gray-500">
          Виберіть кав'ярню, де бажаєте зробити замовлення
        </p>
      </div>

      <div className="space-y-3">
        {locations.map((location) => {
          const isSelected = selectedLocation?.id === location.id;
          const isComingSoon = location.status === 'coming_soon';

          return (
            <div
              key={location.id}
              onClick={() => onSelect(location)}
              className={`location-card ${isSelected ? 'selected' : ''} ${
                isComingSoon ? 'opacity-75' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isComingSoon
                      ? 'bg-gray-100 text-gray-400'
                      : isSelected
                      ? 'bg-coffee text-white'
                      : 'bg-primary-100 text-coffee'
                  }`}
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
                  <h3 className="font-medium text-gray-900 truncate">
                    {location.name}
                  </h3>
                  {location.address && (
                    <p className="text-sm text-gray-500 mt-0.5 truncate">
                      {location.address}
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
                      className={`w-full py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                        isComingSoon
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : isSelected
                          ? 'bg-coffee text-white'
                          : 'bg-primary-100 text-coffee hover:bg-primary-200'
                      }`}
                    >
                      {isComingSoon ? 'Скоро відкриття' : 'Замовити'}
                    </button>
                  </div>
                </div>

                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isComingSoon
                      ? 'border-gray-300 bg-gray-100'
                      : isSelected
                      ? 'border-coffee bg-coffee'
                      : 'border-gray-300 bg-white'
                  }`}
                >
                  {isSelected && !isComingSoon && (
                    <svg
                      className="w-4 h-4 text-white"
                      fill="none"
                      stroke="currentColor"
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
          <p className="text-gray-500">Локації не знайдено</p>
        </div>
      )}
    </div>
  );
}

export default LocationSelector;
