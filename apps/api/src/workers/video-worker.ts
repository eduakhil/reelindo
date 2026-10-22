import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { S3Client, DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import './feed-interest-worker.js';

const required = ['DATABASE_URL', 'REDIS_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required for the video worker`);
const prisma = new PrismaClient();
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT!, region: process.env.S3_REGION ?? 'auto', forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
const bucket = process.env.S3_BUCKET!;
const connection = { url: process.env.REDIS_URL! };

type Payload = { postId: string; sourceUrl: string; trimStart?: number; trimEnd?: number; coverUrl?: string };
async function runFfmpeg(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`)));
  });
}

async function processVideo(job: Job<Payload>) {
  const { postId, sourceUrl, trimStart = 0, trimEnd, coverUrl } = job.data;
  const work = await mkdtemp(join(tmpdir(), 'reelindo-video-'));
  try {
    const inputPath = join(work, 'input');
    const download = await fetch(sourceUrl);
    if (!download.ok || !download.body) throw new Error(`Could not fetch upload (${download.status})`);
    const source = Buffer.from(await download.arrayBuffer());
    await writeFile(inputPath, source);
    const probe = await new Promise<{ width: number; height: number; duration: number; hasAudio: boolean }>((resolve, reject) => {
      const child = spawn(process.env.FFPROBE_PATH ?? 'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', inputPath]);
      let output = ''; child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); }); child.once('error', reject); child.once('close', (code) => {
        try { if (code !== 0) throw new Error('ffprobe failed'); const data = JSON.parse(output) as { streams?: Array<{ codec_type?: string; width?: number; height?: number }>; format?: { duration?: string } }; const video = data.streams?.find((stream) => stream.codec_type === 'video'); resolve({ width: video?.width ?? 0, height: video?.height ?? 0, duration: Number(data.format?.duration ?? 0), hasAudio: data.streams?.some((stream) => stream.codec_type === 'audio') ?? false }); } catch (error) { reject(error); }
      });
    });
    if (probe.duration <= 0 || probe.duration > 180) throw new Error('Video must be between 1 second and 3 minutes');
    const effectiveEnd = Math.min(trimEnd ?? probe.duration, probe.duration);
    if (trimStart >= effectiveEnd) throw new Error('Trim start must be earlier than video end');
    const trimmedDuration = effectiveEnd - trimStart;
    const trimArgs = ['-ss', String(trimStart)];
    const thumbnail = join(work, 'thumbnail.jpg');
    await runFfmpeg(['-y', ...trimArgs, '-i', inputPath, '-ss', '0.5', '-frames:v', '1', '-vf', 'scale=720:-2', thumbnail]);
    const preview = join(work, 'preview.mp4');
    await runFfmpeg(['-y', ...trimArgs, '-i', inputPath, '-t', String(Math.min(3, trimmedDuration)), '-vf', 'scale=360:-2', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-movflags', '+faststart', preview]);
    const hlsDir = join(work, 'hls'); await mkdir(hlsDir);
    const hlsArgs = ['-y', ...trimArgs, '-i', inputPath, '-t', String(trimmedDuration), '-filter_complex', '[0:v]split=2[v360][v720];[v360]scale=w=640:h=1136:force_original_aspect_ratio=decrease:force_divisible_by=2[v0];[v720]scale=w=720:h=1280:force_original_aspect_ratio=decrease:force_divisible_by=2[v1]', '-map', '[v0]', ...(probe.hasAudio ? ['-map', '0:a?'] : []), '-c:v:0', 'libx264', '-b:v:0', '800k', ...(probe.hasAudio ? ['-c:a:0', 'aac', '-b:a:0', '96k'] : []), '-map', '[v1]', ...(probe.hasAudio ? ['-map', '0:a?'] : []), '-c:v:1', 'libx264', '-b:v:1', '1800k', ...(probe.hasAudio ? ['-c:a:1', 'aac', '-b:a:1', '128k'] : []), '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(hlsDir, 'segment_%v_%03d.ts'), '-master_pl_name', 'master.m3u8', '-var_stream_map', probe.hasAudio ? 'v:0,a:0 v:1,a:1' : 'v:0 v:1', join(hlsDir, 'stream_%v.m3u8')];
    await runFfmpeg(hlsArgs);
    const baseKey = `processed/${postId}/${randomUUID()}`;
    const publicBase = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, '');
    const files = await readdir(hlsDir, { withFileTypes: true });
    const outputKeys = files.filter((entry) => entry.isFile()).map((entry) => `${baseKey}/${entry.name}`);
    if (!coverUrl) outputKeys.push(`${baseKey}/thumbnail.jpg`);
    outputKeys.push(`${baseKey}/preview.mp4`);
    for (const entry of files) {
      if (!entry.isFile()) continue;
      const file = entry.name;
      const body = await readFile(join(hlsDir, file));
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${baseKey}/${file}`, Body: body, ContentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t' }));
    }
    const image = await readFile(thumbnail); const previewBytes = await readFile(preview);
    await Promise.all([
      ...(coverUrl ? [] : [s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${baseKey}/thumbnail.jpg`, Body: image, ContentType: 'image/jpeg' }))]),
      s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${baseKey}/preview.mp4`, Body: previewBytes, ContentType: 'video/mp4' })),
    ]);
    const url = async (key: string) => publicBase ? `${publicBase}/${key}` : getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 * 30 });
    const published = await prisma.post.updateMany({ where: { id: postId, status: 'PROCESSING' }, data: { videoUrl: await url(`${baseKey}/master.m3u8`), thumbnailUrl: coverUrl ?? await url(`${baseKey}/thumbnail.jpg`), previewUrl: await url(`${baseKey}/preview.mp4`), duration: effectiveEnd - trimStart, width: probe.width, height: probe.height, status: 'READY' } });
    if (!published.count && outputKeys.length) {
      const deleted = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: outputKeys.map((Key) => ({ Key })), Quiet: true } }));
      if (deleted.Errors?.length) throw new Error('Could not clean up unpublished video outputs');
    }
  } catch (error) {
    await prisma.post.updateMany({ where: { id: postId, status: 'PROCESSING' }, data: { status: 'FAILED' } }).catch(() => undefined);
    throw error;
  } finally { await rm(work, { recursive: true, force: true }); }
}

const worker = new Worker<Payload>('video-processing', processVideo, { connection, concurrency: 2 });
worker.on('completed', (job) => console.info(`Processed post ${job.data.postId}`));
worker.on('failed', (job, error) => console.error(`Failed post ${job?.data.postId}:`, error));
console.info('Reelindo video worker started');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void worker.close().finally(() => prisma.$disconnect()));
