import { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function productRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // GET /api/products - Get all active products
  app.get('', async (_request, reply) => {
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
          imageUrl: true,
        },
      });

      // Group by category
      const categories = new Map<string, typeof products>();
      for (const product of products) {
        const cat = product.category;
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat)!.push(product);
      }

      return reply.send({
        products: products.map(p => ({ ...p, price: p.price.toString() })),
        categories: Object.fromEntries(
          Array.from(categories.entries()).map(([cat, prods]) => [
            cat,
            prods.map(p => ({ ...p, price: p.price.toString() })),
          ])
        ),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Get products error');
      return reply.status(500).send({ error: 'Failed to get products' });
    }
  });
}
