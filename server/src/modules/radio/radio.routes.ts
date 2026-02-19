/**
 * Radio Module — HTTP Routes (v2.0)
 *
 * GET   /api/radio/tracks             — Playlist for WebApp audio player
 * GET   /api/radio/stream/:trackId    — Proxy-stream audio (Telegram file or direct URL)
 * GET   /api/radio/playlist           — Get playlist (sorted, with like counts)
 * GET   /api/radio/tracks/:id/likes   — Get like count + whether current user liked
 * POST  /api/radio/like               — Toggle like on a track
 * POST  /api/radio/tracks/add         — Add track from Telegram file_id (Owner only)
 * DELETE /api/radio/tracks/:id        — Delete a track (Owner only)
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../../shared/jwt.js';
import { redis } from '../../shared/redis.js';

const BOT_TOKEN = process.env.BOT_TOKEN;

const likeSchema = z.object({
  trackId: z.string(),
  telegramId: z.union([z.number(), z.string()]).transform(String).optional(),
});

const addTrackSchema = z.object({
  title: z.string().min(1),
  artist: z.string().default('PerkUp Radio'),
  telegramFileId: z.string().min(1),
  coverUrl: z.string().optional(),
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

/** Resolve admin/owner from JWT or legacy telegramId */
async function resolveAdmin(
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

  // ── GET /api/radio/tracks — playlist for WebApp audio player ───────────
  app.get('/tracks', async (request, reply) => {
    try {
      const tracks = await app.prisma.track.findMany({
        orderBy: { createdAt: 'asc' },
      });

      // Build stream URL base from the request
      const protocol = request.headers['x-forwarded-proto'] || 'https';
      const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost';
      const streamBase = `${protocol}://${host}/api/radio/stream`;

      if (tracks.length > 0) {
        return reply.send({
          tracks: tracks.map((track) => ({
            id: track.id,
            title: track.title,
            artist: track.artist,
            url: track.telegramFileId ? `${streamBase}/${track.id}` : track.url,
            coverUrl: track.coverUrl,
            createdAt: track.createdAt,
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
          url: track.src,
          coverUrl: null,
          createdAt: track.createdAt,
        })),
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

      // If track has a Telegram file ID, proxy from Telegram
      if (track.telegramFileId) {
        const fileUrl = await getTelegramFileUrl(track.telegramFileId);
        if (!fileUrl) {
          return reply.status(502).send({ error: 'Failed to resolve Telegram file' });
        }

        const audioRes = await fetch(fileUrl);
        if (!audioRes.ok || !audioRes.body) {
          return reply.status(502).send({ error: 'Failed to fetch audio from Telegram' });
        }

        reply.header('Content-Type', audioRes.headers.get('content-type') || 'audio/mpeg');
        reply.header('Accept-Ranges', 'none');
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

  // ── POST /api/radio/tracks/add — Add track from Telegram file_id (Owner) ──
  app.post('/tracks/add', async (request, reply) => {
    try {
      const admin = await resolveAdmin(request, app.prisma);
      if (!admin || admin.role !== 'OWNER') {
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

  // ── DELETE /api/radio/tracks/:id — Delete track (Owner) ────────────────
  app.delete<{ Params: { id: string } }>('/tracks/:id', async (request, reply) => {
    try {
      const admin = await resolveAdmin(request, app.prisma);
      if (!admin || admin.role !== 'OWNER') {
        return reply.status(403).send({ error: 'FORBIDDEN' });
      }

      await app.prisma.track.delete({ where: { id: request.params.id } });
      return reply.send({ success: true });
    } catch (error) {
      app.log.error({ err: error }, 'Delete track error');
      return reply.status(500).send({ error: 'Failed to delete track' });
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
