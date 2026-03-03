/**
 * CoffeeDna — Coffee DNA Profile & Archetype Card
 * Shows user's coffee preferences and shareable archetype card
 */

import { useEffect, useState } from 'react';

interface DnaData {
  archetype: string | null;
  archetypeDesc: string | null;
  archetypeRarity: number | null;
  topDrink: string | null;
  timePreference: string | null;
  sugarFree: number | null;
  topLocation: string | null;
  totalOrders: number;
}

interface CoffeeDnaProps {
  apiUrl: string;
  telegramId?: number;
  theme: {
    bgColor: string;
    textColor: string;
    hintColor: string;
    buttonColor: string;
    buttonTextColor: string;
    secondaryBgColor: string;
  };
}

export function CoffeeDna({ apiUrl, telegramId, theme }: CoffeeDnaProps) {
  const [dna, setDna] = useState<DnaData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!telegramId) return;
    fetchDna();
  }, [telegramId]);

  const fetchDna = async () => {
    try {
      // For now, use a placeholder — real endpoint will be added
      setDna({
        archetype: null,
        archetypeDesc: null,
        archetypeRarity: null,
        topDrink: null,
        timePreference: null,
        sugarFree: null,
        topLocation: null,
        totalOrders: 0,
      });
    } catch {
      console.error('Failed to fetch DNA');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 rounded-2xl text-center" style={{ backgroundColor: theme.bgColor }}>
        <p style={{ color: theme.hintColor }}>Завантаження...</p>
      </div>
    );
  }

  const needsMoreOrders = !dna?.archetype || (dna?.totalOrders || 0) < 10;

  return (
    <div className="p-4 rounded-2xl" style={{ backgroundColor: theme.bgColor }}>
      <h3 className="font-semibold mb-2">🧬 Кавовий DNA</h3>

      {needsMoreOrders ? (
        <div className="text-center py-6">
          <p className="text-4xl mb-4">🧬</p>
          <p className="font-semibold mb-2" style={{ color: theme.textColor }}>
            Твій архетип ще формується
          </p>
          <p className="text-sm mb-4" style={{ color: theme.hintColor }}>
            Зроби {10 - (dna?.totalOrders || 0)} замовлень щоб розкрити свій кавовий DNA
          </p>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all"
              style={{
                width: `${Math.min(100, ((dna?.totalOrders || 0) / 10) * 100)}%`,
                backgroundColor: theme.buttonColor,
              }}
            />
          </div>
          <p className="text-xs mt-2" style={{ color: theme.hintColor }}>
            {dna?.totalOrders || 0}/10 замовлень
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Archetype card */}
          <div
            className="p-4 rounded-xl text-center"
            style={{ backgroundColor: '#1a0a00', color: '#FFF8F0' }}
          >
            <p className="text-xs font-mono uppercase tracking-wider opacity-40 mb-2">
              Твій PerkUP DNA
            </p>
            {dna?.topDrink && (
              <p className="text-sm opacity-60 mb-1">☕ {dna.topDrink}</p>
            )}
            {dna?.timePreference && (
              <p className="text-sm opacity-60 mb-1">🌅 {dna.timePreference}</p>
            )}
            {dna?.sugarFree != null && (
              <p className="text-sm opacity-60 mb-1">⚡ Без цукру: {dna.sugarFree}%</p>
            )}
            {dna?.topLocation && (
              <p className="text-sm opacity-60 mb-3">📍 {dna.topLocation}</p>
            )}
            <p className="text-xl font-bold text-yellow-400 mt-2">
              {dna?.archetype || 'Кавовий дослідник'}
            </p>
            {dna?.archetypeRarity && (
              <p className="text-xs text-cyan-400 mt-1">
                Таких лише {dna.archetypeRarity}% клієнтів PerkUP
              </p>
            )}
          </div>

          <button
            className="w-full py-2 rounded-xl text-sm font-medium"
            style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
          >
            📤 Поділитись своїм DNA
          </button>
        </div>
      )}
    </div>
  );
}
