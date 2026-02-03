import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

const CreateOrderSchema = z.object({
  telegramId: z.number(),
  locationId: z.string().uuid(),
  items: z.array(
    z.object({
      name: z.string().min(1),
      quantity: z.number().int().positive(),
      price: z.number().positive(),
    })
  ).min(1),
});

type CreateOrderBody = z.infer<typeof CreateOrderSchema>;

export async function orderRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  // Create new order
  app.post<{ Body: CreateOrderBody }>('/', async (request, reply) => {
    const parseResult = CreateOrderSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parseResult.error.flatten(),
      });
    }

    const { telegramId, locationId, items } = parseResult.data;

    // Find or create user
    let user = await app.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
    });

    if (!user) {
      user = await app.prisma.user.create({
        data: { telegramId: BigInt(telegramId) },
      });
    }

    // Check location exists
    const location = await app.prisma.location.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    // Calculate total price
    const totalPrice = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // Create order with items
    const order = await app.prisma.order.create({
      data: {
        userId: user.id,
        locationId,
        totalPrice,
        items: {
          create: items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      },
      include: {
        items: true,
        location: {
          select: { name: true },
        },
      },
    });

    return reply.status(201).send({
      order: {
        id: order.id,
        status: order.status,
        totalPrice: order.totalPrice.toString(),
        location: order.location.name,
        items: order.items,
        createdAt: order.createdAt,
      },
    });
  });

  // Get orders by telegram user
  app.get<{ Querystring: { telegramId: string } }>(
    '/',
    async (request, reply) => {
      const { telegramId } = request.query;

      if (!telegramId) {
        return reply.status(400).send({ error: 'telegramId is required' });
      }

      const user = await app.prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      if (!user) {
        return reply.send({ orders: [] });
      }

      const orders = await app.prisma.order.findMany({
        where: { userId: user.id },
        include: {
          items: true,
          location: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({
        orders: orders.map((order) => ({
          id: order.id,
          status: order.status,
          totalPrice: order.totalPrice.toString(),
          location: order.location.name,
          items: order.items,
          createdAt: order.createdAt,
        })),
      });
    }
  );

  // Get order by ID
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
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
        totalPrice: order.totalPrice.toString(),
        location: order.location,
        items: order.items,
        createdAt: order.createdAt,
      },
    });
  });
}
