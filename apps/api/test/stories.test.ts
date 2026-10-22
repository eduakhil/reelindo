import { canViewStory } from '../src/modules/stories/routes.js';

const access = (overrides: Partial<Parameters<typeof canViewStory>[0]> = {}) => canViewStory({
  ownerId: 'owner',
  viewerId: 'viewer',
  audience: 'FOLLOWERS',
  isPrivate: false,
  followed: false,
  closeFriend: false,
  blocked: false,
  ...overrides,
});

describe('canViewStory', () => {
  it('allows an owner to view their own stories', () => {
    expect(access({ ownerId: 'viewer', audience: 'CLOSE_FRIENDS' })).toBe(true);
  });

  it('allows followers to view follower stories but not Close Friends stories', () => {
    expect(access({ followed: true })).toBe(true);
    expect(access({ followed: true, audience: 'CLOSE_FRIENDS' })).toBe(false);
  });

  it('allows only Close Friends to view Close Friends stories', () => {
    expect(access({ audience: 'CLOSE_FRIENDS', closeFriend: true })).toBe(true);
    expect(access({ audience: 'CLOSE_FRIENDS' })).toBe(false);
  });

  it('keeps private stories limited to approved followers and denies blocked viewers', () => {
    expect(access({ audience: 'CLOSE_FRIENDS', isPrivate: true, closeFriend: true })).toBe(false);
    expect(access({ audience: 'CLOSE_FRIENDS', isPrivate: true, followed: true, closeFriend: true })).toBe(true);
    expect(access({ followed: true, blocked: true })).toBe(false);
  });
});
