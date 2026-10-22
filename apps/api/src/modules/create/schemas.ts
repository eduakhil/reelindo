import { z } from 'zod';

export const uploadSchema = z.object({
  fileName: z.string().min(1).max(180).regex(/^[\w.-]+$/),
  contentType: z.enum(['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp']),
  fileSize: z.number().int().positive().max(300 * 1024 * 1024),
}).superRefine((input, context) => {
  if (input.contentType.startsWith('image/') && input.fileSize > 25 * 1024 * 1024) {
    context.addIssue({ code: 'custom', path: ['fileSize'], message: 'Images must be 25 MB or smaller' });
  }
});

export const createPostSchema = z.object({
  type: z.enum(['REEL', 'PHOTO']),
  caption: z.string().max(2200).optional(),
  mediaKey: z.string().min(1).max(500),
  mediaUrl: z.string().url(),
  coverKey: z.string().min(1).max(500).optional(),
  thumbnailUrl: z.string().url().optional(),
  duration: z.number().positive().max(180).optional(),
  trimStart: z.number().min(0).max(180).optional(),
  trimEnd: z.number().positive().max(180).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  visibility: z.enum(['PUBLIC', 'FOLLOWERS', 'PRIVATE']).default('PUBLIC'),
  allowComments: z.boolean().default(true),
  soundId: z.string().uuid().optional(),
});

export type PostVisibility = 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE';

export function resolvePostVisibility(isPrivateAccount: boolean, requested: PostVisibility): PostVisibility {
  return isPrivateAccount ? requested : 'PUBLIC';
}
