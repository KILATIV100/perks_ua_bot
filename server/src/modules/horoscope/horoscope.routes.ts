/**
 * Coffee Horoscope Module — AI-generated daily coffee horoscope
 *
 * GET /today  — Get today's personalized horoscope for user
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { redis } from '../../shared/redis.js';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';

export async function horoscopeRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {

  /**
   * Get today's coffee horoscope for user
   */
  app.get('/today', async (request, reply) => {
    const { telegramId } = request.query as { telegramId: string };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });
    const cacheKey = `horoscope:${user.id}:${today}`;

    // Check cache first
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached));
      }
    } catch {
      // Redis not available, continue
    }

    // Get user's favorite drink from order history
    const recentOrders = await app.prisma.order.findMany({
      where: { userId: user.id, status: 'COMPLETED' },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const favoriteDrink = recentOrders
      .flatMap(o => o.items.map(i => i.product.name))[0] || 'капучіно';

    let horoscope: { text: string; drink: string; bonusPoints: number };

    if (CLAUDE_API_KEY) {
      try {
        const prompt = `Ти — кавовий астролог бота PerkUP. Напиши коротке кавове "передбачення дня" (2-3 речення) для людини на ім'я ${user.firstName || 'друже'}.
Їхній улюблений напій: ${favoriteDrink}.
Запропонуй напій дня з коротким поясненням чому саме він. Стиль: дружній, з гумором, трохи містичний. Українською мовою. Без лапок.`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        const data = await response.json() as { content?: Array<{ text: string }> };
        const text = data.content?.[0]?.text || '';

        horoscope = {
          text,
          drink: favoriteDrink,
          bonusPoints: 15,
        };
      } catch {
        horoscope = getTemplateHoroscope(user.firstName || 'друже', favoriteDrink);
      }
    } else {
      horoscope = getTemplateHoroscope(user.firstName || 'друже', favoriteDrink);
    }

    const result = {
      ...horoscope,
      date: today,
      userName: user.firstName || 'друже',
    };

    // Cache for the rest of the day
    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400);
    } catch {
      // Redis not available
    }

    return reply.send(result);
  });
}

function getTemplateHoroscope(name: string, favDrink: string): {
  text: string;
  drink: string;
  bonusPoints: number;
} {
  const templates = [
    {
      text: `Зірки кажуть: сьогодні ідеальний день для нових знайомств. Флет уайт допоможе тобі бути впевненим.`,
      drink: 'Флет уайт',
    },
    {
      text: `Меркурій у ретроградності — ідеальний день для глибоких рішень. Подвійний еспресо — те що треба.`,
      drink: 'Допіо',
    },
    {
      text: `Сьогодні Всесвіт натякає: будь сміливим! Спробуй раф — він додасть тобі креативної енергії.`,
      drink: 'Раф',
    },
    {
      text: `Місяць у фазі відпочинку. Ідеальний день для капучіно і хорошої книги.`,
      drink: 'Капучіно',
    },
    {
      text: `Венера підказує: будь ніжним до себе. Лате з мигдальним молоком — саме для цього дня.`,
      drink: 'Лате',
    },
  ];

  const picked = templates[Math.floor(Math.random() * templates.length)];

  return {
    text: picked.text,
    drink: picked.drink,
    bonusPoints: 15,
  };
}
