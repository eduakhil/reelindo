import type { PrismaClient } from '@prisma/client';

type SignalKind = 'CREATOR' | 'HASHTAG' | 'SOUND';

export async function refreshFeedInterests(prisma: PrismaClient, userId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [events, likes] = await Promise.all([
    prisma.viewEvent.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' }, take: 500,
      select: { completedPct: true, watchMs: true, createdAt: true, post: { select: { userId: true, soundId: true, hashtags: { select: { hashtag: { select: { name: true } } } } } } },
    }),
    prisma.like.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' }, take: 300,
      select: { createdAt: true, post: { select: { userId: true, soundId: true, hashtags: { select: { hashtag: { select: { name: true } } } } } } },
    }),
  ]);

  const scores = new Map<string, number>();
  const add = (kind: SignalKind, value: string | null | undefined, weight: number, createdAt: Date) => {
    if (!value || !Number.isFinite(weight)) return;
    const ageDays = Math.max(0, (Date.now() - createdAt.getTime()) / 86_400_000);
    const key = `${kind}:${value.toLowerCase()}`;
    scores.set(key, (scores.get(key) ?? 0) + weight * Math.exp(-ageDays / 21));
  };
  for (const event of events) {
    const weight = (event.completedPct >= 75 ? 1.5 : event.completedPct >= 35 ? 0.65 : -0.5) + Math.min(0.5, event.watchMs / 120_000);
    add('CREATOR', event.post.userId, weight, event.createdAt);
    add('SOUND', event.post.soundId, weight, event.createdAt);
    for (const { hashtag } of event.post.hashtags) add('HASHTAG', hashtag.name, weight, event.createdAt);
  }
  for (const like of likes) {
    add('CREATOR', like.post.userId, 2, like.createdAt);
    add('SOUND', like.post.soundId, 2, like.createdAt);
    for (const { hashtag } of like.post.hashtags) add('HASHTAG', hashtag.name, 2, like.createdAt);
  }

  const updatedAt = new Date();
  const data = [...scores.entries()].filter(([, score]) => score >= 0.35).sort((a, b) => b[1] - a[1]).slice(0, 100).map(([key, score]) => {
    const separator = key.indexOf(':');
    return { userId, kind: key.slice(0, separator), signalKey: key.slice(separator + 1), score: Number(score.toFixed(4)), updatedAt };
  });
  await prisma.$transaction(async (tx) => {
    await tx.feedInterestSignal.deleteMany({ where: { userId } });
    if (data.length) await tx.feedInterestSignal.createMany({ data });
  });
  return data.length;
}
