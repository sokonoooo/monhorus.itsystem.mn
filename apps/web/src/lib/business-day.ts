/**
 * Calendar days in the business timezone.
 *
 * ONE CONVENTION, AND IT IS NOT THE VIEWER'S. A "day" in this system means a day in
 * Ulaanbaatar: the backend bounds every day with `dayBounds(instant, APP_TIMEZONE)`, the
 * calendar endpoint states `timezone: 'Asia/Ulaanbaatar'` in its own response, the report
 * PDFs format in it, and every timestamp the web app prints already passes
 * `timeZone: 'Asia/Ulaanbaatar'`. A client that framed its day boundaries in the browser's
 * zone would be the only participant disagreeing, and it would disagree by eight hours.
 *
 * The bugs this replaces were both that disagreement:
 *   - a report range built as `${date}T00:00:00.000Z` dropped 00:00-08:00 of its first day
 *     and swallowed 00:00-08:00 of the day after its last, so a call logged at 07:00 on the
 *     first day of the month never appeared in that month's report;
 *   - the calendar bucketed events by browser-local midnight while labelling every date in
 *     Ulaanbaatar, so a viewer outside UTC+8 saw an event dated 21 Aug drawn in the 20 Aug
 *     cell, and the fetch window missed the events at the edges entirely.
 *
 * `Intl` resolves the offset, so daylight saving is the platform's problem rather than an
 * offset constant's. Mongolia does not observe it today; nothing here depends on that.
 *
 * This mirrors `apps/backend/src/common/utils/day-bounds.util.ts` deliberately — same
 * approach, same edge cases — so the two ends of a request agree by construction.
 *
 * A `DateKey` is a calendar date (`YYYY-MM-DD`), not an instant: exactly what an
 * `<input type="date">` holds and what a URL filter carries.
 */

/** The zone every calendar day in this system is measured in. */
export const BUSINESS_TIME_ZONE = 'Asia/Ulaanbaatar';

/** A calendar date as `YYYY-MM-DD`. */
export type DateKey = string;

/** The zone's offset from UTC at a given instant, in minutes. */
function offsetMinutes(instant: Date): number {
  // Formatting the instant as if it were UTC and diffing against the real instant yields
  // the offset without hardcoding it.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const lookup = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    lookup('year'),
    lookup('month') - 1,
    lookup('day'),
    // A midnight in some zones formats the hour as 24; normalise it to 0.
    lookup('hour') % 24,
    lookup('minute'),
    lookup('second'),
  );

  return (asUtc - instant.getTime()) / 60_000;
}

/** `YYYY-MM-DD` for an instant, as the business timezone sees it. */
export function businessDateKey(instant: Date | string | number): DateKey {
  const date = instant instanceof Date ? instant : new Date(instant);
  // `en-CA` formats as YYYY-MM-DD, which is exactly the shape wanted.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Today, in the business timezone. */
export function todayDateKey(): DateKey {
  return businessDateKey(new Date());
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The numeric parts of a date key. Anything unparseable falls back to the epoch. */
function partsOf(date: DateKey): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return { year: 1970, month: 1, day: 1 };
  }
  return { year: year!, month: month!, day: day! };
}

/**
 * The instant a business day begins, as an ISO string.
 *
 * Midnight local expressed as UTC: take the naive UTC midnight and shift it back by the
 * offset in force at that moment. For Ulaanbaatar `2026-08-21` becomes
 * `2026-08-20T16:00:00.000Z`, which is what makes an event at 07:00 on the 21st fall
 * inside a range framed on the 21st.
 *
 * Also the right end for a half-open `[from, to)` window such as the calendar endpoint's:
 * pass the day AFTER the last one shown, rather than that day's final millisecond.
 */
export function businessDayStart(date: DateKey): string {
  return new Date(startMs(date)).toISOString();
}

function startMs(date: DateKey): number {
  const { year, month, day } = partsOf(date);
  const naiveMidnight = Date.UTC(year, month - 1, day);
  return naiveMidnight - offsetMinutes(new Date(naiveMidnight)) * 60_000;
}

/**
 * The last instant of a business day, as an ISO string.
 *
 * Inclusive — 23:59:59.999 local — because the API filters read `dateTo` as `$lte`. Derived
 * from the NEXT day's start rather than by adding 86_399_999 ms, so a day that a zone
 * change made longer or shorter still ends where the next one begins.
 */
export function businessDayEnd(date: DateKey): string {
  return new Date(startMs(addDays(date, 1)) - 1).toISOString();
}

/**
 * `days` after a date key.
 *
 * Pure calendar arithmetic through `Date.UTC`, which has no offsets to trip over: the key
 * is a date, and the day after the 31st is the 1st regardless of any zone.
 */
export function addDays(date: DateKey, days: number): DateKey {
  const { year, month, day } = partsOf(date);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** `months` after a date key, landing on the first of that month. */
export function addMonthsToMonthStart(date: DateKey, months: number): DateKey {
  const { year, month } = partsOf(date);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-01`;
}

/** The first of the month containing a date key. */
export function monthStartDateKey(date: DateKey): DateKey {
  const { year, month } = partsOf(date);
  return `${year}-${pad(month)}-01`;
}

/** The last day of the month containing a date key. */
export function monthEndDateKey(date: DateKey): DateKey {
  return addDays(addMonthsToMonthStart(date, 1), -1);
}

/** Monday of the week containing a date key, matching the Mongolian working week. */
export function weekStartDateKey(date: DateKey): DateKey {
  const { year, month, day } = partsOf(date);
  // `getUTCDay` is Sunday-first; rotate so Monday is 0.
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

/** The day-of-month a key names, for the number printed in a grid cell. */
export function dayOfMonth(date: DateKey): number {
  return partsOf(date).day;
}

/** Whether two keys fall in the same calendar month. */
export function sameMonth(left: DateKey, right: DateKey): boolean {
  return left.slice(0, 7) === right.slice(0, 7);
}

/** Whole days from `from` to `to`, both date keys. */
export function daysBetween(from: DateKey, to: DateKey): number {
  const start = partsOf(from);
  const end = partsOf(to);
  return Math.round(
    (Date.UTC(end.year, end.month - 1, end.day) -
      Date.UTC(start.year, start.month - 1, start.day)) /
      86_400_000,
  );
}

/** First day of the current month, in the business timezone. */
export function currentMonthStartDateKey(): DateKey {
  return monthStartDateKey(todayDateKey());
}
