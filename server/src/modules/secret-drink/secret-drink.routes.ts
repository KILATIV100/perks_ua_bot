/**
 * Secret Drink of the Day Module
 *
 * GET  /today       — Get today's secret drink
 * POST /claim       — Claim/reserve the secret drink
 * POST /set         — (Admin) Set today's secret drink manually
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function secretDrinkRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {

  /**
   * Get today's secret drink
   */
  app.get('/today', async (_request, reply) => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });

    const secretDrink = await app.prisma.secretDrink.findFirst({
      where: { date: today, isActive: true },
      include: { location: { select: { name: true } } },
    });

    if (!secretDrink) {
      return reply.send({ available: false, message: 'Секретний напій ще не розкрито!' });
    }

    return reply.send({
      available: true,
      drink: {
        id: secretDrink.id,
        productName: secretDrink.productName,
        originalPrice: secretDrink.originalPrice,
        discountPrice: secretDrink.discountPrice,
        discountPercent: secretDrink.discountPercent,
        remaining: secretDrink.maxQuantity - secretDrink.claimedCount,
        maxQuantity: secretDrink.maxQuantity,
        availableUntil: secretDrink.availableUntil,
        location: secretDrink.location?.name || 'Всі локації',
      },
    });
  });

  /**
   * Claim the secret drink
   */
  app.post('/claim', async (request, reply) => {
    const { telegramId, secretDrinkId } = request.body as {
      telegramId: string;
      secretDrinkId: string;
    };

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const drink = await app.prisma.secretDrink.findUnique({
      where: { id: secretDrinkId },
    });

    if (!drink || !drink.isActive) {
      return reply.status(404).send({ error: 'Secret drink not available' });
    }

    if (drink.claimedCount >= drink.maxQuantity) {
      return reply.status(400).send({ error: 'Sold out', message: 'На жаль, все вже розібрали!' });
    }

    if (new Date() > drink.availableUntil) {
      return reply.status(400).send({ error: 'Expired', message: 'Час акції вичерпано' });
    }

    const updated = await app.prisma.secretDrink.update({
      where: { id: secretDrinkId },
      data: { claimedCount: { increment: 1 } },
    });

    return reply.send({
      success: true,
      remaining: updated.maxQuantity - updated.claimedCount,
      discountPrice: drink.discountPrice,
    });
  });

  /**
   * Admin: Set today's secret drink
   */
  app.post('/set', async (request, reply) => {
    const {
      telegramId,
      productName,
      originalPrice,
      discountPercent,
      maxQuantity,
      availableHours,
      locationId,
    } = request.body as {
      telegramId: string;
      productName: string;
      originalPrice: number;
      discountPercent?: number;
      maxQuantity?: number;
      availableHours?: number;
      locationId?: string;
    };

    const admin = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!admin || (admin.role !== 'ADMIN' && admin.role !== 'OWNER')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });
    const discount = discountPercent || 30;
    const discountPrice = Math.round(originalPrice * (1 - discount / 100));
    const hours = availableHours || 3;
    const availableUntil = new Date(Date.now() + hours * 60 * 60 * 1000);

    // Deactivate previous secret drinks for today
    await app.prisma.secretDrink.updateMany({
      where: { date: today },
      data: { isActive: false },
    });

    const secretDrink = await app.prisma.secretDrink.create({
      data: {
        productName,
        originalPrice,
        discountPrice,
        discountPercent: discount,
        maxQuantity: maxQuantity || 15,
        availableUntil,
        date: today,
        locationId: locationId || null,
      },
    });

    // Log admin action
    await app.prisma.adminLog.create({
      data: {
        adminId: admin.id,
        action: 'set_secret_drink',
        payload: { productName, originalPrice, discountPrice, date: today },
      },
    });

    return reply.send({ success: true, secretDrink });
  });
}
