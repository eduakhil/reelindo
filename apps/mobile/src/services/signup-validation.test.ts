import { formatDateInput, parseBirthDate, usernameSuggestions } from './signup-validation';

declare function describe(name: string, run: () => void): void;
declare function it(name: string, run: () => void): void;
declare function expect(actual: unknown): {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
};

describe('signup validation helpers', () => {
  it('suggests valid usernames from display names', () => {
    expect(usernameSuggestions('Amita Shah')).toEqual(['amita.shah', 'amita.shah.reel', 'hey_amita.shah']);
    expect(usernameSuggestions('A')).toEqual([]);
  });

  it('formats typed birth dates as MM/DD/YYYY', () => {
    expect(formatDateInput('10212010')).toBe('10/21/2010');
    expect(formatDateInput('10/2x/2010more')).toBe('10/22/010');
  });

  it('validates real dates and the minimum age', () => {
    const today = new Date(2026, 9, 21, 12);
    expect(parseBirthDate('10/21/2010', today)).toEqual({ isoDate: '2010-10-21' });
    expect(parseBirthDate('10/22/2010', today).error).toBe('You must be at least 16 years old to sign up.');
    expect(parseBirthDate('02/29/2011', today).error).toBe('Enter a valid calendar date.');
  });
});
