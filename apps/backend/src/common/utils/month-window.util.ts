/**
 * Month arithmetic for the six-month series the dashboard and the portal both draw.
 *
 * One definition, because two would eventually disagree about where a month starts and the
 * two screens would then quietly report different totals for the same data. Everything
 * here works in the DEPLOYMENT timezone rather than the server's: a request raised at
 * 01:00 in Ulaanbaatar on the first belongs to that month, and `getMonth()` on a UTC host
 * would file it under the previous one.
 */

/** `YYYY-MM` in the given timezone. */
export function monthKeyOf(moment: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(moment);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

/**
 * The `count` month keys ending with the month `now` falls in, oldest first.
 *
 * Walked back a month at a time from the first of the current month rather than by
 * subtracting days, so a 28- or 31-day month cannot slide the window.
 */
export function monthWindow(now: Date, timeZone: string, count: number): string[] {
  const keys: string[] = [];
  const [year, month] = monthKeyOf(now, timeZone).split('-').map(Number) as [number, number];
  for (let back = count - 1; back >= 0; back -= 1) {
    const shifted = new Date(Date.UTC(year, month - 1 - back, 1));
    keys.push(
      `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`,
    );
  }
  return keys;
}

/**
 * The instant a month key stops covering — the first moment of the month after it.
 *
 * Derived by asking the zone what the UTC instant looks like locally and correcting by the
 * difference, which is exact for a zone at a whole-hour offset with no DST. A boundary an
 * hour out would move at most the records raised in that hour into the neighbouring month.
 */
export function monthEnd(key: string, timeZone: string): Date {
  const [year, month] = key.split('-').map(Number) as [number, number];
  const utcStartOfNext = Date.UTC(year, month, 1);
  const probe = new Date(utcStartOfNext);
  const asZoned = new Date(probe.toLocaleString('en-US', { timeZone }));
  return new Date(utcStartOfNext - (asZoned.getTime() - probe.getTime()));
}

/** The first moment the oldest month in a window covers. */
export function windowStart(months: readonly string[], timeZone: string): Date {
  const firstEnd = monthEnd(months[0] ?? '1970-01', timeZone);
  const start = new Date(firstEnd.getTime());
  start.setUTCMonth(start.getUTCMonth() - 1);
  return start;
}
