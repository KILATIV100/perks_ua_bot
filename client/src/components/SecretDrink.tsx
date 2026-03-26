/**
 * SecretDrink — Secret Drink of the Day widget
 */

import { useEffect, useState } from 'react';

interface SecretDrinkData {
  id: string;
  productName: string;
  originalPrice: number;
  discountPrice: number;
  discountPercent: number;
  remaining: number;
  maxQuantity: number;
  availableUntil: string;
  location: string;
}

interface SecretDrinkProps {
  apiUrl: string;
  theme: {
    bgColor: string;
    textColor: string;
    hintColor: string;
    buttonColor: string;
    buttonTextColor: string;
    secondaryBgColor: string;
  };
}

export function SecretDrink({ apiUrl, theme }: SecretDrinkProps) {
  const [drink, setDrink] = useState<SecretDrinkData | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSecret();
  }, []);

  const fetchSecret = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/secret-drink/today`);
      if (res.ok) {
        const data = await res.json();
        setAvailable(data.available);
        if (data.drink) setDrink(data.drink);
      }
    } catch {
      console.error('Failed to fetch secret drink');
    } finally {
      setLoading(false);
    }
  };

  if (loading || !available || !drink) return null;

  const priceOriginal = (drink.originalPrice / 100).toFixed(0);
  const priceDiscount = (drink.discountPrice / 100).toFixed(0);
  const timeLeft = new Date(drink.availableUntil).toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="p-4 rounded-2xl" style={{ backgroundColor: '#FFF8E1', border: '1px solid #F4A623' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🔒</span>
        <span className="font-bold text-sm" style={{ color: '#8B5A2B' }}>СЕКРЕТ РОЗКРИТО!</span>
      </div>

      <p className="font-bold mb-1" style={{ color: '#1a0a00' }}>
        {drink.productName}
      </p>

      <div className="flex items-center gap-2 mb-2">
        <span className="line-through text-sm" style={{ color: theme.hintColor }}>
          {priceOriginal} грн
        </span>
        <span className="font-bold text-lg" style={{ color: '#c8821a' }}>
          {priceDiscount} грн
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
          -{drink.discountPercent}%
        </span>
      </div>

      <div className="flex justify-between text-xs" style={{ color: theme.hintColor }}>
        <span>Залишилось: {drink.remaining} з {drink.maxQuantity}</span>
        <span>До {timeLeft}</span>
      </div>
    </div>
  );
}
