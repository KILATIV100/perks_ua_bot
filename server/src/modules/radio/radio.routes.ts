/**
 * Radio Module — HTTP Routes (v2.0)
 *
 * GET    /api/radio/tracks             — Playlist with user context (favorites, role)
 * GET    /api/radio/stream/:trackId    — Proxy-stream audio from Telegram
 * POST   /api/radio/tracks/add         — Add track from Telegram file_id (Owner only)
 * DELETE /api/radio/tracks/:id         — Delete a track (Owner/Admin only)
 * POST   /api/radio/favorite           — Toggle favorite on a track
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../../shared/jwt.js';
import { redis } from '../../shared/redis.js';

const BOT_TOKEN = process.env.BOT_TOKEN;

const addTrackSchema = z.object({
  title: z.string().min(1),
  artist: z.string().default('PerkUp Radio'),
  telegramFileId: z.string().min(1),
  coverUrl: z.string().optional(),
  telegramId: z.union([z.number(), z.string()]).transform(String).optional(),
});

const favoriteSchema = z.object({
  trackId: z.string().min(1),
  telegramId: z.union([z.number(), z.string()]).transform(String).optional(),
});

/** Resolve user from JWT or legacy telegramId */
async function resolveUser(
  request: FastifyRequest,
  prisma: FastifyInstance['prisma'],
): Promise<{ userId: string; role: string } | null> {
  const jwtUser = (request as FastifyRequest & { user?: JwtPayload }).user;
  if (jwtUser) {
    const user = await prisma.user.findUnique({
      where: { id: jwtUser.userId },
      select: { id: true, role: true },
    });
    if (!user) return null;
    return { userId: user.id, role: user.role };
  }

  const telegramId =
    (request.query as Record<string, string>)?.telegramId ||
    (request.body as Record<string, string>)?.telegramId;

  if (telegramId) {
    const user = await prisma.user.findUnique({
      where: { telegramId: String(telegramId) },
      select: { id: true, role: true },
    });
    if (!user) return null;
    return { userId: user.id, role: user.role };
  }

  return null;
}

/** Get Telegram file download URL (cached for 50 minutes) */
async function getTelegramFileUrl(fileId: string): Promise<string | null> {
  if (!BOT_TOKEN) return null;

  const cacheKey = `tg_file:${fileId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
  } catch { /* redis miss, proceed */ }

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const data = await res.json() as { ok: boolean; result?: { file_path: string } };

    if (!data.ok || !data.result?.file_path) return null;

    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;

    try {
      await redis.set(cacheKey, url, 'EX', 3000); // cache 50 min (TG links ~1h)
    } catch { /* non-critical */ }

    return url;
  } catch {
    return null;
  }
}

export async function radioRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {

  // ── GET /api/radio/tracks — playlist with user context ─────────────────
  app.get('/tracks', async (request, reply) => {
    try {
      const user = await resolveUser(request, app.prisma);

      const tracks = await app.prisma.track.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          _count: { select: { favorites: true } },
        },
      });

      // Build stream URL base from the request
      const protocol = request.headers['x-forwarded-proto'] || 'https';
      const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost';
      const streamBase = `${protocol}://${host}/api/radio/stream`;

      // Get user's favorites if authenticated
      let favoriteTrackIds = new Set<string>();
      if (user) {
        const favs = await app.prisma.favoriteTrack.findMany({
          where: { userId: user.userId },
          select: { trackId: true },
        });
        favoriteTrackIds = new Set(favs.map(f => f.trackId));
      }

      return reply.send({
        tracks: tracks.map((track) => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          url: track.telegramFileId ? `${streamBase}/${track.id}` : track.url,
          coverUrl: track.coverUrl,
          createdAt: track.createdAt,
          isFavorite: favoriteTrackIds.has(track.id),
          favoriteCount: track._count.favorites,
        })),
        userRole: user?.role || null,
      });
    } catch (error) {
      app.log.error({ err: error }, 'Get tracks error');
      return reply.status(500).send({ error: 'Failed to get tracks' });
    }
  });

  // ── GET /api/radio/stream/:trackId — proxy audio from Telegram ─────────
  app.get<{ Params: { trackId: string } }>('/stream/:trackId', async (request, reply) => {
    try {
      const track = await app.prisma.track.findUnique({
        where: { id: request.params.trackId },
      });

      if (!track) {
        return reply.status(404).send({ error: 'Track not found' });
      }

      if (track.telegramFileId) {
        const fileUrl = await getTelegramFileUrl(track.telegramFileId);
        if (!fileUrl) {
          return reply.status(502).send({ error: 'Failed to resolve Telegram file' });
        }

        const audioRes = await fetch(fileUrl);
        if (!audioRes.ok || !audioRes.body) {
          return reply.status(502).send({ error: 'Failed to fetch audio from Telegram' });
        }

        reply.header('Content-Type', 'audio/mpeg');
        reply.header('Accept-Ranges', 'none');
        reply.header('Cache-Control', 'public, max-age=2400');
        const contentLength = audioRes.headers.get('content-length');
        if (contentLength) reply.header('Content-Length', contentLength);

        return reply.send(audioRes.body);
      }

      // Fallback: redirect to direct URL
      return reply.redirect(track.url);
    } catch (error) {
      app.log.error({ err: error }, 'Stream track error');
      return reply.status(500).send({ error: 'Failed to stream track' });
    }
  });

  // ── POST /api/radio/tracks/add — Add track (Owner only) ───────────────
  app.post('/tracks/add', async (request, reply) => {
    try {
      const user = await resolveUser(request, app.prisma);
      if (!user || user.role !== 'OWNER') {
        return reply.status(403).send({ error: 'FORBIDDEN' });
      }

      const body = addTrackSchema.parse(request.body);

      const track = await app.prisma.track.create({
        data: {
          title: body.title,
          artist: body.artist,
          url: '',
          telegramFileId: body.telegramFileId,
          coverUrl: body.coverUrl || null,
        },
      });

      return reply.send({ success: true, track });
    } catch (error) {
      app.log.error({ err: error }, 'Add track error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to add track' });
    }
  });

  // ── DELETE /api/radio/tracks/:id — Delete track (Owner/Admin) ──────────
  app.delete<{ Params: { id: string } }>('/tracks/:id', async (request, reply) => {
    try {
      const user = await resolveUser(request, app.prisma);
      if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
        return reply.status(403).send({ error: 'FORBIDDEN' });
      }

      await app.prisma.track.delete({ where: { id: request.params.id } });
      return reply.send({ success: true });
    } catch (error) {
      app.log.error({ err: error }, 'Delete track error');
      return reply.status(500).send({ error: 'Failed to delete track' });
    }
  });

  // ── POST /api/radio/favorite — Toggle favorite ────────────────────────
  app.post('/favorite', async (request, reply) => {
    try {
      const body = favoriteSchema.parse(request.body);
      const user = await resolveUser(request, app.prisma);

      if (!user) {
        return reply.status(401).send({ error: 'UNAUTHORIZED' });
      }

      const track = await app.prisma.track.findUnique({ where: { id: body.trackId } });
      if (!track) {
        return reply.status(404).send({ error: 'Track not found' });
      }

      const existing = await app.prisma.favoriteTrack.findUnique({
        where: { userId_trackId: { userId: user.userId, trackId: body.trackId } },
      });

      if (existing) {
        await app.prisma.favoriteTrack.delete({ where: { id: existing.id } });
        return reply.send({ isFavorite: false });
      } else {
        await app.prisma.favoriteTrack.create({
          data: { userId: user.userId, trackId: body.trackId },
        });
        return reply.send({ isFavorite: true });
      }
    } catch (error) {
      app.log.error({ err: error }, 'Toggle favorite error');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request data', details: error.errors });
      }
      return reply.status(500).send({ error: 'Failed to toggle favorite' });
    }
  });
}
