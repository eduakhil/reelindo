import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { Redis } from 'ioredis';
import { DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Queue } from 'bullmq';
import { createPost, createUploadUrl } from './modules/create/service.js';
import { resolvePostVisibility } from './modules/create/schemas.js';
import { createPostSchema, uploadSchema } from './modules/create/schemas.js';
import { canViewPost, registerSocialRoutes } from './modules/social/routes.js';
import { registerStoryRoutes } from './modules/stories/routes.js';
import { registerInboxRoutes } from './modules/inbox/routes.js';
import { sendExpoPush } from './modules/inbox/push.js';
import { registerSafetyRoutes } from './modules/safety/routes.js';
import { moderateText } from './modules/safety/moderation.js';
import { registerFeedV2Routes, scheduleInterestRefresh } from './modules/feed/routes.js';
import { createHash, randomBytes } from 'node:crypto';
import { z, ZodError } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import * as Sentry from '@sentry/node';

const env = z.object({
  API_PORT: z.coerce.number().int().positive().default(Number(process.env.PORT) || 4000),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
}).parse(process.env);

const app = Fastify({ logger: true });
const prisma = new PrismaClient();
const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
async function conversationHasBlock(conversationId: string) {
  const members = await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true }, take: 3 });
  if (members.length !== 2) return true;
  const [first, second] = members;
  if (!first || !second) return true;
  return Boolean(await prisma.block.findFirst({
    where: { OR: [{ blockerId: first.userId, blockedId: second.userId }, { blockerId: second.userId, blockedId: first.userId }] },
    select: { blockerId: true },
  }));
}
const s3 = process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
  ? new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? 'auto', forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } })
  : null;
const videoQueue = process.env.REDIS_URL ? new Queue('video-processing', { connection: { url: process.env.REDIS_URL } }) : null;
const feedInterestQueue = process.env.REDIS_URL ? new Queue('feed-interest-refresh', { connection: { url: process.env.REDIS_URL } }) : null;
const feedV2Percent = z.coerce.number().int().min(0).max(100).default(20).parse(process.env.FEED_V2_PERCENT ?? 20);
const io = new SocketIOServer(app.server, {
  cors: { origin: corsOrigins.length ? corsOrigins : false, methods: ['GET', 'POST'] },
  allowRequest: (request, callback) => {
    const origin = request.headers.origin;
    callback(null, !origin || corsOrigins.includes(origin));
  },
});
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token ?? socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (typeof token !== 'string') return next(new Error('Authentication required'));
  try {
    const payload = app.jwt.verify<{ sub: string }>(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, isBanned: true } });
    if (!user || user.isBanned) return next(new Error('Account unavailable'));
    socket.data.userId = user.id;
    next();
  } catch { next(new Error('Authentication required')); }
});
io.on('connection', (socket) => {
  const userId = socket.data.userId as string;
  socket.join(`user:${userId}`);
  socket.on('conversation:join', async (conversationId: unknown, acknowledge?: (result: { joined: boolean }) => void) => {
    if (typeof conversationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(conversationId)) return acknowledge?.({ joined: false });
    const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } }, select: { conversationId: true } }).catch(() => null);
    if (!member) return acknowledge?.({ joined: false });
    if (await conversationHasBlock(conversationId).catch(() => true)) return acknowledge?.({ joined: false });
    await socket.join(`conversation:${conversationId}`);
    acknowledge?.({ joined: true });
  });
  socket.on('conversation:leave', (conversationId: unknown) => { if (typeof conversationId === 'string') void socket.leave(`conversation:${conversationId}`); });
  for (const event of ['typing:start', 'typing:stop'] as const) socket.on(event, async (conversationId: unknown) => {
    if (typeof conversationId !== 'string') return;
    const room = `conversation:${conversationId}`;
    if (!socket.rooms.has(room)) return;
    if (await conversationHasBlock(conversationId).catch(() => true)) return;
    socket.to(room).emit(event, { conversationId, userId });
  });
});
registerSocialRoutes(app, prisma, requireUser, redis);
registerFeedV2Routes(app, prisma, requireUser, feedInterestQueue, feedV2Percent, loadFeed);
registerStoryRoutes(app, prisma, requireUser, s3, process.env.S3_BUCKET, process.env.S3_PUBLIC_BASE_URL);
registerInboxRoutes(app, prisma, requireUser, io);
registerSafetyRoutes(app, prisma, requireUser, s3, process.env.S3_BUCKET, io);
await app.register(helmet);
await app.register(cors, { origin: corsOrigins.length ? corsOrigins : false });
await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });
await app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
  keyGenerator: (request: FastifyRequest) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return request.ip;
    try {
      const payload = app.jwt.verify<{ sub?: string }>(token);
      return payload.sub ? `user:${payload.sub}` : request.ip;
    } catch {
      return request.ip;
    }
  },
});
await app.register(swagger, { openapi: { info: { title: 'Reelindo API', version: '0.1.0' } } });
await app.register(swaggerUi, { routePrefix: '/docs' });

const registerSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase()),
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9._]+$/).transform((v) => v.toLowerCase()),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(10).max(128),
  birthDate: z.coerce.date(),
});
const loginSchema = z.object({ email: z.string().email().transform((v) => v.toLowerCase()), password: z.string().min(1).max(128) });
const refreshSchema = z.object({ refreshToken: z.string().min(32).max(512) });
const forgotSchema = z.object({ email: z.string().email().transform((v) => v.toLowerCase()) });
const resetSchema = z.object({ token: z.string().min(32).max(512), password: z.string().min(10).max(128) });
const refreshDays = 30;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const userId = (request.user as { sub?: string }).sub;
    if (!userId) throw new Error('Missing token subject');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isBanned: true } });
    if (!user || user.isBanned) { await reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' }); return null; }
    return user.id;
  } catch {
    if (!reply.sent) await reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    return null;
  }
}

function issueAccessToken(user: { id: string; username: string; role: string }) {
  return app.jwt.sign({ sub: user.id, username: user.username, role: user.role }, { expiresIn: '15m' });
}

async function issueRefreshToken(userId: string, deviceInfo?: string) {
  const token = randomBytes(48).toString('base64url');
  await prisma.refreshToken.create({ data: { userId, tokenHash: digest(token), deviceInfo: deviceInfo ?? null, expiresAt: new Date(Date.now() + refreshDays * 86400000) } });
  return token;
}

async function createSession(user: { id: string; username: string; role: string; language: string; isPrivate: boolean }, deviceInfo?: string) {
  return { user: { id: user.id, username: user.username, role: user.role, language: user.language, isPrivate: user.isPrivate }, accessToken: issueAccessToken(user), refreshToken: await issueRefreshToken(user.id, deviceInfo) };
}

app.post('/auth/register', async (request, reply) => {
  const input = registerSchema.parse(request.body);
  const ageAtRegistration = new Date();
  ageAtRegistration.setFullYear(ageAtRegistration.getFullYear() - 16);
  if (input.birthDate > ageAtRegistration) return reply.code(400).send({ code: 'AGE_REQUIREMENT', message: 'You must be at least 16 to create an account' });
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  try {
    const user = await prisma.user.create({ data: { email: input.email, username: input.username, displayName: input.displayName, passwordHash } });
    return reply.code(201).send(await createSession(user, request.headers['user-agent']));
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return reply.code(409).send({ code: 'ACCOUNT_EXISTS', message: 'Email or username is already in use' });
    throw error;
  }
});

app.post('/auth/login', async (request, reply) => {
  const input = loginSchema.parse(request.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, input.password))) return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
  if (user.isBanned) return reply.code(403).send({ code: 'ACCOUNT_UNAVAILABLE', message: 'This account is unavailable' });
  await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
  return createSession(user, request.headers['user-agent']);
});

app.post('/auth/refresh', async (request, reply) => {
  const { refreshToken } = refreshSchema.parse(request.body);
  const oldHash = digest(refreshToken);
  const session = await prisma.refreshToken.findUnique({ where: { tokenHash: oldHash }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.isBanned) return reply.code(401).send({ code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired' });
  const next = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + refreshDays * 86400000);
  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: session.id }, data: { revokedAt: new Date() } }),
    prisma.refreshToken.create({ data: { userId: session.userId, tokenHash: digest(next), deviceInfo: session.deviceInfo, expiresAt } }),
  ]);
  return { user: { id: session.user.id, username: session.user.username, role: session.user.role, language: session.user.language, isPrivate: session.user.isPrivate }, accessToken: issueAccessToken(session.user), refreshToken: next };
});

app.post('/auth/logout', async (request, reply) => {
  const parsed = refreshSchema.safeParse(request.body);
  if (parsed.success) await prisma.refreshToken.updateMany({ where: { tokenHash: digest(parsed.data.refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  return reply.code(204).send();
});

app.post('/auth/logout-all', async (request, reply) => {
  try {
    await request.jwtVerify();
    const userId = (request.user as { sub: string }).sub;
    await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return reply.code(204).send();
  } catch {
    return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }
});

app.post('/auth/forgot', async (request, reply) => {
  const { email } = forgotSchema.parse(request.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const token = randomBytes(32).toString('base64url');
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    if (process.env.NODE_ENV !== 'production') app.log.info({ userId: user.id, resetToken: token }, 'Development-only password reset token');
  }
  return reply.send({ message: 'If an account matches that email, password reset instructions will be sent.' });
});

app.post('/auth/reset', async (request, reply) => {
  const input = resetSchema.parse(request.body);
  const tokenHash = digest(input.token);
  const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date()) return reply.code(400).send({ code: 'RESET_TOKEN_INVALID', message: 'Password reset link is invalid or expired' });
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  await prisma.$transaction([
    prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  return reply.send({ message: 'Password updated. Please sign in again.' });
});

app.get('/users/me', async (request, reply) => {
  try {
    await request.jwtVerify();
    const userId = (request.user as { sub: string }).sub;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, email: true, avatarUrl: true, role: true, language: true, isPrivate: true } });
    if (!user) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'Account not found' });
    return user;
  } catch {
    return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }
});

app.post('/posts/upload-url', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  if (!s3 || !process.env.S3_BUCKET) return reply.code(503).send({ code: 'UPLOADS_UNAVAILABLE', message: 'Object storage has not been configured' });
  const input = uploadSchema.parse(request.body);
  return reply.code(201).send(await createUploadUrl(s3, process.env.S3_BUCKET, process.env.S3_PUBLIC_BASE_URL, userId, input));
});

app.post('/posts', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const input = createPostSchema.parse(request.body);
  if (!s3 || !process.env.S3_BUCKET) return reply.code(503).send({ code: 'UPLOADS_UNAVAILABLE', message: 'Object storage has not been configured' });
  let post;
  try { post = await createPost(prisma, videoQueue, s3, process.env.S3_BUCKET, process.env.S3_PUBLIC_BASE_URL, userId, input); }
  catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'CREATE_FAILED';
    const postId = error instanceof Error && 'postId' in error ? String(error.postId) : undefined;
    const status = code === 'PROCESSING_UNAVAILABLE' || code === 'PROCESSING_QUEUE_FAILED' || code === 'MEDIA_CDN_REQUIRED' || code === 'MODERATION_UNAVAILABLE' ? 503 : code === 'CREATE_FAILED' ? 500 : 400;
    request.log.error({ err: error, userId, postId }, 'Post creation failed');
    return reply.code(status).send({ code, message: error instanceof Error ? error.message : 'Could not create post', ...(postId ? { postId } : {}) });
  }
  return reply.code(post.status === 'READY' ? 201 : 202).send(post);
});

const feedQuery = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(30).default(10) });
const postCard = { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } }, sound: { select: { id: true, title: true, artist: true, audioUrl: true } } } as const;
async function loadFeed(userId: string, kind: 'foryou' | 'following', cursor: string | undefined, limit: number) {
  const blocked = await prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } });
  const blockedIds = blocked.map((row) => row.blockerId === userId ? row.blockedId : row.blockerId);
  const followed = kind === 'following' ? await prisma.follow.findMany({ where: { followerId: userId, status: 'ACCEPTED' }, select: { followingId: true } }) : null;
  const cursorPost = cursor ? await prisma.post.findUnique({ where: { id: cursor }, select: { createdAt: true } }) : null;
  const where = {
    status: 'READY' as const,
    ...(kind === 'following' ? { userId: { in: followed!.map((row) => row.followingId) }, visibility: { in: ['PUBLIC', 'FOLLOWERS'] as ('PUBLIC' | 'FOLLOWERS')[] } } : { visibility: 'PUBLIC' as const }),
    user: { isBanned: false, id: { notIn: blockedIds }, ...(kind === 'foryou' ? { OR: [{ isPrivate: false }, { id: userId }, { followers: { some: { followerId: userId, status: 'ACCEPTED' as const } } }] } : {}) },
    ...(cursor && cursorPost ? { OR: [{ createdAt: { lt: cursorPost.createdAt } }, { createdAt: cursorPost.createdAt, id: { lt: cursor } }] } : {}),
  };
  const posts = await prisma.post.findMany({ where, include: postCard, orderBy: { createdAt: 'desc' }, take: limit + 1 });
  const hasMore = posts.length > limit;
  const page = posts.slice(0, limit);
  const ids = page.map((post) => post.id);
  const [likes, saves] = await Promise.all([prisma.like.findMany({ where: { userId, postId: { in: ids } }, select: { postId: true } }), prisma.save.findMany({ where: { userId, postId: { in: ids } }, select: { postId: true } })]);
  const likedIds = new Set(likes.map((item) => item.postId)); const savedIds = new Set(saves.map((item) => item.postId));
  const result = { items: page.map((post) => ({ ...post, viewerHasLiked: likedIds.has(post.id), viewerHasSaved: savedIds.has(post.id) })), nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
  return result;
}
app.get('/posts/feed/:kind', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const params = z.object({ kind: z.enum(['foryou', 'following']) }).parse(request.params);
  const query = feedQuery.parse(request.query);
  return loadFeed(userId, params.kind, query.cursor, query.limit);
});

app.post('/posts/:id/like', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const post = await prisma.post.findUnique({ where: { id }, select: { id: true, userId: true, status: true } });
  if (!post || post.status !== 'READY' || !await canViewPost(prisma, userId, id, post.userId)) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Post not found' });
  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.like.findUnique({ where: { userId_postId: { userId, postId: id } } });
    if (existing) return false;
    await tx.like.create({ data: { userId, postId: id } }); await tx.post.update({ where: { id }, data: { likesCount: { increment: 1 } } }); return true;
  });
  if (created && post.userId !== userId) {
    const notification = await prisma.notification.create({ data: { userId: post.userId, actorId: userId, type: 'LIKE', postId: id }, include: { actor: { select: { username: true } } } });
    void sendExpoPush(prisma, post.userId, 'New like', `@${notification.actor?.username ?? 'Someone'} liked your post`, { type: 'LIKE', notificationId: notification.id, postId: id }).catch(() => undefined);
  }
  if (created) scheduleInterestRefresh(feedInterestQueue, userId);
  return { liked: true };
});
app.delete('/posts/:id/like', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.like.deleteMany({ where: { userId, postId: id } });
    if (deleted.count) await tx.post.updateMany({ where: { id, likesCount: { gt: 0 } }, data: { likesCount: { decrement: 1 } } });
  });
  return { liked: false };
});
app.post('/posts/:id/save', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const post = await prisma.post.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!post || post.status !== 'READY' || !await canViewPost(prisma, userId, id, post.userId)) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Post not found' });
  await prisma.$transaction(async (tx) => {
    const exists = await tx.save.findUnique({ where: { userId_postId: { userId, postId: id } } });
    if (!exists) { await tx.save.create({ data: { userId, postId: id } }); await tx.post.update({ where: { id }, data: { savesCount: { increment: 1 } } }); }
  });
  return { saved: true };
});
app.delete('/posts/:id/save', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const removed = await prisma.save.deleteMany({ where: { userId, postId: id } });
  if (removed.count) await prisma.post.updateMany({ where: { id, savesCount: { gt: 0 } }, data: { savesCount: { decrement: 1 } } });
  return { saved: false };
});
app.post('/posts/:id/share', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const target = await prisma.post.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!target || target.status !== 'READY' || !await canViewPost(prisma, userId, id, target.userId)) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Post not found' });
  await prisma.post.update({ where: { id }, data: { sharesCount: { increment: 1 } } });
  return { shareUrl: `https://reelindo.app/v/${id}`, deepLink: `reelindo://v/${id}` };
});
app.post('/posts/:id/view', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const post = await prisma.post.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!post || post.status !== 'READY' || !await canViewPost(prisma, userId, id, post.userId)) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Post not found' });
  const data = z.object({ watchMs: z.number().int().min(0).max(600000), completedPct: z.number().min(0).max(100) }).parse(request.body);
  await prisma.$transaction([prisma.viewEvent.create({ data: { postId: id, userId, ...data } }), prisma.post.update({ where: { id }, data: { viewsCount: { increment: 1 } } })]);
  scheduleInterestRefresh(feedInterestQueue, userId);
  return reply.code(202).send({ accepted: true });
});

app.get('/posts/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const post = await prisma.post.findFirst({ where: { id, status: 'READY' }, include: { ...postCard, media: { orderBy: { order: 'asc' } } } });
  if (!post || !await canViewPost(prisma, userId, post.id, post.userId)) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Post not found' });
  const [like, save] = await Promise.all([
    prisma.like.findUnique({ where: { userId_postId: { userId, postId: id } }, select: { postId: true } }),
    prisma.save.findUnique({ where: { userId_postId: { userId, postId: id } }, select: { postId: true } }),
  ]);
  return { ...post, viewerHasLiked: Boolean(like), viewerHasSaved: Boolean(save) };
});

app.patch('/posts/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const input = z.object({
    caption: z.string().max(2200).nullable().optional(),
    visibility: z.enum(['PUBLIC', 'FOLLOWERS', 'PRIVATE']).optional(),
    allowComments: z.boolean().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one post field to update').parse(request.body);
  if (input.caption !== undefined && !moderateText(input.caption ?? '').allowed) {
    return reply.code(400).send({ code: 'CONTENT_FILTERED', message: 'Please edit your caption before saving' });
  }
  const post = await prisma.post.findFirst({ where: { id, userId, status: 'READY' }, select: { id: true, user: { select: { isPrivate: true } } } });
  if (!post) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Your post was not found' });

  const hashtags = input.caption === undefined ? null : [...new Set((input.caption?.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((tag) => tag.slice(1).toLowerCase()).filter((tag) => tag.length <= 100))];
  const updated = await prisma.$transaction(async (tx) => {
    if (hashtags) {
      const previous = await tx.postHashtag.findMany({ where: { postId: id }, select: { hashtagId: true, hashtag: { select: { name: true } } } });
      const previousByName = new Map(previous.map((entry) => [entry.hashtag.name, entry.hashtagId]));
      const nextNames = new Set(hashtags);
      const removed = previous.filter((entry) => !nextNames.has(entry.hashtag.name));
      if (removed.length) {
        await tx.postHashtag.deleteMany({ where: { postId: id, hashtagId: { in: removed.map((entry) => entry.hashtagId) } } });
        await tx.hashtag.updateMany({ where: { id: { in: removed.map((entry) => entry.hashtagId) }, postsCount: { gt: 0 } }, data: { postsCount: { decrement: 1 } } });
      }
      const addedNames = hashtags.filter((name) => !previousByName.has(name));
      if (addedNames.length) {
        const added = await Promise.all(addedNames.map((name) => tx.hashtag.upsert({
          where: { name },
          create: { name, postsCount: 1 },
          update: { postsCount: { increment: 1 } },
          select: { id: true },
        })));
        await tx.postHashtag.createMany({ data: added.map((hashtag) => ({ postId: id, hashtagId: hashtag.id })), skipDuplicates: true });
      }
    }
    return tx.post.update({ where: { id }, data: {
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.visibility !== undefined ? { visibility: resolvePostVisibility(post.user.isPrivate, input.visibility) } : {}),
      ...(input.allowComments !== undefined ? { allowComments: input.allowComments } : {}),
    }, include: { ...postCard, media: { orderBy: { order: 'asc' } } } });
  });
  return updated;
});

app.delete('/posts/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const post = await prisma.post.findFirst({
    where: { id, userId },
    select: {
      id: true,
      sourceMediaKey: true,
      videoUrl: true,
      thumbnailUrl: true,
      previewUrl: true,
      hashtags: { select: { hashtagId: true } },
      media: { select: { url: true } },
    },
  });
  if (!post) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Your post was not found' });

  await prisma.$transaction(async (tx) => {
    const hashtagIds = [...new Set(post.hashtags.map(({ hashtagId }) => hashtagId))];
    if (hashtagIds.length) {
      await tx.hashtag.updateMany({
        where: { id: { in: hashtagIds }, postsCount: { gt: 0 } },
        data: { postsCount: { decrement: 1 } },
      });
    }
    await tx.post.delete({ where: { id } });
  });

  let mediaCleanup: 'complete' | 'failed' | 'not_configured' = 'complete';
  if (!s3 || !process.env.S3_BUCKET) {
    mediaCleanup = 'not_configured';
  } else {
    try {
      const publicBase = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, '');
      const keys = new Set<string>();
      if (post.sourceMediaKey) keys.add(post.sourceMediaKey);
      if (publicBase) {
        for (const url of [post.videoUrl, post.thumbnailUrl, post.previewUrl, ...post.media.map(({ url }) => url)]) {
          if (url?.startsWith(`${publicBase}/`)) {
            const key = url.slice(publicBase.length + 1).split('?')[0];
            if (key) keys.add(decodeURIComponent(key));
          }
        }
      }
      const processedPrefix = `processed/${id}/`;
      let continuationToken: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({
          Bucket: process.env.S3_BUCKET,
          Prefix: processedPrefix,
          ContinuationToken: continuationToken,
        }));
        for (const item of page.Contents ?? []) if (item.Key) keys.add(item.Key);
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);

      const allKeys = [...keys];
      for (let start = 0; start < allKeys.length; start += 1000) {
        const response = await s3.send(new DeleteObjectsCommand({
          Bucket: process.env.S3_BUCKET,
          Delete: { Objects: allKeys.slice(start, start + 1000).map((Key) => ({ Key })), Quiet: true },
        }));
        if (response.Errors?.length) throw new Error(`Storage rejected deletion of ${response.Errors.length} post media object(s)`);
      }
    } catch (error) {
      mediaCleanup = 'failed';
      request.log.error({ err: error, postId: id }, 'Post deleted but its media cleanup failed');
    }
  }
  return reply.code(200).send({ deleted: true, mediaCleanup });
});

app.post('/posts/:id/retry', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const post = await prisma.post.findFirst({
    where: { id, userId },
    select: { id: true, type: true, status: true, sourceMediaKey: true, thumbnailUrl: true, trimStart: true, trimEnd: true, visibility: true, user: { select: { isPrivate: true } } },
  });
  if (!post) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Your post was not found' });
  if (post.type !== 'REEL' || !post.sourceMediaKey) {
    return reply.code(409).send({ code: 'POST_CANNOT_RETRY', message: 'Only uploaded Reels can be retried' });
  }
  if (post.status === 'READY') return reply.send({ id, status: 'READY' });
  if (post.status === 'PROCESSING') return reply.code(202).send({ id, status: 'PROCESSING' });
  if (!s3 || !process.env.S3_BUCKET || !process.env.S3_PUBLIC_BASE_URL) {
    return reply.code(503).send({ code: 'PROCESSING_UNAVAILABLE', message: 'Media storage and its public URL must be configured before retrying' });
  }
  if (!videoQueue) return reply.code(503).send({ code: 'PROCESSING_UNAVAILABLE', message: 'Video processing queue is not configured' });

  const uploaded = await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: post.sourceMediaKey }));
  if (!uploaded.ContentLength || !['video/mp4', 'video/quicktime'].includes(uploaded.ContentType ?? '')) {
    return reply.code(400).send({ code: 'MEDIA_NOT_UPLOADED', message: 'The original Reel file is no longer available in storage' });
  }
  const sourceUrl = `${process.env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${post.sourceMediaKey}`;
  const claimed = await prisma.post.updateMany({
    where: { id, userId, status: 'FAILED' },
    data: { status: 'PROCESSING', videoUrl: sourceUrl, previewUrl: null, visibility: resolvePostVisibility(post.user.isPrivate, post.visibility) },
  });
  if (!claimed.count) {
    const current = await prisma.post.findUnique({ where: { id }, select: { status: true } });
    return reply.code(current?.status === 'PROCESSING' ? 202 : 200).send({ id, status: current?.status ?? 'FAILED' });
  }
  try {
    await videoQueue.add('transcode', {
      postId: id,
      sourceUrl,
      trimStart: post.trimStart ?? 0,
      trimEnd: post.trimEnd ?? undefined,
      coverUrl: post.thumbnailUrl ?? undefined,
    }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 500 });
  } catch (error) {
    await prisma.post.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'FAILED' } });
    request.log.error({ err: error, postId: id }, 'Could not queue Reel retry');
    return reply.code(503).send({ code: 'PROCESSING_QUEUE_FAILED', message: 'Your Reel is saved, but processing could not be restarted. Try again later.' });
  }
  return reply.code(202).send({ id, status: 'PROCESSING' });
});

app.get('/users/me/posts', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const query = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(30) }).parse(request.query);
  const items = await prisma.post.findMany({
    where: { userId, status: { in: ['READY', 'PROCESSING', 'FAILED'] }, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    include: { ...postCard, media: { orderBy: { order: 'asc' } } },
  });
  const hasMore = items.length > query.limit;
  const page = items.slice(0, query.limit);
  return { items: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
});

app.get('/users/me/saved', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const query = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(30) }).parse(request.query);
  const saves = await prisma.save.findMany({
    where: { userId },
    ...(query.cursor ? { cursor: { userId_postId: { userId, postId: query.cursor } }, skip: 1 } : {}),
    orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }],
    take: query.limit + 1,
    include: { post: { include: { ...postCard, media: { orderBy: { order: 'asc' } } } } },
  });
  const hasMore = saves.length > query.limit;
  const page = saves.slice(0, query.limit);
  const visible = await Promise.all(page.map(async ({ post }) => post.status === 'READY' && await canViewPost(prisma, userId, post.id, post.userId) ? post : null));
  return { items: visible.filter((post) => post !== null), nextCursor: hasMore ? page[page.length - 1]?.postId ?? null : null };
});

app.get('/health', async () => ({ status: 'ok', service: 'reelindo-api' }));
app.get('/ready', async (_request, reply) => {
  const checks: { database: 'ok' | 'error'; redis: 'ok' | 'error' | 'not_configured' } = { database: 'ok', redis: redis ? 'ok' : 'not_configured' };
  try { await prisma.$queryRaw`SELECT 1`; } catch (error) { checks.database = 'error'; app.log.error({ err: error }, 'Database readiness check failed'); }
  if (redis) try { await redis.ping(); } catch (error) { checks.redis = 'error'; app.log.error({ err: error }, 'Redis readiness check failed'); }
  const ready = checks.database === 'ok' && checks.redis !== 'error';
  return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks });
});
app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
  app.log.error(error);
  if ((error.statusCode ?? 500) >= 500) Sentry.captureException(error);
  if (error instanceof ZodError) return void reply.status(400).send({ code: 'VALIDATION_ERROR', message: error.issues.map((issue) => issue.message).join('; ') });
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  void reply.status(status).send({ code: status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message: status === 500 ? 'An unexpected error occurred' : error.message });
});

await app.listen({ port: env.API_PORT, host: env.API_HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().finally(async () => { io.close(); await Promise.all([videoQueue?.close(), feedInterestQueue?.close()]); redis?.disconnect(); await prisma.$disconnect(); }));
}
