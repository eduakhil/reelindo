import { resolvePostVisibility } from '../src/modules/create/schemas.js';

describe('resolvePostVisibility', () => {
  it('publishes all new posts from public accounts to everyone', () => {
    expect(resolvePostVisibility(false, 'PUBLIC')).toBe('PUBLIC');
    expect(resolvePostVisibility(false, 'FOLLOWERS')).toBe('PUBLIC');
    expect(resolvePostVisibility(false, 'PRIVATE')).toBe('PUBLIC');
  });

  it('preserves the requested audience for private accounts', () => {
    expect(resolvePostVisibility(true, 'PUBLIC')).toBe('PUBLIC');
    expect(resolvePostVisibility(true, 'FOLLOWERS')).toBe('FOLLOWERS');
    expect(resolvePostVisibility(true, 'PRIVATE')).toBe('PRIVATE');
  });
});
