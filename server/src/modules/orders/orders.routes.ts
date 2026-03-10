/**
 * Orders Module — HTTP Routes (v2.0)
 *
 * POST   /api/orders        — Create order
 * GET    /api/orders        — My orders
 * GET    /api/orders/:id    — Order details
 * DELETE /api/orders/:id    — Cancel (only PENDING)
 * PATCH  /api/orders/:id/status — Legacy status update (bot compat)
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, type JwtPayload } from '../../shared/jwt.js';
import { sendTelegramMessage } from '../../shared/utils/telegram.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const AUTO_CANCEL_DELAY_MS = 1 * 60 * 1000;

// ── Schemas ──────────────────────────────────────────────────────────────────

const createOrderSchema = z.object({
  locationId: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
    options: z.record(z.unknown()).optional(),
  })).min(1),
  pickupTime: z.number().int().min(5).max(30).default(10),
  comment: z.string().max(500).optional(),
  paymentMethod: z.enum(['CASH', 'CARD']).default('CASH'),
});

const legacyCreateOrderSchema = z.object({
  telegramId: z.union([z.number(), z.string()]).transform(String),
  locationId: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    name: z.string(),
    quantity: z.number().int().positive(),
    price: z.number().positive(),
  })).min(1),
  paymentMethod: z.string().default('cash'),
  pickupMinutes: z.number().int().min(5).max(30).optional(),
  deliveryType: z.string().default('pickup'),
  shippingAddr: z.string().optional(),
  phone: z.string().optional(),
  comment: z.string().max(500).optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sendTelegramHtmlMessage(
  chatId: string,
  message: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>,
): Promise<void> {
  if (!BOT_TOKEN) return;

  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    };

    if (inlineKeyboard) {
      body.reply_markup = { inline_keyboard: inlineKeyboard };
    }

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // silent
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function orderRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {

  const notifyAdminsAboutOrder = async (
    message: string,
    inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>,
  ): Promise<void> => {
    try {
      const admins = await app.prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'OWNER'] } },
        select: { telegramId: true },
      });

      const recipients = new Set<string>();
      for (const admin of admins) {
        if (admin.telegramId) recipients.add(admin.telegramId);
      }
      if (ADMIN_CHAT_ID) recipients.add(String(ADMIN_CHAT_ID));

      await Promise.all(
        [...recipients].map((chatId) => sendTelegramHtmlMessage(chatId, message, inlineKeyboard)),
      );
    } catch (error) {
      app.log.error({ err: error }, 'Failed to notify admins about order');
    }
  };

  const scheduleAutoCancel = (orderId: string): void => {
    setTimeout(async () => {
      try {
        const order = await app.prisma.order.findUnique({
          where: { id: orderId },
          include: {
            user: { select: { telegramId: true } },
          },
        });

        if (!order || order.status !== 'PENDING') {
          return;
        }

        const cancelledOrder = await app.prisma.order.update({
          where: { id: orderId },
          data: { status: 'REJECTED' },
        });

        await sendTelegramMessage(
          Number(order.user.telegramId),
          '❌ Замовлення скасовано. Наразі великий потік людей, бариста не може прийняти замовлення завчасно. Спробуйте замовити на місці!',
        );

        await notifyAdminsAboutOrder(
          `❌ <b>Замовлення #${cancelledOrder.orderNumber} автоматично скасовано</b> (минуло 1 хв)`,
        );
      } catch (error) {
        app.log.error({ err: error, orderId }, 'Order auto-cancel failed');
      }
    }, AUTO_CANCEL_DELAY_MS);
  };


  const needsClarification = (itemNames: string[], comment?: string): boolean => {
    const normalized = (comment || '').toLowerCase();
    const hasPlantMilk = itemNames.some((name) => name.toLowerCase().includes('рослинне молоко'));
    const hasSyrup = itemNames.some((name) => name.toLowerCase().includes('сироп'));

    if (hasPlantMilk) {
      const milkHints = ['вівся', 'кокос', 'мигдал', 'соє', 'безлактоз'];
      const hasMilkDetails = milkHints.some((hint) => normalized.includes(hint));
      if (!hasMilkDetails) return true;
    }

    if (hasSyrup) {
      const hasSyrupDetails = normalized.includes('сироп') && normalized.length > 12;
      if (!hasSyrupDetails) return true;
    }

    return false;
  };

  // POST /api/orders
  app.post('/', async (request, reply) => {
    try {
      let userId: string | undefined;
      let userTelegramId: string | undefined;
      const body = request.body as Record<string, unknown>;

      // JWT auth
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const { verifyAccessToken } = await import('../../shared/jwt.js');
        const payload = verifyAccessToken(authHeader.slice(7));
        if (payload) {
          userId = payload.userId;
          const u = await app.prisma.user.findUnique({ where: { id: userId }, select: { telegramId: true } });
          userTelegramId = u?.telegramId;
        }
      }

      // Legacy: telegramId in body
      if (!userId && body.telegramId) {
        const legacyParsed = legacyCreateOrderSchema.safeParse(body);
        if (legacyParsed.success) {
          const u = await app.prisma.user.findUnique({
            where: { telegramId: legacyParsed.data.telegramId },
            select: { id: true, telegramId: true, firstName: true, username: true },
          });
          if (u) {
            userId = u.id;
            userTelegramId = u.telegramId;

            const { locationId, items, paymentMethod, pickupMinutes, comment } = legacyParsed.data;
            const pickupTime = pickupMinutes ?? 10;
            const location = await app.prisma.location.findUnique({ where: { id: locationId } });
            if (!location) return reply.status(404).send({ error: 'Location not found' });

            const totalPrice = items.reduce((s, i) => s + i.price * i.quantity, 0);

            const order = await app.prisma.order.create({
              data: {
                userId: u.id,
                locationId,
                status: 'PENDING',
                subtotal: totalPrice,
                total: totalPrice,
                pickupTime,
                paymentMethod: paymentMethod === 'cash' ? 'CASH' : 'CARD',
                estimatedReady: new Date(Date.now() + pickupTime * 60 * 1000),
                comment: comment || undefined,
                items: {
                  create: items.map(i => ({
                    product: { connect: { id: i.productId } },
                    quantity: i.quantity,
                    price: Math.round(i.price),
                    total: Math.round(i.price * i.quantity),
                  })),
                },
              },
              include: { items: true, location: { select: { name: true } } },
            });

            const itemsList = items.map(i => `  • ${i.name} x${i.quantity} — ${i.price * i.quantity} грн`).join('\n');
            const userName = u.firstName || u.username || `ID: ${u.telegramId}`;
            const clarificationNeeded = needsClarification(items.map(i => i.name), comment);
            const adminMsg = `🆕 <b>НОВЕ ЗАМОВЛЕННЯ #${order.orderNumber}</b>\n\n👤 ${userName}\n📍 ${order.location.name}\n💰 <b>${totalPrice} грн</b>\n\n📋 <b>Склад:</b>\n${itemsList}\n\n💬 ${comment || '—'}${clarificationNeeded ? '\n\n❗️ Потрібно уточнення по рослинному молоку/сиропу' : ''}`;
            await notifyAdminsAboutOrder(adminMsg, [[{ text: '✅ Прийняти в роботу', callback_data: `order_accept:${order.id}` }, { text: '❓ Уточнити', callback_data: `order_clarify:${order.id}` }]]);
            sendTelegramMessage(Number(u.telegramId), `✅ *Замовлення #${order.orderNumber} створено!*\n\n📍 ${order.location.name}\n⏱ Очікуйте ~${pickupTime} хв\n\n⚠️ Якщо бариста не підтвердить замовлення протягом 1 хв, воно буде автоматично скасоване.`).catch(() => {});

            scheduleAutoCancel(order.id);

            return reply.status(201).send({
              order: { id: order.id, orderNumber: order.orderNumber, status: order.status, totalPrice: totalPrice.toString(), location: order.location.name, items: order.items, createdAt: order.createdAt },
            });
          }
        }
      }

      if (!userId) return reply.status(401).send({ error: 'UNAUTHORIZED' });

      // V2 order
      const parsed = createOrderSchema.parse(body);
      const location = await app.prisma.location.findUnique({ where: { id: parsed.locationId } });
      if (!location || !location.hasOrdering) return reply.status(400).send({ error: 'ORDERING_NOT_AVAILABLE' });

      const products = await app.prisma.product.findMany({
        where: { id: { in: parsed.items.map(i => i.productId) }, inStock: true, isActive: true },
      });

      let total = 0;
      const orderItems = parsed.items.map(item => {
        const product = products.find(p => p.id === item.productId);
        if (!product) throw new Error(`Product ${item.productId} not found`);
        const t = product.price * item.quantity;
        total += t;
        return { product: { connect: { id: item.productId } }, quantity: item.quantity, price: product.price, total: t, options: (item.options as Prisma.InputJsonValue) ?? Prisma.JsonNull };
      });

      const user = await app.prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, username: true, telegramId: true } });

      const order = await app.prisma.order.create({
        data: {
          userId,
          locationId: parsed.locationId,
          status: 'PENDING',
          pickupTime: parsed.pickupTime,
          comment: parsed.comment,
          paymentMethod: parsed.paymentMethod,
          subtotal: total,
          total,
          estimatedReady: new Date(Date.now() + parsed.pickupTime * 60 * 1000),
          items: { create: orderItems },
        },
        include: { items: { include: { product: { select: { name: true } } } }, location: true },
      });

      const itemNames = order.items.map(i => i.product.name);
      const itemsList = order.items.map(i => `• ${i.product.name} x${i.quantity}`).join('\n');
      const clarificationNeeded = needsClarification(itemNames, parsed.comment);
      const adminMsg = `🆕 <b>НОВЕ ЗАМОВЛЕННЯ #${order.orderNumber}</b>\n\n👤 ${user?.firstName || ''} (@${user?.username || '—'})\n📍 ${order.location.name}\n⏱ ${parsed.pickupTime} хв\n💳 ${parsed.paymentMethod}\n\n📋 <b>Склад:</b>\n${itemsList}\n\n💬 ${parsed.comment || '—'}${clarificationNeeded ? '\n\n❗️ Потрібно уточнення по рослинному молоку/сиропу' : ''}`;
      await notifyAdminsAboutOrder(adminMsg, [[{ text: '✅ Прийняти', callback_data: `order_accept:${order.id}` }, { text: '❓ Уточнити', callback_data: `order_clarify:${order.id}` }]]);
      if (userTelegramId) {
        sendTelegramMessage(Number(userTelegramId), `✅ *Замовлення #${order.orderNumber} створено!*\n\n📍 ${order.location.name}\n⏱ Очікуйте ~${parsed.pickupTime} хв\n\n⚠️ Якщо бариста не підтвердить замовлення протягом 1 хв, воно буде автоматично скасоване.`).catch(() => {});
      }

      scheduleAutoCancel(order.id);

      return reply.status(201).send({ order });
    } catch (error) {
      app.log.error({ err: error }, 'Create order error');
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'INVALID_REQUEST', details: error.errors });
      return reply.status(500).send({ error: 'ORDER_CREATION_FAILED' });
    }
  });

  // GET /api/orders
  app.get('/', async (request, reply) => {
    let userId: string | undefined;
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const { verifyAccessToken } = await import('../../shared/jwt.js');
      const payload = verifyAccessToken(authHeader.slice(7));
      if (payload) userId = payload.userId;
    }
    if (!userId) {
      const telegramId = (request.query as Record<string, string>).telegramId;
      if (telegramId) {
        const u = await app.prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
        if (u) userId = u.id;
      }
    }
    if (!userId) return reply.send({ orders: [] });

    const orders = await app.prisma.order.findMany({
      where: { userId },
      include: { items: { include: { product: { select: { name: true } } } }, location: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return reply.send({ orders });
  });

  // GET /api/orders/:id
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const order = await app.prisma.order.findUnique({
      where: { id: request.params.id },
      include: { items: { include: { product: true } }, location: true, user: { select: { telegramId: true } } },
    });
    if (!order) return reply.status(404).send({ error: 'ORDER_NOT_FOUND' });
    return reply.send({ order });
  });

  // DELETE /api/orders/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { userId } = (request as FastifyRequest & { user: JwtPayload }).user;
    const order = await app.prisma.order.findUnique({ where: { id: request.params.id } });
    if (!order) return reply.status(404).send({ error: 'ORDER_NOT_FOUND' });
    if (order.userId !== userId) return reply.status(403).send({ error: 'NOT_YOUR_ORDER' });
    if (order.status !== 'PENDING') return reply.status(400).send({ error: 'CANNOT_CANCEL' });
    await app.prisma.order.update({ where: { id: request.params.id }, data: { status: 'REJECTED' } });
    return reply.send({ success: true });
  });

  // PATCH /api/orders/:id/status — Legacy (bot compatibility)
  app.patch<{ Params: { id: string } }>('/:id/status', async (request, reply) => {
    const { id } = request.params;
    const body = z.object({
      adminTelegramId: z.union([z.number(), z.string()]).transform(String),
      status: z.enum(['PREPARING', 'READY', 'COMPLETED', 'CANCELLED']),
    }).parse(request.body);

    const admin = await app.prisma.user.findUnique({ where: { telegramId: body.adminTelegramId } });
    if (!admin || (admin.role !== 'ADMIN' && admin.role !== 'OWNER')) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const order = await app.prisma.order.findUnique({
      where: { id },
      include: { user: { select: { telegramId: true } } },
    });
    if (!order) return reply.status(404).send({ error: 'Order not found' });

    const mappedStatus = body.status === 'CANCELLED' ? 'REJECTED' : body.status;
    const updated = await app.prisma.order.update({
      where: { id },
      data: { status: mappedStatus as any, processedById: admin.id, processedAt: new Date() },
    });

    const msgs: Record<string, string> = {
      PREPARING: `☕ *Бариста готує замовлення #${order.orderNumber}!*`,
      READY: `Твоя кава чекає на тебе! ☕️`,
      COMPLETED: `🎉 *Замовлення #${order.orderNumber} виконано!*`,
      CANCELLED: `❌ *Замовлення #${order.orderNumber} скасовано.*`,
    };
    const msg = msgs[body.status];
    if (msg) sendTelegramMessage(Number(order.user.telegramId), msg).catch(() => {});

    return reply.send({ success: true, order: { id, status: updated.status, userTelegramId: order.user.telegramId } });
  });
}
