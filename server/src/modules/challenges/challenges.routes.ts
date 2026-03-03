/**
 * Daily Challenges Module — AI-powered personalized daily challenges
 *
 * GET  /today       — Get today's challenge for user
 * POST /accept      — Accept today's challenge
 * POST /complete    — Mark challenge as completed (triggered by Poster webhook)
 * GET  /history     — Past challenges
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';

export async function challengeRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {

  /**
   * Get today's challenge for user
   * If no challenge exists, generates one using Claude API
   */
  app.get('/today', async (request, reply) => {
    const { telegramId } = request.query as { telegramId: string };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });

    // Check if challenge already exists for today
    let challenge = await app.prisma.dailyChallenge.findUnique({
      where: { userId_date: { userId: user.id, date: today } },
    });

    if (!challenge) {
      // Get user's recent orders to personalize challenge
      const recentOrders = await app.prisma.order.findMany({
        where: { userId: user.id, status: 'COMPLETED' },
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const favoriteProducts = recentOrders
        .flatMap(o => o.items.map(i => i.product.name))
        .reduce((acc, name) => {
          acc[name] = (acc[name] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

      const topProduct = Object.entries(favoriteProducts)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || 'американо';

      // Generate challenge (use Claude if available, otherwise use template)
      let description: string;
      let target: string;

      if (CLAUDE_API_KEY) {
        try {
          const prompt = `Ти - бот кав'ярні PerkUP в Броварах. Згенеруй короткий кавовий виклик дня для клієнта.
Його улюблений напій: ${topProduct}.
Запропонуй спробувати щось нове. Формат: 1-2 речення, дружній тон, українською. Без лапок.`;

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': CLAUDE_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 150,
              messages: [{ role: 'user', content: prompt }],
            }),
          });
          const data = await response.json() as { content?: Array<{ text: string }> };
          description = data.content?.[0]?.text || `Спробуй сьогодні щось нове замість ${topProduct}!`;
        } catch {
          description = `Ти зазвичай береш ${topProduct}. Спробуй сьогодні щось нове — і отримай подвійні бали!`;
        }
        target = topProduct;
      } else {
        // Template-based challenge
        const challenges = [
          { desc: `Ти зазвичай береш ${topProduct}. Спробуй сьогодні флет уайт — подвійні бали!`, target: 'Флет уайт' },
          { desc: `Замов будь-який холодний напій сьогодні і отримай подвійні бали!`, target: 'Холодні напої' },
          { desc: `Візьми каву з собою до 10:00 ранку — отримай ×2 бали!`, target: 'any' },
          { desc: `Спробуй новий раф і отримай подвійні бали за сміливість!`, target: 'Раф' },
        ];
        const picked = challenges[Math.floor(Math.random() * challenges.length)];
        description = picked.desc;
        target = picked.target;
      }

      const expiresAt = new Date();
      expiresAt.setHours(23, 59, 59, 999);

      challenge = await app.prisma.dailyChallenge.create({
        data: {
          userId: user.id,
          description,
          target,
          rewardMultiplier: 2,
          expiresAt,
          date: today,
        },
      });
    }

    return reply.send({ challenge });
  });

  /**
   * Get challenge history
   */
  app.get('/history', async (request, reply) => {
    const { telegramId } = request.query as { telegramId: string };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const challenges = await app.prisma.dailyChallenge.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const completed = challenges.filter(c => c.isCompleted).length;
    const total = challenges.length;

    return reply.send({ challenges, completed, total });
  });
}
