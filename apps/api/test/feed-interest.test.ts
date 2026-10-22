import { jest } from '@jest/globals';
import { refreshFeedInterests } from '../src/modules/feed/interest-service.js';

describe('refreshFeedInterests', () => {
  it('creates creator, hashtag, and sound signals from completed views and likes', async () => {
    const at = new Date();
    const event = { completedPct: 90, watchMs: 45_000, createdAt: at, post: { userId: 'creator-id', soundId: 'sound-id', hashtags: [{ hashtag: { name: 'travel' } }] } };
    const tx = { feedInterestSignal: { deleteMany: jest.fn(), createMany: jest.fn() } };
    const prisma = {
      viewEvent: { findMany: jest.fn(async () => [event]) },
      like: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn((callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };

    const count = await refreshFeedInterests(prisma as never, 'viewer-id');

    expect(count).toBe(3);
    expect(tx.feedInterestSignal.deleteMany).toHaveBeenCalledWith({ where: { userId: 'viewer-id' } });
    expect(tx.feedInterestSignal.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ kind: 'CREATOR', signalKey: 'creator-id' }),
      expect.objectContaining({ kind: 'SOUND', signalKey: 'sound-id' }),
      expect.objectContaining({ kind: 'HASHTAG', signalKey: 'travel' }),
    ]) });
  });

  it('clears stale signals when a user has no recent positive interests', async () => {
    const tx = { feedInterestSignal: { deleteMany: jest.fn(), createMany: jest.fn() } };
    const prisma = {
      viewEvent: { findMany: jest.fn(async () => []) },
      like: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn((callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };

    expect(await refreshFeedInterests(prisma as never, 'viewer-id')).toBe(0);
    expect(tx.feedInterestSignal.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.feedInterestSignal.createMany).not.toHaveBeenCalled();
  });
});
