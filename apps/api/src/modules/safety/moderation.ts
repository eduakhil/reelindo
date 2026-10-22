const defaultBlockedWords = ['fuck', 'shit', 'bitch', 'asshole', 'cunt'];

export function moderateText(text: string) {
  const customWords = (process.env.BANNED_WORDS ?? '').split(',').map((word) => word.trim()).filter(Boolean);
  const words = [...new Set([...defaultBlockedWords, ...customWords])];
  const normalized = text.normalize('NFKC').toLocaleLowerCase();
  const flaggedWord = words.find((word) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(word)}([^\\p{L}\\p{N}_]|$)`, 'iu').test(normalized));
  return { allowed: !flaggedWord, provider: 'basic-word-filter', category: flaggedWord ? 'ABUSIVE_LANGUAGE' : 'CLEAR' } as const;
}

export async function moderateMedia(mediaUrl: string): Promise<'CLEAR' | 'FLAGGED' | 'NOT_CONFIGURED'> {
  const endpoint = process.env.MODERATION_API_URL;
  if (!endpoint) return 'NOT_CONFIGURED';
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.MODERATION_API_KEY ? { authorization: `Bearer ${process.env.MODERATION_API_KEY}` } : {}) }, body: JSON.stringify({ mediaUrl }) });
  if (!response.ok) throw Object.assign(new Error('Content moderation provider is unavailable'), { code: 'MODERATION_UNAVAILABLE' });
  const result = zMediaResult(await response.json());
  return result.safe ? 'CLEAR' : 'FLAGGED';
}

function zMediaResult(value: unknown): { safe: boolean } {
  if (typeof value !== 'object' || value === null || !('safe' in value) || typeof value.safe !== 'boolean') throw Object.assign(new Error('Content moderation provider returned an invalid result'), { code: 'MODERATION_UNAVAILABLE' });
  return { safe: value.safe };
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
