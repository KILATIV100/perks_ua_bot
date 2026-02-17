/**
 * Products Module — HTTP Routes
 *
 * GET /api/products — All active products grouped by category
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function productRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get('/', async (_request, reply) => {
    try {
      const products = await app.prisma.product.findMany({
        where: { isActive: true },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          volume: true,
          price: true,
          category: true,
          type: true,
          imageUrl: true,
        },
      });

      // Return flat array with price as string (frontend expects Product[])
      return reply.send({
        products: products.map(p => ({ ...p, price: p.price.toString() })),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Get products error');
      return reply.status(500).send({ error: 'Failed to get products' });
    }
  });
}
