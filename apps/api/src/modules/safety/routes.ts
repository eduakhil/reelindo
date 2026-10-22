import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import argon2 from 'argon2';
import { z } from 'zod';
import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
const pageSchema = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(25) });

export function registerSafetyRoutes(app: FastifyInstance, prisma: PrismaClient, requireUser: Auth, s3: S3Client | null, bucket: string | undefined, io: SocketIOServer) {
  app.post('/reports', async (request, reply) => {
    const reporterId = await requireUser(request, reply); if (!reporterId) return;
    const input = z.object({ targetType: z.enum(['USER', 'POST', 'COMMENT', 'STORY']), targetId: z.string().uuid(), reason: z.string().trim().min(3).max(100), details: z.string().trim().max(1000).optional() }).parse(request.body);
    if (input.targetType === 'USER' && input.targetId === reporterId) return reply.code(400).send({ code: 'INVALID_REPORT', message: 'You cannot report your own account' });
    const exists = input.targetType === 'USER' ? await prisma.user.findUnique({ where: { id: input.targetId }, select: { id: true } })
      : input.targetType === 'POST' ? await prisma.post.findUnique({ where: { id: input.targetId }, select: { id: true } })
        : input.targetType === 'COMMENT' ? await prisma.comment.findUnique({ where: { id: input.targetId }, select: { id: true } })
          : await prisma.story.findUnique({ where: { id: input.targetId }, select: { id: true } });
    if (!exists) return reply.code(404).send({ code: 'TARGET_NOT_FOUND', message: 'Reported content was not found' });
    const report = await prisma.report.create({ data: { reporterId, targetType: input.targetType, targetId: input.targetId, reason: input.details ? `${input.reason}: ${input.details}`.slice(0, 100) : input.reason }, select: { id: true, status: true, createdAt: true } });
    return reply.code(201).send(report);
  });

  app.get('/users/me/blocks', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const rows = await prisma.block.findMany({ where: { blockerId: userId }, include: { blocked: { select: { id: true, username: true, displayName: true, avatarUrl: true } } }, orderBy: { createdAt: 'desc' } });
    return { items: rows.map(({ blocked, createdAt }) => ({ ...blocked, blockedAt: createdAt })) };
  });
  app.post('/users/:id/block', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (id === userId) return reply.code(400).send({ code: 'INVALID_BLOCK', message: 'You cannot block yourself' });
    if (!(await prisma.user.findUnique({ where: { id }, select: { id: true } }))) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'Account not found' });
    await prisma.$transaction([
      prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: userId, blockedId: id } }, create: { blockerId: userId, blockedId: id }, update: {} }),
      prisma.follow.deleteMany({ where: { OR: [{ followerId: userId, followingId: id }, { followerId: id, followingId: userId }] } }),
    ]);
    return { blocked: true };
  });
  app.delete('/users/:id/block', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await prisma.block.deleteMany({ where: { blockerId: userId, blockedId: id } }); return { blocked: false };
  });

  app.delete('/users/me/account', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { password, confirmation } = z.object({ password: z.string().max(128).optional(), confirmation: z.literal('DELETE') }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (user?.passwordHash && (!password || !(await argon2.verify(user.passwordHash, password)))) return reply.code(403).send({ code: 'INVALID_PASSWORD', message: 'Enter your current password to delete this account' });
    if (s3 && bucket) {
      try { await deleteUserMedia(s3, bucket, userId, (await prisma.post.findMany({ where: { userId }, select: { id: true } })).map((post) => post.id)); }
      catch { return reply.code(503).send({ code: 'MEDIA_CLEANUP_FAILED', message: 'Account media could not be removed. Please retry deletion.' }); }
    }
    await prisma.user.delete({ where: { id: userId } });
    io.in(`user:${userId}`).disconnectSockets(true);
    return reply.code(204).send();
  });

  app.get('/users/me/export', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, email: true, phone: true, displayName: true, bio: true, avatarUrl: true, website: true, isPrivate: true, language: true, createdAt: true } });
    if (!user) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'Account not found' });
    const memberships = await prisma.conversationMember.findMany({ where: { userId }, select: { conversationId: true } });
    const conversationIds = memberships.map((item) => item.conversationId);
    const [posts, comments, likes, saves, followers, following, stories, notifications, messages, blocks, reports] = await Promise.all([
      prisma.post.findMany({ where: { userId }, include: { media: true } }),
      prisma.comment.findMany({ where: { userId } }),
      prisma.like.findMany({ where: { userId } }),
      prisma.save.findMany({ where: { userId } }),
      prisma.follow.findMany({ where: { followingId: userId } }),
      prisma.follow.findMany({ where: { followerId: userId } }),
      prisma.story.findMany({ where: { userId } }),
      prisma.notification.findMany({ where: { userId } }),
      prisma.message.findMany({ where: { conversationId: { in: conversationIds } } }),
      prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }),
      prisma.report.findMany({ where: { reporterId: userId } }),
    ]);
    reply.header('content-disposition', `attachment; filename="reelindo-${user.username}-data.json"`);
    return { exportedAt: new Date().toISOString(), account: user, posts, comments, likes, saves, followers, following, stories, notifications, messages, blocks, reports };
  });

  app.get('/analytics/creator', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { days } = z.object({ days: z.coerce.number().int().refine((value) => value === 7 || value === 28).default(7) }).parse(request.query);
    const since = new Date(Date.now() - days * 86400000);
    const posts = await prisma.post.findMany({ where: { userId, status: { in: ['READY', 'PROCESSING'] } }, select: { id: true } });
    const postIds = posts.map((post) => post.id);
    const [views, follows, likes, comments] = await Promise.all([
      prisma.viewEvent.findMany({ where: { postId: { in: postIds }, createdAt: { gte: since } }, select: { postId: true, watchMs: true, completedPct: true, createdAt: true } }),
      prisma.follow.findMany({ where: { followingId: userId, status: 'ACCEPTED', createdAt: { gte: since } }, select: { createdAt: true } }),
      prisma.like.findMany({ where: { postId: { in: postIds }, createdAt: { gte: since } }, select: { createdAt: true } }),
      prisma.comment.findMany({ where: { postId: { in: postIds }, createdAt: { gte: since } }, select: { createdAt: true } }),
    ]);
    const byDay = new Map<string, { views: number; likes: number; comments: number; followers: number; watchMs: number }>();
    const day = (date: Date) => date.toISOString().slice(0, 10);
    for (let offset = days - 1; offset >= 0; offset--) { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - offset); byDay.set(day(date), { views: 0, likes: 0, comments: 0, followers: 0, watchMs: 0 }); }
    for (const view of views) { const row = byDay.get(day(view.createdAt)); if (row) { row.views++; row.watchMs += view.watchMs; } }
    for (const follow of follows) { const row = byDay.get(day(follow.createdAt)); if (row) row.followers++; }
    for (const like of likes) { const row = byDay.get(day(like.createdAt)); if (row) row.likes++; }
    for (const comment of comments) { const row = byDay.get(day(comment.createdAt)); if (row) row.comments++; }
    const totals = { views: views.length, likes: likes.length, comments: comments.length };
    return { days, totals: { ...totals, newFollowers: follows.length, watchMs: views.reduce((sum, view) => sum + view.watchMs, 0), averageCompletionPct: views.length ? views.reduce((sum, view) => sum + view.completedPct, 0) / views.length : 0 }, byDay: [...byDay.entries()].map(([date, metrics]) => ({ date, ...metrics })) };
  });

  app.get('/admin/reports', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const admin = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (admin?.role !== 'ADMIN') return reply.code(403).send({ code: 'FORBIDDEN', message: 'Administrator access required' });
    const query = pageSchema.extend({ status: z.enum(['PENDING', 'REVIEWED', 'ACTIONED', 'DISMISSED']).default('PENDING') }).parse(request.query);
    const cursor = query.cursor ? await prisma.report.findFirst({ where: { id: query.cursor, status: query.status }, select: { id: true, createdAt: true } }) : null;
    const rows = await prisma.report.findMany({ where: { status: query.status, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, include: { reporter: { select: { id: true, username: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
    const hasMore = rows.length > query.limit; const items = rows.slice(0, query.limit);
    return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
  });
  app.patch('/admin/reports/:id', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const admin = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (admin?.role !== 'ADMIN') return reply.code(403).send({ code: 'FORBIDDEN', message: 'Administrator access required' });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { action } = z.object({ action: z.enum(['REVIEW', 'DISMISS', 'REMOVE', 'BAN']) }).parse(request.body);
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return reply.code(404).send({ code: 'REPORT_NOT_FOUND', message: 'Report not found' });
    if ((action === 'BAN' && report.targetType !== 'USER') || (action === 'REMOVE' && report.targetType === 'USER')) return reply.code(400).send({ code: 'INVALID_MODERATION_ACTION', message: 'This action does not apply to the reported target' });
    if (action === 'REMOVE' && report.targetType === 'POST') await prisma.post.updateMany({ where: { id: report.targetId }, data: { status: 'REMOVED' } });
    if (action === 'REMOVE' && report.targetType === 'COMMENT') {
      const comment = await prisma.comment.findUnique({ where: { id: report.targetId }, select: { postId: true } });
      const deleted = await prisma.comment.deleteMany({ where: { id: report.targetId } });
      if (comment && deleted.count) await prisma.post.updateMany({ where: { id: comment.postId, commentsCount: { gt: 0 } }, data: { commentsCount: { decrement: 1 } } });
    }
    if (action === 'REMOVE' && report.targetType === 'STORY') await prisma.story.deleteMany({ where: { id: report.targetId } });
    if (action === 'BAN' && report.targetType === 'USER') await prisma.user.updateMany({ where: { id: report.targetId }, data: { isBanned: true } });
    const status = action === 'DISMISS' ? 'DISMISSED' : action === 'REVIEW' ? 'REVIEWED' : 'ACTIONED';
    return prisma.report.update({ where: { id }, data: { status } });
  });
}

async function deleteUserMedia(s3: S3Client, bucket: string, userId: string, postIds: string[]) {
  const prefixes = [`uploads/${userId}/`, ...postIds.map((id) => `processed/${id}/`)];
  const keys = new Set<string>();
  for (const prefix of prefixes) {
    let continuationToken: string | undefined;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
      for (const object of page.Contents ?? []) if (object.Key) keys.add(object.Key);
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  }
  const allKeys = [...keys];
  for (let start = 0; start < allKeys.length; start += 1000) {
    const result = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: allKeys.slice(start, start + 1000).map((Key) => ({ Key })), Quiet: true } }));
    if (result.Errors?.length) throw new Error('Object storage did not remove all account media');
  }
}
