import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { sendTelegramMessage } from '../../shared/telegram.js';

const BOT_TOKEN = process.env.BOT_TOKEN;

const CreateOrderSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  locationId: z.string().uuid(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive(),
      price: z.number().positive(),
    })
  ).min(1),
});

const UpdateStatusSchema = z.object({
  adminTelegramId: z.union([z.number(), z.string()]).transform(String),
  status: z.enum(['PREPARING', 'READY', 'COMPLETED', 'CANCELLED']),
});

type CreateOrderBody = z.infer<typeof CreateOrderSchema>;

export async function orderRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  // Create new order
  app.post<{ Body: CreateOrderBody }>('', async (request, reply) => {
    const parseResult = CreateOrderSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parseResult.error.flatten(),
      });
    }

    const { telegramId, locationId, items } = parseResult.data;

    const user = await app.prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found. Sync user first.' });
    }

    const location = await app.prisma.location.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    if (location.status === 'coming_soon') {
      return reply.status(400).send({ error: 'Location is not yet available for orders' });
    }

    if (!location.canPreorder) {
      return reply.status(400).send({ error: 'Попереднє замовлення недоступне для цієї локації. Замовляйте на місці!' });
    }

    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const order = await app.prisma.order.create({
      data: {
        userId: user.id,
        locationId,
        total,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      },
      include: {
        items: true,
        location: { select: { name: true } },
      },
    });

    app.log.info(`[Order Created] id: ${order.id}, user: ${telegramId}, total: ${total}, location: ${location.name}`);

    const itemsList = items.map(i => `  • x${i.quantity} — ${i.price * i.quantity} грн`).join('\n');
    const userName = user.firstName || user.username || `ID: ${telegramId}`;

    const adminMessage =
      `🆕 *Нове замовлення!*\n\n` +
      `👤 Клієнт: ${userName}\n` +
      `📍 Локація: ${location.name}\n` +
      `💰 Сума: *${total} грн*\n\n` +
      `📋 *Замовлення:*\n${itemsList}`;

    const acceptButton = [[
      { text: '✅ Прийняти в роботу', callback_data: `order_accept:${order.id}` },
    ]];

    const admins = await app.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'OWNER'] } },
      select: { telegramId: true },
    });

    for (const admin of admins) {
      sendTelegramMessage(Number(admin.telegramId), adminMessage, acceptButton).catch(err => {
        app.log.error({ err }, `Failed to notify admin ${admin.telegramId}`);
      });
    }

    sendTelegramMessage(
      Number(telegramId),
      `✅ *Замовлення прийнято!*\n\n📍 ${location.name}\n💰 Сума: *${total} грн*\n\nМи повідомимо, коли бариста почне готувати!`
    ).catch(err => {
      app.log.error({ err }, 'Failed to notify user about order');
    });

    return reply.status(201).send({
      order: {
        id: order.id,
        status: order.status,
        total: order.total.toString(),
        location: order.location.name,
        items: order.items,
        createdAt: order.createdAt,
      },
    });
  });

  // PATCH /api/orders/:id/status - Update order status
  app.patch<{ Params: { id: string } }>(':id/status', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = UpdateStatusSchema.parse(request.body);

      const admin = await app.prisma.user.findUnique({
        where: { telegramId: body.adminTelegramId },
      });

      if (!admin || (admin.role !== 'ADMIN' && admin.role !== 'OWNER')) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const order = await app.prisma.order.findUnique({
        where: { id },
        include: {
          user: { select: { telegramId: true, firstName: true } },
          location: { select: { name: true } },
          items: true,
        },
      });

      if (!order) {
        return reply.status(404).send({ error: 'Order not found' });
      }

      const updated = await app.prisma.order.update({
        where: { id },
        data: { status: body.status },
      });

      const statusMessages: Record<string, string> = {
        PREPARING: `☕ *Бариста почав готувати твоє замовлення!*\n\n📍 ${order.location.name}`,
        READY: `✅ *Твоє замовлення готове!*\n\n📍 ${order.location.name}\nМожеш забирати! 🎉`,
        COMPLETED: `🎉 *Замовлення виконано!*\nДякуємо, що обрав PerkUp! ☕`,
        CANCELLED: `❌ *Замовлення скасовано.*\nВибач за незручності. Спробуй пізніше!`,
      };

      const userMessage = statusMessages[body.status];
      if (userMessage) {
        sendTelegramMessage(Number(order.user.telegramId), userMessage).catch(err => {
          app.log.error({ err }, 'Failed to notify user about status change');
        });
      }

      return reply.send({ success: true, order: { id, status: updated.status } });
    } catch (error) {
      app.log.error({ err: error }, 'Update order status error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to update order status' });
    }
  });

  // GET /api/orders - Get orders by telegram user
  app.get<{ Querystring: { telegramId: string } }>('', async (request, reply) => {
    const { telegramId } = request.query;

    if (!telegramId) {
      return reply.status(400).send({ error: 'telegramId is required' });
    }

    const user = await app.prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) {
      return reply.send({ orders: [] });
    }

    const orders = await app.prisma.order.findMany({
      where: { userId: user.id },
      include: { items: true, location: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return reply.send({
      orders: orders.map((order) => ({
        id: order.id,
        status: order.status,
        total: order.total.toString(),
        location: order.location.name,
        items: order.items,
        createdAt: order.createdAt,
      })),
    });
  });

  // GET /api/orders/:id - Get order by ID
  app.get<{ Params: { id: string } }>(':id', async (request, reply) => {
    const { id } = request.params;

    const order = await app.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        location: { select: { name: true, address: true } },
      },
    });

    if (!order) {
      return reply.status(404).send({ error: 'Order not found' });
    }

    return reply.send({
      order: {
        id: order.id,
        status: order.status,
        total: order.total.toString(),
        location: order.location,
        items: order.items,
        createdAt: order.createdAt,
      },
    });
  });
}
