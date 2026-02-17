/**
 * Kyiv Timezone Utilities
 *
 * All spin-reset logic MUST use Kyiv timezone (Europe/Kyiv).
 * Kyiv observes EET (UTC+2) in winter and EEST (UTC+3) in summer.
 * DST is handled automatically via Intl APIs.
 */

const KYIV_TZ = 'Europe/Kyiv';

/**
 * Get today's date string in Kyiv timezone (YYYY-MM-DD format).
 * Used to compare against lastSpinDate for daily spin reset.
 */
export function getKyivDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: KYIV_TZ });
}

/**
 * Get the Kyiv UTC offset in milliseconds at a given moment.
 * Returns positive value for east of UTC (e.g., UTC+3 → +10_800_000).
 */
function getKyivOffsetMs(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: KYIV_TZ,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
  // tzName examples: "GMT+3", "GMT+2"
  const match = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  return sign * (hours * 60 + minutes) * 60 * 1000;
}

/**
 * Get the UTC timestamp for the next 00:00:00 in Kyiv timezone.
 *
 * Example (during EEST, UTC+3):
 *   If now is 2024-06-01 22:30 Kyiv, next midnight = 2024-06-02 00:00 Kyiv = 2024-06-01 21:00 UTC
 */
export function getNextKyivMidnight(from: Date = new Date()): Date {
  const kyivDateStr = getKyivDateString(from); // "2024-06-01"
  const [year, month, day] = kyivDateStr.split('-').map(Number);

  // The UTC time for "next day 00:00:00 Kyiv" =
  //   Date.UTC(nextDay 00:00:00) − kyivOffsetMs
  // Because: Kyiv_time = UTC_time + offset  →  UTC_time = Kyiv_time − offset
  const nextDayUtcMidnight = Date.UTC(year, month - 1, day + 1, 0, 0, 0);
  const offsetMs = getKyivOffsetMs(new Date(nextDayUtcMidnight));
  return new Date(nextDayUtcMidnight - offsetMs);
}

/**
 * Check whether a lastSpinDate string (YYYY-MM-DD, Kyiv) matches today in Kyiv.
 * Returns true if the user has already spun today.
 */
export function hasSpunTodayKyiv(lastSpinDate: string | null | undefined): boolean {
  if (!lastSpinDate) return false;
  return lastSpinDate === getKyivDateString();
}
