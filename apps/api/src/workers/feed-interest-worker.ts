import 'dotenv/config';
import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { refreshFeedInterests } from '../modules/feed/interest-service.js';

if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required for the feed-interest worker');
const prisma = new PrismaClient();
const worker = new Worker<{ userId: string }>('feed-interest-refresh', async (job) => {
  if (!/^[0-9a-f-]{36}$/i.test(job.data.userId)) throw new Error('Invalid user ID in feed-interest job');
  return refreshFeedInterests(prisma, job.data.userId);
}, { connection: { url: process.env.REDIS_URL }, concurrency: 4 });

worker.on('completed', (job, count) => console.info(`Updated ${count} feed signals for ${job.data.userId}`));
worker.on('failed', (job, error) => console.error(`Feed-interest refresh failed for ${job?.data.userId}:`, error));
console.info('Reelindo feed-interest worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void worker.close().finally(() => prisma.$disconnect()));
