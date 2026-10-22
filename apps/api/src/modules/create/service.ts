import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import { CreateBucketCommand, HeadBucketCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand, S3ServiceException, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { createPostSchema, resolvePostVisibility, uploadSchema } from './schemas.js';
import { sendExpoPush } from '../inbox/push.js';
import { moderateMedia } from '../safety/moderation.js';
import { matchesMediaSignature } from '../safety/media-validation.js';

type UploadInput = z.infer<typeof uploadSchema>;
type CreatePostInput = z.infer<typeof createPostSchema>;

export async function createUploadUrl(s3: S3Client, bucket: string, publicBaseUrl: string | undefined, userId: string, input: UploadInput) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (!(error instanceof S3ServiceException) || (error.$metadata.httpStatusCode !== 404 && error.name !== 'NotFound' && error.name !== 'NoSuchBucket')) throw error;
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (createError) {
      if (!(createError instanceof S3ServiceException) || (createError.name !== 'BucketAlreadyExists' && createError.name !== 'BucketAlreadyOwnedByYou')) throw createError;
    }
  }
  const extension = input.fileName.split('.').pop()?.toLowerCase() ?? 'bin';
  const key = `uploads/${userId}/${randomBytes(16).toString('hex')}.${extension}`;
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: input.contentType, ContentLength: input.fileSize });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
  const assetUrl = publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, '')}/${key}` : await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });
  return { uploadUrl, key, assetUrl, expiresIn: 600, requiredHeaders: { 'Content-Type': input.contentType } };
}

export async function createPost(prisma: PrismaClient, videoQueue: Queue | null, s3: S3Client, bucket: string, publicBaseUrl: string | undefined, userId: string, input: CreatePostInput) {
  if (!publicBaseUrl) throw Object.assign(new Error('Configure S3_PUBLIC_BASE_URL to a stable public CDN origin before publishing'), { code: 'MEDIA_CDN_REQUIRED' });
  if (!input.mediaKey.startsWith(`uploads/${userId}/`)) throw Object.assign(new Error('Media must be uploaded to your account storage path'), { code: 'INVALID_MEDIA_KEY' });
  if (input.type === 'REEL' && input.trimStart !== undefined && input.trimEnd !== undefined && input.trimEnd <= input.trimStart) throw Object.assign(new Error('Trim end must be after trim start'), { code: 'INVALID_TRIM' });
  let uploaded;
  try {
    uploaded = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: input.mediaKey }));
  } catch (error) {
    if (error instanceof S3ServiceException && (error.$metadata.httpStatusCode === 404 || error.name === 'NotFound' || error.name === 'NoSuchKey')) {
      throw Object.assign(new Error('Upload the media file before creating the post'), { code: 'MEDIA_NOT_UPLOADED' });
    }
    throw error;
  }
  if (!uploaded?.ContentLength) throw Object.assign(new Error('Upload the media file before creating the post'), { code: 'MEDIA_NOT_UPLOADED' });
  const maxMediaSize = input.type === 'PHOTO' ? 25 * 1024 * 1024 : 300 * 1024 * 1024;
  if (uploaded.ContentLength > maxMediaSize) throw Object.assign(new Error('The uploaded file is larger than the allowed size'), { code: 'MEDIA_TOO_LARGE' });
  const expectedKind = input.type === 'PHOTO' ? 'IMAGE' : 'VIDEO';
  const allowedContentType = expectedKind === 'IMAGE'
    ? ['image/jpeg', 'image/png', 'image/webp'].includes(uploaded.ContentType ?? '')
    : ['video/mp4', 'video/quicktime'].includes(uploaded.ContentType ?? '');
  if (!allowedContentType || !await matchesMediaSignature(s3, bucket, input.mediaKey, uploaded.ContentType ?? '', expectedKind)) {
    throw Object.assign(new Error('The uploaded file does not match the selected media type'), { code: 'INVALID_MEDIA_TYPE' });
  }
  if (input.coverKey && !input.coverKey.startsWith(`uploads/${userId}/`)) throw Object.assign(new Error('Cover image must be uploaded to your account storage path'), { code: 'INVALID_COVER_KEY' });
  if (input.coverKey) {
    let cover;
    try {
      cover = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: input.coverKey }));
    } catch (error) {
      if (error instanceof S3ServiceException && (error.$metadata.httpStatusCode === 404 || error.name === 'NotFound' || error.name === 'NoSuchKey')) {
        throw Object.assign(new Error('Upload the cover image before creating the post'), { code: 'COVER_NOT_UPLOADED' });
      }
      throw error;
    }
    if (!cover.ContentLength) throw Object.assign(new Error('Upload the cover image before creating the post'), { code: 'COVER_NOT_UPLOADED' });
    if (cover.ContentLength > 25 * 1024 * 1024) throw Object.assign(new Error('Cover images must be 25 MB or smaller'), { code: 'COVER_TOO_LARGE' });
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(cover.ContentType ?? '') || !await matchesMediaSignature(s3, bucket, input.coverKey, cover.ContentType ?? '', 'IMAGE')) {
      throw Object.assign(new Error('The cover file must be a JPEG, PNG, or WebP image'), { code: 'INVALID_COVER_TYPE' });
    }
  }
  const mediaUrl = `${publicBaseUrl.replace(/\/$/, '')}/${input.mediaKey}`;
  const coverUrl = input.coverKey ? `${publicBaseUrl.replace(/\/$/, '')}/${input.coverKey}` : input.thumbnailUrl;
  const moderation = await moderateMedia(mediaUrl);
  if (moderation === 'FLAGGED') throw Object.assign(new Error('This media did not pass the content safety check'), { code: 'CONTENT_REJECTED' });
  const isPhoto = input.type === 'PHOTO';
  if (!isPhoto && !videoQueue) throw Object.assign(new Error('Video processing queue is not configured'), { code: 'PROCESSING_UNAVAILABLE' });
  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({ where: { id: userId }, select: { isPrivate: true } });
    if (!account) throw Object.assign(new Error('Creator account not found'), { code: 'USER_NOT_FOUND' });
    const visibility = resolvePostVisibility(account.isPrivate, input.visibility);
    const existingPost = await tx.post.findUnique({
      where: { sourceMediaKey: input.mediaKey },
      select: { id: true, status: true, createdAt: true, userId: true, type: true },
    });
    if (existingPost) {
      if (existingPost.userId !== userId) throw Object.assign(new Error('This media has already been published by another account'), { code: 'MEDIA_ALREADY_PUBLISHED' });
      if (existingPost.status === 'FAILED' && existingPost.type === 'REEL') {
        const retry = await tx.post.update({
          where: { id: existingPost.id },
          data: { status: 'PROCESSING', videoUrl: mediaUrl, thumbnailUrl: coverUrl ?? null, previewUrl: null, visibility },
          select: { id: true, status: true, createdAt: true },
        });
        return { post: retry, recipients: [] as string[], username: '' };
      }
      return { post: { id: existingPost.id, status: existingPost.status, createdAt: existingPost.createdAt }, recipients: [] as string[], username: '' };
    }
    const post = await tx.post.create({
      data: {
        userId,
        type: input.type,
        caption: input.caption ?? null,
        sourceMediaKey: input.mediaKey,
        videoUrl: isPhoto ? null : mediaUrl,
        thumbnailUrl: isPhoto ? mediaUrl : coverUrl ?? null,
        duration: input.duration ?? null,
        trimStart: input.type === 'REEL' ? input.trimStart ?? 0 : null,
        trimEnd: input.type === 'REEL' ? input.trimEnd ?? null : null,
        width: input.width ?? null,
        height: input.height ?? null,
        visibility,
        allowComments: input.allowComments,
        soundId: input.soundId ?? null,
        status: isPhoto ? 'READY' : 'PROCESSING',
        ...(isPhoto ? { media: { create: { url: mediaUrl, order: 0 } } } : {}),
      },
      select: { id: true, status: true, createdAt: true },
    });
    const hashtagNames = [...new Set((input.caption?.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((tag) => tag.slice(1).toLowerCase()).filter((tag) => tag.length <= 100))];
    if (hashtagNames.length) {
      const hashtags = await Promise.all(hashtagNames.map((name) => tx.hashtag.upsert({ where: { name }, create: { name, postsCount: 1 }, update: { postsCount: { increment: 1 } } })));
      await tx.postHashtag.createMany({ data: hashtags.map((hashtag) => ({ postId: post.id, hashtagId: hashtag.id })), skipDuplicates: true });
    }
    if (input.soundId) await tx.sound.update({ where: { id: input.soundId }, data: { usesCount: { increment: 1 } } });
    const mentionedNames = [...new Set((input.caption?.match(/@[a-zA-Z0-9._]{3,30}/g) ?? []).map((mention) => mention.slice(1).toLowerCase()))];
    const mentioned = mentionedNames.length
      ? await tx.user.findMany({ where: { username: { in: mentionedNames }, isBanned: false }, select: { id: true } })
      : [];
    if (mentioned.length) {
      await tx.mention.createMany({ data: mentioned.map((user) => ({ postId: post.id, userId: user.id })) });
      const recipients = mentioned.filter((user) => user.id !== userId);
      if (recipients.length) {
        await tx.notification.createMany({ data: recipients.map((user) => ({ userId: user.id, actorId: userId, type: 'MENTION', postId: post.id })) });
      }
    }
    const actor = mentioned.length
      ? await tx.user.findUnique({ where: { id: userId }, select: { username: true } })
      : null;
    return { post, recipients: mentioned.filter((user) => user.id !== userId).map((user) => user.id), username: actor?.username ?? 'Someone' };
  });
  const { post } = result;
  for (const recipientId of result.recipients) {
    void sendExpoPush(prisma, recipientId, 'You were mentioned', `@${result.username} mentioned you in a post`, { type: 'MENTION', postId: post.id })
      .catch((error: unknown) => console.warn('Could not send post mention notification.', error));
  }
  if (post.status === 'PROCESSING') {
    try {
      await videoQueue!.add('transcode', { postId: post.id, sourceUrl: mediaUrl, trimStart: input.trimStart ?? 0, trimEnd: input.trimEnd, coverUrl }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 500 });
    } catch (error) {
      await prisma.post.update({ where: { id: post.id }, data: { status: 'FAILED' } });
      throw Object.assign(new Error('Your upload was saved, but Reel processing could not be started. Open your profile to see the failed post.'), {
        code: 'PROCESSING_QUEUE_FAILED',
        postId: post.id,
        cause: error,
      });
    }
  }
  return post;
}
