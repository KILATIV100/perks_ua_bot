import { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function locationRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Get all locations
  app.get('/', async (_request, reply) => {
    const locations = await app.prisma.location.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        address: true,
        isActive: true,
        hasOrdering: true,
      },
    });

    return reply.send({ locations });
  });

  // Get location by ID
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const location = await app.prisma.location.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        address: true,
        isActive: true,
        hasOrdering: true,
      },
    });

    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    return reply.send({ location });
  });
}
