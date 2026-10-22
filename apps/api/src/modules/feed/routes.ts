import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { canViewPost } from '../social/routes.js';
import { getFeedVariant, rankFeedCandidates } from './recommendations.js';

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
type InterestQueue = Queue | null;
type BaselineFeedLoader = (userId: string, kind: 'foryou', cursor: string | undefined, limit: number) => Promise<{ items: unknown[]; nextCursor: string | null }>;
const querySchema = z.object({ cursor: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(30).default(10) });
const include = {
  user: { select: { id: true, username: true, displayName: true, avatarUrl: true, _count: { select: { posts: true, followers: true } } } },
  sound: { select: { id: true, title: true, artist: true, audioUrl: true } },
  hashtags: { include: { hashtag: { select: { name: true } } } },
} as const;

export function scheduleInterestRefresh(queue: InterestQueue, userId: string) {
  if (!queue) return;
  void queue.add('refresh-user', { userId }, { jobId: `refresh-${userId}`, delay: 5 * 60_000, removeOnComplete: true, removeOnFail: true }).catch(() => undefined);
}

export function registerFeedV2Routes(app: FastifyInstance, prisma: PrismaClient, requireUser: Auth, queue: InterestQueue, v2Percent: number, baselineFeed: BaselineFeedLoader) {
  app.get('/v2/feed/interests', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const [topics, selected] = await Promise.all([
      prisma.interestTopic.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.userInterest.findMany({ where: { userId }, select: { topicId: true } }),
    ]);
    const selectedIds = new Set(selected.map((item) => item.topicId));
    return { items: topics.map((topic) => ({ ...topic, selected: selectedIds.has(topic.id) })) };
  });
  app.put('/v2/feed/interests', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { topicIds } = z.object({ topicIds: z.array(z.string().uuid()).max(20) }).parse(request.body);
    const uniqueIds = [...new Set(topicIds)];
    const valid = uniqueIds.length ? await prisma.interestTopic.findMany({ where: { id: { in: uniqueIds } }, select: { id: true } }) : [];
    if (valid.length !== uniqueIds.length) return reply.code(400).send({ code: 'INVALID_INTEREST', message: 'One or more interest topics are unavailable' });
    await prisma.$transaction(async (tx) => {
      await tx.userInterest.deleteMany({ where: { userId } });
      if (uniqueIds.length) await tx.userInterest.createMany({ data: uniqueIds.map((topicId) => ({ userId, topicId })) });
    });
    scheduleInterestRefresh(queue, userId);
    return { topicIds: uniqueIds };
  });

  app.get('/v2/feed/foryou', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const query = querySchema.parse(request.query);
    const variant = getFeedVariant(userId, v2Percent);
    if (variant === 'v1') {
      if (query.cursor && !z.string().uuid().safeParse(query.cursor).success) return reply.code(400).send({ code: 'INVALID_CURSOR', message: 'Feed cursor is invalid' });
      const old = await baselineFeed(userId, 'foryou', query.cursor, query.limit);
      return { ...old, experiment: variant, items: old.items.map((post) => Object.assign({}, typeof post === 'object' && post !== null ? post : {}, { recommendationVariant: variant })) };
    }
    const offset = query.cursor ? Number(query.cursor.slice(3)) : 0;
    if (query.cursor && (!/^v2:\d+$/.test(query.cursor) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000)) return reply.code(400).send({ code: 'INVALID_CURSOR', message: 'Feed cursor is invalid' });
    const ranked = await buildRankedFeed(prisma, userId);
    const page = ranked.slice(offset, offset + query.limit);
    const pageIds = page.map(({ post }) => post.id);
    const [likes, saves] = await Promise.all([
      prisma.like.findMany({ where: { userId, postId: { in: pageIds } }, select: { postId: true } }),
      prisma.save.findMany({ where: { userId, postId: { in: pageIds } }, select: { postId: true } }),
    ]);
    const likedIds = new Set(likes.map((item) => item.postId)); const savedIds = new Set(saves.map((item) => item.postId));
    return {
      experiment: variant,
      items: page.map(({ post, score, reasons }) => {
        const { _count: _counts, ...user } = post.user;
        return { ...post, user, viewerHasLiked: likedIds.has(post.id), viewerHasSaved: savedIds.has(post.id), recommendationVariant: variant, recommendationScore: score, recommendationReasons: reasons };
      }),
      nextCursor: offset + page.length < ranked.length ? `v2:${offset + page.length}` : null,
    };
  });

  app.post('/v2/feed/:postId/feedback', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    const { action } = z.object({ action: z.enum(['NOT_INTERESTED', 'SHOW_LESS']) }).parse(request.body);
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, userId: true, status: true } });
    if (!post || post.status !== 'READY' || !await canViewPost(prisma, userId, post.id, post.userId)) return reply.code(404).send({ code: 'POST_NOT_FOUND', message: 'Post not found' });
    await prisma.feedFeedback.upsert({ where: { userId_postId: { userId, postId } }, create: { userId, postId, action }, update: { action, createdAt: new Date() } });
    scheduleInterestRefresh(queue, userId);
    return { postId, action };
  });
  app.delete('/v2/feed/:postId/feedback', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    await prisma.feedFeedback.deleteMany({ where: { userId, postId } });
    return reply.code(204).send();
  });

  app.get('/admin/users/:userId/feed-debug', async (request, reply) => {
    const adminId = await requireUser(request, reply); if (!adminId) return;
    const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
    if (admin?.role !== 'ADMIN') return reply.code(403).send({ code: 'FORBIDDEN', message: 'Administrator access required' });
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const ranked = await buildRankedFeed(prisma, userId);
    return { userId, experiment: getFeedVariant(userId, v2Percent), items: ranked.slice(0, 30).map(({ post, score, reasons }) => ({ postId: post.id, creatorId: post.userId, score, reasons, createdAt: post.createdAt })) };
  });
}

async function buildRankedFeed(prisma: PrismaClient, userId: string) {
  const [blocked, follows, signals, likes, feedback, topics] = await Promise.all([
    prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } }),
    prisma.follow.findMany({ where: { followerId: userId, status: 'ACCEPTED' }, select: { followingId: true }, take: 500 }),
    prisma.feedInterestSignal.findMany({ where: { userId, score: { gt: 0 } }, orderBy: { score: 'desc' }, take: 100 }),
    prisma.like.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { post: { select: {
        userId: true, soundId: true,
        hashtags: { select: { hashtag: { select: { name: true } } } },
      } } },
    }),
    prisma.feedFeedback.findMany({
      where: { userId, action: { in: ['NOT_INTERESTED', 'SHOW_LESS'] } }, orderBy: { createdAt: 'desc' }, take: 500,
      select: { action: true, postId: true, post: { select: {
        userId: true, soundId: true,
        hashtags: { select: { hashtag: { select: { name: true } } } },
      } } },
    }),
    prisma.userInterest.findMany({ where: { userId }, include: { topic: { select: { name: true } } }, take: 100 }),
  ]);
  const blockedIds = blocked.map((row) => row.blockerId === userId ? row.blockedId : row.blockerId);
  const followedCreatorIds = new Set(follows.map((item) => item.followingId));
  const likedCreatorIds = new Set(likes.map((item) => item.post.userId));
  const likedSoundIds = new Set(likes.flatMap((item) => item.post.soundId ? [item.post.soundId] : []));
  const likedHashtags = new Set(likes.flatMap((item) => item.post.hashtags.map(({ hashtag }) => hashtag.name.toLowerCase())));
  const ignoredPostIds = feedback.filter((item) => item.action === 'NOT_INTERESTED').map((item) => item.postId);
  const showLessCreatorIds = new Set(feedback.filter((item) => item.action === 'SHOW_LESS').map((item) => item.post.userId));
  const personalizedOr: Prisma.PostWhereInput[] = [];
  const creatorIds = [...new Set([...signals.filter((item) => item.kind === 'CREATOR').map((item) => item.signalKey), ...likedCreatorIds])].filter((id) => !blockedIds.includes(id) && id !== userId);
  const soundIds = [...new Set([...signals.filter((item) => item.kind === 'SOUND').map((item) => item.signalKey), ...likedSoundIds])];
  const tags = [...new Set([...signals.filter((item) => item.kind === 'HASHTAG').map((item) => item.signalKey.toLowerCase()), ...likedHashtags, ...topics.map((item) => item.topic.name.toLowerCase())])];
  if (creatorIds.length) personalizedOr.push({ userId: { in: creatorIds } });
  if (soundIds.length) personalizedOr.push({ soundId: { in: soundIds } });
  if (tags.length) personalizedOr.push({ hashtags: { some: { hashtag: { name: { in: tags } } } } });
  const notBanned = { isBanned: false, isPrivate: false, id: { notIn: [...blockedIds, userId] } };
  const [trending, followedPosts, personalized, recentPublic, ignored] = await Promise.all([
    prisma.post.findMany({ where: { status: 'READY', visibility: 'PUBLIC', user: notBanned, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, include, orderBy: [{ likesCount: 'desc' }, { viewsCount: 'desc' }, { createdAt: 'desc' }], take: 140 }),
    followedCreatorIds.size ? prisma.post.findMany({ where: { status: 'READY', visibility: { in: ['PUBLIC', 'FOLLOWERS'] }, userId: { in: [...followedCreatorIds] }, user: { isBanned: false, id: { notIn: blockedIds } } }, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 140 }) : Promise.resolve([]),
    personalizedOr.length ? prisma.post.findMany({ where: { status: 'READY', visibility: 'PUBLIC', user: notBanned, OR: personalizedOr }, include, orderBy: [{ createdAt: 'desc' }, { likesCount: 'desc' }], take: 180 }) : Promise.resolve([]),
    prisma.post.findMany({ where: { status: 'READY', visibility: 'PUBLIC', user: notBanned }, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 }),
    ignoredPostIds.length ? prisma.post.findMany({ where: { id: { in: ignoredPostIds } }, select: { id: true } }) : Promise.resolve([]),
  ]);
  const ignoredSet = new Set(ignored.map((item) => item.id));
  const unique = new Map<string, typeof trending[number]>();
  for (const post of [...recentPublic, ...trending, ...followedPosts, ...personalized]) if (!ignoredSet.has(post.id)) unique.set(post.id, post);
  const candidates = [...unique.values()];
  if (!candidates.length) return [];
  const ids = candidates.map((post) => post.id);
  const views = await prisma.viewEvent.groupBy({ by: ['postId'], where: { postId: { in: ids }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, _avg: { completedPct: true, watchMs: true }, _count: { _all: true } });
  const viewStats = new Map(views.map((item) => [item.postId, { averageCompletionPct: item._avg.completedPct ?? 0, averageWatchMs: item._avg.watchMs ?? 0, eventCount: item._count._all }]));
  return rankFeedCandidates({ candidates, signals, followedCreatorIds, likedCreatorIds, likedSoundIds, likedHashtags, showLessCreatorIds, viewStats });
}
