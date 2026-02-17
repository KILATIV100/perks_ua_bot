import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const AUTO_CANCEL_MS = 5 * 60 * 1000;

interface TelegramMessageResponse {
  ok: boolean;
  result?: {
    message_id: number;
  };
}

async function telegramRequest(method: string, payload: Record<string, unknown>): Promise<TelegramMessageResponse | null> {
  if (!BOT_TOKEN) return null;

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return (await response.json()) as TelegramMessageResponse;
  } catch (error) {
    console.log(`[Telegram] Error calling ${method}:`, error);
    return null;
  }
}

async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>
): Promise<number | null> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  };

  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  }

  const response = await telegramRequest('sendMessage', body);
  if (!response?.ok || !response.result) return null;
  return response.result.message_id;
}

async function editTelegramMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'Markdown',
  };

  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  } else {
    body.reply_markup = { inline_keyboard: [] };
  }

  await telegramRequest('editMessageText', body);
}

const CreateOrderSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  locationId: z.string().uuid(),
  paymentMethod: z.enum(['cash', 'telegram_pay', 'CASH', 'CARD']).default('cash'),
  deliveryType: z.enum(['pickup', 'shipping']).default('pickup'),
  pickupMinutes: z.number().int().min(5).max(30).optional(),
  pickupTime: z.number().int().min(5).max(30).optional(),
  shippingAddr: z.string().min(5).optional(),
  phone: z.string().min(6).optional(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      name: z.string().min(1).optional(),
      quantity: z.number().int().positive(),
      price: z.number().positive(),
    })
  ).min(1),
}).superRefine((data, ctx) => {
  if (data.deliveryType === 'shipping') {
    if (!data.shippingAddr) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shippingAddr'], message: 'Shipping address is required' });
    }
    if (!data.phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: 'Phone is required' });
    }
  } else if (!data.pickupMinutes && !data.pickupTime) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pickupMinutes'], message: 'Pickup time is required' });
  }
});

const UpdateStatusSchema = z.object({
  adminTelegramId: z.union([z.number(), z.string()]).transform(String),
  status: z.enum(['PREPARING', 'READY', 'COMPLETED', 'REJECTED']),
});

type CreateOrderBody = z.infer<typeof CreateOrderSchema>;

type OrderStatusLiteral = 'PENDING' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED' | 'CANCELED';

async function updateOrderStatus(prismaOrder: any, id: string, status: OrderStatusLiteral): Promise<any> {
  try {
    return await prismaOrder.update({ where: { id }, data: { status } });
  } catch (error) {
    if (status === 'CANCELLED') {
      return prismaOrder.update({ where: { id }, data: { status: 'CANCELED' } });
    }
    throw error;
  }
}

export async function orderRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  const prismaOrder = app.prisma.order as any;

  app.post<{ Body: CreateOrderBody }>('', async (request, reply) => {
    const parseResult = CreateOrderSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parseResult.error.flatten(),
      });
    }

    const { telegramId, locationId, items, paymentMethod, pickupMinutes, pickupTime, deliveryType, shippingAddr, phone } = parseResult.data;
    const resolvedDeliveryType = deliveryType ?? 'pickup';
    const resolvedPickupMinutes = resolvedDeliveryType === 'shipping' ? 10 : (pickupMinutes ?? pickupTime ?? 10);

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      return reply.status(404).send({ error: 'User not found. Sync user first.' });
    }

    const location = await app.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    if (!location.isActive) {
      return reply.status(400).send({ error: 'Location is not yet available for orders' });
    }

    if (!location.hasOrdering) {
      return reply.status(400).send({ error: 'Попереднє замовлення недоступне для цієї локації. Замовляйте на місці!' });
    }

    const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const order = await prismaOrder.create({
      data: {
        userId: user.id,
        locationId,
        status: 'PENDING',
        totalPrice,
        paymentMethod,
        pickupMinutes: resolvedPickupMinutes,
        deliveryType: resolvedDeliveryType,
        shippingAddr: resolvedDeliveryType === 'shipping' ? shippingAddr : null,
        phone: resolvedDeliveryType === 'shipping' ? phone : null,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            name: item.name ?? 'Товар',
            quantity: item.quantity,
            price: item.price,
            total: item.price * item.quantity,
          })),
        },
      },
      include: {
        items: true,
        location: { select: { name: true } },
      },
    });

    const itemsList = items.map(i => `  • ${i.name ?? 'Товар'} x${i.quantity} — ${i.price * i.quantity} грн`).join('\n');
    const paymentLabel = ['cash', 'CASH'].includes(String(paymentMethod)) ? 'При отриманні' : 'Картка';
    const userName = user.firstName || user.username || `ID: ${telegramId}`;

    const pickupInfo = resolvedDeliveryType === 'shipping'
      ? `🚚 Доставка: ${shippingAddr}\n📞 Телефон: ${phone}\n\n`
      : `⏱ Час готовності: ${resolvedPickupMinutes} хв\n\n`;

    const adminMessage =
      `🆕 *Нове замовлення #${order.id.slice(0, 8)}*\n\n` +
      `👤 Клієнт: ${userName}\n` +
      `📍 Локація: ${location.name}\n` +
      `💰 Сума: *${Number((order as any).totalPrice ?? totalPrice)} грн*\n` +
      `💳 Оплата: ${paymentLabel}\n` +
      pickupInfo +
      `📋 *Замовлення:*\n${itemsList}`;

    const actionButtons = [[
      { text: '✅ Прийняти', callback_data: `order_accept:${order.id}` },
      { text: '❌ Відхилити', callback_data: `order_reject:${order.id}` },
    ]];

    let adminMessageId: number | null = null;
    if (ADMIN_GROUP_ID) {
      adminMessageId = await sendTelegramMessage(ADMIN_GROUP_ID, adminMessage, actionButtons);
    } else {
      app.log.warn('ADMIN_GROUP_ID is not configured, admin order notifications are disabled');
    }

    sendTelegramMessage(
      Number(telegramId),
      `⏳ *Замовлення відправлено!*\nОчікуємо підтвердження від баристи...`
    ).catch((err) => {
      app.log.error({ err }, 'Failed to notify user about pending order');
    });

    setTimeout(async () => {
      try {
        const current = await prismaOrder.findUnique({
          where: { id: order.id },
          include: { user: { select: { telegramId: true } } },
        });

        if (!current || current.status !== 'PENDING') {
          return;
        }

        await updateOrderStatus(prismaOrder, order.id, 'CANCELLED');

        await sendTelegramMessage(
          Number(current.user.telegramId),
          `❌ Наразі великий потік людей, бариста не може прийняти замовлення завчасно. Будь ласка, замовляйте на місці!`
        );

        if (ADMIN_GROUP_ID && adminMessageId) {
          await editTelegramMessage(
            ADMIN_GROUP_ID,
            adminMessageId,
            `${adminMessage}\n\n⏳ *Автоматично скасовано (немає відповіді)*`
          );
        }
      } catch (error) {
        app.log.error({ err: error, orderId: order.id }, 'Failed to auto-cancel pending order');
      }
    }, AUTO_CANCEL_MS);

    app.log.info(`[Order Created] id: ${order.id}, user: ${telegramId}, total: ${totalPrice}, location: ${location.name}`);

    return reply.status(201).send({
      order: {
        id: order.id,
        status: order.status,
        totalPrice: String((order as any).totalPrice ?? (order as any).total ?? 0),
        location: order.location.name,
        items: order.items,
        paymentMethod,
        pickupMinutes: resolvedPickupMinutes,
        deliveryType: resolvedDeliveryType,
        shippingAddr: resolvedDeliveryType === 'shipping' ? shippingAddr : null,
        phone: resolvedDeliveryType === 'shipping' ? phone : null,
        createdAt: order.createdAt,
      },
    });
  });

  app.patch<{ Params: { id: string } }>(':id/status', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = UpdateStatusSchema.parse(request.body);

      const admin = await app.prisma.user.findUnique({ where: { telegramId: body.adminTelegramId } });
      if (!admin || (admin.role !== 'ADMIN' && admin.role !== 'OWNER')) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const order = await prismaOrder.findUnique({
        where: { id },
        include: {
          user: { select: { telegramId: true } },
          location: { select: { name: true } },
        },
      });

      if (!order) {
        return reply.status(404).send({ error: 'Order not found' });
      }

      if ((order.status === 'CANCELLED' || order.status === 'CANCELED') || order.status === 'COMPLETED') {
        return reply.status(409).send({ error: `Order already ${order.status.toLowerCase()}` });
      }

      const updated = await updateOrderStatus(prismaOrder, id, body.status as OrderStatusLiteral);

      const isShipping = (order.deliveryType ?? 'pickup') === 'shipping';
      const statusMessages: Record<string, string> = {
        PREPARING: isShipping
          ? `📦 *Ми готуємо твоє замовлення до відправки!*\n\n📍 ${order.location.name}`
          : `✅ Замовлення прийнято! Бариста почав готувати. Буде готово через ~${order.pickupMinutes ?? order.pickupTime ?? 10} хв.`,
        READY: isShipping
          ? `✅ *Замовлення готове до відправки!*\n\nМи надішлемо інформацію про доставку найближчим часом.`
          : `✅ *Твоє замовлення готове!*\n\n📍 ${order.location.name}\nМожеш забирати! 🎉`,
        COMPLETED: `🎉 *Замовлення виконано!*\nДякуємо, що обрав PerkUp! ☕`,
        CANCELLED: `❌ На жаль, бариста зараз не може прийняти замовлення. Спробуй пізніше або замов на місці.`,
      };

      const userMessage = statusMessages[body.status];
      if (userMessage) {
        sendTelegramMessage(Number(order.user.telegramId), userMessage).catch((err) => {
          app.log.error({ err }, 'Failed to notify user about status change');
        });
      }

      return reply.send({ success: true, order: { id, status: updated.status, pickupMinutes: updated.pickupMinutes ?? updated.pickupTime ?? 10 } });
    } catch (error) {
      app.log.error({ err: error }, 'Update order status error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to update order status' });
    }
  });

  app.get<{ Querystring: { telegramId: string } }>('', async (request, reply) => {
    const { telegramId } = request.query;

    if (!telegramId) {
      return reply.status(400).send({ error: 'telegramId is required' });
    }

    const user = await app.prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      return reply.send({ orders: [] });
    }

    const orders = await prismaOrder.findMany({
      where: { userId: user.id },
      include: {
        items: true,
        location: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return reply.send({
      orders: orders.map((savedOrder: (typeof orders)[number]) => ({
        id: savedOrder.id,
        status: savedOrder.status,
        totalPrice: String((savedOrder as any).totalPrice ?? (savedOrder as any).total ?? 0),
        location: savedOrder.location.name,
        items: savedOrder.items,
        paymentMethod: savedOrder.paymentMethod,
        pickupMinutes: (savedOrder as any).pickupMinutes ?? (savedOrder as any).pickupTime ?? 10,
        deliveryType: (savedOrder as any).deliveryType ?? 'pickup',
        shippingAddr: (savedOrder as any).shippingAddr ?? null,
        phone: (savedOrder as any).phone ?? null,
        createdAt: savedOrder.createdAt,
      })),
    });
  });

  app.get<{ Params: { id: string } }>(':id', async (request, reply) => {
    const { id } = request.params;

    const order = await prismaOrder.findUnique({
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
        totalPrice: String((order as any).totalPrice ?? (order as any).total ?? 0),
        location: order.location,
        items: order.items,
        paymentMethod: order.paymentMethod,
        pickupMinutes: (order as any).pickupMinutes ?? (order as any).pickupTime ?? 10,
        deliveryType: (order as any).deliveryType ?? 'pickup',
        shippingAddr: (order as any).shippingAddr ?? null,
        phone: (order as any).phone ?? null,
        createdAt: order.createdAt,
      },
    });
  });
}
