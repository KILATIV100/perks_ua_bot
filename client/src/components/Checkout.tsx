import { useState } from 'react';
import axios from 'axios';
import type { CartItem } from './Menu';

interface CheckoutProps {
  apiUrl: string;
  cart: CartItem[];
  telegramId: number;
  locationId: string;
  locationName: string;
  theme: {
    bgColor: string;
    textColor: string;
    hintColor: string;
    buttonColor: string;
    buttonTextColor: string;
    secondaryBgColor: string;
  };
  onClose: () => void;
  onSuccess: () => void;
}

export function Checkout({ apiUrl, cart, telegramId, locationId, locationName, theme, onClose, onSuccess }: CheckoutProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = cart.reduce((sum, item) => sum + parseFloat(item.product.price) * item.quantity, 0);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      await axios.post(`${apiUrl}/api/orders`, {
        telegramId: String(telegramId),
        locationId,
        items: cart.map(item => ({
          productId: item.product.id,
          quantity: item.quantity,
          price: parseFloat(item.product.price),
        })),
      });

      onSuccess();
    } catch (err) {
      console.error('[Checkout] Error:', err);
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError('Не вдалося створити замовлення. Спробуйте пізніше.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div
        className="w-full max-w-md rounded-t-3xl p-6 max-h-[85vh] overflow-y-auto animate-slide-up"
        style={{ backgroundColor: theme.bgColor }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold" style={{ color: theme.textColor }}>
            Оформлення замовлення
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: theme.hintColor + '20', color: theme.hintColor }}
          >
            ✕
          </button>
        </div>

        {/* Location */}
        <div className="mb-4 p-3 rounded-xl" style={{ backgroundColor: theme.secondaryBgColor }}>
          <p className="text-xs" style={{ color: theme.hintColor }}>Локація</p>
          <p className="font-medium text-sm" style={{ color: theme.textColor }}>📍 {locationName}</p>
        </div>

        {/* Order items */}
        <div className="mb-4">
          <p className="text-xs mb-2 font-medium" style={{ color: theme.hintColor }}>Замовлення</p>
          {cart.map(item => (
            <div key={item.product.id} className="flex justify-between items-center py-2 border-b" style={{ borderColor: theme.hintColor + '20' }}>
              <div>
                <span className="text-sm" style={{ color: theme.textColor }}>
                  {item.product.name} x{item.quantity}
                </span>
              </div>
              <span className="text-sm font-medium" style={{ color: theme.textColor }}>
                {parseFloat(item.product.price) * item.quantity} грн
              </span>
            </div>
          ))}
          <div className="flex justify-between items-center pt-2">
            <span className="font-bold" style={{ color: theme.textColor }}>Разом</span>
            <span className="font-bold text-lg" style={{ color: theme.buttonColor }}>{total} грн</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-xl text-center text-sm" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
            {error}
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={submitting || cart.length === 0}
          className="w-full py-4 rounded-2xl font-bold text-base transition-all active:scale-[0.98] disabled:opacity-60"
          style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
        >
          {submitting ? 'Оформлюємо...' : `Замовити — ${total} грн`}
        </button>
      </div>
    </div>
  );
}
