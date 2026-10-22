import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { sendExpoPush } from '../inbox/push.js';
import { moderateText } from '../safety/moderation.js';

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
const cursorQuery = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(30).default(20) });
const profileSelect = { id: true, username: true, displayName: true, bio: true, avatarUrl: true, website: true, isVerified: true, isPrivate: true, language: true, createdAt: true } as const;

export function registerSocialRoutes(app: FastifyInstance, prisma: PrismaClient, requireUser: Auth, redis: Redis | null) {
  app.get('/users/me/close-friends', async (request, reply) => {
    const ownerId = await requireUser(request, reply); if (!ownerId) return;
    const items = await prisma.closeFriend.findMany({
      where: { ownerId },
      include: { friend: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { items: items.map(({ friend, createdAt }) => ({ ...friend, createdAt })) };
  });

  app.post('/users/me/close-friends', async (request, reply) => {
    const ownerId = await requireUser(request, reply); if (!ownerId) return;
    const { userId: friendId } = z.object({ userId: z.string().uuid() }).strict().parse(request.body);
    if (ownerId === friendId) return reply.code(400).send({ code: 'CANNOT_ADD_SELF', message: 'You cannot add yourself to Close Friends' });
    const friend = await prisma.user.findUnique({ where: { id: friendId }, select: { id: true, isBanned: true } });
    if (!friend || friend.isBanned) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'Creator not found' });
    const blocked = await prisma.block.findFirst({ where: { OR: [{ blockerId: ownerId, blockedId: friendId }, { blockerId: friendId, blockedId: ownerId }] }, select: { blockerId: true } });
    if (blocked) return reply.code(403).send({ code: 'USER_UNAVAILABLE', message: 'This creator is unavailable' });
    await prisma.closeFriend.upsert({
      where: { ownerId_friendId: { ownerId, friendId } },
      create: { ownerId, friendId },
      update: {},
    });
    return { added: true };
  });

  app.delete('/users/me/close-friends/:userId', async (request, reply) => {
    const ownerId = await requireUser(request, reply); if (!ownerId) return;
    const { userId: friendId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    await prisma.closeFriend.deleteMany({ where: { ownerId, friendId } });
    return { removed: true };
  });

  app.get('/users/:username', async (request, reply) => {
    const viewerId = await requireUser(request, reply); if (!viewerId) return;
    const { username } = z.object({ username: z.string().min(1).max(30) }).parse(request.params);
    const user = await prisma.user.findFirst({ where: { username: username.toLowerCase(), isBanned: false }, select: profileSelect });
    if (!user) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'Creator not found' });
    const [followersCount, followingCount, postsCount, likesCount, follow, blocked] = await Promise.all([
      prisma.follow.count({ where: { followingId: user.id, status: 'ACCEPTED' } }),
      prisma.follow.count({ where: { followerId: user.id, status: 'ACCEPTED' } }),
      prisma.post.count({ where: { userId: user.id, status: 'READY' } }),
      prisma.post.aggregate({ where: { userId: user.id, status: 'READY' }, _sum: { likesCount: true } }),
      prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: user.id } }, select: { status: true } }),
      prisma.block.findFirst({ where: { OR: [{ blockerId: viewerId, blockedId: user.id }, { blockerId: user.id, blockedId: viewerId }] } }),
    ]);
    const isSelf = user.id === viewerId;
    if (blocked && !isSelf) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'Creator not found' });
    return { ...user, followersCount, followingCount, postsCount, likesCount: likesCount._sum.likesCount ?? 0, isSelf, followStatus: isSelf ? 'SELF' : follow?.status ?? 'NONE', isBlocked: Boolean(blocked), canViewPosts: isSelf || (!blocked && (!user.isPrivate || follow?.status === 'ACCEPTED')) };
  });

  app.patch('/users/me', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const input = z.object({ displayName: z.string().trim().min(1).max(80).optional(), bio: z.string().max(300).optional(), website: z.string().url().max(2048).nullable().optional(), avatarUrl: z.string().url().nullable().optional(), isPrivate: z.boolean().optional(), language: z.enum(['en', 'hi']).optional() }).strict().parse(request.body);
    const user = await prisma.user.update({ where: { id: userId }, data: {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.website !== undefined ? { website: input.website } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.isPrivate !== undefined ? { isPrivate: input.isPrivate } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
    }, select: profileSelect });
    return user;
  });

  app.post('/users/:id/follow', async (request, reply) => {
    const followerId = await requireUser(request, reply); if (!followerId) return;
    const { id: followingId } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (followerId === followingId) return reply.code(400).send({ code: 'CANNOT_FOLLOW_SELF', message: 'You cannot follow yourself' });
    const target = await prisma.user.findUnique({ where: { id: followingId }, select: { id: true, isPrivate: true, isBanned: true } });
    if (!target || target.isBanned) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'Creator not found' });
    const blocked = await prisma.block.findFirst({ where: { OR: [{ blockerId: followerId, blockedId: followingId }, { blockerId: followingId, blockedId: followerId }] } });
    if (blocked) return reply.code(403).send({ code: 'USER_UNAVAILABLE', message: 'This creator is unavailable' });
    const status = target.isPrivate ? 'PENDING' : 'ACCEPTED';
    const existing = await prisma.follow.findUnique({ where: { followerId_followingId: { followerId, followingId } }, select: { status: true } });
    await prisma.follow.upsert({ where: { followerId_followingId: { followerId, followingId } }, create: { followerId, followingId, status }, update: { status } });
    if (!existing && status === 'ACCEPTED') {
      const notification = await prisma.notification.create({ data: { userId: followingId, actorId: followerId, type: 'FOLLOW' }, include: { actor: { select: { username: true } } } });
      void sendExpoPush(prisma, followingId, 'New follower', `@${notification.actor?.username ?? 'Someone'} started following you`, { type: 'FOLLOW', notificationId: notification.id }).catch(() => undefined);
    }
    await redis?.del(`profile:${followingId}`);
    return { following: status === 'ACCEPTED', status };
  });
  app.delete('/users/:id/follow', async (request, reply) => {
    const followerId = await requireUser(request, reply); if (!followerId) return;
    const { id: followingId } = z.object({ id: z.string().uuid() }).parse(request.params);
    await prisma.follow.deleteMany({ where: { followerId, followingId } });
    return { following: false, status: 'NONE' };
  });

  app.get('/users/:id/followers', async (request, reply) => listFollows(request, reply, prisma, requireUser, 'followers'));
  app.get('/users/:id/following', async (request, reply) => listFollows(request, reply, prisma, requireUser, 'following'));

  app.get('/users/:username/posts', async (request, reply) => {
    const viewerId = await requireUser(request, reply); if (!viewerId) return;
    const { username } = z.object({ username: z.string().min(1).max(30) }).parse(request.params);
    const query = cursorQuery.parse(request.query);
    const profile = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true, isPrivate: true, isBanned: true } });
    if (!profile || profile.isBanned) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'Creator not found' });
    if (profile.id !== viewerId && await prisma.block.findFirst({ where: { OR: [{ blockerId: viewerId, blockedId: profile.id }, { blockerId: profile.id, blockedId: viewerId }] } })) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'Creator not found' });
    const follows = profile.id === viewerId || !profile.isPrivate || await prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: profile.id } }, select: { status: true } }).then((item) => item?.status === 'ACCEPTED');
    if (!follows) return reply.code(403).send({ code: 'PRIVATE_PROFILE', message: 'Follow this account to see its posts' });
    const acceptedFollow = profile.id !== viewerId && await prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: profile.id } }, select: { status: true } }).then((item) => item?.status === 'ACCEPTED');
    const visibility = profile.id === viewerId ? ['PUBLIC', 'FOLLOWERS', 'PRIVATE'] as const : acceptedFollow ? ['PUBLIC', 'FOLLOWERS'] as const : ['PUBLIC'] as const;
    const items = await prisma.post.findMany({ where: { userId: profile.id, status: 'READY', visibility: { in: [...visibility] }, ...(query.cursor ? { id: { lt: query.cursor } } : {}) }, orderBy: { createdAt: 'desc' }, take: query.limit + 1, include: { media: { orderBy: { order: 'asc' } } } });
    const hasMore = items.length > query.limit; const page = items.slice(0, query.limit);
    return { items: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
  });

  app.post('/posts/:id/comments', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id: postId } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ text: z.string().trim().min(1).max(2000), parentId: z.string().uuid().optional() }).parse(request.body);
    if (!moderateText(input.text).allowed) return reply.code(400).send({ code: 'CONTENT_FILTERED', message: 'Please edit this comment to remove abusive language' });
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, userId: true, allowComments: true, status: true } });
    if (!post || post.status !== 'READY') return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Post not found' });
    if (!await canViewPost(prisma, userId, post.id, post.userId)) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Post not found' });
    if (!post.allowComments) return reply.code(403).send({ code: 'COMMENTS_DISABLED', message: 'Comments are disabled for this post' });
    if (input.parentId) { const parent = await prisma.comment.findUnique({ where: { id: input.parentId }, select: { postId: true, parentId: true } }); if (!parent || parent.postId !== postId || parent.parentId) return reply.code(400).send({ code: 'INVALID_REPLY', message: 'Replies must target a top-level comment on this post' }); }
    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({ data: { postId, userId, text: input.text, parentId: input.parentId ?? null }, include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } });
      await tx.post.update({ where: { id: postId }, data: { commentsCount: { increment: 1 } } });
      return created;
    });
    if (post.userId !== userId) {
      const notification = await prisma.notification.create({ data: { userId: post.userId, actorId: userId, type: 'COMMENT', postId, commentId: comment.id }, include: { actor: { select: { username: true } } } });
      void sendExpoPush(prisma, post.userId, 'New comment', `@${notification.actor?.username ?? 'Someone'} commented on your post`, { type: 'COMMENT', notificationId: notification.id, postId }).catch(() => undefined);
    }
    const mentionedNames = [...new Set((input.text.match(/@[a-zA-Z0-9._]{3,30}/g) ?? []).map((mention) => mention.slice(1).toLowerCase()))];
    if (mentionedNames.length) {
      const mentioned = await prisma.user.findMany({ where: { username: { in: mentionedNames }, isBanned: false }, select: { id: true } });
      if (mentioned.length) {
        await prisma.mention.createMany({ data: mentioned.map((user) => ({ commentId: comment.id, userId: user.id })) });
        const recipients = mentioned.filter((user) => user.id !== userId);
        await prisma.notification.createMany({ data: recipients.map((user) => ({ userId: user.id, actorId: userId, type: 'MENTION', postId, commentId: comment.id })) });
        const actor = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
        for (const recipient of recipients) void sendExpoPush(prisma, recipient.id, 'You were mentioned', `@${actor?.username ?? 'Someone'} mentioned you in a comment`, { type: 'MENTION', notificationId: comment.id, postId }).catch(() => undefined);
      }
    }
    return reply.code(201).send(comment);
  });
  app.get('/posts/:id/comments', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id: postId } = z.object({ id: z.string().uuid() }).parse(request.params); const query = cursorQuery.parse(request.query);
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, userId: true, allowComments: true, status: true } });
    if (!post || post.status !== 'READY') return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Post not found' });
    if (!await canViewPost(prisma, userId, post.id, post.userId)) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Post not found' });
    const rows = await prisma.comment.findMany({ where: { postId, parentId: null, ...(query.cursor ? { id: { lt: query.cursor } } : {}) }, include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } }, replies: { take: 3, orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } } }, orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], take: query.limit + 1 });
    const hasMore = rows.length > query.limit; const items = rows.slice(0, query.limit);
    const ids = items.flatMap((item) => [item.id, ...item.replies.map((reply) => reply.id)]);
    const likes = await prisma.commentLike.findMany({ where: { userId, commentId: { in: ids } }, select: { commentId: true } });
    const liked = new Set(likes.map((item) => item.commentId));
    return { items: items.map((item) => ({ ...item, viewerHasLiked: liked.has(item.id), replies: item.replies.map((reply) => ({ ...reply, viewerHasLiked: liked.has(reply.id) })) })), nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null, commentsEnabled: post.allowComments };
  });
  app.post('/comments/:id/like', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const comment = await prisma.comment.findUnique({ where: { id }, select: { postId: true, post: { select: { userId: true, status: true } } } });
    if (!comment || comment.post.status !== 'READY' || !await canViewPost(prisma, userId, comment.postId, comment.post.userId)) return reply.code(404).send({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found' });
    await prisma.$transaction(async (tx) => { const exists = await tx.commentLike.findUnique({ where: { userId_commentId: { userId, commentId: id } } }); if (!exists) { await tx.commentLike.create({ data: { userId, commentId: id } }); await tx.comment.update({ where: { id }, data: { likesCount: { increment: 1 } } }); } });
    return { liked: true };
  });
  app.delete('/comments/:id/like', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const deleted = await prisma.commentLike.deleteMany({ where: { userId, commentId: id } });
    if (deleted.count) await prisma.comment.updateMany({ where: { id, likesCount: { gt: 0 } }, data: { likesCount: { decrement: 1 } } });
    return { liked: false };
  });
  app.post('/comments/:id/pin', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const comment = await prisma.comment.findUnique({ where: { id }, select: { postId: true, parentId: true } });
    if (!comment || comment.parentId) return reply.code(404).send({ code: 'COMMENT_NOT_FOUND', message: 'Top-level comment not found' });
    const post = await prisma.post.findUnique({ where: { id: comment.postId }, select: { userId: true } });
    if (post?.userId !== userId) return reply.code(403).send({ code: 'FORBIDDEN', message: 'Only the post owner can pin comments' });
    await prisma.$transaction([prisma.comment.updateMany({ where: { postId: comment.postId, isPinned: true }, data: { isPinned: false } }), prisma.comment.update({ where: { id }, data: { isPinned: true } })]);
    return { pinned: true };
  });
  app.delete('/comments/:id/pin', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const comment = await prisma.comment.findUnique({ where: { id }, select: { postId: true } });
    if (!comment) return reply.code(404).send({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found' });
    const post = await prisma.post.findUnique({ where: { id: comment.postId }, select: { userId: true } });
    if (post?.userId !== userId) return reply.code(403).send({ code: 'FORBIDDEN', message: 'Only the post owner can unpin comments' });
    await prisma.comment.update({ where: { id }, data: { isPinned: false } });
    return { pinned: false };
  });
  app.delete('/comments/:id', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const comment = await prisma.comment.findUnique({ where: { id }, select: { userId: true, postId: true } });
    if (!comment) return reply.code(404).send({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found' });
    if (comment.userId !== userId) return reply.code(403).send({ code: 'FORBIDDEN', message: 'You can only delete your own comments' });
    const deleted = await prisma.comment.deleteMany({ where: { id } });
    if (deleted.count) await prisma.post.updateMany({ where: { id: comment.postId, commentsCount: { gt: 0 } }, data: { commentsCount: { decrement: 1 } } });
    return reply.code(204).send();
  });

  app.get('/explore/search', async (request, reply) => {
    const viewerId = await requireUser(request, reply); if (!viewerId) return;
    const { q, type } = z.object({ q: z.string().trim().min(1).max(100), type: z.enum(['top', 'accounts', 'videos', 'hashtags', 'sounds']).default('top') }).parse(request.query);
    const term = q.replace(/[%_\\]/g, '');
    const [accounts, hashtags, sounds, posts] = await Promise.all([
      type === 'top' || type === 'accounts' ? prisma.user.findMany({ where: { isBanned: false, OR: [{ username: { contains: term, mode: 'insensitive' } }, { displayName: { contains: term, mode: 'insensitive' } }] }, select: profileSelect, take: 10, orderBy: { username: 'asc' } }) : [],
      type === 'top' || type === 'hashtags' ? prisma.hashtag.findMany({ where: { name: { contains: term.replace(/^#/, ''), mode: 'insensitive' } }, orderBy: { postsCount: 'desc' }, take: 10 }) : [],
      type === 'top' || type === 'sounds' ? prisma.sound.findMany({ where: { OR: [{ title: { contains: term, mode: 'insensitive' } }, { artist: { contains: term, mode: 'insensitive' } }] }, orderBy: { usesCount: 'desc' }, take: 10 }) : [],
      type === 'top' || type === 'videos' ? prisma.post.findMany({ where: { status: 'READY', visibility: 'PUBLIC', caption: { contains: term, mode: 'insensitive' }, user: { isBanned: false, OR: [{ isPrivate: false }, { id: viewerId }, { followers: { some: { followerId: viewerId, status: 'ACCEPTED' } } }] } }, orderBy: { createdAt: 'desc' }, take: 12, include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } }) : [],
    ]);
    return { accounts, hashtags, sounds, posts };
  });

  app.get('/explore/trending/hashtags', async (request, reply) => { const userId = await requireUser(request, reply); if (!userId) return; return prisma.hashtag.findMany({ orderBy: [{ postsCount: 'desc' }, { name: 'asc' }], take: 20 }); });
  app.get('/explore/trending/sounds', async (request, reply) => { const userId = await requireUser(request, reply); if (!userId) return; return prisma.sound.findMany({ orderBy: [{ usesCount: 'desc' }, { id: 'asc' }], take: 20 }); });
  app.get('/explore/trending', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const [hashtags, sounds] = await Promise.all([
      prisma.hashtag.findMany({ orderBy: [{ postsCount: 'desc' }, { name: 'asc' }], take: 20 }),
      prisma.sound.findMany({ orderBy: [{ usesCount: 'desc' }, { id: 'asc' }], take: 20 }),
    ]);
    return { hashtags, sounds };
  });
  app.get('/hashtags/:name', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(request.params); const query = cursorQuery.parse(request.query);
    const hashtag = await prisma.hashtag.findUnique({ where: { name: name.replace(/^#/, '').toLowerCase() } });
    if (!hashtag) return reply.code(404).send({ code: 'HASHTAG_NOT_FOUND', message: 'Hashtag not found' });
    const links = await prisma.postHashtag.findMany({
      where: {
        hashtagId: hashtag.id,
        ...(query.cursor ? { postId: { lt: query.cursor } } : {}),
        post: {
          status: 'READY',
          visibility: 'PUBLIC',
          user: {
            isBanned: false,
            OR: [
              { isPrivate: false },
              { id: userId },
              { followers: { some: { followerId: userId, status: 'ACCEPTED' } } },
            ],
          },
        },
      },
      orderBy: { post: { createdAt: 'desc' } },
      take: query.limit + 1,
      include: { post: { include: { media: { orderBy: { order: 'asc' } } } } },
    });
    const hasMore = links.length > query.limit; const items = links.slice(0, query.limit).map((link) => link.post);
    return { hashtag, items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  });
  app.get('/sounds/:id', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const query = cursorQuery.parse(request.query);
    const sound = await prisma.sound.findUnique({ where: { id } }); if (!sound) return reply.code(404).send({ code: 'SOUND_NOT_FOUND', message: 'Sound not found' });
    const items = await prisma.post.findMany({ where: { soundId: id, status: 'READY', visibility: 'PUBLIC', user: { isBanned: false, OR: [{ isPrivate: false }, { id: userId }, { followers: { some: { followerId: userId, status: 'ACCEPTED' } } }] }, ...(query.cursor ? { id: { lt: query.cursor } } : {}) }, orderBy: { createdAt: 'desc' }, take: query.limit + 1, include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } });
    const hasMore = items.length > query.limit; const page = items.slice(0, query.limit);
    return { sound, items: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
  });
}

async function listFollows(request: FastifyRequest, reply: FastifyReply, prisma: PrismaClient, requireUser: Auth, kind: 'followers' | 'following') {
  const viewerId = await requireUser(request, reply); if (!viewerId) return;
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const query = cursorQuery.parse(request.query);
  const profile = await prisma.user.findUnique({ where: { id }, select: { id: true, isPrivate: true, isBanned: true } });
  if (!profile || profile.isBanned) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'Creator not found' });
  if (id !== viewerId) {
    const [blocked, follow] = await Promise.all([
      prisma.block.findFirst({ where: { OR: [{ blockerId: viewerId, blockedId: id }, { blockerId: id, blockedId: viewerId }] }, select: { blockerId: true } }),
      profile.isPrivate ? prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: id } }, select: { status: true } }) : Promise.resolve(null),
    ]);
    if (blocked) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'Creator not found' });
    if (profile.isPrivate && follow?.status !== 'ACCEPTED') return reply.code(403).send({ code: 'PRIVATE_PROFILE', message: 'Follow this account to see its connections' });
  }
  const page = kind === 'followers'
    ? await prisma.follow.findMany({ where: { followingId: id, status: 'ACCEPTED', ...(query.cursor ? { followerId: { lt: query.cursor } } : {}) }, take: query.limit + 1, orderBy: { createdAt: 'desc' }, include: { follower: { select: profileSelect } } })
    : await prisma.follow.findMany({ where: { followerId: id, status: 'ACCEPTED', ...(query.cursor ? { followingId: { lt: query.cursor } } : {}) }, take: query.limit + 1, orderBy: { createdAt: 'desc' }, include: { following: { select: profileSelect } } });
  const hasMore = page.length > query.limit; const rows = page.slice(0, query.limit);
  return { items: rows.map((row) => kind === 'followers' ? ('follower' in row ? row.follower : null) : ('following' in row ? row.following : null)), nextCursor: hasMore ? (kind === 'followers' ? rows[rows.length - 1]?.followerId : rows[rows.length - 1]?.followingId) ?? null : null };
}

export async function canViewPost(prisma: PrismaClient, viewerId: string, postId: string, authorId: string) {
  if (viewerId === authorId) return true;
  const [post, blocked, follow] = await Promise.all([
    prisma.post.findUnique({ where: { id: postId }, select: { visibility: true, user: { select: { isPrivate: true, isBanned: true } } } }),
    prisma.block.findFirst({ where: { OR: [{ blockerId: viewerId, blockedId: authorId }, { blockerId: authorId, blockedId: viewerId }] } }),
    prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: authorId } }, select: { status: true } }),
  ]);
  if (blocked || !post || post.user.isBanned) return false;
  const accepted = follow?.status === 'ACCEPTED';
  if (post.user.isPrivate && !accepted) return false;
  return post.visibility === 'PUBLIC' || post.visibility === 'FOLLOWERS' && accepted;
}
