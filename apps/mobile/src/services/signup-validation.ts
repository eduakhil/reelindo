export function usernameSuggestions(displayName: string) {
  const base = displayName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9._]+/g, '.').replace(/^[._]+|[._]+$/g, '').slice(0, 24);
  if (base.length < 3) return [];
  return [...new Set([base, `${base}.reel`, `hey_${base}`.slice(0, 30)])].filter((value) => value.length <= 30);
}

export function formatDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseBirthDate(value: string, now = new Date()): { isoDate?: string; error?: string } {
  if (!value) return { error: 'Enter your date of birth.' };
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return { error: 'Use the format MM/DD/YYYY.' };
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const birthday = new Date(Date.UTC(year, month - 1, day));
  if (birthday.getUTCFullYear() !== year || birthday.getUTCMonth() !== month - 1 || birthday.getUTCDate() !== day) {
    return { error: 'Enter a valid calendar date.' };
  }
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cutoff.setFullYear(cutoff.getFullYear() - 16);
  const cutoffDate = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (isoDate > cutoffDate) return { error: 'You must be at least 16 years old to sign up.' };
  return { isoDate };
}
