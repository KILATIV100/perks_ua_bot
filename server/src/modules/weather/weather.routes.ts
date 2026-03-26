/**
 * Weather Menu Module — Weather-based drink recommendations
 *
 * GET /current         — Get current weather in Brovary
 * GET /recommendation  — Get weather-based drink recommendation
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || '';
const BROVARY_LAT = 50.511;
const BROVARY_LON = 30.775;

interface WeatherData {
  temp: number;
  feelsLike: number;
  description: string;
  icon: string;
}

async function getCurrentWeather(): Promise<WeatherData | null> {
  if (!OPENWEATHER_API_KEY) return null;

  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${BROVARY_LAT}&lon=${BROVARY_LON}&units=metric&lang=uk&appid=${OPENWEATHER_API_KEY}`
    );
    const data = await response.json() as {
      main?: { temp: number; feels_like: number };
      weather?: Array<{ description: string; icon: string }>;
    };

    if (!data.main) return null;

    return {
      temp: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      description: data.weather?.[0]?.description || '',
      icon: data.weather?.[0]?.icon || '',
    };
  } catch {
    return null;
  }
}

function getRecommendation(temp: number): {
  drinks: string[];
  message: string;
  emoji: string;
} {
  if (temp <= -5) {
    return {
      drinks: ['Гарячий шоколад', 'Раф', 'Глінтвейн б/а'],
      message: 'В таку погоду тільки щось гаряче і затишне!',
      emoji: '🥶',
    };
  }
  if (temp <= 5) {
    return {
      drinks: ['Капучіно', 'Лате', 'Какао'],
      message: 'Прохолодно — час на класику з молоком!',
      emoji: '🌧',
    };
  }
  if (temp <= 15) {
    return {
      drinks: ['Американо', 'Фільтр кава', 'Флет уайт'],
      message: 'Ідеальна погода для кави!',
      emoji: '☁️',
    };
  }
  if (temp <= 25) {
    return {
      drinks: ['ICE-лате', 'Еспресо-тонік', 'Лимонад'],
      message: 'Тепло! Спробуй щось освіжаюче.',
      emoji: '☀️',
    };
  }
  return {
    drinks: ['ICE-лате', 'Фрапе', 'Лимонад', 'Молочний коктейль'],
    message: 'Спека! Тільки холодне рятує.',
    emoji: '🔥',
  };
}

export async function weatherRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {

  /**
   * Get current weather
   */
  app.get('/current', async (_request, reply) => {
    const weather = await getCurrentWeather();

    if (!weather) {
      return reply.send({ available: false });
    }

    return reply.send({
      available: true,
      ...weather,
    });
  });

  /**
   * Get weather-based drink recommendation
   */
  app.get('/recommendation', async (_request, reply) => {
    const weather = await getCurrentWeather();

    if (!weather) {
      return reply.send({
        available: false,
        recommendation: getRecommendation(10), // Default fallback
      });
    }

    const recommendation = getRecommendation(weather.temp);

    return reply.send({
      available: true,
      weather,
      recommendation,
    });
  });
}
