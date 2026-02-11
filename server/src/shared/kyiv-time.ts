/**
 * Get today's date string in Kyiv timezone (YYYY-MM-DD).
 * Used for spin cooldown comparisons — reset at 00:00 Kyiv time.
 */
export function getKyivDateString(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now); // returns YYYY-MM-DD
}

/**
 * Get the next midnight in Kyiv timezone (DST-safe).
 */
export function getNextKyivMidnight(): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const kyivHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const kyivMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const kyivSecond = parseInt(parts.find(p => p.type === 'second')?.value || '0');

  const elapsedSinceKyivMidnight = (kyivHour * 3600 + kyivMinute * 60 + kyivSecond) * 1000;
  const currentMidnight = new Date(now.getTime() - elapsedSinceKyivMidnight);
  return new Date(currentMidnight.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Get the start of today (midnight) in Kyiv timezone as a UTC Date.
 * Useful for querying "today's" records in the database.
 */
export function getKyivMidnightToday(): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const s = parseInt(parts.find(p => p.type === 'second')?.value || '0');

  return new Date(now.getTime() - (h * 3600 + m * 60 + s) * 1000);
}
