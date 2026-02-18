/**
 * Radio Module — HTTP Routes (v2.0)
 *
 * GET   /api/radio/playlist          — Get playlist (sorted, with like counts)
 * GET   /api/radio/tracks/:id/likes  — Get like count + whether current user liked
 * POST  /api/radio/like              — Toggle like on a track
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../../shared/jwt.js';

const likeSchema = z.object({
  trackId: z.string(),
  telegramId: z.union([z.number(), z.string()]).transform(String).optional(),
});

/** Resolve userId from JWT or legacy telegramId */
async function resolveUserId(
  request: FastifyRequest,
  prisma: FastifyInstance['prisma'],
): Promise<string | null> {
  const jwtUser = (request as FastifyRequest & { user?: JwtPayload }).user;
  if (jwtUser) return jwtUser.userId;

  const telegramId =
    (request.query as Record<string, string>)?.telegramId ||
    (request.body as Record<string, string>)?.telegramId;

  if (telegramId) {
    const user = await prisma.user.findUnique({
      where: { telegramId: String(telegramId) },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  return null;
}


function normalizeTrackUrl(rawUrl: string): string {
  const base = (process.env.MUSIC_BASE_URL || 'https://perkup.com.ua/music').replace(/\/+$/, '');
  const cleaned = rawUrl.trim();

  if (!cleaned) return `${base}/track1.mp3`;

  // Legacy placeholder from early seeds
  if (cleaned.includes('your-domain.com.ua')) {
    const fileName = cleaned.split('/').filter(Boolean).pop() || 'track1.mp3';
    return `${base}/${fileName}`;
  }

  // Convert relative URLs to absolute music base
  if (cleaned.startsWith('/')) {
    return cleaned.replace(/^\/+(music\/)?/, `${base}/`);
  }

  return cleaned.replace('://', '§§').replace(/\/{2,}/g, '/').replace('§§', '://');
}

export async function radioRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {


  // ── GET /api/radio/tracks — local playlist for WebApp audio player ─────
  app.get('/tracks', async (_request, reply) => {
    try {
      const tracks = await app.prisma.track.findMany({
        orderBy: { createdAt: 'asc' },
      });

      if (tracks.length > 0) {
        return reply.send({
          tracks: tracks.map((track) => ({
            ...track,
            url: normalizeTrackUrl(track.url),
          })),
        });
      }

      const legacyTracks = await app.prisma.radioTrack.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });

      return reply.send({
        tracks: legacyTracks.map((track) => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          url: normalizeTrackUrl(track.src),
          coverUrl: null,
          createdAt: track.createdAt,
        })),
      });
    } catch (error) {
      app.log.error({ err: error }, 'Get tracks error');
      return reply.status(500).send({ error: 'Failed to get tracks' });
    }
  });

  // ── GET /api/radio/playlist ─────────────────────────────────────────────
  app.get('/playlist', async (request, reply) => {
    try {
      const userId = await resolveUserId(request, app.prisma);

      const tracks = await app.prisma.radioTrack.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          _count: { select: { likes: true } },
        },
      });

      // If user is authenticated, check which tracks they liked
      let likedTrackIds = new Set<string>();
      if (userId) {
        const likes = await app.prisma.radioLike.findMany({
          where: { userId },
          select: { trackId: true },
        });
        likedTrackIds = new Set(likes.map(l => l.trackId));
      }

      const playlist = tracks.map(track => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        src: track.src,
        duration: track.duration,
        sortOrder: track.sortOrder,
        likes: track._count.likes,
        isLiked: likedTrackIds.has(track.id),
      }));

      return reply.send({ playlist });
    } catch (error) {
      app.log.error({ err: error }, 'Get playlist error');
      return reply.status(500).send({ error: 'Failed to get playlist' });
    }
  });

  // ── GET /api/radio/tracks/:id/likes ─────────────────────────────────────
  app.get<{ Params: { id: string } }>('/tracks/:id/likes', async (request, reply) => {
    try {
      const trackId = request.params.id;
      const userId = await resolveUserId(request, app.prisma);

      const count = await app.prisma.radioLike.count({ where: { trackId } });

      let isLiked = false;
      if (userId) {
        const like = await app.prisma.radioLike.findUnique({
          where: { userId_trackId: { userId, trackId } },
        });
        isLiked = !!like;
      }

      return reply.send({ trackId, likes: count, isLiked });
    } catch (error) {
      app.log.error({ err: error }, 'Get track likes error');
      return reply.status(500).send({ error: 'Failed to get likes' });
    }
  });

  // ── POST /api/radio/like — Toggle like ──────────────────────────────────
  app.post('/like', async (request, reply) => {
    try {
      const body = likeSchema.parse(request.body);
      const userId = await resolveUserId(request, app.prisma);

      if (!userId) {
        return reply.status(401).send({ error: 'UNAUTHORIZED' });
      }

      // Check track exists
      const track = await app.prisma.radioTrack.findUnique({ where: { id: body.trackId } });
      if (!track) {
        return reply.status(404).send({ error: 'Track not found' });
      }

      // Toggle like
      const existing = await app.prisma.radioLike.findUnique({
        where: { userId_trackId: { userId, trackId: body.trackId } },
      });

      if (existing) {
        await app.prisma.radioLike.delete({ where: { id: existing.id } });
        const count = await app.prisma.radioLike.count({ where: { trackId: body.trackId } });
        return reply.send({ liked: false, likes: count });
      } else {
        await app.prisma.radioLike.create({
          data: { userId, trackId: body.trackId },
        });
        const count = await app.prisma.radioLike.count({ where: { trackId: body.trackId } });
        return reply.send({ liked: true, likes: count });
      }
    } catch (error) {
      app.log.error({ err: error }, 'Toggle like error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to toggle like' });
    }
  });
}
