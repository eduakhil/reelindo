import { getFeedVariant, rankFeedCandidates, type FeedCandidate } from '../src/modules/feed/recommendations.js';

const post = (id: string, userId: string, hashtags: string[] = []): FeedCandidate => ({
  id, userId, createdAt: new Date('2026-10-21T12:00:00Z'), soundId: null,
  likesCount: 20, commentsCount: 3, sharesCount: 1, viewsCount: 200,
  hashtags: hashtags.map((name) => ({ hashtag: { name } })),
  user: { _count: { posts: 1, followers: 12 } },
});

describe('feed recommendations', () => {
  it('assigns a user to the same experiment bucket each time', () => {
    expect(getFeedVariant('user-1', 50)).toBe(getFeedVariant('user-1', 50));
    expect(getFeedVariant('user-1', 0)).toBe('v1');
    expect(getFeedVariant('user-1', 100)).toBe('v2');
  });

  it('uses interest signals and avoids three consecutive posts from one creator', () => {
    const ranked = rankFeedCandidates({
      candidates: [post('1', 'creator-a'), post('2', 'creator-a'), post('3', 'creator-a'), post('4', 'creator-b', ['travel']), post('5', 'creator-c'), post('6', 'creator-d')],
      signals: [{ kind: 'HASHTAG', signalKey: 'travel', score: 2 }],
      followedCreatorIds: new Set(), likedCreatorIds: new Set(), likedSoundIds: new Set(),
      likedHashtags: new Set(), showLessCreatorIds: new Set(), viewStats: new Map(), now: new Date('2026-10-21T13:00:00Z'),
    });
    expect(ranked[0]?.post.id).toBe('4');
    for (let index = 2; index < ranked.length; index += 1) {
      expect(ranked[index]?.post.userId === ranked[index - 1]?.post.userId && ranked[index]?.post.userId === ranked[index - 2]?.post.userId).toBe(false);
    }
  });
});
