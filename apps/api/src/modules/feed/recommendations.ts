import { createHash } from 'node:crypto';

export type FeedSignal = { kind: string; signalKey: string; score: number };
export type FeedCandidate = {
  id: string;
  userId: string;
  createdAt: Date;
  soundId: string | null;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  hashtags: Array<{ hashtag: { name: string } }>;
  user: { _count: { posts: number; followers: number } };
};
export type FeedViewStats = { averageCompletionPct: number; averageWatchMs: number; eventCount: number };
export type ScoredCandidate<T extends FeedCandidate> = { post: T; score: number; reasons: string[] };

export function getFeedVariant(userId: string, v2Percent: number): 'v1' | 'v2' {
  const bucket = createHash('sha256').update(userId).digest().readUInt32BE(0) % 100;
  return bucket < Math.max(0, Math.min(100, v2Percent)) ? 'v2' : 'v1';
}

export function rankFeedCandidates<T extends FeedCandidate>(input: {
  candidates: T[];
  signals: FeedSignal[];
  followedCreatorIds: Set<string>;
  likedCreatorIds: Set<string>;
  likedSoundIds: Set<string>;
  likedHashtags: Set<string>;
  showLessCreatorIds: Set<string>;
  viewStats: Map<string, FeedViewStats>;
  now?: Date;
}): Array<ScoredCandidate<T>> {
  const now = input.now ?? new Date();
  const signalScores = new Map(input.signals.map((signal) => [`${signal.kind}:${signal.signalKey.toLowerCase()}`, signal.score]));
  const scored = input.candidates.map((post) => {
    const reasons: string[] = [];
    let score = 0;
    if (input.followedCreatorIds.has(post.userId)) { score += 20; reasons.push('From a creator you follow'); }
    const creatorInterest = signalScores.get(`CREATOR:${post.userId}`) ?? 0;
    if (creatorInterest > 0) { score += Math.min(creatorInterest, 8) * 2; reasons.push('Based on creators you watch'); }
    const hashtagMatches = post.hashtags.map(({ hashtag }) => hashtag.name.toLowerCase()).filter((name) => input.likedHashtags.has(name) || (signalScores.get(`HASHTAG:${name}`) ?? 0) > 0);
    if (hashtagMatches.length) { score += Math.min(12, hashtagMatches.reduce((sum, name) => sum + (2 + (signalScores.get(`HASHTAG:${name}`) ?? 0)), 0)); reasons.push(`Matches #${hashtagMatches[0]}`); }
    const soundInterest = post.soundId ? signalScores.get(`SOUND:${post.soundId}`) ?? 0 : 0;
    if (post.soundId && (input.likedSoundIds.has(post.soundId) || soundInterest > 0)) { score += 6 + Math.min(soundInterest, 4); reasons.push('Uses a sound you enjoy'); }
    if (input.likedCreatorIds.has(post.userId) || post.hashtags.some(({ hashtag }) => input.likedHashtags.has(hashtag.name.toLowerCase())) || Boolean(post.soundId && input.likedSoundIds.has(post.soundId))) {
      score += 5; reasons.push('Similar to a post you liked');
    }
    const ageHours = Math.max(0, (now.getTime() - post.createdAt.getTime()) / 3_600_000);
    const trend = Math.log1p(post.likesCount * 2 + post.commentsCount * 4 + post.sharesCount * 7 + post.viewsCount * 0.05);
    score += trend * 1.8 + Math.max(0, 8 - ageHours / 12);
    score += Math.min(4, Math.log1p(post.user._count.followers));
    if (ageHours < 72) reasons.push('Popular and recent');
    const stats = input.viewStats.get(post.id);
    if (stats?.eventCount) {
      score += Math.max(-8, Math.min(12, (stats.averageCompletionPct - 35) * 0.16));
      score += Math.min(3, stats.averageWatchMs / 10_000);
      score += Math.min(4, Math.log1p(stats.eventCount));
      if (stats.averageCompletionPct < 15) score -= 5;
      if (stats.averageCompletionPct > 75) reasons.push('People tend to watch this one through');
    }
    if (post.user._count.posts <= 3 && ageHours < 24 * 7) { score += 10; reasons.push('A fresh creator to discover'); }
    if (input.showLessCreatorIds.has(post.userId)) { score -= 12; reasons.push('Reduced because you asked to see less from this creator'); }
    if (!reasons.length) reasons.push('Recommended for you');
    return { post, score: Number(score.toFixed(4)), reasons };
  }).sort((a, b) => b.score - a.score || b.post.createdAt.getTime() - a.post.createdAt.getTime() || a.post.id.localeCompare(b.post.id));

  const diversified: Array<ScoredCandidate<T>> = [];
  const remaining = [...scored];
  while (remaining.length) {
    const last = diversified.at(-1)?.post.userId;
    const previous = diversified.at(-2)?.post.userId;
    const index = last && previous === last ? remaining.findIndex((item) => item.post.userId !== last) : 0;
    diversified.push(remaining.splice(index < 0 ? 0 : index, 1)[0]!);
  }
  return diversified;
}
