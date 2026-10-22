import { afterEach, describe, expect, it } from '@jest/globals';
import { moderateText } from '../src/modules/safety/moderation.js';

const previousBannedWords = process.env.BANNED_WORDS;

afterEach(() => {
  if (previousBannedWords === undefined) delete process.env.BANNED_WORDS;
  else process.env.BANNED_WORDS = previousBannedWords;
});

describe('moderateText', () => {
  it('allows ordinary text', () => {
    expect(moderateText('A lovely day for a walk')).toMatchObject({ allowed: true, category: 'CLEAR' });
  });

  it('blocks configured words as whole words, case insensitively', () => {
    process.env.BANNED_WORDS = 'spoilerword';
    expect(moderateText('That is a SPOILERWORD!')).toMatchObject({ allowed: false, category: 'ABUSIVE_LANGUAGE' });
    expect(moderateText('spoilerwording is a different word')).toMatchObject({ allowed: true });
  });

  it('normalizes compatibility characters before matching', () => {
    expect(moderateText('ＦＵＣＫ')).toMatchObject({ allowed: false, category: 'ABUSIVE_LANGUAGE' });
  });
});
