import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { CreateBucketCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3ServiceException, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { moderateMedia } from '../safety/moderation.js';
import { matchesMediaSignature } from '../safety/media-validation.js';

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;

export function canViewStory(input: {
  ownerId: string;
  viewerId: string;
  audience: 'FOLLOWERS' | 'CLOSE_FRIENDS';
  isPrivate: boolean;
  followed: boolean;
  closeFriend: boolean;
  blocked: boolean;
}) {
  if (input.ownerId === input.viewerId) return true;
  if (input.blocked || (input.isPrivate && !input.followed)) return false;
  return input.audience === 'CLOSE_FRIENDS' ? input.closeFriend : input.followed;
}

export function registerStoryRoutes(app: FastifyInstance, prisma: PrismaClient, requireUser: Auth, s3: S3Client | null, bucket: string | undefined, publicBaseUrl: string | undefined) {
  app.post('/stories/upload-url', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    if (!s3 || !bucket) return reply.code(503).send({ code: 'UPLOADS_UNAVAILABLE', message: 'Object storage has not been configured' });
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (!(error instanceof S3ServiceException) || (error.$metadata.httpStatusCode !== 404 && error.name !== 'NotFound' && error.name !== 'NoSuchBucket')) throw error;
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (createError) {
        if (!(createError instanceof S3ServiceException) || !['BucketAlreadyExists', 'BucketAlreadyOwnedByYou'].includes(createError.name)) throw createError;
      }
    }
    const input = z.object({ fileName: z.string().min(1).max(180).regex(/^[\w.-]+$/), contentType: z.enum(['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp']), fileSize: z.number().int().positive().max(100 * 1024 * 1024) }).superRefine((value, context) => {
      if (value.contentType.startsWith('image/') && value.fileSize > 25 * 1024 * 1024) context.addIssue({ code: 'custom', path: ['fileSize'], message: 'Story images must be 25 MB or smaller' });
    }).parse(request.body);
    const extension = input.fileName.split('.').pop()?.toLowerCase() ?? 'bin';
    const key = `uploads/${userId}/stories/${randomBytes(16).toString('hex')}.${extension}`;
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: input.contentType, ContentLength: input.fileSize }), { expiresIn: 600 });
    return reply.code(201).send({ uploadUrl, key, expiresIn: 600, requiredHeaders: { 'Content-Type': input.contentType } });
  });

  app.post('/stories', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    if (!s3 || !bucket) return reply.code(503).send({ code: 'UPLOADS_UNAVAILABLE', message: 'Object storage has not been configured' });
    if (!publicBaseUrl) return reply.code(503).send({ code: 'MEDIA_CDN_REQUIRED', message: 'Configure a stable public media URL before publishing stories' });
    const input = z.object({
      mediaKey: z.string().min(1).max(500),
      mediaType: z.enum(['VIDEO', 'PHOTO']),
      audience: z.enum(['FOLLOWERS', 'CLOSE_FRIENDS']).default('FOLLOWERS'),
      caption: z.string().trim().max(200).default(''),
      textStyle: z.enum(['BOLD', 'SERIF', 'TYPEWRITER', 'NEON']).default('BOLD'),
      filter: z.enum(['NONE', 'WARM', 'COOL', 'DREAM']).default('NONE'),
      soundId: z.string().uuid().nullable().optional(),
      overlays: z.array(z.discriminatedUnion('type', [
        z.object({
          type: z.literal('STICKER'),
          value: z.string().trim().min(1).max(16),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          scale: z.number().min(0.5).max(3),
        }).strict(),
        z.object({
          type: z.literal('DRAW'),
          points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(2).max(250),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          width: z.number().min(0.002).max(0.04),
        }).strict(),
      ])).max(20).default([]),
    }).parse(request.body);
    if (input.audience === 'CLOSE_FRIENDS' && !await prisma.closeFriend.findFirst({ where: { ownerId: userId }, select: { friendId: true } })) {
      return reply.code(400).send({ code: 'CLOSE_FRIENDS_EMPTY', message: 'Add at least one Close Friend before sharing to that audience' });
    }
    if (!input.mediaKey.startsWith(`uploads/${userId}/stories/`)) return reply.code(400).send({ code: 'INVALID_MEDIA_KEY', message: 'Story media must use your story upload path' });
    let uploaded;
    try {
      uploaded = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: input.mediaKey }));
    } catch (error) {
      if (error instanceof S3ServiceException && (error.$metadata.httpStatusCode === 404 || error.name === 'NotFound' || error.name === 'NoSuchKey')) {
        return reply.code(400).send({ code: 'MEDIA_NOT_UPLOADED', message: 'Upload the story media before publishing' });
      }
      request.log.error({ err: error, userId }, 'Could not verify uploaded story media');
      throw error;
    }
    if (!uploaded.ContentLength) return reply.code(400).send({ code: 'MEDIA_NOT_UPLOADED', message: 'Upload the story media before publishing' });
    if (uploaded.ContentLength > 100 * 1024 * 1024) return reply.code(400).send({ code: 'MEDIA_TOO_LARGE', message: 'Story media must be 100 MB or smaller' });
    if (input.mediaType === 'PHOTO' && uploaded.ContentLength > 25 * 1024 * 1024) return reply.code(400).send({ code: 'MEDIA_TOO_LARGE', message: 'Story images must be 25 MB or smaller' });
    const contentType = uploaded.ContentType ?? '';
    const expectedPrefix = input.mediaType === 'VIDEO' ? 'video/' : 'image/';
    if (!contentType.startsWith(expectedPrefix) || !await matchesMediaSignature(s3, bucket, input.mediaKey, contentType, input.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE')) return reply.code(400).send({ code: 'INVALID_MEDIA_TYPE', message: 'The uploaded file does not match the selected story media type' });
    const mediaUrl = `${publicBaseUrl.replace(/\/$/, '')}/${input.mediaKey}`;
    let moderation: 'CLEAR' | 'FLAGGED' | 'NOT_CONFIGURED';
    try { moderation = await moderateMedia(mediaUrl); }
    catch (error) {
      request.log.error({ err: error, userId }, 'Story media moderation failed');
      return reply.code(503).send({ code: 'MODERATION_UNAVAILABLE', message: 'Content moderation is temporarily unavailable' });
    }
    if (moderation === 'FLAGGED') return reply.code(400).send({ code: 'CONTENT_REJECTED', message: 'This media did not pass the content safety check' });
    if (input.soundId && !await prisma.sound.findUnique({ where: { id: input.soundId }, select: { id: true } })) {
      return reply.code(400).send({ code: 'SOUND_NOT_FOUND', message: 'Choose a sound that is still available' });
    }
    const existing = await prisma.story.findUnique({
      where: { mediaKey: input.mediaKey },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        sound: { select: { id: true, title: true, artist: true, audioUrl: true, coverUrl: true } },
      },
    });
    if (existing) {
      if (existing.userId !== userId) return reply.code(409).send({ code: 'MEDIA_ALREADY_PUBLISHED', message: 'This media has already been published' });
      return reply.code(200).send(existing);
    }
    const story = await prisma.story.create({
      data: {
        userId,
        mediaKey: input.mediaKey,
        mediaUrl,
        mediaType: input.mediaType,
        audience: input.audience,
        caption: input.caption || null,
        textStyle: input.textStyle,
        filter: input.filter,
        overlays: input.overlays,
        soundId: input.soundId ?? null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        sound: { select: { id: true, title: true, artist: true, audioUrl: true, coverUrl: true } },
      },
    });
    return reply.code(201).send(story);
  });

  app.get('/stories/feed', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const now = new Date();
    const blocked = await prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } });
    const blockedIds = blocked.map((entry) => entry.blockerId === userId ? entry.blockedId : entry.blockerId);
    const follows = await prisma.follow.findMany({ where: { followerId: userId, status: 'ACCEPTED' }, select: { followingId: true } });
    const closeFriendOwners = await prisma.closeFriend.findMany({ where: { friendId: userId }, select: { ownerId: true } });
    const followedIds = new Set([userId, ...follows.map((entry) => entry.followingId)]);
    const closeFriendIds = new Set(closeFriendOwners.map((entry) => entry.ownerId));
    const visibleUserIds = [...new Set([...followedIds, ...closeFriendIds])].filter((id) => id === userId || !blockedIds.includes(id));
    const stories = await prisma.story.findMany({ where: { userId: { in: visibleUserIds }, expiresAt: { gt: now }, user: { isBanned: false } }, include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, isPrivate: true } }, sound: { select: { id: true, title: true, artist: true, audioUrl: true, coverUrl: true } }, views: { where: { viewerId: userId }, select: { storyId: true } } }, orderBy: { createdAt: 'asc' } });
    const groups = new Map<string, { user: { id: string; username: string; displayName: string; avatarUrl: string | null }; stories: Array<Record<string, unknown>>; hasUnviewed: boolean }>();
    for (const story of stories) {
      const followed = followedIds.has(story.userId);
      const closeFriend = closeFriendIds.has(story.userId);
      if (!canViewStory({ ownerId: story.userId, viewerId: userId, audience: story.audience, isPrivate: story.user.isPrivate, followed, closeFriend, blocked: false })) continue;
      const entry = groups.get(story.userId) ?? { user: { id: story.user.id, username: story.user.username, displayName: story.user.displayName, avatarUrl: story.user.avatarUrl }, stories: [], hasUnviewed: false };
      const viewed = story.userId === userId || story.views.length > 0;
      entry.stories.push({ id: story.id, mediaUrl: story.mediaUrl, mediaType: story.mediaType, audience: story.audience, caption: story.caption, textStyle: story.textStyle, filter: story.filter, overlays: story.overlays, sound: story.sound, createdAt: story.createdAt, expiresAt: story.expiresAt, viewerHasViewed: viewed });
      if (!viewed) entry.hasUnviewed = true;
      groups.set(story.userId, entry);
    }
    return [...groups.entries()].map(([id, value]) => ({ userId: id, user: value.user, stories: value.stories, hasUnviewed: value.hasUnviewed }));
  });

  app.post('/stories/:id/view', async (request, reply) => {
    const viewerId = await requireUser(request, reply); if (!viewerId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const story = await prisma.story.findFirst({ where: { id, expiresAt: { gt: new Date() }, user: { isBanned: false } }, select: { id: true, userId: true, audience: true, user: { select: { isPrivate: true } } } });
    if (!story) return reply.code(404).send({ code: 'STORY_NOT_FOUND', message: 'Story not found or expired' });
    if (story.userId !== viewerId) {
      const [follow, block, closeFriend] = await Promise.all([
        prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: story.userId } }, select: { status: true } }),
        prisma.block.findFirst({ where: { OR: [{ blockerId: viewerId, blockedId: story.userId }, { blockerId: story.userId, blockedId: viewerId }] } }),
        prisma.closeFriend.findUnique({ where: { ownerId_friendId: { ownerId: story.userId, friendId: viewerId } }, select: { friendId: true } }),
      ]);
      const followed = follow?.status === 'ACCEPTED';
      if (!canViewStory({ ownerId: story.userId, viewerId, audience: story.audience, isPrivate: story.user.isPrivate, followed, closeFriend: Boolean(closeFriend), blocked: Boolean(block) })) {
        return reply.code(404).send({ code: 'STORY_NOT_FOUND', message: 'Story not found' });
      }
      await prisma.storyView.upsert({ where: { storyId_viewerId: { storyId: id, viewerId } }, create: { storyId: id, viewerId }, update: { viewedAt: new Date() } });
    }
    return { viewed: true };
  });

  app.get('/stories/:id/viewers', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const story = await prisma.story.findFirst({ where: { id, userId, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (!story) return reply.code(404).send({ code: 'STORY_NOT_FOUND', message: 'Story not found' });
    const views = await prisma.storyView.findMany({ where: { storyId: id }, include: { viewer: { select: { id: true, username: true, displayName: true, avatarUrl: true } } }, orderBy: { viewedAt: 'desc' } });
    return { items: views.map(({ viewer, viewedAt }) => ({ ...viewer, viewedAt })) };
  });

  app.delete('/stories/:id', async (request, reply) => {
    const userId = await requireUser(request, reply); if (!userId) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const removed = await prisma.story.deleteMany({ where: { id, userId } });
    if (!removed.count) return reply.code(404).send({ code: 'STORY_NOT_FOUND', message: 'Story not found' });
    return reply.code(204).send();
  });
}
