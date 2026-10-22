import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Server as SocketIOServer } from 'socket.io';
import { sendExpoPush } from './push.js';

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
const pageSchema = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(25) });
const safeUser = { id: true, username: true, displayName: true, avatarUrl: true } as const;

export function registerInboxRoutes(app: FastifyInstance, prisma: PrismaClient, requireUser: Auth, io: SocketIOServer) {
  app.get('/notifications', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const query = pageSchema.parse(request.query);
    const cursor = query.cursor ? await prisma.notification.findFirst({ where: { id: query.cursor, userId }, select: { id: true, createdAt: true } }) : null;
    const rows = await prisma.notification.findMany({ where: { userId, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, include: { actor: { select: safeUser }, post: { select: { id: true, thumbnailUrl: true, caption: true } }, comment: { select: { id: true, text: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
    const hasMore = rows.length > query.limit; const items = rows.slice(0, query.limit);
    return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null, unreadCount: await prisma.notification.count({ where: { userId, isRead: false } }) };
  });

  app.post('/notifications/read', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const input = z.object({ ids: z.array(z.string().uuid()).max(100).optional(), all: z.boolean().default(false) }).parse(request.body ?? {});
    const result = await prisma.notification.updateMany({ where: { userId, isRead: false, ...(input.all ? {} : { id: { in: input.ids ?? [] } }) }, data: { isRead: true } });
    return { updated: result.count };
  });

  app.post('/notifications/device', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const input = z.object({ token: z.string().min(8).max(512), platform: z.enum(['ios', 'android', 'web']) }).parse(request.body);
    await prisma.deviceToken.upsert({ where: { token: input.token }, create: { ...input, userId }, update: { userId, platform: input.platform } });
    return reply.code(204).send();
  });

  app.delete('/notifications/device/:token', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { token } = z.object({ token: z.string().min(8).max(512) }).parse(request.params);
    await prisma.deviceToken.deleteMany({ where: { token, userId } }); return reply.code(204).send();
  });

  app.get('/notifications/preferences', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const preference = await prisma.notificationPreference.findUnique({ where: { userId } });
    return { pushEnabled: preference?.pushEnabled ?? true };
  });
  app.put('/notifications/preferences', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { pushEnabled } = z.object({ pushEnabled: z.boolean() }).parse(request.body);
    return prisma.notificationPreference.upsert({ where: { userId }, create: { userId, pushEnabled }, update: { pushEnabled }, select: { pushEnabled: true } });
  });

  app.get('/chat/conversations', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const query = pageSchema.parse(request.query);
    const cursor = query.cursor ? await prisma.conversation.findFirst({ where: { id: query.cursor, members: { some: { userId } } }, select: { id: true, updatedAt: true } }) : null;
    const memberships = await prisma.conversationMember.findMany({ where: { userId, ...(cursor ? { conversation: { OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] } } : {}) }, include: { conversation: { include: { members: { where: { userId: { not: userId } }, include: { user: { select: safeUser } } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } } } }, orderBy: [{ conversation: { updatedAt: 'desc' } }, { conversationId: 'desc' }], take: query.limit + 1 });
    const hasMore = memberships.length > query.limit; const rows = memberships.slice(0, query.limit);
    return { items: rows.map(({ conversation }) => ({ id: conversation.id, updatedAt: conversation.updatedAt, peer: conversation.members[0]?.user ?? null, lastMessage: conversation.messages[0] ?? null })), nextCursor: hasMore ? rows.at(-1)?.conversationId ?? null : null };
  });

  app.post('/chat/conversations', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { userId: peerId } = z.object({ userId: z.string().uuid() }).parse(request.body);
    if (peerId === userId) return reply.code(400).send({ code: 'INVALID_RECIPIENT', message: 'Choose another account to message' });
    const [peer, blocked] = await Promise.all([prisma.user.findUnique({ where: { id: peerId }, select: { id: true, isBanned: true, isPrivate: true } }), prisma.block.findFirst({ where: { OR: [{ blockerId: userId, blockedId: peerId }, { blockerId: peerId, blockedId: userId }] } })]);
    if (!peer || peer.isBanned || blocked) return reply.code(404).send({ code: 'USER_UNAVAILABLE', message: 'This account is unavailable' });
    if (peer.isPrivate && (await prisma.follow.findUnique({ where: { followerId_followingId: { followerId: userId, followingId: peerId } }, select: { status: true } }))?.status !== 'ACCEPTED') return reply.code(403).send({ code: 'FOLLOW_REQUIRED', message: 'Follow this private account before messaging' });
    const memberships = await prisma.conversationMember.findMany({ where: { userId }, select: { conversationId: true } });
    for (const membership of memberships) {
      const match = await prisma.conversationMember.count({ where: { conversationId: membership.conversationId, userId: peerId } });
      if (match) return { id: membership.conversationId };
    }
    const conversation = await prisma.conversation.create({ data: { members: { create: [{ userId }, { userId: peerId }] } }, select: { id: true } });
    return reply.code(201).send(conversation);
  });

  app.get('/chat/conversations/:id/messages', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const query = pageSchema.parse(request.query);
    if (!(await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: id, userId } } }))) return reply.code(404).send({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' });
    const cursor = query.cursor ? await prisma.message.findFirst({ where: { id: query.cursor, conversationId: id }, select: { id: true, createdAt: true } }) : null;
    const rows = await prisma.message.findMany({ where: { conversationId: id, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, include: { sender: { select: safeUser }, sharedPost: { select: { id: true, thumbnailUrl: true, caption: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
    const hasMore = rows.length > query.limit; const items = rows.slice(0, query.limit).reverse();
    await prisma.message.updateMany({ where: { conversationId: id, senderId: { not: userId }, readAt: null }, data: { readAt: new Date() } });
    io.to(`conversation:${id}`).emit('message:read', { conversationId: id, readerId: userId, readAt: new Date().toISOString() });
    return { items, nextCursor: hasMore ? rows[query.limit - 1]?.id ?? null : null };
  });

  app.post('/chat/conversations/:id/messages', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ text: z.string().trim().min(1).max(4000).optional(), sharedPostId: z.string().uuid().optional() }).refine((v) => v.text || v.sharedPostId, 'Message cannot be empty').parse(request.body);
    const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: id, userId } } });
    if (!member) return reply.code(404).send({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' });
    const peer = await prisma.conversationMember.findFirst({ where: { conversationId: id, userId: { not: userId } }, select: { userId: true } });
    if (!peer || await prisma.block.findFirst({ where: { OR: [{ blockerId: userId, blockedId: peer.userId }, { blockerId: peer.userId, blockedId: userId }] } })) return reply.code(403).send({ code: 'MESSAGING_UNAVAILABLE', message: 'Messaging is unavailable for this conversation' });
    if (input.sharedPostId) {
      const post = await prisma.post.findFirst({ where: { id: input.sharedPostId, status: 'READY', visibility: 'PUBLIC', user: { isBanned: false } }, select: { id: true } });
      if (!post) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Shared post not found' });
    }
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({ data: { conversationId: id, senderId: userId, ...(input.text !== undefined ? { text: input.text } : {}), ...(input.sharedPostId !== undefined ? { sharedPostId: input.sharedPostId } : {}) }, include: { sender: { select: safeUser }, sharedPost: { select: { id: true, thumbnailUrl: true, caption: true } } } });
      await tx.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
      await tx.notification.create({ data: { userId: peer.userId, actorId: userId, type: 'MESSAGE' } });
      return created;
    });
    io.to(`conversation:${id}`).emit('message:new', message);
    io.to(`user:${peer.userId}`).emit('notification:new', { type: 'MESSAGE', conversationId: id });
    void sendExpoPush(prisma, peer.userId, `Message from @${message.sender.username}`, message.text ?? 'Shared a post with you', { type: 'MESSAGE', conversationId: id }).catch(() => undefined);
    return reply.code(201).send(message);
  });
}
