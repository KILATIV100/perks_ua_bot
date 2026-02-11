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
      });

      // Group by category
      const grouped = products.reduce<Record<string, typeof products>>(
        (acc, product) => {
          if (!acc[product.category]) acc[product.category] = [];
          acc[product.category].push(product);
          return acc;
        },
        {},
      );

      return reply.send({ products: grouped });
    } catch (error) {
      app.log.error({ err: error }, 'Get products error');
      return reply.status(500).send({ error: 'Failed to get products' });
    }
  });
}
