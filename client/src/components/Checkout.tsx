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

const PICKUP_TIMES = [5, 10, 15, 20];

export function Checkout({ apiUrl, cart, telegramId, locationId, locationName, theme, onClose, onSuccess }: CheckoutProps) {
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'telegram_pay'>('cash');
  const [pickupMinutes, setPickupMinutes] = useState(10);
  const [shippingAddress, setShippingAddress] = useState('');
  const [shippingPhone, setShippingPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = cart.reduce((sum, item) => sum + parseFloat(item.product.price) * item.quantity, 0);
  const isShippingOrder = cart.some(item => item.product.type === 'MERCH' || item.product.type === 'BEANS');

  const handleSubmit = async () => {
    if (submitting) return;
    setError(null);

    if (isShippingOrder) {
      if (!shippingAddress.trim() || !shippingPhone.trim()) {
        setError("Будь ласка, заповніть адресу та телефон для доставки.");
        return;
      }
    }

    setSubmitting(true);

    try {

      await axios.post(`${apiUrl}/api/orders`, {
        telegramId: String(telegramId),
        locationId,
        paymentMethod,
        pickupMinutes: isShippingOrder ? undefined : pickupMinutes,
        deliveryType: isShippingOrder ? 'shipping' : 'pickup',
        shippingAddr: isShippingOrder ? shippingAddress.trim() : undefined,
        phone: isShippingOrder ? shippingPhone.trim() : undefined,
        items: cart.map(item => ({
          productId: item.product.id,
          name: item.product.name,
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

        {/* Pickup time or shipping info */}
        {!isShippingOrder ? (
          <div className="mb-4">
            <p className="text-xs mb-2 font-medium" style={{ color: theme.hintColor }}>Час готовності</p>
            <div className="grid grid-cols-4 gap-2">
              {PICKUP_TIMES.map(time => (
                <button
                  key={time}
                  onClick={() => setPickupMinutes(time)}
                  className="py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{
                    backgroundColor: pickupMinutes === time ? theme.buttonColor : theme.secondaryBgColor,
                    color: pickupMinutes === time ? theme.buttonTextColor : theme.textColor,
                  }}
                >
                  {time} хв
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-4 space-y-3">
            <p className="text-xs font-medium" style={{ color: theme.hintColor }}>
              Доставка (Нова Пошта)
            </p>
            <input
              value={shippingAddress}
              onChange={(event) => setShippingAddress(event.target.value)}
              placeholder="Місто та відділення/поштомат"
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={{ backgroundColor: theme.secondaryBgColor, color: theme.textColor }}
            />
            <input
              value={shippingPhone}
              onChange={(event) => setShippingPhone(event.target.value)}
              placeholder="Телефон для зв'язку"
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={{ backgroundColor: theme.secondaryBgColor, color: theme.textColor }}
            />
          </div>
        )}

        {/* Payment method */}
        <div className="mb-6">
          <p className="text-xs mb-2 font-medium" style={{ color: theme.hintColor }}>Спосіб оплати</p>
          <div className="space-y-2">
            <button
              onClick={() => setPaymentMethod('cash')}
              className="w-full p-3 rounded-xl flex items-center gap-3 transition-all"
              style={{
                backgroundColor: paymentMethod === 'cash' ? theme.buttonColor + '15' : theme.secondaryBgColor,
                border: paymentMethod === 'cash' ? `2px solid ${theme.buttonColor}` : '2px solid transparent',
              }}
            >
              <span className="text-xl">💵</span>
              <span className="text-sm font-medium" style={{ color: theme.textColor }}>При отриманні</span>
            </button>
            <button
              onClick={() => setPaymentMethod('telegram_pay')}
              className="w-full p-3 rounded-xl flex items-center gap-3 transition-all opacity-50 cursor-not-allowed"
              style={{
                backgroundColor: theme.secondaryBgColor,
                border: '2px solid transparent',
              }}
              disabled
            >
              <span className="text-xl">💳</span>
              <div className="flex-1 text-left">
                <span className="text-sm font-medium" style={{ color: theme.textColor }}>Telegram Pay</span>
                <span className="text-xs ml-2" style={{ color: theme.hintColor }}>Незабаром</span>
              </div>
            </button>
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
